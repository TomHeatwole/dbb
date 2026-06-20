#!/bin/bash
# Fetches daily SF TE+ KTC values for all tight ends from KTC player profile pages.
# Non-TE historical SF values come from the Community Trade Value Data sheet instead.
#
# TE slugs are taken from KTC dynasty rankings (playersArray), supplemented by
# ktc_historical_name_ids.csv for historical TE names that still have a slug.
#
# Output: site/public/data/sf_tep_ktc_values_historical.csv
# Columns: date, name, ktc_value, ktc_player_id, sleeper_id
#
# Usage (run from project root):
#   bash scripts/fetch_sf_tep_ktc_historical.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_CSV="$PROJECT_ROOT/site/public/data/sf_tep_ktc_values_historical.csv"
NAME_MAP="$PROJECT_ROOT/site/public/data/ktc_historical_name_ids.csv"
FETCHER="$PROJECT_ROOT/ktc_scrape/fetch_all_te_tep_history.py"
TMP_KTC_HTML="$(mktemp /tmp/ktc_rankings_XXXXXX.html)"

cleanup() { rm -f "$TMP_KTC_HTML"; }
trap cleanup EXIT

if [[ ! -f "$NAME_MAP" ]]; then
  echo "Name map not found at $NAME_MAP — run fetch_sf_non_tep_ktc_historical.sh first." >&2
  exit 1
fi

echo "Fetching KTC dynasty rankings for TE slug list..."
curl -sS --fail \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "https://keeptradecut.com/dynasty-rankings" \
  -o "$TMP_KTC_HTML"

echo "Fetching SF TE+ history for all tight ends (this may take a few minutes)..."
python3 "$FETCHER" \
  --ktc-html "$TMP_KTC_HTML" \
  --name-map "$NAME_MAP" \
  -o "$OUT_CSV"

echo "Rebuilding merged SF TE+ historical board..."
python3 "$SCRIPT_DIR/build_sf_ktc_values_historical.py"
