#!/usr/bin/env python3
"""
Merge ESPN IDs from the nflverse players CSV into a supplementary JSON file
keyed by Sleeper player ID. This fills gaps where Sleeper's own data and the
ffb_ids repo don't include an ESPN ID (common for rookies).

Reads:
  site/public/data/players.txt             (Sleeper API dump)
  site/public/data/players_gsis_mapping.csv (nflverse players with ESPN IDs)

Writes:
  site/public/data/espn_id_supplement.json  ({sleeper_id: espn_id, ...})

Run after update_players.sh and update_player_ids.sh.
"""

import csv
import json
import os
import re
import sys
import unicodedata

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(ROOT, "site", "public", "data")

SLEEPER_PATH = os.path.join(DATA_DIR, "players.txt")
NFLVERSE_PATH = os.path.join(DATA_DIR, "players_gsis_mapping.csv")
OUTPUT_PATH = os.path.join(DATA_DIR, "espn_id_supplement.json")


def normalize_name(name):
    if not name:
        return ""
    name = unicodedata.normalize("NFKD", name)
    name = name.encode("ascii", "ignore").decode("ascii")
    name = re.sub(r"[^a-z ]", "", name.lower())
    name = re.sub(r"\s+", " ", name).strip()
    # Drop common suffixes
    name = re.sub(r"\s+(jr|sr|ii|iii|iv|v)$", "", name)
    return name


def load_sleeper_players():
    with open(SLEEPER_PATH, "r") as f:
        data = json.load(f)
    result = {}
    for pid, p in data.items():
        full_name = p.get("full_name") or ""
        if not full_name:
            first = p.get("first_name") or ""
            last = p.get("last_name") or ""
            full_name = f"{first} {last}".strip()
        existing_espn = p.get("espn_id")
        result[pid] = {
            "name": full_name,
            "normalized": normalize_name(full_name),
            "has_espn": bool(existing_espn),
            "position": p.get("position") or "",
            "team": p.get("team") or "",
        }
    return result


def load_nflverse_espn_map():
    name_to_espn = {}
    with open(NFLVERSE_PATH, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            espn_id = (row.get("espn_id") or "").strip()
            name = (row.get("display_name") or "").strip()
            position = (row.get("position") or "").strip()
            if not espn_id or not name:
                continue
            key = normalize_name(name)
            if not key:
                continue
            # Prefer the most recent entry (later rows overwrite earlier)
            name_to_espn[key] = {"espn_id": espn_id, "position": position}
    return name_to_espn


def main():
    if not os.path.exists(SLEEPER_PATH):
        print(f"ERROR: {SLEEPER_PATH} not found. Run update_players.sh first.", file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(NFLVERSE_PATH):
        print(f"ERROR: {NFLVERSE_PATH} not found. Run update_player_ids.sh first.", file=sys.stderr)
        sys.exit(1)

    sleeper = load_sleeper_players()
    nflverse = load_nflverse_espn_map()

    supplement = {}
    matched = 0
    for sid, info in sleeper.items():
        if info["has_espn"]:
            continue
        nkey = info["normalized"]
        if not nkey:
            continue
        entry = nflverse.get(nkey)
        if entry:
            supplement[sid] = entry["espn_id"]
            matched += 1

    with open(OUTPUT_PATH, "w") as f:
        json.dump(supplement, f, separators=(",", ":"))

    total_missing = sum(1 for v in sleeper.values() if not v["has_espn"])
    print(f"Sleeper players missing ESPN ID: {total_missing}")
    print(f"Matched via nflverse name lookup: {matched}")
    print(f"Still missing: {total_missing - matched}")
    print(f"Wrote {OUTPUT_PATH} ({len(supplement)} entries)")


if __name__ == "__main__":
    main()
