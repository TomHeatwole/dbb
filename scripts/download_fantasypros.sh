#!/bin/bash
# Downloads FantasyPros rankings for every position defined in
# fantasypros_scrape/*.sh and writes one CSV per file to
# site/public/data/fantasypros_<name>.csv.
#
# The script auto-discovers all .sh files in fantasypros_scrape/, so adding a
# new position is as simple as dropping another curl file in that directory.
#
# Output columns: rank, name, team, position, sleeper_id
#
# Usage (run from project root):
#   bash scripts/download_fantasypros.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SCRAPE_DIR="$PROJECT_ROOT/fantasypros_scrape"
OUT_DIR="$PROJECT_ROOT/site/public/data"
PROCESSOR="$SCRIPT_DIR/process_fantasypros_rankings.js"

shopt -s nullglob
curl_files=("$SCRAPE_DIR"/*.sh)

if [[ ${#curl_files[@]} -eq 0 ]]; then
  echo "No .sh files found in $SCRAPE_DIR — nothing to do."
  exit 0
fi

echo "FantasyPros: processing ${#curl_files[@]} ranking(s)..."
echo ""

errors=0

for curl_file in "${curl_files[@]}"; do
  base="$(basename "$curl_file" .sh)"
  out_csv="$OUT_DIR/fantasypros_${base}.csv"

  echo "── $base ──────────────────────────────────────────────────────────────"
  if node "$PROCESSOR" "$curl_file" "$out_csv"; then
    echo ""
  else
    echo "  ERROR: failed to process $curl_file" >&2
    errors=$((errors + 1))
    echo ""
  fi
done

if [[ $errors -gt 0 ]]; then
  echo "FantasyPros: completed with $errors error(s)." >&2
  exit 1
fi

echo "FantasyPros: all rankings downloaded successfully."
