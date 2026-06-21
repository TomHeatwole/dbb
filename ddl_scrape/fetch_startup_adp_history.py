#!/usr/bin/env python3
"""Fetch historical dynasty startup ADP from Dynasty Data Lab.

Source API: https://api.dynastydatalab.com/api/
  - GET adp/adp?start_date=&end_date=&type=picks  (startup ADP over a window)
  - GET players/nfl                               (player metadata by Sleeper ID)

Output: long-format CSV with one row per player per season.
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import time
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

API_BASE = "https://api.dynastydatalab.com/api"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
OUTPUT_FIELDS = [
    "season",
    "sleeper_id",
    "name",
    "position",
    "team",
    "adp",
    "overall_rank",
    "pos_rank",
    "window_start",
    "window_end",
]


def season_window(season: int) -> tuple[int, int, str, str]:
    """Startup draft season window: Jan 1 through Aug 31 (UTC)."""
    start = datetime(season, 1, 1, tzinfo=timezone.utc)
    end = datetime(season, 8, 31, 23, 59, 59, tzinfo=timezone.utc)
    return (
        int(start.timestamp()),
        int(end.timestamp()),
        start.date().isoformat(),
        end.date().isoformat(),
    )


def api_get(path: str, query: dict[str, str] | None = None) -> list | dict:
    url = f"{API_BASE}/{path.lstrip('/')}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query)}"
    result = subprocess.run(
        ["curl", "-sS", "--fail", "-A", USER_AGENT, url],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        sys.exit(f"ERROR: curl failed for {url}: {result.stderr.strip()}")
    return json.loads(result.stdout)


def load_player_map() -> dict[str, dict[str, str]]:
    players = api_get("players/nfl")
    if not isinstance(players, list):
        sys.exit("ERROR: players/nfl did not return a list")

    out: dict[str, dict[str, str]] = {}
    for row in players:
        sid = str(row.get("id_sleeper") or "").strip()
        if not sid:
            continue
        first = (row.get("id_firstname") or "").strip()
        last = (row.get("id_lastname") or "").strip()
        name = f"{first} {last}".strip() if last else (first or "Unknown")
        out[sid] = {
            "name": name,
            "position": (row.get("id_pos") or "").strip(),
            "team": (row.get("id_team") or "").strip(),
        }
    return out


def assign_ranks(rows: list[dict]) -> list[dict]:
    """Sort by ADP ascending and assign overall + positional ranks."""
    rows.sort(key=lambda r: (r["adp"], r["sleeper_id"]))
    pos_counters: dict[str, int] = defaultdict(int)
    for i, row in enumerate(rows, start=1):
        row["overall_rank"] = i
        pos = row["position"] or "UNK"
        pos_counters[pos] += 1
        row["pos_rank"] = pos_counters[pos]
    return rows


def fetch_season_adp(season: int, player_map: dict[str, dict[str, str]]) -> list[dict]:
    start_ts, end_ts, window_start, window_end = season_window(season)
    raw = api_get(
        "adp/adp",
        {
            "start_date": str(start_ts),
            "end_date": str(end_ts),
            "type": "picks",
        },
    )
    if not isinstance(raw, list):
        sys.exit(f"ERROR: adp/adp for {season} did not return a list")

    rows: list[dict] = []
    for item in raw:
        sid = str(item.get("id_sleeper") or "").strip()
        adp = item.get("adp_adp")
        if not sid or adp is None:
            continue
        meta = player_map.get(sid, {})
        rows.append(
            {
                "season": season,
                "sleeper_id": sid,
                "name": meta.get("name", ""),
                "position": meta.get("position", ""),
                "team": meta.get("team", ""),
                "adp": adp,
                "window_start": window_start,
                "window_end": window_end,
            }
        )

    return assign_ranks(rows)


def default_season_range(seasons: int) -> tuple[int, int]:
    """Most recent completed startup seasons (excludes current calendar year)."""
    end_season = datetime.now(timezone.utc).year - 1
    start_season = end_season - seasons + 1
    return start_season, end_season


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in OUTPUT_FIELDS})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("site/public/data/ddl_startup_adp_historical.csv"),
        help="Output CSV path",
    )
    parser.add_argument(
        "--seasons",
        type=int,
        default=5,
        help="Number of most recent completed seasons (default: 5)",
    )
    parser.add_argument("--start", type=int, help="First season year (overrides --seasons)")
    parser.add_argument("--end", type=int, help="Last season year (overrides --seasons)")
    parser.add_argument(
        "--delay",
        type=float,
        default=0.5,
        help="Seconds to sleep between season API calls (default: 0.5)",
    )
    args = parser.parse_args()

    if args.start is not None or args.end is not None:
        if args.start is None or args.end is None:
            sys.exit("ERROR: pass both --start and --end, or use --seasons")
        start_season, end_season = args.start, args.end
    else:
        start_season, end_season = default_season_range(args.seasons)

    if start_season > end_season:
        sys.exit("ERROR: start season must be <= end season")

    print(f"Fetching player metadata from {API_BASE}/players/nfl ...")
    player_map = load_player_map()
    print(f"  {len(player_map)} players loaded")

    all_rows: list[dict] = []
    season_list = list(range(start_season, end_season + 1))
    for i, season in enumerate(season_list):
        print(f"Fetching startup ADP for {season} ...", end=" ", flush=True)
        rows = fetch_season_adp(season, player_map)
        unmatched = sum(1 for r in rows if not r["name"])
        print(f"{len(rows)} players ({unmatched} without name metadata)")
        all_rows.extend(rows)
        if i < len(season_list) - 1 and args.delay > 0:
            time.sleep(args.delay)

    write_csv(args.output, all_rows)
    print(
        f"Wrote {len(all_rows)} rows for seasons {start_season}-{end_season} "
        f"to {args.output}"
    )


if __name__ == "__main__":
    main()
