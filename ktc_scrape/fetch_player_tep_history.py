#!/usr/bin/env python3
"""Fetch daily SF TE+ value history for a player from a KTC profile page."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path


def parse_yymmdd(raw: str) -> str:
    """Convert KTC date code (YYMMDD) to ISO YYYY-MM-DD."""
    raw = raw.strip()
    if len(raw) != 6 or not raw.isdigit():
        raise ValueError(f"invalid KTC date code: {raw!r}")
    return f"20{raw[0:2]}-{raw[2:4]}-{raw[4:6]}"


def load_profile_html(html_path: Path) -> str:
    if not html_path.is_file():
        sys.exit(f"ERROR: HTML file not found: {html_path}")
    return html_path.read_text(encoding="utf-8")


def extract_player_superflex(html: str) -> dict:
    match = re.search(
        r"var playerSuperflex = (\{.*?\});\s*\n\s*var playerOneQB",
        html,
        re.DOTALL,
    )
    if not match:
        sys.exit("ERROR: could not find playerSuperflex JSON in page HTML")
    return json.loads(match.group(1))


def extract_player_meta(html: str) -> dict:
    match = re.search(r'var player = (\{.*?\});\s*\n\s*var playerSuperflex', html, re.DOTALL)
    if not match:
        sys.exit("ERROR: could not find player JSON in page HTML")
    player = json.loads(match.group(1))
    name = player.get("playerName", "").strip()
    if not name:
        sys.exit("ERROR: player name missing from page JSON")
    return {
        "name": name,
        "ktc_player_id": player.get("playerID", ""),
        "ktc_slug": player.get("slug", ""),
        "position": (player.get("position") or "").upper(),
        "team": (player.get("team") or "").upper(),
    }


def load_name_map(path: Path | None) -> dict[str, dict[str, str]]:
    if path is None or not path.is_file():
        return {}
    with path.open(newline="", encoding="utf-8") as f:
        return {row["name"].strip(): row for row in csv.DictReader(f) if row.get("name")}


def tep_history(player_superflex: dict) -> list[dict]:
    """Return daily TE+ history points ({d, v})."""
    tep = player_superflex.get("tep") or {}
    history = tep.get("history")
    if history:
        return history

    # Non-TE players often omit tep.history; TE+ equals base SF for them.
    overall = player_superflex.get("overallValue") or []
    if overall:
        return overall

    sys.exit("ERROR: no TE+ history or overallValue series found on profile page")


def write_history_csv(
    out_path: Path,
    player: dict,
    history: list[dict],
    name_map: dict[str, dict[str, str]] | None = None,
) -> tuple[int, str, str]:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    dates: list[str] = []
    player_name = player["name"]

    meta = (name_map or {}).get(player_name, {})
    ktc_player_id = player.get("ktc_player_id") or meta.get("ktc_player_id", "")
    sleeper_id = meta.get("sleeper_id", "")

    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["date", "name", "ktc_value", "ktc_player_id", "sleeper_id"])

        for point in history:
            date = parse_yymmdd(str(point["d"]))
            value = point["v"]
            if isinstance(value, float) and value.is_integer():
                value = int(value)
            writer.writerow([date, player_name, value, ktc_player_id, sleeper_id])
            dates.append(date)

    if not dates:
        sys.exit("ERROR: history series is empty")

    return len(dates), dates[0], dates[-1]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Parse SF TE+ daily history from a downloaded KTC profile HTML page."
    )
    parser.add_argument("html_path", type=Path, help="Downloaded KTC profile page HTML")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        required=True,
        help="Output CSV path",
    )
    parser.add_argument(
        "--name-map",
        type=Path,
        default=None,
        help="Optional ktc_historical_name_ids.csv for sleeper_id lookup",
    )
    args = parser.parse_args()

    html = load_profile_html(args.html_path)
    player = extract_player_meta(html)
    name_map = load_name_map(args.name_map)
    history = tep_history(extract_player_superflex(html))
    count, min_date, max_date = write_history_csv(args.output, player, history, name_map)

    print(
        f"Wrote {count:,} TE+ records for {player['name']} "
        f"({min_date} → {max_date}) → {args.output}"
    )


if __name__ == "__main__":
    main()
