#!/bin/bash
set -e

./scripts/update_downloads.sh
./scripts/fetch_ktc_values.sh
./scripts/fetch_sf_non_tep_ktc_historical.sh
./scrape_adp
./scripts/update_player_ids.sh
./scripts/update_players.sh
node ./scripts/process_gibbs_deltas.js
node ./scripts/process_yafsb_adp.js
