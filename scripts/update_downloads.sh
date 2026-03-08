#!/bin/bash
# Updates dynasty rankings data:
#
#   1. Fetches player values from the FantasyCalc public API and writes
#      → site/public/data/fantasycalc.csv
#
#   2. Fetches the ffb dynasty startup rankings page,
#      matches players to Sleeper IDs, and writes
#      → site/public/data/ffb.csv
#
# Usage (run from project root):
#   bash scripts/update_downloads.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 1. FantasyCalc ─────────────────────────────────────────────────────────────

echo "FantasyCalc: fetching dynasty values from API..."
node "$SCRIPT_DIR/process_fantasycalc_rankings.js"

echo ""

# ── 2. ffb rankings → ffb.csv ─────────────────────────

echo "FFB rankings: matching players to Sleeper IDs..."
node "$SCRIPT_DIR/process_ffb_rankings.js"
