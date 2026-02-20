#!/bin/bash
# Copies the most recent fantasycalc_dynasty_rankings* file from ~/Downloads
# to site/public/data/fantasycalc.csv
#
# Usage (run from project root):
#   bash scripts/update_downloads.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_CSV="$PROJECT_ROOT/site/public/data/fantasycalc.csv"
DOWNLOADS_DIR="$HOME/Downloads"

LATEST=$(ls -t "$DOWNLOADS_DIR"/fantasycalc_dynasty_rankings* 2>/dev/null | head -1)

if [[ -z "$LATEST" ]]; then
  echo "ERROR: No file matching 'fantasycalc_dynasty_rankings*' found in $DOWNLOADS_DIR"
  exit 1
fi

echo "Found: $LATEST"
cp "$LATEST" "$OUT_CSV"
echo "Copied → $OUT_CSV"
