#!/usr/bin/env python3
"""2025 holdout for the live current-drive + next-drive book.

Current drive: snap LightGBM on 2025 snaps (last snap of each drive).
Next drive: 2023–24 next-start tables + drive-start LightGBM, scored on
2025 snaps against the actual next opposing drive result.

Writes example_data/ncaaf_drive_results/current_next_drive_holdout.json
"""
from __future__ import annotations

import csv
import json
import math
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

from fit_next_drive_start import (  # noqa: E402
    SNAP_PATH,
    build_tables,
    load_snaps,
)
from ncaaf_field_buckets import fp_bucket  # noqa: E402

DRIVE_CSV = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_drives.csv')
SNAP_OUTCOMES = os.path.join(
    ROOT, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_snaps_outcomes.csv'
)
MODEL_JSON = os.path.join(ROOT, 'site', 'src', 'drives', 'driveResultModel.json')
OUT_JSON = os.path.join(
    ROOT, 'example_data', 'ncaaf_drive_results', 'current_next_drive_holdout.json'
)

CLASSES = ('punt', 'td', 'fg', 'other')
CLASS_INDEX = {c: i for i, c in enumerate(CLASSES)}
FP_CODES = {'deep': 0, 'kickoff': 1, 'midfield': 2, 'favorable': 3}
HALF_CODES = {'h1': 0, 'h2': 1, 'ot': 2}
DIST_CODES = {'short': 0, 'med': 1, 'long': 2, 'xlong': 3}
TIME_CODES = {'late': 0, 'mid': 1, 'early': 2}

LOOKUP_LAYERS = (
    ('full', ('down', 'dist', 'field', 'score', 'time', 'half')),
    ('downFieldScoreTimeHalf', ('down', 'field', 'score', 'time', 'half')),
    ('noScore', ('down', 'dist', 'field', 'time', 'half')),
    ('noTime', ('down', 'dist', 'field', 'score', 'half')),
    ('downFieldTimeHalf', ('down', 'field', 'time', 'half')),
    ('downFieldScoreHalf', ('down', 'field', 'score', 'half')),
    ('downFieldHalf', ('down', 'field', 'half')),
    ('fieldHalf', ('field', 'half')),
)


def to_float(v):
    if v in ('', None):
        return float('nan')
    try:
        x = float(v)
    except (TypeError, ValueError):
        return float('nan')
    return x if math.isfinite(x) else float('nan')


def map_drive_label(bucket):
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


def map_snap_label(result):
    n = str(result or '').strip().upper()
    if n == 'PUNT':
        return 'punt'
    if n == 'TD':
        return 'td'
    if n in ('FG', 'MISSED_FG'):
        return 'fg'
    if n == 'OTHER':
        return 'other'
    return None


def walk(node, x):
    if node.get('f') is None:
        return node['v']
    v = x[node['f']]
    go_left = (not math.isfinite(v)) or v <= node['t']
    return walk(node['l'] if go_left else node['r'], x)


def load_layer_scorer(model, layer):
    pack = model[layer]['lgbm']
    features = pack['features']
    trees = pack['trees']

    def score(feat):
        x = [feat.get(name, float('nan')) for name in features]
        raw = [0.0] * 4
        for tree in trees:
            raw[tree['c']] += walk(tree['n'], x)
        m = max(raw)
        ex = [math.exp(v - m) for v in raw]
        s = sum(ex)
        return [v / s for v in ex]

    return score


def half_code(period):
    p = to_float(period)
    if p in (1, 2):
        return 0.0
    if p in (3, 4):
        return 1.0
    if p > 4:
        return 2.0
    return float('nan')


def dist_code(distance):
    d = to_float(distance)
    if not math.isfinite(d):
        return float('nan')
    if d <= 3:
        return 0.0
    if d <= 6:
        return 1.0
    if d <= 10:
        return 2.0
    return 3.0


def time_code(sec_left_half):
    s = to_float(sec_left_half)
    if not math.isfinite(s):
        return float('nan')
    if s <= 180:
        return 0.0
    if s <= 480:
        return 1.0
    return 2.0


def fp_code(ytg):
    fp = fp_bucket(ytg)
    return float(FP_CODES[fp]) if fp else float('nan')


def exp_points(ou, offense_spread):
    if not (math.isfinite(ou) and math.isfinite(offense_spread)):
        return float('nan'), float('nan')
    return (ou - offense_spread) / 2.0, (ou + offense_spread) / 2.0


def clock_from_game_seconds(sec_left_game):
    sec = int(round(sec_left_game))
    if sec <= 0:
        return 4, 0
    period = 4 - int(math.floor((sec - 0.001) / 900))
    period = min(4, max(1, period))
    clock_sec = sec - (4 - period) * 900
    return period, clock_sec


def lookup_cell(tables, row):
    for layer, keys in LOOKUP_LAYERS:
        parts = []
        ok = True
        for k in keys:
            v = row.get(k)
            if v is None or v == '':
                ok = False
                break
            parts.append(str(v))
        if not ok:
            continue
        cell = tables.get(layer, {}).get('|'.join(parts))
        if cell:
            return cell
    return tables.get('global')


def logloss(ys, ps):
    total = 0.0
    n = 0
    for y, p in zip(ys, ps):
        i = CLASS_INDEX[y]
        total += -math.log(max(p[i], 1e-15))
        n += 1
    return total / n if n else float('nan')


def accuracy(ys, ps):
    if not ys:
        return float('nan')
    hits = 0
    for y, p in zip(ys, ps):
        pred = CLASSES[max(range(4), key=lambda i: p[i])]
        if pred == y:
            hits += 1
    return hits / len(ys)


def mean_mix(ys):
    n = len(ys)
    mix = [ys.count(c) / n if n else 0.0 for c in CLASSES]
    return mix


def summarize_scores(ys, ps, extra=None):
    mix = mean_mix(ys)
    raw = [logloss(ys, [mix] * len(ys))] if ys else [float('nan')]
    cal = []
    for i, c in enumerate(CLASSES):
        pred = [p[i] for p in ps]
        obs = [1.0 if y == c else 0.0 for y in ys]
        if pred:
            cal.append({
                'bucket': c,
                'model': round(sum(pred) / len(pred), 4),
                'obs': round(sum(obs) / len(obs), 4),
            })
    out = {
        'n': len(ys),
        'logloss': round(logloss(ys, ps), 4) if ys else None,
        'raw': round(raw[0], 4) if ys else None,
        'acc': round(accuracy(ys, ps), 3) if ys else None,
        'calibration': cal,
    }
    if extra:
        out.update(extra)
    return out


def load_drive_lookup():
    """(game_id, 1-based drive_n) → result / side / lines."""
    out = {}
    with open(DRIVE_CSV, newline='') as fh:
        for raw in csv.DictReader(fh):
            gid = str(raw.get('game_id') or '')
            dn = to_float(raw.get('drive_n'))
            y = map_drive_label(raw.get('result_bucket'))
            if not gid or not math.isfinite(dn) or y is None:
                continue
            spread = to_float(raw.get('offense_spread'))
            ou = to_float(raw.get('cfbd_over_under'))
            if not math.isfinite(ou):
                ou = to_float(raw.get('over_under'))
            out[(gid, int(dn))] = {
                'y': y,
                'offense_side': raw.get('offense_side'),
                'offense_spread': spread,
                'over_under': ou,
                'start_yard': to_float(raw.get('start_yard')),
                'start_period': to_float(raw.get('start_period')),
                'start_seconds_left': to_float(raw.get('start_seconds_left')),
                'score_diff': (
                    to_float(raw.get('start_offense_score'))
                    - to_float(raw.get('start_defense_score'))
                ),
            }
    return out


def last_snap_keys(rows):
    best = {}
    for i, r in enumerate(rows):
        key = (str(r.get('game_id') or ''), r.get('drive_n'))
        if key[1] is None:
            continue
        prev = best.get(key)
        sec = r.get('sec_left_game')
        if prev is None or (sec is not None and (prev[1] is None or sec < prev[1])):
            best[key] = (i, sec)
    return {key: idx for key, (idx, _) in best.items()}


def drive_start_features(ytg, sec_left, period, score_diff, offense_spread, ou, is_home):
    exp_off, exp_def = exp_points(ou, offense_spread)
    return {
        'ytg': ytg,
        'sec_left': sec_left,
        'period': period,
        'score_diff': score_diff if math.isfinite(score_diff) else 0.0,
        'offense_spread': offense_spread,
        'over_under': ou,
        'exp_off': exp_off,
        'exp_def': exp_def,
        'drive_n': float('nan'),
        'is_home': is_home,
        'so_far_td': float('nan'),
        'so_far_fg': float('nan'),
        'so_far_punt': float('nan'),
        'so_far_other': float('nan'),
        'fp_code': fp_code(ytg),
        'half_code': half_code(period),
    }


def snap_features(row, spread, ou):
    ytg = to_float(row.get('ytg'))
    down = to_float(row.get('down'))
    distance = to_float(row.get('distance'))
    period = to_float(row.get('period'))
    sec = to_float(row.get('sec_left_game'))
    half = to_float(row.get('sec_left_half'))
    score_diff = to_float(row.get('score_diff'))
    exp_off, exp_def = exp_points(ou, spread)
    return {
        'down': down,
        'distance': distance if math.isfinite(distance) else 10.0,
        'ytg': ytg,
        'sec_left': sec,
        'period': period,
        'score_diff': score_diff,
        'offense_spread': spread,
        'over_under': ou,
        'exp_off': exp_off,
        'exp_def': exp_def,
        'fp_code': fp_code(ytg),
        'dist_code': dist_code(distance if math.isfinite(distance) else 10.0),
        'half_code': half_code(period),
        'time_code': time_code(half),
    }


def eval_current(score_snap, drives):
    ys = []
    ps = []
    last = {}
    with open(SNAP_OUTCOMES, newline='') as fh:
        for raw in csv.DictReader(fh):
            if str(raw.get('season') or '') != '2025':
                continue
            y = map_snap_label(raw.get('this_result'))
            ytg = to_float(raw.get('ytg'))
            down = to_float(raw.get('down'))
            if y is None or not math.isfinite(ytg) or not math.isfinite(down):
                continue
            gid = str(raw.get('game_id') or '')
            dn = to_float(raw.get('drive_n'))
            if not gid or not math.isfinite(dn):
                continue
            info = drives.get((gid, int(dn) + 1)) or drives.get((gid, int(dn)))
            if not info:
                continue
            sec = to_float(raw.get('sec_left_game'))
            key = (gid, int(dn))
            prev = last.get(key)
            if prev is None or (math.isfinite(sec) and sec < prev[0]):
                last[key] = (sec, raw, y, info)
    for _, raw, y, info in last.values():
        feat = snap_features(raw, info['offense_spread'], info['over_under'])
        ps.append(score_snap(feat))
        ys.append(y)
    return summarize_scores(ys, ps)


def eval_next(tables, score_start, rows, drives, last_only):
    if last_only:
        keep = set(last_snap_keys(rows).values())
        chosen = [r for i, r in enumerate(rows) if i in keep]
    else:
        chosen = rows
    ys = []
    ps = []
    oracle_ps = []
    abs_err = []
    for r in chosen:
        if r.get('season') != 2025:
            continue
        if r.get('next_ytg') is None:
            continue
        gid = str(r.get('game_id') or '')
        dn = r.get('drive_n')
        nxt = drives.get((gid, (dn or -1) + 2))
        if not nxt:
            continue
        cell = lookup_cell(tables, r)
        if not cell or not cell.get('y') or cell['y'][3] is None:
            continue
        pred_ytg = float(cell['y'][3])
        consumed = cell.get('t', [None, None, None, None])[3]
        sec_now = r.get('sec_left_game')
        if sec_now is None or consumed is None:
            continue
        sec_left = max(0.0, float(sec_now) - float(consumed))
        period, _clock = clock_from_game_seconds(sec_left)
        cur = drives.get((gid, (dn or -1) + 1))
        if not cur:
            continue
        spread = -cur['offense_spread'] if math.isfinite(cur['offense_spread']) else float('nan')
        ou = cur['over_under']
        is_home = 0.0 if cur.get('offense_side') == 'home' else 1.0
        score_diff = -cur['score_diff'] if math.isfinite(cur.get('score_diff', float('nan'))) else 0.0
        pred_feat = drive_start_features(
            pred_ytg, sec_left, period, score_diff, spread, ou, is_home
        )
        actual_ytg = nxt['start_yard']
        actual_sec = nxt['start_seconds_left']
        actual_period = nxt['start_period']
        if not math.isfinite(actual_ytg):
            continue
        oracle_feat = drive_start_features(
            actual_ytg, actual_sec, actual_period, nxt['score_diff'],
            nxt['offense_spread'], nxt['over_under'],
            1.0 if nxt.get('offense_side') == 'home' else 0.0,
        )
        ys.append(nxt['y'])
        ps.append(score_start(pred_feat))
        oracle_ps.append(score_start(oracle_feat))
        abs_err.append(abs(pred_ytg - r['next_ytg']))
    extra = {
        'ytgMae': round(sum(abs_err) / len(abs_err), 2) if abs_err else None,
        'oracle': summarize_scores(ys, oracle_ps),
    }
    return summarize_scores(ys, ps, extra)


def main():
    print('loading model / drives / snaps…', flush=True)
    with open(MODEL_JSON, encoding='utf-8') as fh:
        model = json.load(fh)
    score_start = load_layer_scorer(model, 'driveStart')
    score_snap = load_layer_scorer(model, 'snap')
    drives = load_drive_lookup()
    snaps = load_snaps(SNAP_PATH)
    train = [r for r in snaps if r.get('season') in (2023, 2024)]
    print(f'  next-start train snaps {len(train):,}', flush=True)
    tables = build_tables(train)

    print('scoring 2025 current-drive last snaps…', flush=True)
    current = eval_current(score_snap, drives)
    print(
        f"  current last-snap logloss {current['logloss']}  "
        f"raw {current['raw']}  acc {current['acc']}  n={current['n']:,}",
        flush=True,
    )

    print('scoring 2025 next-drive (last snap / all snaps)…', flush=True)
    next_last = eval_next(tables, score_start, snaps, drives, last_only=True)
    next_all = eval_next(tables, score_start, snaps, drives, last_only=False)
    for label, row in (('last snap', next_last), ('all snaps', next_all)):
        print(
            f"  next {label} logloss {row['logloss']}  raw {row['raw']}  "
            f"acc {row['acc']}  ytg MAE {row['ytgMae']}  n={row['n']:,}"
            f"  oracle {row['oracle']['logloss']}",
            flush=True,
        )

    payload = {
        'testSeason': 2025,
        'trainSeasons': [2023, 2024],
        'currentDrive': {
            'note': 'Snap LightGBM on the last 2025 snap of each drive.',
            **current,
        },
        'nextDrive': {
            'note': (
                'Next-start tables fit on 2023–24 only, then drive-start '
                'LightGBM at the predicted opponent start.'
            ),
            'lastSnap': next_last,
            'allSnaps': next_all,
        },
        'publishedSnapHoldout': model.get('meta', {}),
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2)
    print(f'wrote {OUT_JSON}', flush=True)


if __name__ == '__main__':
    main()
