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
