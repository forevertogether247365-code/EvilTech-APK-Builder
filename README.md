# EvilTech APK Builder

**Turn your code into an Android app.**

Paste HTML, CSS and JavaScript, customize your app, and build a real, signed,
installable `.apk` — right from the browser. No Android Studio, no Gradle.

## How it works

Frontend → Backend API → build queue → Android build worker → signed APK → download

The backend compiles a native Android WebView container around the user's code
using Android's own build tools (`aapt2`, `d8`, `zipalign`, `apksigner`) — the
same pipeline Android Studio uses underneath, driven directly. Each build runs
in an isolated temp directory with a hard timeout and is cleaned up afterwards.

## Deploy on Render (Blueprint)

1. Push this repo to GitHub.
2. Render dashboard → **New + → Blueprint** → pick the repo.
3. Render provisions the web service **and** a free Postgres database
   automatically (`render.yaml`). The `EVITECH_DB_URL` env var is wired for you.
4. Deploy. First build takes a few minutes (Docker image + Android toolchain).

The Docker image includes everything needed for real APK builds:
Node 24, Java 17, Android build-tools r34 and the API 34 platform jar.

## Local development

```bash
npm install
export EVITECH_DB_URL="postgres://..."   # any Postgres
npm start
```

Requirements: Java 17, zip, ImageMagick, and the Android build toolchain at
`/opt/android-build` (build-tools_r34 + android-34/android.jar).

## Notes

- No login: each browser gets its own private workspace automatically.
- Users never see server internals; build failures return friendly messages.
- APKs auto-delete 24 hours after a successful build.
