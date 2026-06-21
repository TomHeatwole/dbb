#!/usr/bin/env bash
# Regenerate imputed historical KTC filled board CSVs (2021+).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/build_sf_ktc_values_historical_filled.py
