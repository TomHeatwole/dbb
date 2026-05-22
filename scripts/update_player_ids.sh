curl -k "https://raw.githubusercontent.com/mayscopeland/ffb_ids/refs/heads/main/player_ids.csv" -o site/public/data/player_ids.txt
curl -k "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv" -L -o site/public/data/players_gsis_mapping.csv

# Merge nflverse ESPN IDs into a supplementary file for rookies missing from ffb_ids
python3 "$(dirname "$0")/merge_espn_ids.py"
