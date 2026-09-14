#!/usr/bin/env bash
# Start Appium against the local Android SDK / JDK 17 install.
set -euo pipefail

if [[ "$(uname -s)" == "Darwin" ]]; then
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:/opt/homebrew/bin:$PATH"
else
  export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-$(dpkg --print-architecture 2>/dev/null || uname -m)}"
  if [[ -z "${ANDROID_HOME:-}" ]]; then
    if [[ -d /usr/lib/android-sdk ]]; then
      export ANDROID_HOME="/usr/lib/android-sdk"
    else
      export ANDROID_HOME="$HOME/Android/Sdk"
    fi
  fi
  export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
fi
export ANDROID_SDK_ROOT="$ANDROID_HOME"

exec appium --address 127.0.0.1 --port "${APPIUM_PORT:-4723}" \
  --allow-insecure '*:chromedriver_autodownload' \
  --log-timestamp --log-no-colors "$@"
