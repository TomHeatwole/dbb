curl -k "https://raw.githubusercontent.com/mayscopeland/ffb_ids/refs/heads/main/player_ids.csv" -o site/public/data/player_ids.txt
curl -k "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv" -L -o site/public/data/players_gsis_mapping.csv
