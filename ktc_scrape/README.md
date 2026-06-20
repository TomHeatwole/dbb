# ktc_scrape

Normalizes a raw KeepTradeCut (KTC) CSV export into a standard schema for use in the project.

## Output schema

| Column | Description |
|--------|-------------|
| `name` | Player name |
| `position` | Position (uppercased) |
| `team` | NFL team (uppercased) |
| `ktc_value` | KTC dynasty trade value |
| `as_of` | Date the values were pulled (ISO format) |

Normalized output lands in `output/ktc_values.csv` by default.

## Historical SF values (Community Trade Value Data)

Daily KTC Superflex (non-TEP) history is fetched from the public
[Community Trade Value Data](https://docs.google.com/spreadsheets/d/1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs)
sheet (`SF Historical Data` tab) and written to
`site/public/data/sf_non_tep_ktc_values_historical.csv`.

```bash
bash scripts/fetch_sf_non_tep_ktc_historical.sh
```

Output schema:

| Column | Description |
|--------|-------------|
| `date` | Value date (ISO `YYYY-MM-DD`) |
| `name` | Player or pick name |
| `ktc_value` | KTC SF dynasty trade value (no TE premium) |
| `ktc_player_id` | KTC internal player ID (blank for picks / unmatched) |
| `sleeper_id` | Matched Sleeper player ID (blank for picks / unmatched) |

A separate lookup file is written at `site/public/data/ktc_historical_name_ids.csv`
with full match metadata (`ktc_slug`, `sleeper_name`, `position`, `team`, `ktc_match`,
`sleeper_match`). Rebuild it with:

```bash
node scripts/build_ktc_historical_name_map.js --from-wide-csv /path/to/wide.csv --ktc-html /tmp/ktc_rankings.html
```

## SF TE+ history (all tight ends, KTC profile pages)

Daily TE+ values for every TE are scraped from embedded `playerSuperflex.tep.history`
on KTC profile pages and written to a single file:
`site/public/data/sf_tep_ktc_values_historical.csv`.

TE slugs come from the KTC dynasty rankings page, supplemented by
`ktc_historical_name_ids.csv` for historical TE names that still have a slug.
Requires the name map from `fetch_sf_non_tep_ktc_historical.sh`.

```bash
bash scripts/fetch_sf_tep_ktc_historical.sh
```

Run this occasionally (not part of `all_updates.sh`); current TE+ values are already
refreshed daily via `fetch_ktc_values.sh`.

Output schema matches the SF non-TEP historical file:
`date`, `name`, `ktc_value`, `ktc_player_id`, `sleeper_id`.

## Setup

```bash
pip install -r requirements.txt
```

## Usage

### 1. You already have a raw CSV

If you exported a CSV manually from KTC (or have one from another scraper):

```bash
python normalize.py --raw-csv path/to/raw.csv
```

Output goes to `output/ktc_values.csv`. Override with `--out-csv`:

```bash
python normalize.py --raw-csv path/to/raw.csv --out-csv output/ktc_sf_2026-02-17.csv
```

### 2. Run a scraper first, then normalize

If you have a scraper script that produces the raw CSV:

```bash
python normalize.py \
  --run \
  --scraper-cmd python my_scraper.py --format SF \
  --raw-csv path/to/raw.csv \
  --out-csv output/ktc_values.csv
```

## Adjusting column names

If your scraper uses different column names than `Player / Pos / Team / Value`,
edit the `col_map` dict near the top of `normalize_ktc_csv()` in `normalize.py`:

```python
col_map = {
    "Player": "name",   # change "Player" to whatever your scraper outputs
    "Pos":    "position",
    "Team":   "team",
    "Value":  "ktc_value",
}
```
