#!/usr/bin/env bash
# Start Appium against the local Android SDK / JDK 17 install.
set -euo pipefail

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:/opt/homebrew/bin:$PATH"

exec appium --address 127.0.0.1 --port "${APPIUM_PORT:-4723}" \
  --allow-insecure '*:chromedriver_autodownload' \
  --log-timestamp --log-no-colors "$@"
