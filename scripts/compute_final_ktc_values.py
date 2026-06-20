#!/usr/bin/env python3
"""
compute_final_ktc_values.py

Extract preseason SF TE+ KTC values from sf_ktc_values_historical.csv for each
season's final snapshot date (day before / of week 1):

  2020 → 2020-09-10
  2021 → 2021-09-09
  2022 → 2022-09-08
  2023 → 2023-09-07
  2024 → 2024-09-05
  2025 → 2025-09-04

Writes:
  site/public/data/final_ktc_values.csv

Usage (from project root):
  python3 scripts/compute_final_ktc_values.py
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
HISTORICAL_CSV = PROJECT_ROOT / "site/public/data/sf_ktc_values_historical.csv"
NAME_IDS_CSV = PROJECT_ROOT / "site/public/data/ktc_historical_name_ids.csv"
PLAYERS_FILE = PROJECT_ROOT / "site/public/data/players.txt"
OUTPUT_CSV = PROJECT_ROOT / "site/public/data/final_ktc_values.csv"

POSITIONS = ("QB", "RB", "WR", "TE")
PICK_RE = re.compile(r"^\d{4}\s+(Early|Mid|Late)\s+", re.I)

FINAL_KTC_DATES: dict[int, str] = {
    2020: "2020-09-10",
    2021: "2021-09-09",
    2022: "2022-09-08",
    2023: "2023-09-07",
    2024: "2024-09-05",
    2025: "2025-09-04",
}

FIELDNAMES = (
    "year",
    "date",
    "name",
    "position",
    "sleeper_id",
    "ktc_player_id",
    "ktc_value",
)


def load_position_lookup() -> dict[str, str]:
    by_name: dict[str, str] = {}
    if NAME_IDS_CSV.is_file():
        with NAME_IDS_CSV.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                pos = (row.get("position") or "").strip().upper()
                name = (row.get("name") or "").strip()
                if name and pos in POSITIONS:
                    by_name[name] = pos
    return by_name


def load_players() -> dict:
    if not PLAYERS_FILE.is_file():
        return {}
    return json.loads(PLAYERS_FILE.read_text(encoding="utf-8"))


def resolve_position(name: str, sleeper_id: str, by_name: dict[str, str], players: dict) -> str:
    pos = by_name.get(name)
    if pos in POSITIONS:
        return pos
    if sleeper_id and sleeper_id in players:
        p = players[sleeper_id]
        pos = (p.get("position") or (p.get("fantasy_positions") or [""])[0] or "").upper()
        if pos in POSITIONS:
            return pos
    return ""


def main() -> None:
    if not HISTORICAL_CSV.is_file():
        sys.exit(f"ERROR: missing {HISTORICAL_CSV}")

    target_dates = set(FINAL_KTC_DATES.values())
    date_to_year = {date: year for year, date in FINAL_KTC_DATES.items()}
    by_name = load_position_lookup()
    players = load_players()

    rows_by_year: dict[int, list[dict]] = {year: [] for year in FINAL_KTC_DATES}

    with HISTORICAL_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            date = (row.get("date") or "").strip()
            if date not in target_dates:
                continue

            name = (row.get("name") or "").strip()
            if not name or PICK_RE.match(name):
                continue

            try:
                value = int(row["ktc_value"])
            except (KeyError, ValueError, TypeError):
                continue

            sleeper_id = (row.get("sleeper_id") or "").strip()
            year = date_to_year[date]
            rows_by_year[year].append({
                "year": year,
                "date": date,
                "name": name,
                "position": resolve_position(name, sleeper_id, by_name, players),
                "sleeper_id": sleeper_id,
                "ktc_player_id": (row.get("ktc_player_id") or "").strip(),
                "ktc_value": value,
            })

    output_rows: list[dict] = []
    for year in sorted(FINAL_KTC_DATES):
        date = FINAL_KTC_DATES[year]
        year_rows = rows_by_year[year]
        if not year_rows:
            sys.exit(f"ERROR: no rows found for {year} ({date})")
        year_rows.sort(key=lambda r: (-r["ktc_value"], r["name"]))
        output_rows.extend(year_rows)

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(output_rows)

    for year in sorted(FINAL_KTC_DATES):
        count = len(rows_by_year[year])
        print(f"  {year} ({FINAL_KTC_DATES[year]}): {count:,} players")

    print(f"Wrote {len(output_rows):,} rows → {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
