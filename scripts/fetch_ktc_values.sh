#!/bin/bash
# Fetches KTC dynasty trade values and writes to site/public/data/ktc_values.csv
# Columns: name, position, team, ktc_value_1qb, ktc_value_2qb, ktc_value_tep_1qb, ktc_value_tep_2qb,
#          rank_1qb, rank_2qb, rank_tep_1qb, rank_tep_2qb, as_of
#
# Usage (run from project root):
#   bash scripts/fetch_ktc_values.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_CSV="$PROJECT_ROOT/site/public/data/ktc_values.csv"
TMP_HTML="$(mktemp /tmp/ktc_page_XXXXXX.html)"

cleanup() { rm -f "$TMP_HTML"; }
trap cleanup EXIT

echo "Fetching KTC dynasty rankings..."
curl -s --fail \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "https://keeptradecut.com/dynasty-rankings" \
  -o "$TMP_HTML"

echo "Parsing and writing CSV..."
python3 - "$TMP_HTML" "$OUT_CSV" << 'PYEOF'
import csv, datetime, json, re, sys

html_path, out_path = sys.argv[1], sys.argv[2]

with open(html_path, encoding="utf-8") as f:
    html = f.read()

m = re.search(r'var playersArray\s*=\s*(\[.*?\]);', html, re.DOTALL)
if not m:
    sys.exit("ERROR: Could not find playersArray in KTC page. The page structure may have changed.")

players = json.loads(m.group(1))
today = datetime.date.today().isoformat()

rows = []
for p in players:
    one_qb = p.get("oneQBValues", {})
    sf     = p.get("superflexValues", {})
    rows.append({
        "name":               p.get("playerName", "").strip(),
        "position":           p.get("position", "").strip().upper(),
        "team":               p.get("team", "").strip().upper(),
        "ktc_value_1qb":      one_qb.get("value", ""),
        "ktc_value_2qb":      sf.get("value", ""),
        "ktc_value_tep_1qb":  one_qb.get("tep", {}).get("value", ""),
        "ktc_value_tep_2qb":  sf.get("tep", {}).get("value", ""),
        "rank_1qb":           one_qb.get("rank", ""),
        "rank_2qb":           sf.get("rank", ""),
        "rank_tep_1qb":       one_qb.get("tep", {}).get("rank", ""),
        "rank_tep_2qb":       sf.get("tep", {}).get("rank", ""),
        "as_of":              today,
    })

fieldnames = ["name", "position", "team",
              "ktc_value_1qb", "ktc_value_2qb", "ktc_value_tep_1qb", "ktc_value_tep_2qb",
              "rank_1qb", "rank_2qb", "rank_tep_1qb", "rank_tep_2qb", "as_of"]
with open(out_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

print(f"Wrote {len(rows):,} players → {out_path}")
PYEOF
