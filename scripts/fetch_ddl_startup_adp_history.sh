#!/bin/bash
# Fetches historical dynasty startup ADP from Dynasty Data Lab (past 5 seasons by default).
# Merges type=picks (veterans) + type=rookies (incl. that year's draft class).
#
# Source: https://api.dynastydatalab.com/api/adp/adp
# Output: site/public/data/ddl_startup_adp_historical.csv
#
# Usage (run from project root):
#   bash scripts/fetch_ddl_startup_adp_history.sh
#   bash scripts/fetch_ddl_startup_adp_history.sh --start 2021 --end 2025

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FETCHER="$PROJECT_ROOT/ddl_scrape/fetch_startup_adp_history.py"
OUT_CSV="$PROJECT_ROOT/site/public/data/ddl_startup_adp_historical.csv"

python3 "$FETCHER" -o "$OUT_CSV" "$@"
