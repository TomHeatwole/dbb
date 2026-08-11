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
#   2b. Fetches the ffb Ultimate Draft Kit rankings (paywalled content) and
#       writes CSVs to the private companion repo
#       → dbbp/ffb-udk/ffb_udk_{qb,rb,wr,te,top200,superflex}.csv
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

echo ""

# ── 2b. ffb UDK rankings → dbbp/ffb-udk/*.csv (private repo) ──────────────────

echo "FFB UDK rankings: computing rankings and matching players to Sleeper IDs..."
node "$SCRIPT_DIR/process_udk_rankings.js"

echo ""

# ── 3. FantasyPros rankings → fantasypros_<name>.csv ──────────────────────────

bash "$SCRIPT_DIR/download_fantasypros.sh"
