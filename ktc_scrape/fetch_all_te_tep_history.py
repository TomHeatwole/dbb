#!/usr/bin/env python3
"""Fetch daily SF TE+ KTC history for all tight ends from KTC profile pages."""

from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_player_tep_history import (
    extract_player_meta,
    extract_player_superflex,
    load_name_map,
    parse_yymmdd,
    tep_history,
)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
PROFILE_URL = "https://keeptradecut.com/dynasty-rankings/players/{slug}"


def load_players_array(html: str) -> list[dict]:
    match = re.search(r"var playersArray\s*=\s*(\[.*?\]);", html, re.DOTALL)
    if not match:
        sys.exit("ERROR: could not find playersArray in KTC rankings HTML")
    return json.loads(match.group(1))


def te_slugs_from_rankings(html: str) -> dict[str, dict]:
    """Return slug -> {name, ktc_player_id, team} for ranked TEs."""
    slugs: dict[str, dict] = {}
    for player in load_players_array(html):
        if (player.get("position") or "").upper() != "TE":
            continue
        slug = (player.get("slug") or "").strip()
        name = (player.get("playerName") or "").strip()
        if not slug or not name:
            continue
        slugs[slug] = {
            "name": name,
            "ktc_player_id": str(player.get("playerID") or ""),
            "team": (player.get("team") or "").upper(),
        }
    return slugs


def te_slugs_from_name_map(path: Path | None) -> dict[str, dict]:
    """Supplement with historical TE rows that already have a KTC slug."""
    if path is None or not path.is_file():
        return {}

    slugs: dict[str, dict] = {}
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("is_pick") == "1":
                continue
            if (row.get("position") or "").upper() != "TE":
                continue
            slug = (row.get("ktc_slug") or "").strip()
            name = (row.get("name") or "").strip()
            if not slug or not name:
                continue
            slugs[slug] = {
                "name": name,
                "ktc_player_id": row.get("ktc_player_id", ""),
                "team": (row.get("team") or "").upper(),
            }
    return slugs


def fetch_profile_html(slug: str, timeout: int = 60) -> str:
    url = PROFILE_URL.format(slug=urllib.parse.quote(slug))
    result = subprocess.run(
        [
            "curl",
            "-sS",
            "--fail",
            "-A",
            USER_AGENT,
            url,
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(err or f"curl failed for {slug}")
    return result.stdout


def format_value(value: float | int) -> int | float:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch SF TE+ daily KTC history for all tight ends."
    )
    parser.add_argument(
        "--ktc-html",
        type=Path,
        required=True,
        help="Downloaded keeptradecut.com/dynasty-rankings HTML",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        required=True,
        help="Combined long-format CSV output path",
    )
    parser.add_argument(
        "--name-map",
        type=Path,
        default=None,
        help="Optional ktc_historical_name_ids.csv for sleeper_id lookup",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.25,
        help="Seconds to sleep between profile requests (default: 0.25)",
    )
    args = parser.parse_args()

    if not args.ktc_html.is_file():
        sys.exit(f"ERROR: rankings HTML not found: {args.ktc_html}")

    rankings_html = args.ktc_html.read_text(encoding="utf-8")
    slug_map = te_slugs_from_rankings(rankings_html)
    slug_map.update(te_slugs_from_name_map(args.name_map))

    if not slug_map:
        sys.exit("ERROR: no TE slugs found")

    name_map = load_name_map(args.name_map)
    slugs = sorted(slug_map.keys())

    args.output.parent.mkdir(parents=True, exist_ok=True)
    total_records = 0
    ok = 0
    failed: list[str] = []

    with args.output.open("w", newline="", encoding="utf-8") as out_f:
        writer = csv.writer(out_f)
        writer.writerow(["date", "name", "ktc_value", "ktc_player_id", "sleeper_id"])

        for i, slug in enumerate(slugs):
            meta = slug_map[slug]
            label = meta["name"]
            print(f"[{i + 1}/{len(slugs)}] {label} ({slug})...", flush=True)
            try:
                html = fetch_profile_html(slug)
                player = extract_player_meta(html)
                if player.get("ktc_slug") and player["ktc_slug"] != slug:
                    print(f"  warning: slug mismatch ({player['ktc_slug']})", flush=True)
                history = tep_history(extract_player_superflex(html))
                if (player.get("position") or "").upper() == "TE" and not (
                    extract_player_superflex(html).get("tep") or {}
                ).get("history"):
                    print("  note: using overallValue fallback (no tep.history)", flush=True)

                player_name = player.get("name") or label
                ktc_player_id = player.get("ktc_player_id") or meta.get("ktc_player_id", "")
                sleeper_id = name_map.get(player_name, {}).get("sleeper_id", "")

                for point in history:
                    writer.writerow([
                        parse_yymmdd(str(point["d"])),
                        player_name,
                        format_value(point["v"]),
                        ktc_player_id,
                        sleeper_id,
                    ])
                    total_records += 1
                ok += 1
            except Exception as exc:  # noqa: BLE001 - collect and continue
                failed.append(f"{label} ({slug}): {exc}")
                print(f"  ERROR: {exc}", flush=True)

            if args.delay > 0 and i + 1 < len(slugs):
                time.sleep(args.delay)

    print(
        f"\nWrote {total_records:,} TE+ records for {ok}/{len(slugs)} TEs → {args.output}"
    )
    if failed:
        print(f"Failed ({len(failed)}):", file=sys.stderr)
        for line in failed:
            print(f"  - {line}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
