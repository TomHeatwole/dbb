#!/usr/bin/env python3
"""
compute_ktc_average_deltas.py

Computes KTC historical rank statistics from sf_ktc_values_historical_filled.csv.

Uses true positional_rank / overall_rank at each imputed snapshot (2021+).

Outputs:
  - site/public/data/ktc_average_rank_values.csv
      Average ktc_value at each rank slot over snapshots (QB1, RB2, Overall3, etc.)
      Consumed by the KTC Rank Compare sandbox (positional + Overall tabs).

Usage (from project root):
  python3 scripts/compute_ktc_average_deltas.py
"""

from __future__ import annotations

import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FILLED_CSV = PROJECT_ROOT / "site/public/data/sf_ktc_values_historical_filled.csv"
RANK_VALUES_CSV = PROJECT_ROOT / "site/public/data/ktc_average_rank_values.csv"

POSITIONS = ("QB", "RB", "WR", "TE")
PICK_RE = re.compile(r"^\d{4}\s+(Early|Mid|Late)\s+", re.I)
KIND_PRIORITY = {"final_ktc": 3, "rookie_draft": 2, "monthly": 1}


def rank_label(metric: str, position: str, rank: int) -> str:
    if metric == "overall":
        return f"Overall{rank}"
    return f"{position}{rank}"


def load_filled_snapshots() -> dict[str, list[dict]]:
    """resolved_date -> deduped snapshot rows (prefer final_ktc on same date)."""
    if not FILLED_CSV.is_file():
        sys.exit(
            f"ERROR: missing {FILLED_CSV}. "
            "Run: python3 scripts/build_sf_ktc_values_historical_filled.py"
        )

    raw_by_key: dict[tuple[str, str, str, int], dict] = {}

    with FILLED_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            date = (row.get("resolved_date") or "").strip()
            kind = (row.get("snapshot_kind") or "").strip()
            pos = (row.get("position") or "").strip().upper()
            name = (row.get("name") or "").strip()
            if not date or pos not in POSITIONS or not name or PICK_RE.match(name):
                continue
            try:
                pos_rank = int(row["positional_rank"])
                value = int(row["ktc_value"])
            except (KeyError, ValueError, TypeError):
                continue
            if value <= 0:
                continue
            ovr_raw = (row.get("overall_rank") or "").strip()
            ovr = int(ovr_raw) if ovr_raw.isdigit() else None

            slot_key = (date, pos, str(pos_rank), pos_rank)
            existing = raw_by_key.get(slot_key)
            if existing is None or KIND_PRIORITY.get(kind, 0) > KIND_PRIORITY.get(existing["kind"], 0):
                raw_by_key[slot_key] = {
                    "date": date,
                    "kind": kind,
                    "position": pos,
                    "pos_rank": pos_rank,
                    "value": value,
                    "overall_rank": ovr,
                }

    by_date: dict[str, list[dict]] = defaultdict(list)
    for entry in raw_by_key.values():
        by_date[entry["date"]].append(entry)
    return by_date


def compute_rank_value_stats(by_date: dict[str, list[dict]]) -> tuple[int, dict]:
    value_stats: dict[tuple, list[float | int]] = defaultdict(lambda: [0.0, 0])
    day_count = 0

    for date_str in sorted(by_date.keys()):
        entries = by_date[date_str]
        if not entries:
            continue
        day_count += 1

        for entry in entries:
            pos = entry["position"]
            pos_rank = entry["pos_rank"]
            val = entry["value"]
            value_key = ("positional", pos, pos_rank)
            value_stats[value_key][0] += val
            value_stats[value_key][1] += 1

            ovr = entry.get("overall_rank")
            if ovr is not None:
                value_key = ("overall", "OVERALL", ovr)
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
    by_date = load_filled_snapshots()
    day_count, value_stats = compute_rank_value_stats(by_date)
    value_rows = write_rank_values_csv(value_stats, RANK_VALUES_CSV)

    print(f"Processed {day_count:,} imputed snapshots")
    print(f"Wrote {value_rows:,} rank-slot averages → {RANK_VALUES_CSV}")


if __name__ == "__main__":
    main()
