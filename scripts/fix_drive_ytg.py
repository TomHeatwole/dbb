#!/usr/bin/env python3
"""Rewrite espn_ncaaf_drives.csv start_yard as yards-to-goal.

ESPN stored hash-marks in start_yard (own 25 as 25). Recover ytg from
start_text (``STAN 25``) and keep the raw mark in start_yard_line.
"""
from __future__ import annotations

import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ncaaf_field_buckets import yards_to_goal  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_drives.csv')


def main():
    tmp = PATH + '.tmp'
    n = changed = parsed = failed = 0
    with open(PATH, newline='', encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        fields = list(reader.fieldnames or [])
        if 'start_yard_line' not in fields:
            idx = fields.index('start_yard') + 1 if 'start_yard' in fields else len(fields)
            fields.insert(idx, 'start_yard_line')
        with open(tmp, 'w', newline='', encoding='utf-8') as out:
            w = csv.DictWriter(out, fieldnames=fields, extrasaction='ignore')
            w.writeheader()
            for row in reader:
                n += 1
                raw_line = row.get('start_yard_line') or row.get('start_yard', '')
                if not row.get('start_yard_line'):
                    row['start_yard_line'] = raw_line
                ytg = yards_to_goal(
                    row.get('start_text'),
                    offense_abbr=row.get('offense_abbr') or '',
                    home_abbr=row.get('home_abbr') or '',
                    away_abbr=row.get('away_abbr') or '',
                    offense_side=row.get('offense_side') or '',
                    yard_line=raw_line,
                )
                if ytg is None:
                    failed += 1
                    row['start_yard'] = raw_line
                else:
                    parsed += 1
                    if str(raw_line) != str(ytg):
                        changed += 1
                    row['start_yard'] = ytg
                w.writerow(row)
    os.replace(tmp, PATH)
    print(f'rewrote {PATH}')
    print(f'  rows {n}  parsed {parsed}  changed {changed}  left-as-is {failed}')


if __name__ == '__main__':
    main()
