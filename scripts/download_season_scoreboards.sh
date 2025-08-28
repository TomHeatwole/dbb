#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   scripts/download_season_scoreboards.sh 2024
# Requires:
#   - jq
#   - curl
#   - python3 (for UTC-safe date stepping)
# Notes:
#   Reads site/public/data/{SEASON}/schedule_manifest.txt (JSON), enumerates all
#   dates across calendar entries, and downloads ESPN daily scoreboard blobs to:
#     site/public/data/{SEASON}/{YYYYMMDD}.txt

SEASON="${1:-2024}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC_DIR="$ROOT_DIR/site/public"
MANIFEST="$PUBLIC_DIR/data/$SEASON/schedule_manifest.txt"
OUT_DIR="$PUBLIC_DIR/data/$SEASON"

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required for this script." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required for this script." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required for this script." >&2
  exit 1
fi

if [[ ! -f "$MANIFEST" ]]; then
  echo "Error: schedule manifest not found at $MANIFEST" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "Reading manifest: $MANIFEST" >&2
RANGES_FILE="$(mktemp)"
trap 'rm -f "$RANGES_FILE" "$TMP_DAYS"' EXIT
# Extract all start/end ISO timestamps for all entries in all calendar buckets
jq -r '.leagues[0].calendar[] | .entries[] | [.startDate, .endDate] | @tsv' "$MANIFEST" > "$RANGES_FILE"

# Collect all YYYYMMDD tokens into a temp file to dedupe
TMP_DAYS="$(mktemp)"

# Loop over ranges without using mapfile (portable)
while IFS=$'\t' read -r start_iso end_iso; do
  [[ -z "${start_iso:-}" || -z "${end_iso:-}" ]] && continue
  # Enumerate days in UTC using python3 for portability
  python3 - "$start_iso" "$end_iso" >> "$TMP_DAYS" <<'PY'
import sys, datetime
start = datetime.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
end = datetime.datetime.fromisoformat(sys.argv[2].replace('Z', '+00:00'))
cur = start
one = datetime.timedelta(days=1)
# Cap at 370 days to avoid accidental runaway
for _ in range(370):
    if cur.date() > end.date():
        break
    print(cur.strftime('%Y%m%d'))
    cur = cur + one
PY

done < "$RANGES_FILE"

# Dedupe and sort
sort -u "$TMP_DAYS" -o "$TMP_DAYS"

# Download each day
while IFS= read -r day; do
  [[ -z "$day" ]] && continue
  out="$OUT_DIR/${day}.txt"
  url="https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${day}"
  echo "curl -ksS -o \"$out\" \"$url\"" >&2
  curl -ksS -o "$out" "$url"
  # Be a good citizen
  sleep 0.2
done < "$TMP_DAYS"

echo "Done. Files saved under $OUT_DIR" >&2 