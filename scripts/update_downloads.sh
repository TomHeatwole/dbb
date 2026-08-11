#!/bin/bash
# Updates dynasty rankings data:
#
#   1. Fetches player values from the FantasyCalc public API and writes
#      → site/public/data/fantasycalc.csv
#
#   2. Cookie-based scrapes that live in the private dbbp repo (the scripts
#      and their saved session cookies must not ship with the public repo);
#      skipped entirely when dbbp/ is not checked out:
#        - ffb dynasty startup rankings → site/public/data/ffb.csv
#        - ffb Ultimate Draft Kit       → dbbp/ffb-udk/ffb_udk_*.csv
#        - Establish The Run redraft    → dbbp/etr/etr_*.csv
#
# Usage (run from project root):
#   bash scripts/update_downloads.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DBBP_SCRIPTS="$SCRIPT_DIR/../dbbp/scripts"

# ── 1. FantasyCalc ─────────────────────────────────────────────────────────────

echo "FantasyCalc: fetching dynasty values from API..."
node "$SCRIPT_DIR/process_fantasycalc_rankings.js"

echo ""

# ── 2. Cookie-based scrapes (private scripts in dbbp/scripts/) ────────────────

if [ -d "$DBBP_SCRIPTS" ]; then
  echo "FFB rankings: matching players to Sleeper IDs..."
  node "$DBBP_SCRIPTS/process_ffb_rankings.js"

  echo ""

  echo "FFB UDK rankings: computing rankings and matching players to Sleeper IDs..."
  node "$DBBP_SCRIPTS/process_udk_rankings.js"

  echo ""

  echo "ETR rankings: fetching and matching players to Sleeper IDs..."
  node "$DBBP_SCRIPTS/process_etr_rankings.js"

  echo ""
else
  echo "dbbp/scripts not found — skipping FFB + ETR cookie-based scrapes."
  echo ""
fi

# ── 3. FantasyPros rankings → fantasypros_<name>.csv ──────────────────────────

bash "$SCRIPT_DIR/download_fantasypros.sh"
