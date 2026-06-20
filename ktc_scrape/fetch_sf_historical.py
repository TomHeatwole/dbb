#!/usr/bin/env python3
"""Convert Community Trade Value Data 'SF Historical Data' sheet CSV to long format.

Input: wide CSV (Date column + player/pick columns) from Google Sheets export.
Output: date,name,ktc_value[,ktc_player_id,sleeper_id] rows (SF / Superflex, no TE premium).
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

OUTPUT_FIELDS_BASE = ["date", "name", "ktc_value"]
OUTPUT_FIELDS_WITH_IDS = OUTPUT_FIELDS_BASE + ["ktc_player_id", "sleeper_id"]


def load_name_map(path: Path | None) -> dict[str, dict[str, str]]:
    if path is None:
        return {}
    if not path.is_file():
        sys.exit(f"ERROR: name map not found: {path}")

    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return {row["name"].strip(): row for row in reader if row.get("name")}


def parse_wide_csv(
    in_path: Path,
    out_path: Path,
    name_map: dict[str, dict[str, str]] | None = None,
) -> tuple[int, int, str, str]:
    """Melt wide historical KTC CSV into long format. Returns (days, records, min_date, max_date)."""
    ids = name_map or {}
    fields = OUTPUT_FIELDS_WITH_IDS if ids else OUTPUT_FIELDS_BASE

    with in_path.open(newline="", encoding="utf-8") as f_in:
        reader = csv.reader(f_in)
        try:
            header = next(reader)
        except StopIteration:
            sys.exit("ERROR: input CSV is empty")

        if not header or header[0].strip().lower() != "date":
            sys.exit(f"ERROR: expected first column 'Date', got {header[0]!r}")

        names = [h.strip() for h in header[1:]]
        dates: list[str] = []
        record_count = 0

        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w", newline="", encoding="utf-8") as f_out:
            writer = csv.writer(f_out)
            writer.writerow(fields)

            for row in reader:
                if not row:
                    continue
                date = row[0].strip()
                if not date:
                    continue
                dates.append(date)

                values = row[1:]
                if len(values) < len(names):
                    values = values + [""] * (len(names) - len(values))

                for name, raw in zip(names, values):
                    raw = raw.strip()
                    if not raw or not name:
                        continue
                    try:
                        value = float(raw)
                    except ValueError:
                        continue
                    if value.is_integer():
                        value = int(value)

                    if ids:
                        meta = ids.get(name, {})
                        writer.writerow([
                            date,
                            name,
                            value,
                            meta.get("ktc_player_id", ""),
                            meta.get("sleeper_id", ""),
                        ])
                    else:
                        writer.writerow([date, name, value])
                    record_count += 1

    if not dates:
        sys.exit("ERROR: no date rows found in input CSV")

    return len(dates), record_count, dates[-1], dates[0]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert wide SF Historical KTC CSV to long format."
    )
    parser.add_argument("input_csv", type=Path, help="Wide CSV downloaded from Google Sheets")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        required=True,
        help="Output long-format CSV path",
    )
    parser.add_argument(
        "--name-map",
        type=Path,
        default=None,
        help="Optional ktc_historical_name_ids.csv to embed ktc_player_id and sleeper_id",
    )
    args = parser.parse_args()

    if not args.input_csv.is_file():
        sys.exit(f"ERROR: input file not found: {args.input_csv}")

    name_map = load_name_map(args.name_map)
    days, records, min_date, max_date = parse_wide_csv(args.input_csv, args.output, name_map)
    id_note = " with embedded IDs" if name_map else ""
    print(
        f"Wrote {records:,} value records across {days:,} days "
        f"({min_date} → {max_date}){id_note} → {args.output}"
    )


if __name__ == "__main__":
    main()
