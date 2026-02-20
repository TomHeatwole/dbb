#!/bin/bash
# Updates dynasty rankings data from ~/Downloads:
#
#   1. Copies the most recent fantasycalc_dynasty_rankings* file
#      → site/public/data/fantasycalc.csv
#
#   2. Processes the most recent "Dynasty Startup Rankings - Fantasy Footballers
#      Podcast*.csv", matches players to Sleeper IDs, and writes
#      → site/public/data/ffb.csv
#
# Usage (run from project root):
#   bash scripts/update_downloads.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOWNLOADS_DIR="$HOME/Downloads"

# ── 1. FantasyCalc ─────────────────────────────────────────────────────────────

FC_OUT="$PROJECT_ROOT/site/public/data/fantasycalc.csv"
FC_LATEST=$(ls -t "$DOWNLOADS_DIR"/fantasycalc_dynasty_rankings* 2>/dev/null | head -1)

if [[ -z "$FC_LATEST" ]]; then
  echo "WARNING: No file matching 'fantasycalc_dynasty_rankings*' found in $DOWNLOADS_DIR — skipping FantasyCalc update"
else
  echo "FantasyCalc: found $FC_LATEST"
  cp "$FC_LATEST" "$FC_OUT"
  echo "FantasyCalc: copied → $FC_OUT"
fi

echo ""

# ── 2. Fantasy Footballers Podcast rankings → ffb.csv ─────────────────────────

echo "FFB rankings: matching players to Sleeper IDs..."
node "$SCRIPT_DIR/process_ffb_rankings.js"
