#!/usr/bin/env python3
"""Fit P(points) and P(next start bucket) from espn_ncaaf_snaps_outcomes.csv.

Writes:
  example_data/ncaaf_drive_results/drive_situation_tables.json
  site/src/drives/driveSituationTables.json
"""
from __future__ import annotations

import csv
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ncaaf_field_buckets import (  # noqa: E402
    DIST_IDS,
    FP_IDS,
    HALF_BINS,
    POINT_VALUES,
    TIME_BINS,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP_PATH = os.path.join(
    ROOT, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_snaps_outcomes.csv'
)
OUT_DATA = os.path.join(
    ROOT, 'example_data', 'ncaaf_drive_results', 'drive_situation_tables.json'
)
OUT_SITE = os.path.join(ROOT, 'site', 'src', 'drives', 'driveSituationTables.json')

MIN_N = 20


def to_int(v):
    if v in ('', None):
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def load_snaps(path):
    rows = []
    games = set()
    with open(path, newline='', encoding='utf-8') as f:
        for raw in csv.DictReader(f):
            down = to_int(raw.get('down'))
            points = to_int(raw.get('this_points'))
            fp = raw.get('fp_bucket') or ''
            dist = raw.get('dist_bin') or ''
            tb = raw.get('time_bin') or ''
            hb = raw.get('half_bin') or ''
            if down not in (1, 2, 3, 4):
                continue
            if fp not in FP_IDS or dist not in DIST_IDS:
                continue
            if hb not in HALF_BINS:
                continue
            if points not in POINT_VALUES:
                continue
            games.add(raw.get('game_id'))
            rows.append({
                'down': down,
                'dist': dist,
                'fp': fp,
                'time': tb if tb in TIME_BINS else None,
                'half': hb,
                'points': points,
                'next_fp': raw.get('next_fp_bucket') or '',
                'next_kind': raw.get('next_kind') or '',
                'next_ytg': to_int(raw.get('next_ytg')),
            })
    return rows, games


def summarize(rows):
    n = len(rows)
    pts = {k: 0 for k in POINT_VALUES}
    nxt = {k: 0 for k in FP_IDS}
    n_next = 0
    n_over = 0
    ytg_sum = 0
    ytg_n = 0
    for r in rows:
        pts[r['points']] += 1
        if r['next_kind'] == 'game_over' or not r['next_fp']:
            n_over += 1
            continue
        if r['next_fp'] in nxt:
            nxt[r['next_fp']] += 1
            n_next += 1
        if r['next_ytg'] is not None:
            ytg_sum += r['next_ytg']
            ytg_n += 1
    denom = max(1, n)
    nd = max(1, n_next)
    return {
        'n': n,
        'nn': n_next,
        'p': [round(pts[k] / denom, 4) for k in POINT_VALUES],
        'z': [round(nxt[k] / nd, 4) for k in FP_IDS],
        'go': round(n_over / denom, 4),
        'y': None if not ytg_n else round(ytg_sum / ytg_n, 1),
    }


def group(rows, keys):
    buckets = defaultdict(list)
    for r in rows:
        parts = []
        skip = False
        for k in keys:
            v = r.get(k)
            if v is None or v == '':
                skip = True
                break
            parts.append(str(v))
        if skip:
            continue
        buckets['|'.join(parts)].append(r)
    return buckets


def keep_cells(buckets, min_n=MIN_N):
    return {k: summarize(rs) for k, rs in buckets.items() if len(rs) >= min_n}


def main():
    if not os.path.isfile(SNAP_PATH):
        raise SystemExit(f'missing {SNAP_PATH}')
    rows, games = load_snaps(SNAP_PATH)
    print(f'loaded {len(rows)} snaps from {len(games)} games')

    tables = {
        'full': keep_cells(group(rows, ['down', 'dist', 'fp', 'time', 'half'])),
        'noTime': keep_cells(group(rows, ['down', 'dist', 'fp', 'half'])),
        'noDist': keep_cells(group(rows, ['down', 'fp', 'time', 'half'])),
        'downFpHalf': keep_cells(group(rows, ['down', 'fp', 'half'])),
        'fpHalf': keep_cells(group(rows, ['fp', 'half']), 15),
        'fp': keep_cells(group(rows, ['fp']), 15),
    }
    payload = {
        'meta': {
            'nSnaps': len(rows),
            'nGames': len(games),
            'minN': MIN_N,
            'fpBuckets': list(FP_IDS),
            'distBins': list(DIST_IDS),
            'timeBins': list(TIME_BINS),
            'halfBins': list(HALF_BINS),
            'points': list(POINT_VALUES),
            'source': 'ESPN college-football summary plays, 2023-2025 FBS+FCS',
            'note': (
                'fp: deep=inside own 15, kickoff=own 15-30 or kickoff start, '
                'midfield=own 31 through opp 45, favorable=inside opp 45. '
                'p = P(this drive scores 0/3/6/7/8). z = P(next opp start bucket).'
            ),
        },
        'tables': tables,
        'global': summarize(rows),
    }
    for path in (OUT_DATA, OUT_SITE):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, separators=(',', ':'))
        print(f'wrote {path} ({os.path.getsize(path):,} bytes)')

    print('cells', {k: len(v) for k, v in tables.items()})
    g = payload['global']
    print('global points', dict(zip(POINT_VALUES, g['p'])), 'n', g['n'])
    print('global next  ', dict(zip(FP_IDS, g['z'])), 'game_over', g['go'])


if __name__ == '__main__':
    main()
