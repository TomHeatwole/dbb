#!/bin/bash
# Fetch JAPLAN trip data from Google Sheets into site/public/c4e8a1f3/data/snapshot.json
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$SCRIPT_DIR/build_japlan.py"
