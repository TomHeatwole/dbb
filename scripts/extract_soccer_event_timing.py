#!/usr/bin/env python3
"""Extract corner-kick and goal timings from the European Soccer Database dump.

Reads corner_detail.csv and goal_detail.csv from the extracted archive and
writes two tidy CSVs of event timings tagged with league.

The archive's detail CSVs carry no league column; that mapping lives in the
Match/League/Country tables of the source database.sqlite. Pass --sqlite to
join it in, otherwise league is written as UNKNOWN.

Usage:
  python scripts/extract_soccer_event_timing.py <archiveDir> [outDir] [--sqlite path]
"""
import argparse
import csv
import os
import sqlite3

# Per DataDictionary.xlsx, only these goal_type/comment codes are real goals;
# dg (disallowed), npm/psm (missed penalties) and rp (retake) are not.
VALID_GOAL_CODES = {'n', 'o', 'p'}


def load_league_map(sqlite_path):
    con = sqlite3.connect(sqlite_path)
    try:
        rows = con.execute("""
            SELECT Match.id, Country.name, League.name
            FROM Match
            JOIN League ON League.id = Match.league_id
            JOIN Country ON Country.id = League.country_id
        """).fetchall()
    finally:
        con.close()
    return {str(mid): f'{country} {league}' for mid, country, league in rows}


def extract(src, out_path, league_map, goals_only_valid):
    kept = dropped_deleted = dropped_invalid = 0
    with open(src, newline='', encoding='utf-8') as fh, \
            open(out_path, 'w', newline='', encoding='utf-8') as out:
        writer = csv.writer(out)
        writer.writerow(['league', 'match_id', 'minute', 'elapsed', 'elapsed_plus'])
        for row in csv.DictReader(fh):
            if row.get('del', '').strip() == '1':
                dropped_deleted += 1
                continue
            if goals_only_valid:
                # "comment" is documented as more reliable than "goal_type".
                code = (row.get('comment') or row.get('goal_type') or '').strip()
                if code not in VALID_GOAL_CODES:
                    dropped_invalid += 1
                    continue
            elapsed = row['elapsed'].strip()
            if not elapsed:
                dropped_invalid += 1
                continue
            plus = row['elapsed_plus'].strip()
            elapsed = int(elapsed)
            plus = int(plus) if plus else 0
            match_id = row['match_id']
            writer.writerow([
                league_map.get(match_id, 'UNKNOWN'), match_id,
                elapsed + plus, elapsed, plus,
            ])
            kept += 1
    return kept, dropped_deleted, dropped_invalid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('archive_dir')
    ap.add_argument('out_dir', nargs='?')
    ap.add_argument('--sqlite', help='source database.sqlite for the league mapping')
    args = ap.parse_args()

    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    out_dir = os.path.abspath(args.out_dir) if args.out_dir else \
        os.path.join(root, 'example_data', 'soccer_event_timing')
    os.makedirs(out_dir, exist_ok=True)

    league_map = load_league_map(args.sqlite) if args.sqlite else {}
    if args.sqlite:
        print(f'league mapping: {len(league_map)} matches')
    else:
        print('league mapping: none supplied, writing UNKNOWN')

    for name, goals_only_valid in [('corner', False), ('goal', True)]:
        src = os.path.join(args.archive_dir, f'{name}_detail.csv')
        out_path = os.path.join(out_dir, f'{name}_timing.csv')
        kept, deleted, invalid = extract(src, out_path, league_map, goals_only_valid)
        print(f'{name:7s} -> {out_path}')
        print(f'         kept={kept} dropped_deleted={deleted} dropped_invalid={invalid}')


if __name__ == '__main__':
    main()
