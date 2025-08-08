#!/bin/bash

# Serialize settings/settings.json into a single string and write to /site/.env.local as SITE_SETTINGS=<serialized_string>

set -e

# Get the absolute path to the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
SETTINGS_JSON="$ROOT_DIR/settings/settings.json"
ENV_FILE="$ROOT_DIR/site/.env.local"

if [ ! -f "$SETTINGS_JSON" ]; then
  echo "settings.json not found at $SETTINGS_JSON"
  exit 1
fi

# Serialize JSON to a single line, escaping as needed
SERIALIZED=$(jq -c . "$SETTINGS_JSON")

# Write to .env.local
{
  echo "REACT_APP_SITE_SETTINGS='$SERIALIZED'"
} > "$ENV_FILE"

echo "Wrote settings to $ENV_FILE" 
