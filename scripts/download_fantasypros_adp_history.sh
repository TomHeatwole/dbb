#!/bin/bash
# Downloads historical FantasyPros ADP (2015–present) for overall, half-PPR,
# full PPR, and best ball. Skips year/format combos where data is unavailable.
#
# Usage (run from project root):
#   bash scripts/download_fantasypros_adp_history.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROCESSOR="$SCRIPT_DIR/process_fantasypros_adp.js"
START_YEAR=2015
END_YEAR="$(date +%Y)"

TYPES=(overall half ppr bestball)

echo "FantasyPros ADP history: ${START_YEAR}–${END_YEAR}, ${#TYPES[@]} formats per year"
echo ""

errors=0
skipped=0
ok=0

for year in $(seq "$START_YEAR" "$END_YEAR"); do
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  Season $year"
  echo "══════════════════════════════════════════════════════════════════════"

  for type in "${TYPES[@]}"; do
    out="$SCRIPT_DIR/../site/public/data/adp/fantasypros_adp_${type}_${year}.csv"
    if [[ -f "$out" ]]; then
      echo "  $type: already exists, skipping"
      continue
    fi

    echo -n "  $type: "
    if output=$(node "$PROCESSOR" "$type" "$year" 2>&1); then
      if echo "$output" | grep -q 'Skipped: data not available'; then
        skipped=$((skipped + 1))
        echo "not available"
      else
        ok=$((ok + 1))
        echo "$output" | sed 's/^/    /'
      fi
    else
      errors=$((errors + 1))
      echo "ERROR"
      echo "$output" | sed 's/^/    /' >&2
    fi
  done
  echo ""
done

echo "FantasyPros ADP history: $ok downloaded, $skipped unavailable, $errors error(s)."
[[ $errors -eq 0 ]]
