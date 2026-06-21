#!/usr/bin/env python3
"""Fetch daily SF positional + overall rank history for all KTC dynasty players."""

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
)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
PROFILE_URL = "https://keeptradecut.com/dynasty-rankings/players/{slug}"
SKILL_POSITIONS = {"QB", "RB", "WR", "TE"}
OUTPUT_FIELDS = [
    "date",
    "name",
    "position",
    "positional_rank",
    "overall_rank",
    "ktc_player_id",
    "ktc_slug",
    "sleeper_id",
    "rank_basis",
]


def load_players_array(html: str) -> list[dict]:
    match = re.search(r"var playersArray\s*=\s*(\[.*?\]);", html, re.DOTALL)
    if not match:
        sys.exit("ERROR: could not find playersArray in KTC rankings HTML")
    return json.loads(match.group(1))


def slug_map_from_rankings(html: str) -> dict[str, dict]:
    """Return slug -> metadata for all skill-position players on the dynasty board."""
    slugs: dict[str, dict] = {}
    for player in load_players_array(html):
        position = (player.get("position") or "").upper()
        if position not in SKILL_POSITIONS:
            continue
        slug = (player.get("slug") or "").strip()
        name = (player.get("playerName") or "").strip()
        if not slug or not name:
            continue
        slugs[slug] = {
            "name": name,
            "position": position,
            "ktc_player_id": str(player.get("playerID") or ""),
            "team": (player.get("team") or "").upper(),
        }
    return slugs


def slug_map_from_name_map(path: Path | None) -> dict[str, dict]:
    """Supplement with historical rows that already have a KTC slug."""
    if path is None or not path.is_file():
        return {}

    slugs: dict[str, dict] = {}
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("is_pick") == "1":
                continue
            position = (row.get("position") or "").upper()
            if position not in SKILL_POSITIONS:
                continue
            slug = (row.get("ktc_slug") or "").strip()
            name = (row.get("name") or "").strip()
            if not slug or not name:
                continue
            slugs[slug] = {
                "name": name,
                "position": position,
                "ktc_player_id": row.get("ktc_player_id", ""),
                "team": (row.get("team") or "").upper(),
            }
    return slugs


def fetch_profile_html(slug: str, timeout: int = 60) -> str:
    url = PROFILE_URL.format(slug=urllib.parse.quote(slug))
    result = subprocess.run(
        ["curl", "-sS", "--fail", "-A", USER_AGENT, url],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(err or f"curl failed for {slug}")
    return result.stdout


def rank_basis_for_position(position: str) -> str:
    return "sf_tep" if position == "TE" else "sf"


def extract_rank_series(player_superflex: dict) -> tuple[list[dict], list[dict]]:
    positional = player_superflex.get("positionalRankHistory") or []
    overall = player_superflex.get("overallRankHistory") or []
    if not positional:
        raise RuntimeError("positionalRankHistory is empty")
    if not overall:
        raise RuntimeError("overallRankHistory is empty")
    return positional, overall


def merge_rank_rows(
    positional: list[dict],
    overall: list[dict],
    player: dict,
    meta: dict,
    name_map: dict[str, dict[str, str]],
) -> list[list]:
    overall_by_date = {str(point["d"]): point["v"] for point in overall}
    player_name = player.get("name") or meta["name"]
    position = (player.get("position") or meta.get("position") or "").upper()
    ktc_player_id = player.get("ktc_player_id") or meta.get("ktc_player_id", "")
    sleeper_id = name_map.get(player_name, {}).get("sleeper_id", "")
    basis = rank_basis_for_position(position)

    rows: list[list] = []
    for point in positional:
        date_code = str(point["d"])
        overall_rank = overall_by_date.get(date_code)
        if overall_rank is None:
            continue
        pos_rank = point["v"]
        rows.append([
            parse_yymmdd(date_code),
            player_name,
            position,
            int(pos_rank) if isinstance(pos_rank, float) and pos_rank.is_integer() else pos_rank,
            int(overall_rank) if isinstance(overall_rank, float) and overall_rank.is_integer() else overall_rank,
            ktc_player_id,
            player.get("ktc_slug") or meta.get("ktc_slug", ""),
            sleeper_id,
            basis,
        ])
    return rows


def write_players_manifest(path: Path, players: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "name",
        "position",
        "ktc_player_id",
        "ktc_slug",
        "sleeper_id",
        "team",
        "rank_basis",
        "history_days",
        "history_start",
        "history_end",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(players)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch daily SF positional rank history for all KTC dynasty players."
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
        "--players-out",
        type=Path,
        default=None,
        help="Optional one-row-per-player manifest CSV",
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
    slug_map = slug_map_from_rankings(rankings_html)
    slug_map.update(slug_map_from_name_map(args.name_map))
    for slug, meta in slug_map.items():
        meta.setdefault("ktc_slug", slug)

    if not slug_map:
        sys.exit("ERROR: no player slugs found")

    name_map = load_name_map(args.name_map)
    slugs = sorted(slug_map.keys())

    args.output.parent.mkdir(parents=True, exist_ok=True)
    total_records = 0
    ok = 0
    failed: list[str] = []
    manifest: list[dict] = []

    with args.output.open("w", newline="", encoding="utf-8") as out_f:
        writer = csv.writer(out_f)
        writer.writerow(OUTPUT_FIELDS)

        for i, slug in enumerate(slugs):
            meta = slug_map[slug]
            label = meta["name"]
            print(f"[{i + 1}/{len(slugs)}] {label} ({slug})...", flush=True)
            try:
                html = fetch_profile_html(slug)
                player = extract_player_meta(html)
                player_superflex = extract_player_superflex(html)
                if player.get("ktc_slug") and player["ktc_slug"] != slug:
                    print(f"  warning: slug mismatch ({player['ktc_slug']})", flush=True)

                positional, overall = extract_rank_series(player_superflex)
                player["ktc_slug"] = player.get("ktc_slug") or slug
                rows = merge_rank_rows(positional, overall, player, meta, name_map)
                if not rows:
                    raise RuntimeError("no aligned rank rows written")

                for row in rows:
                    writer.writerow(row)
                    total_records += 1

                manifest.append({
                    "name": rows[0][1],
                    "position": rows[0][2],
                    "ktc_player_id": rows[0][5],
                    "ktc_slug": slug,
                    "sleeper_id": rows[0][7],
                    "team": meta.get("team", ""),
                    "rank_basis": rows[0][8],
                    "history_days": len(rows),
                    "history_start": rows[0][0],
                    "history_end": rows[-1][0],
                })
                ok += 1
            except Exception as exc:  # noqa: BLE001 - collect and continue
                failed.append(f"{label} ({slug}): {exc}")
                print(f"  ERROR: {exc}", flush=True)

            if args.delay > 0 and i + 1 < len(slugs):
                time.sleep(args.delay)

    if args.players_out:
        write_players_manifest(args.players_out, manifest)

    print(
        f"\nWrote {total_records:,} rank records for {ok}/{len(slugs)} players → {args.output}"
    )
    if failed:
        print(f"Failed ({len(failed)}):", file=sys.stderr)
        for line in failed:
            print(f"  - {line}", file=sys.stderr)
        if ok == 0:
            sys.exit(1)


if __name__ == "__main__":
    main()
