#!/usr/bin/env python3

import argparse
import json
import csv
from typing import Dict, List, Any, Optional, Set

PLAYER_IDS_CSV = "/Users/tomh/dev/dbb/site/public/data/player_ids.txt"


def load_sleeper_to_espn_map(csv_path: str) -> Dict[str, Dict[str, str]]:
    mapping: Dict[str, Dict[str, str]] = {}
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            sleeper_id = (row.get('sleeper_id') or '').strip()
            espn_id = (row.get('espn_id') or '').strip()
            espn_name = (row.get('espn_name') or '').strip()
            if sleeper_id and espn_id:
                mapping[sleeper_id] = {'espn_id': espn_id, 'espn_name': espn_name}
    return mapping


def collect_week_player_ids(weekly_scores_json_path: str) -> Set[str]:
    with open(weekly_scores_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    ids: Set[str] = set()
    # Expecting a list of matchup objects with a "players" array
    if isinstance(data, list):
        for entry in data:
            players = entry.get('players') if isinstance(entry, dict) else None
            if isinstance(players, list):
                for pid in players:
                    if pid is not None:
                        ids.add(str(pid))
            # Also include starters array in case some payloads omit bench in players
            starters = entry.get('starters') if isinstance(entry, dict) else None
            if isinstance(starters, list):
                for pid in starters:
                    if pid is not None:
                        ids.add(str(pid))
    return ids


def build_espn_player_list(weekly_scores_json_path: str, csv_path: str) -> List[Dict[str, Any]]:
    sleeper_ids = collect_week_player_ids(weekly_scores_json_path)
    map_se_to_espn = load_sleeper_to_espn_map(csv_path)

    results: List[Dict[str, Any]] = []
    for sid in sorted(sleeper_ids, key=lambda x: int(x) if x.isdigit() else x):
        m = map_se_to_espn.get(sid)
        if not m:
            continue
        results.append({'espn_id': m['espn_id'], 'name': m['espn_name'] or ''})

    # Deduplicate on espn_id (in case of duplicates across inputs)
    seen: Set[str] = set()
    deduped: List[Dict[str, Any]] = []
    for r in results:
        if r['espn_id'] in seen:
            continue
        seen.add(r['espn_id'])
        deduped.append(r)

    # Sort by name then espn_id for stable output
    deduped.sort(key=lambda r: (r['name'].lower(), int(r['espn_id']) if r['espn_id'].isdigit() else r['espn_id']))
    return deduped


def main() -> None:
    parser = argparse.ArgumentParser(description='Build full list of ESPN player IDs with names from a weekly scores JSON (Sleeper matchup payload).')
    parser.add_argument('--week-json', '-i', type=str, required=True, help='Path to weekly scores JSON file (parsed)')
    parser.add_argument('--ids-csv', type=str, default=PLAYER_IDS_CSV, help='Path to player_ids.txt CSV mapping (default: site/public/data/player_ids.txt)')
    parser.add_argument('--pretty', action='store_true', help='Pretty-print JSON output')
    args = parser.parse_args()

    result = build_espn_player_list(args.week_json, args.ids_csv)
    if args.pretty:
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    main() 