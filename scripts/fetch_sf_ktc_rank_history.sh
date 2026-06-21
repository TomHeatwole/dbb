#!/bin/bash
# Fetches daily SF positional + overall rank history for every KTC dynasty player
# (QB/RB/WR/TE) from KTC profile pages.
#
# TE positional ranks use the SF TE+ board; other positions use regular Superflex.
#
# Output:
#   site/public/data/sf_ktc_pos_ranks_historical.csv
#   site/public/data/sf_ktc_rank_history_players.csv
#
# Usage (run from project root):
#   bash scripts/fetch_sf_ktc_rank_history.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_CSV="$PROJECT_ROOT/site/public/data/sf_ktc_pos_ranks_historical.csv"
PLAYERS_CSV="$PROJECT_ROOT/site/public/data/sf_ktc_rank_history_players.csv"
NAME_MAP="$PROJECT_ROOT/site/public/data/ktc_historical_name_ids.csv"
FETCHER="$PROJECT_ROOT/ktc_scrape/fetch_all_rank_history.py"
TMP_KTC_HTML="$(mktemp /tmp/ktc_rankings_XXXXXX.html)"

cleanup() { rm -f "$TMP_KTC_HTML"; }
trap cleanup EXIT

echo "Fetching KTC dynasty rankings for player slug list..."
curl -sS --fail \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "https://keeptradecut.com/dynasty-rankings" \
  -o "$TMP_KTC_HTML"

echo "Fetching SF rank history for all dynasty players (this may take several minutes)..."
python3 "$FETCHER" \
  --ktc-html "$TMP_KTC_HTML" \
  --name-map "$NAME_MAP" \
  --players-out "$PLAYERS_CSV" \
  -o "$OUT_CSV"
