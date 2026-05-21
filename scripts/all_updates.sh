#!/bin/bash
set -e

./scripts/update_downloads.sh
./scripts/fetch_ktc_values.sh
./scripts/update_player_ids.sh
./scripts/update_players.sh
