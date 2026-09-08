#!/usr/bin/env bash
# Start Appium if needed, then round-robin FanDuel NCAAF Drive Result odds.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:/opt/homebrew/bin:$PATH"

APPIUM_URL="${APPIUM_URL:-http://127.0.0.1:4723}"

if [[ -z "${DATABASE_URL:-}" && -f "$ROOT/site/.env.local" ]]; then
  while IFS= read -r line; do
    case "$line" in
      DATABASE_URL=*)
        DATABASE_URL="${line#DATABASE_URL=}"
        DATABASE_URL="${DATABASE_URL%\"}"
        DATABASE_URL="${DATABASE_URL#\"}"
        export DATABASE_URL
        ;;
    esac
  done < "$ROOT/site/.env.local"
fi

if ! curl -sf "$APPIUM_URL/status" >/dev/null; then
  echo "Starting Appium on ${APPIUM_URL}…"
  nohup "$ROOT/scripts/start-appium.sh" >>/tmp/appium-watch.log 2>&1 &
  disown || true
  for _ in $(seq 1 50); do
    if curl -sf "$APPIUM_URL/status" >/dev/null; then
      break
    fi
    sleep 0.4
  done
  if ! curl -sf "$APPIUM_URL/status" >/dev/null; then
    echo "Appium failed to start. See /tmp/appium-watch.log" >&2
    exit 1
  fi
fi

exec node "$ROOT/scripts/watch_fanduel_drive_results.mjs" "$@"
