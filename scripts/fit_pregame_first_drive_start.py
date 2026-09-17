#!/usr/bin/env python3
"""Fit pregame 1st-drive start tables from ESPN drives.

Writes site/src/drives/pregameFirstDriveStartTables.json

Two layers:

  1. Spread-binned mean spots (legacy / display).
  2. Going-second start *mixture*: P(start bin | opening-drive result, spread).
     Opening-drive result is scored live by the drive-start LightGBM; these
     tables are the conditional field-position distributions after that result.
"""
from __future__ import annotations

import csv
import json
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRIVE_CSV = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_drives.csv')
OUT_JSON = os.path.join(ROOT, 'site', 'src', 'drives', 'pregameFirstDriveStartTables.json')

SPREAD_BINS = [
    ('fav_le_21', -99, -21),
    ('fav_21_14', -21, -14),
    ('fav_14_7', -14, -7),
    ('fav_7_3', -7, -3),
    ('pick', -3, 3),
    ('dog_3_7', 3, 7),
    ('dog_7_14', 7, 14),
    ('dog_14_21', 14, 21),
    ('dog_ge_21', 21, 99),
]

# Same cuts as nextDriveStart field bins (ESPN yards-to-goal).
START_BINS = [
    ('own_1_10', 'Own 1–10', 90, 99),
    ('own_11_20', 'Own 11–20', 80, 89),
    ('own_21_35', 'Own 21–35', 65, 79),
    ('own_36_50', 'Own 36–50', 50, 64),
    ('plus_35_49', 'Opp 49–35', 35, 49),
    ('fg_20_34', 'Opp 34–20', 20, 34),
    ('red_1_19', 'Red zone', 1, 19),
]
PRIOR_RESULTS = ('td', 'fg', 'punt', 'other')


def to_float(v):
    if v in ('', None):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def spread_bin_id(spread):
    if spread is None:
        return None
    for key, lo, hi in SPREAD_BINS:
        if lo <= spread < hi:
            return key
    return None


def start_bin_id(ytg):
    if ytg is None:
        return None
    for key, _label, lo, hi in START_BINS:
        if lo <= ytg <= hi:
            return key
    return None


def map_result(bucket):
    n = str(bucket or '').strip().lower()
    if n == 'punt':
        return 'punt'
    if n in ('offensive td', 'td'):
        return 'td'
    if n in ('field goal attempt', 'fg'):
        return 'fg'
    if n in ('any other', 'other'):
        return 'other'
    return None


def fit_mean_bucket(rows):
    out = {}
    for key, lo, hi in SPREAD_BINS:
        sub = [r for r in rows if r['spread'] is not None and lo <= r['spread'] < hi]
        if len(sub) < 30:
            continue
        ytgs = sorted(r['ytg'] for r in sub)
        secs = sorted(r['sec'] for r in sub if r['sec'] is not None)
        out[key] = {
            'n': len(sub),
            'ytg': round(sum(ytgs) / len(ytgs), 2),
            'ytgP50': ytgs[len(ytgs) // 2],
            'secLeft': round(sum(secs) / len(secs)) if secs else 3300,
            'clockSec': round((sum(secs) / len(secs)) % 900) if secs else 750,
        }
    return out


def pack_hist(rows):
    """rows: dicts with ytg, sec, optional filter already applied."""
    by_bin = defaultdict(list)
    for r in rows:
        bid = start_bin_id(r['ytg'])
        if not bid:
            continue
        by_bin[bid].append(r)
    n = sum(len(v) for v in by_bin.values())
    bins = {}
    for key, _label, _lo, _hi in START_BINS:
        chunk = by_bin.get(key) or []
        if not chunk:
            continue
        ytgs = [x['ytg'] for x in chunk]
        secs = [x['sec'] for x in chunk if x['sec'] is not None]
        bins[key] = {
            'n': len(chunk),
            'ytg': round(sum(ytgs) / len(ytgs), 2),
            'secLeft': round(sum(secs) / len(secs)) if secs else None,
        }
    return {'n': n, 'bins': bins}


def fit_mix(rows):
    global_pack = pack_hist(rows)
    by_spread = {}
    for key, lo, hi in SPREAD_BINS:
        sub = [r for r in rows if r['spread'] is not None and lo <= r['spread'] < hi]
        packed = pack_hist(sub)
        if packed['n'] >= 20:
            by_spread[key] = packed
    return {'global': global_pack, 'bySpread': by_spread}


def main():
    rows_all = list(csv.DictReader(open(DRIVE_CSV, encoding='utf-8')))
    by_game = defaultdict(list)
    for row in rows_all:
        if row['season'] not in ('2023', '2024', '2025'):
            continue
        by_game[row['game_id']].append(row)

    receive, kick = [], []
    after_by_prior = {k: [] for k in PRIOR_RESULTS}

    for _gid, drives in by_game.items():
        drives = sorted(drives, key=lambda d: int(float(d['drive_n'])))
        if not drives:
            continue
        recv_side = drives[0]['offense_side']
        seen = set()
        for i, row in enumerate(drives):
            side = row['offense_side']
            if side in seen:
                continue
            seen.add(side)
            ytg = to_float(row['start_yard'])
            if ytg is None:
                continue
            rec = {
                'ytg': ytg,
                'spread': to_float(row['offense_spread']),
                'sec': to_float(row['start_seconds_left']),
            }
            if side == recv_side:
                receive.append(rec)
                continue
            kick.append(rec)
            prev = drives[i - 1] if i else None
            prior = map_result(prev.get('result_bucket') if prev else None)
            if prior:
                after_by_prior[prior].append(rec)

    after_mix = {prior: fit_mix(after_by_prior[prior]) for prior in PRIOR_RESULTS}
    receive_mix = fit_mix(receive)

    payload = {
        'meta': {
            'source': 'espn_ncaaf_drives.csv 2023-25 team-first possessions',
            'receive': 'opening kickoff return',
            'afterOpponent': 'first possession after opponent opening drive',
            'afterOpponentMix': (
                'P(start bin | opening result, going-second spread). '
                'Opening result is scored by the drive-start LightGBM; '
                'these histograms are the conditional spots.'
            ),
            'shrinkage': 40,
        },
        'startBins': [
            {'id': key, 'label': label, 'lo': lo, 'hi': hi}
            for key, label, lo, hi in START_BINS
        ],
        'receive': fit_mean_bucket(receive),
        'afterOpponent': fit_mean_bucket(kick),
        'global': {
            'receive': {'ytg': 74.5, 'secLeft': 3600, 'clockSec': 900},
            'afterOpponent': {'ytg': 71.3, 'secLeft': 3300, 'clockSec': 750},
        },
        'receiveMix': receive_mix,
        'afterOpponentMix': after_mix,
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2)
    print(f'wrote {OUT_JSON}')
    for prior in PRIOR_RESULTS:
        print(f"  after {prior}: n={after_mix[prior]['global']['n']}")


if __name__ == '__main__':
    main()
