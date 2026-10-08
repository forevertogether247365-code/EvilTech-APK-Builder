#!/bin/bash
# build-apk.sh — one real Android build, no Gradle, no Android Studio.
# Usage: build-apk.sh <workdir>
#   workdir contains:  project.json  (name, package, versionName, versionCode,
#                                      orientation, fullscreen, statusBar,
#                                      navBar, internet, iconPath, html/css/js)
# Produces: <workdir>/app.apk  (signed, aligned, installable)
set -u
WORK="$1"
BT_DIR="${EVITECH_BT_DIR:-$(ls -d /opt/android-build/build-tools_r34 $HOME/android-build/build-tools_r34 2>/dev/null | head -1)}"
PLATFORM_JAR="${EVITECH_PLATFORM_JAR:-$(ls /opt/android-build/android-34/android.jar $HOME/android-build/android-34/android.jar 2>/dev/null | head -1)}"
KEYSTORE="${EVITECH_KEYSTORE:-$HOME/.evitech/evitech.keystore}"
KS_PASS="${EVITECH_KS_PASS:-evitech-build}"

fail() { echo "BUILD_ERROR: $1" >&2; exit 1; }

[ -x "$BT_DIR/aapt2" ] || fail "aapt2 not found at $BT_DIR"
[ -f "$PLATFORM_JAR" ] || fail "android.jar not found at $PLATFORM_JAR"

cd "$WORK" || fail "cannot enter workdir"

# ── read project config ──
PKG=$(node -pe 'JSON.parse(require("fs").readFileSync("project.json","utf8")).package')
APP_NAME=$(node -pe 'JSON.parse(require("fs").readFileSync("project.json","utf8")).name')
VNAME=$(node -pe 'JSON.parse(require("fs").readFileSync("project.json","utf8")).versionName')
VCODE=$(node -pe 'JSON.parse(require("fs").readFileSync("project.json","utf8")).versionCode')
ORIENT=$(node -pe 'JSON.parse(require("fs").readFileSync("project.json","utf8")).orientation')
FULL=$(node -pe 'JSON.parse(require("fs").readFileSync("project.json","utf8")).fullscreen')
STATUS=$(node -pe 'JSON.parse(require("fs").readFileSync("project.json","utf8")).statusBar')
NAV=$(node -pe 'JSON.parse(require("fs").readFileSync("project.json","utf8")).navBar')
NET=$(node -pe 'JSON.parse(require("fs").readFileSync("project.json","utf8")).internet')
ICON=$(node -pe 'JSON.parse(require("fs").readFileSync("project.json","utf8")).iconPath')

# manifest orientation value
case "$ORIENT" in
  landscape) MORIENT="sensorLandscape";;
  auto)      MORIENT="fullSensor";;
  *)         MORIENT="portrait";;
esac

# theme: fullscreen hides everything, otherwise system bars per toggles
if [ "$FULL" = "true" ]; then THEME="Theme.Material.NoActionBar.Fullscreen"; else THEME="Theme.Material.NoActionBar"; fi

[ "$NET" = "true" ] && PERM='<uses-permission android:name="android.permission.INTERNET" />' || PERM=''

# ── 1. project skeleton ──
mkdir -p app/src app/res app/assets/www gen classes dex
echo "$PKG" > app/package.txt

# ── 2. manifest ──
sed -e "s|__PACKAGE__|$PKG|g" \
    -e "s|__APP_NAME__|$APP_NAME|g" \
    -e "s|__THEME__|$THEME|g" \
    -e "s|__ORIENTATION__|$MORIENT|g" \
    -e "s|__INTERNET_PERMISSION__|$PERM|g" \
    "$EVITECH_TEMPLATES/AndroidManifest.xml.tmpl" > app/AndroidManifest.xml

# ── 3. icons (all densities) ──
if [ -n "$ICON" ] && [ -f "$ICON" ]; then
  SRC="$ICON"
else
  SRC="${EVITECH_TEMPLATES}/default-icon.png"
fi
[ -f "$SRC" ] || fail "icon missing"
for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  dens=${d%%:*}; size=${d##*:}
  mkdir -p "app/res/mipmap-$dens"
  convert "$SRC" -resize "${size}x${size}" -background transparent -gravity center -extent "${size}x${size}" "app/res/mipmap-$dens/ic_launcher.png" || fail "icon resize failed ($dens)"
done

# ── 4. java source ──
PKG_PATH=$(echo "$PKG" | tr '.' '/')
mkdir -p "app/src/$PKG_PATH"
sed -e "s|__PACKAGE__|$PKG|g" \
    -e "s|__FULLSCREEN__|$FULL|g" \
    -e "s|__STATUS_BAR__|$STATUS|g" \
    -e "s|__NAV_BAR__|$NAV|g" \
    "$EVITECH_TEMPLATES/MainActivity.java.tmpl" > "app/src/$PKG_PATH/MainActivity.java"

# ── 5. user assets ──
cp "${EVITECH_TEMPLATES}/../user/index.html" app/assets/www/index.html 2>/dev/null || true
# user files are provided by the server directly in $WORK/user
if [ -f "$WORK/user/index.html" ]; then cp "$WORK/user/index.html" app/assets/www/index.html; fi
[ -f "$WORK/user/style.css" ] && cp "$WORK/user/style.css" app/assets/www/style.css
[ -f "$WORK/user/script.js" ] && cp "$WORK/user/script.js" app/assets/www/script.js

# ── 6. compile java → dex (UTF-8: containers often default to ASCII) ──
JAVAC_OUT=$(javac -encoding UTF-8 -source 8 -target 8 -nowarn -classpath "$PLATFORM_JAR" \
      -d classes "app/src/$PKG_PATH/MainActivity.java" 2>&1 | grep -v "bootstrap class path" || true)
if echo "$JAVAC_OUT" | grep -q "error:"; then
  echo "JAVAC: $JAVAC_OUT" >&2
  fail "app code compilation failed: $(echo "$JAVAC_OUT" | grep -m1 'error:' | cut -c1-160)"
fi
[ -d classes ] && [ -n "$(find classes -name '*.class')" ] || fail "java compilation failed"

"$BT_DIR/d8" --release --lib "$PLATFORM_JAR" --min-api 21 --output dex $(find classes -name '*.class') || fail "dexing failed"
[ -f dex/classes.dex ] || fail "classes.dex missing"

# ── 7. resources → base apk ──
"$BT_DIR/aapt2" compile --dir app/res -o res.zip || fail "resource compile failed"
"$BT_DIR/aapt2" link \
    -o unsigned.apk \
    -I "$PLATFORM_JAR" \
    --manifest app/AndroidManifest.xml \
    --min-sdk-version 21 --target-sdk-version 34 \
    --version-code "$VCODE" --version-name "$VNAME" \
    --auto-add-overlay \
    res.zip || fail "resource link failed"

# ── 8. add dex + assets ──
cp dex/classes.dex .
zip -q -j unsigned.apk classes.dex || fail "adding dex failed"
(cd app && zip -q -r ../unsigned.apk assets) || fail "adding assets failed"

# ── 9. align + sign ──
"$BT_DIR/zipalign" -f 4 unsigned.apk aligned.apk || fail "zipalign failed"

# keystore: generate once if missing
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -alias evitech -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=Evitech APK Builder, OU=Evitech, O=Evitech, C=US" >/dev/null 2>&1 || fail "keystore generation failed"
fi

"$BT_DIR/apksigner" sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" \
    --key-pass "pass:$KS_PASS" --out app.apk aligned.apk || fail "signing failed"

"$BT_DIR/apksigner" verify app.apk >/dev/null 2>&1 || fail "signature verification failed"

rm -f unsigned.apk aligned.apk classes.dex res.zip
rm -rf classes dex
echo "BUILD_OK: $WORK/app.apk"
