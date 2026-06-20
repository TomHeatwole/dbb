#!/bin/bash
# Fetch daily SF TE+ KTC history for a single player profile page.
#
# Usage (run from project root):
#   bash scripts/fetch_ktc_tep_player_history.sh brock-bowers-1612
#   bash scripts/fetch_ktc_tep_player_history.sh brock-bowers-1612 brock-bowers.csv

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/fetch_ktc_tep_player_history.sh <ktc-slug> [output-filename.csv]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FETCHER="$PROJECT_ROOT/ktc_scrape/fetch_player_tep_history.py"
NAME_MAP="$PROJECT_ROOT/site/public/data/ktc_historical_name_ids.csv"
OUT_DIR="$PROJECT_ROOT/site/public/data/tep_values"

SLUG="$1"
if [[ $# -ge 2 ]]; then
  OUT_FILE="$OUT_DIR/$2"
else
  # brock-bowers-1612 -> brock-bowers.csv
  BASE="${SLUG%-*}"
  OUT_FILE="$OUT_DIR/${BASE}.csv"
fi

TMP_HTML="$(mktemp /tmp/ktc_tep_profile_XXXXXX.html)"
cleanup() { rm -f "$TMP_HTML"; }
trap cleanup EXIT

PROFILE_URL="https://keeptradecut.com/dynasty-rankings/players/${SLUG}"
echo "Fetching KTC profile for ${SLUG}..."
curl -sS --fail \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "$PROFILE_URL" \
  -o "$TMP_HTML"

python3 "$FETCHER" "$TMP_HTML" -o "$OUT_FILE" --name-map "$NAME_MAP"
