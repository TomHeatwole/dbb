#!/bin/bash
# Fetches historical KTC Superflex (non-TEP) values from the Community Trade Value
# Data Google Sheet and writes long-format CSV to site/public/data/.
#
# Also builds a name → ID map (KTC playerID + Sleeper ID) once up-front and embeds
# those IDs in every historical row.
#
# Source sheet: SF Historical Data tab
# Name map:     site/public/data/ktc_historical_name_ids.csv
#
# Output columns: date, name, ktc_value, ktc_player_id, sleeper_id
#
# Usage (run from project root):
#   bash scripts/fetch_sf_non_tep_ktc_historical.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_CSV="$PROJECT_ROOT/site/public/data/sf_non_tep_ktc_values_historical.csv"
NAME_MAP="$PROJECT_ROOT/site/public/data/ktc_historical_name_ids.csv"
FETCHER="$PROJECT_ROOT/ktc_scrape/fetch_sf_historical.py"
TMP_WIDE="$(mktemp /tmp/sf_ktc_hist_wide_XXXXXX.csv)"
TMP_KTC_HTML="$(mktemp /tmp/ktc_rankings_XXXXXX.html)"

SHEET_ID="1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs"
SHEET_NAME="SF Historical Data"
SOURCE_URL="https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${SHEET_NAME}'))")"

cleanup() { rm -f "$TMP_WIDE" "$TMP_KTC_HTML"; }
trap cleanup EXIT

echo "Fetching SF Historical KTC data from Community Trade Value Data sheet..."
curl -sS --fail \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "$SOURCE_URL" \
  -o "$TMP_WIDE"

echo "Fetching KTC dynasty rankings for playerID lookup..."
curl -sS --fail \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "https://keeptradecut.com/dynasty-rankings" \
  -o "$TMP_KTC_HTML"

echo "Building name → ID map..."
node "$SCRIPT_DIR/build_ktc_historical_name_map.js" \
  --from-wide-csv "$TMP_WIDE" \
  --ktc-html "$TMP_KTC_HTML"

echo "Converting to long format with embedded IDs..."
python3 "$FETCHER" "$TMP_WIDE" -o "$OUT_CSV" --name-map "$NAME_MAP"

echo "Rebuilding merged SF TE+ historical board..."
python3 "$SCRIPT_DIR/build_sf_ktc_values_historical.py"
