#!/bin/bash

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <league_id>"
  exit 1
fi

LEAGUE_ID="$1"
OUTPUT_DIR="output"

mkdir -p "$OUTPUT_DIR"

for WEEK in {1..17}
do
  echo "Downloading week $WEEK..."
  curl -k "https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${WEEK}" -o "$OUTPUT_DIR/week${WEEK}.txt"
done

echo "Download complete. Files saved in $OUTPUT_DIR/" 