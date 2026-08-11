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

# DBB custom redraft board — blends the private + public boards refreshed
# above, so it must run last. Skipped when the private repo isn't checked out.
if [ -d ./dbbp/scripts ]; then
  node ./dbbp/scripts/build_custom_rankings.js
fi
