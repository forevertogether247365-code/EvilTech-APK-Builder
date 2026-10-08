FROM node:24

# Java for javac/keytool + zip for APK packaging
RUN apt-get update -qq && apt-get install -y -qq openjdk-17-jdk-headless zip imagemagick >/dev/null

# Android build tools (aapt2, d8, zipalign, apksigner) + android.jar
RUN mkdir -p /opt/android-build && cd /opt/android-build \
  && curl -s -o bt.zip https://dl.google.com/android/repository/build-tools_r34-linux.zip \
  && unzip -q bt.zip && rm bt.zip && mv android-14 build-tools_r34 \
  && curl -s -o pf.zip https://dl.google.com/android/repository/platform-34-ext7_r03.zip \
  && unzip -q -o pf.zip 'android-34/*' && rm pf.zip

WORKDIR /app
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .

ENV PORT=3001
EXPOSE 3001
CMD ["npm", "start"]
