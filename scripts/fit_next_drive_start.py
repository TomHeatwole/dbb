#!/usr/bin/env python3
"""Fit opponent next-drive start lookup tables from snap CSV.

Writes:
  example_data/ncaaf_drive_results/next_drive_start_tables.json
  site/src/drives/nextDriveStartTables.json
"""
from __future__ import annotations

import csv
import json
import math
import os
import statistics
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP_PATH = os.path.join(
    ROOT, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_snaps_next_drive.csv'
)
OUT_DATA = os.path.join(
    ROOT, 'example_data', 'ncaaf_drive_results', 'next_drive_start_tables.json'
)
OUT_SITE = os.path.join(ROOT, 'site', 'src', 'drives', 'nextDriveStartTables.json')

FIELD_BINS = [
    ('own_1_10', 90, 99),
    ('own_11_20', 80, 89),
    ('own_21_35', 65, 79),
    ('own_36_50', 50, 64),
    ('plus_35_49', 35, 49),
    ('fg_20_34', 20, 34),
    ('red_1_19', 1, 19),
]
ZONE_KEYS = [k for k, _, _ in FIELD_BINS]
DIST_BINS = [
    ('short', 1, 3),
    ('med', 4, 6),
    ('long', 7, 10),
    ('xlong', 11, 99),
]
MIN_N = 20


def field_bin(ytg):
    y = int(ytg)
    for key, lo, hi in FIELD_BINS:
        if lo <= y <= hi:
            return key
    return None


def dist_bin(distance):
    d = int(distance)
    for key, lo, hi in DIST_BINS:
        if lo <= d <= hi:
            return key
    return 'xlong'


def score_bin(diff):
    if diff is None:
        return None
    d = int(diff)
    if d <= -9:
        return 'trail2'
    if d <= -1:
        return 'trail'
    if d == 0:
        return 'tied'
    if d <= 8:
        return 'lead'
    return 'lead2'


def time_bin(sec_left_half):
    if sec_left_half is None:
        return None
    s = int(sec_left_half)
    if s <= 180:
        return 'late'
    if s <= 480:
        return 'mid'
    return 'early'


def half_bin(period):
    if period is None:
        return None
    p = int(period)
    if p in (1, 2):
        return 'h1'
    if p in (3, 4):
        return 'h2'
    return 'ot'


def to_int(v):
    if v in ('', None):
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def pct(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    if len(xs) == 1:
        return xs[0]
    i = (len(xs) - 1) * p
    lo = int(math.floor(i))
    hi = min(lo + 1, len(xs) - 1)
    frac = i - lo
    return xs[lo] * (1 - frac) + xs[hi] * frac


def zone_of(ytg):
    return field_bin(ytg)


def summarize(rows):
    n = len(rows)
    with_next = [r for r in rows if r['next_ytg'] is not None]
    ytgs = [r['next_ytg'] for r in with_next]
    times = [r['seconds_consumed'] for r in with_next if r['seconds_consumed'] is not None]
    kinds = defaultdict(int)
    results = defaultdict(int)
    zones = defaultdict(int)
    for r in rows:
        kinds[r['next_kind']] += 1
        results[r['this_result']] += 1
    for y in ytgs:
        z = zone_of(y)
        if z:
            zones[z] += 1
    nz = max(1, len(ytgs))
    nk = max(1, n)
    return {
        'n': n,
        'nNext': len(with_next),
        'yMean': None if not ytgs else round(statistics.mean(ytgs), 1),
        'yP25': None if not ytgs else round(pct(ytgs, 0.25), 1),
        'yP50': None if not ytgs else round(pct(ytgs, 0.50), 1),
        'yP75': None if not ytgs else round(pct(ytgs, 0.75), 1),
        'tMean': None if not times else round(statistics.mean(times), 1),
        'tP25': None if not times else round(pct(times, 0.25), 1),
        'tP50': None if not times else round(pct(times, 0.50), 1),
        'tP75': None if not times else round(pct(times, 0.75), 1),
        'pSame': round(kinds.get('opp_same_half', 0) / nk, 4),
        'pNextHalf': round(kinds.get('opp_next_half', 0) / nk, 4),
        'pGameOver': round(kinds.get('game_over', 0) / nk, 4),
        'pPunt': round(results.get('Punt', 0) / nk, 4),
        'pTd': round(results.get('Offensive TD', 0) / nk, 4),
        'pFg': round(results.get('Field Goal Attempt', 0) / nk, 4),
        'pOther': round(results.get('Any Other', 0) / nk, 4),
        'zones': {k: round(zones.get(k, 0) / nz, 4) for k in ZONE_KEYS},
    }


def compact(stats):
    """Pack for JSON size."""
    z = stats['zones']
    return {
        'n': stats['n'],
        'nn': stats['nNext'],
        'y': [stats['yP25'], stats['yP50'], stats['yP75'], stats['yMean']],
        't': [stats['tP25'], stats['tP50'], stats['tP75'], stats['tMean']],
        'k': [stats['pSame'], stats['pNextHalf'], stats['pGameOver']],
        'r': [stats['pPunt'], stats['pTd'], stats['pFg'], stats['pOther']],
        'z': [z[k] for k in ZONE_KEYS],
    }


def load_snaps(path):
    rows = []
    with open(path, newline='') as f:
        for raw in csv.DictReader(f):
            down = to_int(raw.get('down'))
            dist = to_int(raw.get('distance'))
            ytg = to_int(raw.get('ytg'))
            period = to_int(raw.get('period'))
            if down is None or dist is None or ytg is None:
                continue
            fb = field_bin(ytg)
            if not fb:
                continue
            hb = half_bin(period)
            if not hb:
                continue
            rows.append({
                'down': down,
                'dist': dist_bin(dist),
                'field': fb,
                'score': score_bin(to_int(raw.get('score_diff'))),
                'time': time_bin(to_int(raw.get('sec_left_half'))),
                'half': hb,
                'ytg': ytg,
                'next_ytg': to_int(raw.get('next_ytg')),
                'seconds_consumed': to_int(raw.get('seconds_consumed')),
                'next_kind': raw.get('next_kind') or '',
                'this_result': raw.get('this_result') or '',
                'period': period,
            })
    return rows


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


def keep_cells(buckets, min_n):
    out = {}
    for k, rs in buckets.items():
        if len(rs) < min_n:
            continue
        out[k] = compact(summarize(rs))
    return out


def field_curve(rows):
    """E[next ytg] by current 5-yard ytg bin and down, regulation only."""
    buckets = defaultdict(list)
    for r in rows:
        if r['half'] == 'ot':
            continue
        if r['next_ytg'] is None:
            continue
        y5 = int(math.floor((r['ytg'] - 1) / 5) * 5 + 1)
        buckets[(r['down'], y5)].append(r['next_ytg'])
    series = {1: {}, 2: {}, 3: {}, 4: {}}
    for (down, y5), ys in buckets.items():
        if len(ys) < 30:
            continue
        mean = round(statistics.mean(ys), 1)
        series[down][str(y5)] = {
            'n': len(ys),
            'mean': mean,
            'p50': round(pct(ys, 0.5), 1),
            'own': round(100 - mean, 1),
        }
    return series


def example_hist(rows):
    """10-yard opponent start histogram for the default situation."""
    hist = defaultdict(int)
    n = 0
    for r in rows:
        if r['down'] != 2 or r['field'] != 'own_1_10':
            continue
        if r['score'] != 'trail' or r['time'] != 'mid' or r['half'] != 'h1':
            continue
        if r['next_ytg'] is None:
            continue
        own = 100 - r['next_ytg']
        b = max(0, min(90, (own // 10) * 10))
        hist[b] += 1
        n += 1
    if not n:
        return {'n': 0, 'bins': []}
    bins = []
    for b in range(0, 100, 10):
        if b < 50:
            label = f'OWN {b}–{b + 9}'
        elif b == 50:
            label = '50–OPP 41'
        else:
            label = f'OPP {100 - (b + 9)}–{100 - b}'
        bins.append({'label': label, 'p': round(hist.get(b, 0) / n, 4)})
    return {'n': n, 'bins': bins}


def time_curve(rows):
    """Seconds consumed by time-left-in-half (60s bins) and half, 2nd down own 1-35."""
    buckets = defaultdict(list)
    for r in rows:
        if r['down'] not in (1, 2, 3):
            continue
        if r['field'] not in ('own_1_10', 'own_11_20', 'own_21_35'):
            continue
        if r['seconds_consumed'] is None:
            continue
        # reconstruct approx sec_left_half from time bin only is too coarse;
        # skip — computed in scrape. We don't have raw sec here except via rows.
        pass
    return {}


def main():
    if not os.path.isfile(SNAP_PATH):
        raise SystemExit(f'missing {SNAP_PATH}')
    rows = load_snaps(SNAP_PATH)
    print(f'loaded {len(rows)} snaps')

    tables = {
        'full': keep_cells(
            group(rows, ['down', 'dist', 'field', 'score', 'time', 'half']),
            MIN_N,
        ),
        'noScore': keep_cells(
            group(rows, ['down', 'dist', 'field', 'time', 'half']),
            MIN_N,
        ),
        'noTime': keep_cells(
            group(rows, ['down', 'dist', 'field', 'score', 'half']),
            MIN_N,
        ),
        'downFieldScoreTimeHalf': keep_cells(
            group(rows, ['down', 'field', 'score', 'time', 'half']),
            15,
        ),
        'downFieldTimeHalf': keep_cells(
            group(rows, ['down', 'field', 'time', 'half']),
            MIN_N,
        ),
        'downFieldScoreHalf': keep_cells(
            group(rows, ['down', 'field', 'score', 'half']),
            15,
        ),
        'downFieldHalf': keep_cells(
            group(rows, ['down', 'field', 'half']),
            15,
        ),
        'fieldHalf': keep_cells(
            group(rows, ['field', 'half']),
            15,
        ),
        'global': compact(summarize(rows)),
    }
    meta = {
        'nSnaps': len(rows),
        'nGames': None,
        'minN': MIN_N,
        'fieldBins': ZONE_KEYS,
        'distBins': [k for k, _, _ in DIST_BINS],
        'scoreBins': ['trail2', 'trail', 'tied', 'lead', 'lead2'],
        'timeBins': ['late', 'mid', 'early'],
        'halfBins': ['h1', 'h2', 'ot'],
        'yNote': 'next_ytg is opponent yards-to-goal at their next drive start (75 = own 25)',
        'source': 'ESPN college-football summary plays, 2023-2025 FBS+FCS',
    }
    # n games from raw file
    games = set()
    with open(SNAP_PATH, newline='') as f:
        for raw in csv.DictReader(f):
            games.add(raw.get('game_id'))
    meta['nGames'] = len(games)

    payload = {
        'meta': meta,
        'tables': {k: v for k, v in tables.items() if k != 'global'},
        'global': tables['global'],
        'fieldCurve': field_curve(rows),
        'example': None,
    }

    # Highlight the user's example cell if present.
    ex_key = '2|short|own_1_10|trail|mid|h1'
    payload['example'] = {
        'key': ex_key,
        'full': tables['full'].get(ex_key),
        'noScore': tables['noScore'].get('2|short|own_1_10|mid|h1'),
        'downFieldScoreTimeHalf': tables['downFieldScoreTimeHalf'].get(
            '2|own_1_10|trail|mid|h1'
        ),
        'downFieldTimeHalf': tables['downFieldTimeHalf'].get('2|own_1_10|mid|h1'),
        'downFieldHalf': tables['downFieldHalf'].get('2|own_1_10|h1'),
    }

    for path in (OUT_DATA, OUT_SITE):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            json.dump(payload, f, separators=(',', ':'))
        size = os.path.getsize(path)
        print(f'wrote {path} ({size:,} bytes)')

    print('full cells', len(tables['full']))
    print('downFieldScoreTimeHalf', len(tables['downFieldScoreTimeHalf']))
    print('noScore', len(tables['noScore']))
    print('downFieldTimeHalf', len(tables['downFieldTimeHalf']))
    print('example', json.dumps(payload['example'], indent=2))
    g = tables['global']
    print('global next_ytg mean', g['y'][3], 'consumed', g['t'][3], 'n', g['n'])

    canvas = {
        'meta': meta,
        'global': tables['global'],
        'dsth': tables['downFieldScoreTimeHalf'],
        'dfth': tables['downFieldTimeHalf'],
        'dfh': tables['downFieldHalf'],
        'fieldCurve': payload['fieldCurve'],
        'example': payload['example'],
        'exampleHist': example_hist(rows),
    }
    canvas_path = os.path.join(
        ROOT, 'example_data', 'ncaaf_drive_results', 'next_drive_start_canvas.json'
    )
    with open(canvas_path, 'w') as f:
        json.dump(canvas, f, separators=(',', ':'))
    print(f'wrote {canvas_path} ({os.path.getsize(canvas_path):,} bytes)')


if __name__ == '__main__':
    main()
