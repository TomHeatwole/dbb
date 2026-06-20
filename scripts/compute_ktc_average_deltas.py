#!/usr/bin/env python3
"""
compute_ktc_average_deltas.py

Computes KTC historical rank statistics from sf_ktc_values_historical.csv (SF TE+ baseline).

For each day:
  - Rank players within QB/RB/WR/TE by ktc_value (desc) → QB1, RB2, …
  - Rank all players overall by ktc_value → Overall1, Overall2, …

Outputs:
  - site/public/data/ktc_average_rank_values.csv
      Average ktc_value at each rank slot over full history (QB1, RB2, Overall3, etc.)
      Consumed by the KTC Rank Compare sandbox (positional + Overall tabs).

Usage (from project root):
  python3 scripts/compute_ktc_average_deltas.py
"""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
HISTORICAL_CSV = PROJECT_ROOT / "site/public/data/sf_ktc_values_historical.csv"
NAME_IDS_CSV = PROJECT_ROOT / "site/public/data/ktc_historical_name_ids.csv"
PLAYERS_FILE = PROJECT_ROOT / "site/public/data/players.txt"
RANK_VALUES_CSV = PROJECT_ROOT / "site/public/data/ktc_average_rank_values.csv"

POSITIONS = ("QB", "RB", "WR", "TE")
PICK_RE = re.compile(r"^\d{4}\s+(Early|Mid|Late)\s+", re.I)


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


def resolve_position(name: str, sleeper_id: str, by_name: dict[str, str], players: dict) -> str | None:
    pos = by_name.get(name)
    if pos in POSITIONS:
        return pos
    if sleeper_id and sleeper_id in players:
        p = players[sleeper_id]
        pos = (p.get("position") or (p.get("fantasy_positions") or [""])[0] or "").upper()
        if pos in POSITIONS:
            return pos
    return None


def rank_label(metric: str, position: str, rank: int) -> str:
    if metric == "overall":
        return f"Overall{rank}"
    return f"{position}{rank}"


def load_historical_by_date(by_name: dict[str, str], players: dict) -> dict[str, list[tuple[str, int]]]:
    by_date: dict[str, list[tuple[str, int]]] = defaultdict(list)
    with HISTORICAL_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = (row.get("name") or "").strip()
            if not name or PICK_RE.match(name):
                continue
            try:
                value = int(row["ktc_value"])
            except (KeyError, ValueError, TypeError):
                continue
            pos = resolve_position(name, (row.get("sleeper_id") or "").strip(), by_name, players)
            if not pos:
                continue
            by_date[row["date"]].append((pos, value))
    return by_date


def compute_rank_value_stats(by_date: dict[str, list[tuple[str, int]]]) -> tuple[int, dict]:
    value_stats: dict[tuple, list[float | int]] = defaultdict(lambda: [0.0, 0])
    day_count = 0

    for date_str in sorted(by_date.keys()):
        entries = by_date[date_str]
        if not entries:
            continue
        day_count += 1

        by_pos: dict[str, list[int]] = {p: [] for p in POSITIONS}
        for pos, value in entries:
            by_pos[pos].append(value)

        for pos in POSITIONS:
            values = sorted(by_pos[pos], reverse=True)
            for i, val in enumerate(values):
                rank = i + 1
                value_key = ("positional", pos, rank)
                value_stats[value_key][0] += val
                value_stats[value_key][1] += 1

        overall = sorted((v for _, v in entries), reverse=True)
        for i, val in enumerate(overall):
            rank = i + 1
            value_key = ("overall", "OVERALL", rank)
            value_stats[value_key][0] += val
            value_stats[value_key][1] += 1

    return day_count, value_stats


def write_rank_values_csv(value_stats: dict, out_path: Path) -> int:
    rows: list[dict] = []
    for key in sorted(value_stats.keys(), key=lambda k: (k[0], k[1], k[2])):
        metric, position, rank = key
        total, count = value_stats[key]
        if count == 0:
            continue
        rows.append({
            "metric": metric,
            "position": position,
            "rank": rank,
            "label": rank_label(metric, position, rank),
            "average_value": round(total / count, 2),
            "day_count": count,
        })

    fieldnames = ["metric", "position", "rank", "label", "average_value", "day_count"]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def main() -> None:
    if not HISTORICAL_CSV.is_file():
        sys.exit(f"ERROR: missing {HISTORICAL_CSV}")

    by_name = load_position_lookup()
    players = load_players()
    by_date = load_historical_by_date(by_name, players)

    day_count, value_stats = compute_rank_value_stats(by_date)
    value_rows = write_rank_values_csv(value_stats, RANK_VALUES_CSV)

    print(f"Processed {day_count:,} days")
    print(f"Wrote {value_rows:,} rank-slot averages → {RANK_VALUES_CSV}")


if __name__ == "__main__":
    main()
