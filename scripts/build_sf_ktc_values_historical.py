#!/usr/bin/env python3
"""
build_sf_ktc_values_historical.py

Build canonical SF Superflex TE+ historical values from two source scrapes:

  sf_non_tep_ktc_values_historical.csv — all positions, no TE premium
  sf_tep_ktc_values_historical.csv     — TE-only TE+ values from KTC profiles

Output sf_ktc_values_historical.csv = non_tep board with TE rows replaced by
TE+ where scraped; non-TEP TE values kept as fallback when no TE+ row exists.

Also refreshes ktc_historical_dates.json entry for the merged file.

Usage (from project root):
  python3 scripts/build_sf_ktc_values_historical.py
"""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "site/public/data"
NON_TEP_CSV = DATA_DIR / "sf_non_tep_ktc_values_historical.csv"
TEP_TE_CSV = DATA_DIR / "sf_tep_ktc_values_historical.csv"
OUTPUT_CSV = DATA_DIR / "sf_ktc_values_historical.csv"
NAME_IDS_CSV = DATA_DIR / "ktc_historical_name_ids.csv"
PLAYERS_FILE = DATA_DIR / "players.txt"
DATES_JSON = DATA_DIR / "ktc_historical_dates.json"

FIELDNAMES = ("date", "name", "ktc_value", "ktc_player_id", "sleeper_id")
PICK_RE = re.compile(r"^\d{4}\s+(Early|Mid|Late)\s+", re.I)


def load_te_names() -> set[str]:
    names: set[str] = set()
    if NAME_IDS_CSV.is_file():
        with NAME_IDS_CSV.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if (row.get("position") or "").strip() == "TE":
                    name = (row.get("name") or "").strip()
                    if name:
                        names.add(name)
    return names


def load_players() -> dict:
    if not PLAYERS_FILE.is_file():
        return {}
    return json.loads(PLAYERS_FILE.read_text(encoding="utf-8"))


def row_key(row: dict) -> str:
    sleeper_id = (row.get("sleeper_id") or "").strip()
    if sleeper_id:
        return f"id:{sleeper_id}"
    return f"name:{row['name']}"


def is_te_row(row: dict, te_names: set[str], players: dict) -> bool:
    name = row["name"]
    if name in te_names:
        return True
    sleeper_id = (row.get("sleeper_id") or "").strip()
    if sleeper_id and sleeper_id in players:
        pos = (
            players[sleeper_id].get("position")
            or (players[sleeper_id].get("fantasy_positions") or [""])[0]
            or ""
        ).upper()
        return pos == "TE"
    return False


def load_rows_by_date(path: Path) -> dict[str, list[dict]]:
    by_date: dict[str, list[dict]] = defaultdict(list)
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            date = (row.get("date") or "").strip()
            name = (row.get("name") or "").strip()
            if not date or not name:
                continue
            try:
                value = int(row["ktc_value"])
            except (KeyError, ValueError, TypeError):
                continue
            by_date[date].append({
                "date": date,
                "name": name,
                "ktc_value": value,
                "ktc_player_id": (row.get("ktc_player_id") or "").strip(),
                "sleeper_id": (row.get("sleeper_id") or "").strip(),
            })
    return by_date


def merge_date(
    non_tep_rows: list[dict],
    tep_rows: list[dict],
    te_names: set[str],
    players: dict,
) -> tuple[list[dict], int, int]:
    """Return merged rows, te_tep_count, te_fallback_count."""
    tep_by_key = {row_key(row): row for row in tep_rows}
    combined: dict[str, dict] = {}
    te_fallback_count = 0

    for row in non_tep_rows:
        key = row_key(row)
        if PICK_RE.match(row["name"]):
            combined[key] = row
            continue
        if key in tep_by_key:
            continue
        if is_te_row(row, te_names, players):
            combined[key] = row
            te_fallback_count += 1
            continue
        combined[key] = row

    for key, row in tep_by_key.items():
        combined[key] = row

    merged = list(combined.values())
    merged.sort(key=lambda r: (-r["ktc_value"], r["name"]))
    return merged, len(tep_by_key), te_fallback_count


def write_output(rows_by_date: dict[str, list[dict]]) -> int:
    total = 0
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        for date in sorted(rows_by_date):
            for row in rows_by_date[date]:
                writer.writerow(row)
                total += 1
    return total


def update_dates_json(dates: list[str]) -> None:
    payload: dict = {}
    if DATES_JSON.is_file():
        payload = json.loads(DATES_JSON.read_text(encoding="utf-8"))
    payload["sf_ktc"] = {
        "min": dates[0] if dates else "",
        "max": dates[-1] if dates else "",
        "count": len(dates),
        "dates": dates,
    }
    # Keep sf_tep dates in sync for existing UI keys.
    payload["sf_tep"] = payload["sf_ktc"]
    DATES_JSON.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    if not NON_TEP_CSV.is_file():
        sys.exit(f"ERROR: missing {NON_TEP_CSV}")
    if not TEP_TE_CSV.is_file():
        sys.exit(f"ERROR: missing {TEP_TE_CSV}")

    te_names = load_te_names()
    players = load_players()
    non_tep_by_date = load_rows_by_date(NON_TEP_CSV)
    tep_by_date = load_rows_by_date(TEP_TE_CSV)

    merged_by_date: dict[str, list[dict]] = {}
    total_tep = 0
    total_fallback = 0

    for date, non_tep_rows in non_tep_by_date.items():
        merged, tep_count, fallback_count = merge_date(
            non_tep_rows,
            tep_by_date.get(date, []),
            te_names,
            players,
        )
        merged_by_date[date] = merged
        total_tep += tep_count
        total_fallback += fallback_count

    row_count = write_output(merged_by_date)
    dates = sorted(merged_by_date)
    update_dates_json(dates)

    print(f"Wrote {row_count:,} rows → {OUTPUT_CSV}")
    print(f"Dates: {len(dates):,} ({dates[0]} … {dates[-1]})")
    print(f"TE+ replacements (sum across dates): {total_tep:,}")
    print(f"TE non-TEP fallbacks (sum across dates): {total_fallback:,}")


if __name__ == "__main__":
    main()
