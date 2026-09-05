#!/usr/bin/env python3
"""Train joint drive-result models and export trees for the site.

Two LightGBM multiclass models, both predicting FanDuel buckets
(punt / offensive TD / FG attempt / other):

  drive_start  — features known at the start of a drive (pregame 1st-drive)
  snap         — features known on the current snap (live)

Train 2023–24, hold out 2025. Baselines: raw frequencies and
P(y | field bucket). Logistic regression is the linear joint model.

Usage:
  python3 scripts/train_drive_models.py
"""
from __future__ import annotations

import json
import math
import os
import sys
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ncaaf_field_buckets import fp_bucket, half_bin  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRIVE_CSV = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_drives.csv')
SNAP_CSV = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_snaps_outcomes.csv')
OUT_JSON = os.path.join(ROOT, 'site', 'src', 'drives', 'driveResultModel.json')
OUT_EVAL = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'drive_model_eval.json')

CLASSES = ('punt', 'td', 'fg', 'other')
CLASS_INDEX = {c: i for i, c in enumerate(CLASSES)}

FP_CODES = {'deep': 0, 'kickoff': 1, 'midfield': 2, 'favorable': 3}
HALF_CODES = {'h1': 0, 'h2': 1, 'ot': 2}
DIST_CODES = {'short': 0, 'med': 1, 'long': 2, 'xlong': 3}
TIME_CODES = {'late': 0, 'mid': 1, 'early': 2}

DRIVE_FEATURES = [
    'ytg', 'sec_left', 'period', 'score_diff',
    'offense_spread', 'over_under', 'exp_off', 'exp_def',
    'drive_n', 'is_home',
    'so_far_td', 'so_far_fg', 'so_far_punt', 'so_far_other',
    'fp_code', 'half_code',
]
SNAP_FEATURES = [
    'down', 'distance', 'ytg', 'sec_left', 'period', 'score_diff',
    'offense_spread', 'over_under', 'exp_off', 'exp_def',
    'fp_code', 'dist_code', 'half_code', 'time_code',
]


def to_float(v):
    if v in ('', None) or (isinstance(v, float) and math.isnan(v)):
        return np.nan
    try:
        return float(v)
    except (TypeError, ValueError):
        return np.nan


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


def exp_points(ou, offense_spread):
    if np.isnan(ou) or np.isnan(offense_spread):
        return np.nan, np.nan
    return (ou - offense_spread) / 2.0, (ou + offense_spread) / 2.0


def load_game_lines():
    """game_id → home-perspective closer (spread, ou)."""
    cols = ['game_id', 'cfbd_spread', 'cfbd_over_under', 'spread', 'over_under']
    games = pd.read_csv(DRIVE_CSV, usecols=lambda c: c in cols + ['season'], low_memory=False)
    # one row per game
    first = games.groupby('game_id', sort=False).first()
    out = {}
    for gid, row in first.iterrows():
        spread = to_float(row.get('cfbd_spread', np.nan))
        if np.isnan(spread):
            spread = to_float(row.get('spread', np.nan))
        ou = to_float(row.get('cfbd_over_under', np.nan))
        if np.isnan(ou):
            ou = to_float(row.get('over_under', np.nan))
        out[str(gid)] = (spread, ou)
    return out


def load_drives(lines):
    usecols = [
        'season', 'game_id', 'drive_n', 'offense_side',
        'start_period', 'start_seconds_left', 'start_yard',
        'start_offense_score', 'start_defense_score',
        'result_bucket',
        'so_far_td', 'so_far_fg', 'so_far_punt', 'so_far_other',
        'offense_spread', 'cfbd_spread', 'cfbd_over_under', 'over_under',
    ]
    df = pd.read_csv(DRIVE_CSV, usecols=usecols, low_memory=False)
    rows = []
    for rec in df.itertuples(index=False):
        y = map_drive_label(rec.result_bucket)
        ytg = to_float(rec.start_yard)
        if y is None or np.isnan(ytg) or ytg < 1 or ytg > 99:
            continue
        sec = to_float(rec.start_seconds_left)
        period = to_float(rec.start_period)
        off_s = to_float(rec.start_offense_score)
        def_s = to_float(rec.start_defense_score)
        score_diff = off_s - def_s if not (np.isnan(off_s) or np.isnan(def_s)) else np.nan
        spread = to_float(rec.offense_spread)
        ou = to_float(rec.cfbd_over_under)
        if np.isnan(ou):
            ou = to_float(rec.over_under)
        exp_off, exp_def = exp_points(ou, spread)
        fp = fp_bucket(ytg)
        hb = half_bin(period) if not np.isnan(period) else None
        rows.append({
            'season': int(rec.season) if not pd.isna(rec.season) else None,
            'y': y,
            'ytg': ytg,
            'sec_left': sec,
            'period': period,
            'score_diff': score_diff,
            'offense_spread': spread,
            'over_under': ou,
            'exp_off': exp_off,
            'exp_def': exp_def,
            'drive_n': to_float(rec.drive_n),
            'is_home': 1.0 if rec.offense_side == 'home' else 0.0,
            'so_far_td': to_float(rec.so_far_td) or 0.0,
            'so_far_fg': to_float(rec.so_far_fg) or 0.0,
            'so_far_punt': to_float(rec.so_far_punt) or 0.0,
            'so_far_other': to_float(rec.so_far_other) or 0.0,
            'fp_code': float(FP_CODES[fp]) if fp else np.nan,
            'half_code': float(HALF_CODES[hb]) if hb else np.nan,
        })
    return pd.DataFrame(rows)


def load_drive_spread_map():
    """(game_id, drive_n) → (offense_spread, ou). drive_n in snaps is 0-based."""
    usecols = ['game_id', 'drive_n', 'offense_spread', 'cfbd_over_under', 'over_under']
    df = pd.read_csv(DRIVE_CSV, usecols=usecols, low_memory=False)
    out = {}
    for rec in df.itertuples(index=False):
        gid = str(int(rec.game_id)) if not pd.isna(rec.game_id) else ''
        dn = to_float(rec.drive_n)
        if not gid or np.isnan(dn):
            continue
        spread = to_float(rec.offense_spread)
        ou = to_float(rec.cfbd_over_under)
        if np.isnan(ou):
            ou = to_float(rec.over_under)
        # snaps use 0-based drive_n; drives CSV is 1-based
        out[(gid, int(dn) - 1)] = (spread, ou)
        out[(gid, int(dn))] = (spread, ou)
    return out


def load_snaps(lines):
    spread_map = load_drive_spread_map()
    usecols = [
        'season', 'game_id', 'drive_n', 'down', 'distance', 'ytg',
        'period', 'sec_left_game', 'score_diff',
        'fp_bucket', 'dist_bin', 'half_bin', 'time_bin',
        'this_result',
    ]
    df = pd.read_csv(SNAP_CSV, usecols=usecols, low_memory=False)
    rows = []
    for rec in df.itertuples(index=False):
        y = map_snap_label(rec.this_result)
        ytg = to_float(rec.ytg)
        if y is None or np.isnan(ytg):
            continue
        gid = str(int(rec.game_id)) if not pd.isna(rec.game_id) else ''
        dn = int(rec.drive_n) if not pd.isna(rec.drive_n) else -1
        spread, ou = spread_map.get((gid, dn), (np.nan, np.nan))
        if np.isnan(spread) or np.isnan(ou):
            home_spread, home_ou = lines.get(gid, (np.nan, np.nan))
            if np.isnan(ou):
                ou = home_ou
            if np.isnan(spread):
                spread = home_spread
        exp_off, exp_def = exp_points(ou, spread)
        rows.append({
            'season': int(rec.season) if not pd.isna(rec.season) else None,
            'y': y,
            'down': to_float(rec.down),
            'distance': to_float(rec.distance),
            'ytg': ytg,
            'sec_left': to_float(rec.sec_left_game),
            'period': to_float(rec.period),
            'score_diff': to_float(rec.score_diff),
            'offense_spread': spread,
            'over_under': ou,
            'exp_off': exp_off,
            'exp_def': exp_def,
            'fp_code': float(FP_CODES[rec.fp_bucket]) if rec.fp_bucket in FP_CODES else np.nan,
            'dist_code': float(DIST_CODES[rec.dist_bin]) if rec.dist_bin in DIST_CODES else np.nan,
            'half_code': float(HALF_CODES[rec.half_bin]) if rec.half_bin in HALF_CODES else np.nan,
            'time_code': float(TIME_CODES[rec.time_bin]) if rec.time_bin in TIME_CODES else np.nan,
        })
    return pd.DataFrame(rows)


def split_by_season(df):
    train = df[df['season'].isin((2023, 2024))].copy()
    test = df[df['season'] == 2025].copy()
    return train, test


def matrix(df, features):
    return df[features].to_numpy(dtype=np.float64)


def labels(df):
    return df['y'].map(CLASS_INDEX).to_numpy(dtype=np.int32)


def softmax(raw):
    shifted = raw - raw.max(axis=1, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=1, keepdims=True)


def logloss(y, p):
    p = np.clip(p, 1e-15, 1 - 1e-15)
    return float(-np.mean(np.log(p[np.arange(len(y)), y])))


def accuracy(y, p):
    return float((p.argmax(axis=1) == y).mean())


def ece(y, p, bins=10):
    """Expected calibration error on the predicted-class probability."""
    conf = p.max(axis=1)
    pred = p.argmax(axis=1)
    correct = (pred == y).astype(np.float64)
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    n = len(y)
    for i in range(bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (conf >= lo) & (conf < hi) if i < bins - 1 else (conf >= lo) & (conf <= hi)
        if not mask.any():
            continue
        total += mask.sum() / n * abs(correct[mask].mean() - conf[mask].mean())
    return float(total)


def per_class_reliability(y, p, bins=8):
    out = {}
    edges = np.linspace(0, 1, bins + 1)
    for i, name in enumerate(CLASSES):
        rows = []
        for b in range(bins):
            lo, hi = edges[b], edges[b + 1]
            mask = (p[:, i] >= lo) & (p[:, i] < hi) if b < bins - 1 else (p[:, i] >= lo) & (p[:, i] <= hi)
            if mask.sum() < 20:
                continue
            rows.append({
                'lo': round(float(lo), 3),
                'hi': round(float(hi), 3),
                'n': int(mask.sum()),
                'pred': round(float(p[mask, i].mean()), 4),
                'obs': round(float((y[mask] == i).mean()), 4),
            })
        out[name] = rows
    return out


def freq_probs(train_y, n):
    counts = np.bincount(train_y, minlength=4).astype(np.float64)
    counts = counts / counts.sum()
    return np.tile(counts, (n, 1))


def bucket_probs(train, test, col='fp_code'):
    tables = {}
    for code, grp in train.groupby(col):
        if pd.isna(code):
            continue
        c = np.bincount(labels(grp), minlength=4).astype(np.float64)
        tables[float(code)] = c / c.sum()
    global_p = np.bincount(labels(train), minlength=4).astype(np.float64)
    global_p = global_p / global_p.sum()
    out = []
    for code in test[col].to_numpy():
        if pd.isna(code) or float(code) not in tables:
            out.append(global_p)
        else:
            out.append(tables[float(code)])
    return np.vstack(out)


def fit_logit(train, test, features):
    med = np.nanmedian(matrix(train, features), axis=0)
    def fill(df):
        x = matrix(df, features)
        inds = np.where(np.isnan(x))
        x[inds] = np.take(med, inds[1])
        return x
    x_tr, x_te = fill(train), fill(test)
    scaler = StandardScaler()
    x_tr = scaler.fit_transform(x_tr)
    x_te = scaler.transform(x_te)
    clf = LogisticRegression(
        max_iter=400,
        solver='lbfgs',
        C=0.5,
    )
    clf.fit(x_tr, labels(train))
    return clf.predict_proba(x_te), {
        'coef': clf.coef_.tolist(),
        'intercept': clf.intercept_.tolist(),
        'mean': scaler.mean_.tolist(),
        'scale': scaler.scale_.tolist(),
        'median': med.tolist(),
        'features': list(features),
    }


def fit_lgbm(train, test, features, seed=7):
    dtrain = lgb.Dataset(matrix(train, features), label=labels(train), feature_name=list(features))
    dvalid = lgb.Dataset(matrix(test, features), label=labels(test), reference=dtrain)
    params = {
        'objective': 'multiclass',
        'num_class': 4,
        'metric': 'multi_logloss',
        'learning_rate': 0.05,
        'num_leaves': 31,
        'min_data_in_leaf': 80,
        'feature_fraction': 0.85,
        'bagging_fraction': 0.8,
        'bagging_freq': 1,
        'verbose': -1,
        'seed': seed,
    }
    booster = lgb.train(
        params,
        dtrain,
        num_boost_round=400,
        valid_sets=[dvalid],
        callbacks=[lgb.early_stopping(40, verbose=False), lgb.log_evaluation(0)],
    )
    pred = booster.predict(matrix(test, features), raw_score=False)
    return booster, pred


def compact_tree(node):
    if 'leaf_value' in node:
        return {'v': round(float(node['leaf_value']), 8)}
    return {
        'f': int(node['split_feature']),
        't': float(node['threshold']),
        'dl': bool(node.get('default_left', True)),
        'l': compact_tree(node['left_child']),
        'r': compact_tree(node['right_child']),
    }


def walk_compact(node, x):
    if 'f' not in node:
        return float(node['v'])
    v = x[node['f']]
    go_left = node['dl'] if not (isinstance(v, (int, float)) and math.isfinite(v)) else v <= node['t']
    return walk_compact(node['l'] if go_left else node['r'], x)


def score_exported(lgbm, feature_map):
    features = lgbm['features']
    x = [feature_map.get(name, float('nan')) for name in features]
    raw = [0.0] * len(CLASSES)
    for tree in lgbm['trees']:
        raw[tree['c']] += walk_compact(tree['n'], x)
    m = max(raw)
    ex = [math.exp(v - m) for v in raw]
    s = sum(ex)
    return [v / s for v in ex]


def export_booster(booster, features, classes=CLASSES):
    dump = booster.dump_model()
    trees = []
    for info in dump['tree_info']:
        trees.append({
            'c': int(info['tree_index']) % len(classes),
            's': float(info.get('shrinkage', 1.0)),
            'n': compact_tree(info['tree_structure']),
        })
    gain = booster.feature_importance(importance_type='gain')
    split = booster.feature_importance(importance_type='split')
    return {
        'features': list(features),
        'classes': list(classes),
        'best_iteration': int(booster.best_iteration or len(trees) // len(classes)),
        'trees': trees,
        'importance': {
            features[i]: {'gain': float(gain[i]), 'split': int(split[i])}
            for i in range(len(features))
        },
    }


def scorecard(name, y, p):
    return {
        'name': name,
        'n': int(len(y)),
        'logloss': round(logloss(y, p), 5),
        'accuracy': round(accuracy(y, p), 4),
        'ece': round(ece(y, p), 4),
        'mean_p': {CLASSES[i]: round(float(p[:, i].mean()), 4) for i in range(4)},
        'obs': {CLASSES[i]: round(float((y == i).mean()), 4) for i in range(4)},
        'reliability': per_class_reliability(y, p),
    }


def run_family(name, train, test, features):
    y_tr, y_te = labels(train), labels(test)
    raw = freq_probs(y_tr, len(y_te))
    buck = bucket_probs(train, test)
    logit_p, logit_export = fit_logit(train, test, features)
    booster, lgb_p = fit_lgbm(train, test, features)
    cards = [
        scorecard('raw_freq', y_te, raw),
        scorecard('fp_bucket', y_te, buck),
        scorecard('logistic', y_te, logit_p),
        scorecard('lightgbm', y_te, lgb_p),
    ]
    print(f'\n=== {name} (test 2025, n={len(y_te)}) ===')
    for c in cards:
        print(
            f"  {c['name']:12}  logloss {c['logloss']:.4f}  "
            f"acc {c['accuracy']:.3f}  ece {c['ece']:.3f}"
        )
    print('  LGBM importance (gain):')
    exported = export_booster(booster, features)
    ranked = sorted(exported['importance'].items(), key=lambda kv: -kv[1]['gain'])
    for feat, imp in ranked[:8]:
        print(f"    {feat:16} {imp['gain']:.0f}")
    return {
        'eval': cards,
        'lgbm': exported,
        'logistic': logit_export,
        'winner': 'lightgbm',
    }


def main():
    print('loading lines / drives / snaps…', flush=True)
    lines = load_game_lines()
    drives = load_drives(lines)
    snaps = load_snaps(lines)
    print(f'  drives {len(drives):,}  snaps {len(snaps):,}  games-with-lines {sum(1 for s,o in lines.values() if not np.isnan(s)):,}')

    d_tr, d_te = split_by_season(drives)
    s_tr, s_te = split_by_season(snaps)
    print(f'  drive train {len(d_tr):,} test {len(d_te):,}')
    print(f'  snap  train {len(s_tr):,} test {len(s_te):,}')

    drive_pack = run_family('drive_start', d_tr, d_te, DRIVE_FEATURES)
    snap_pack = run_family('snap', s_tr, s_te, SNAP_FEATURES)

    meta = {
        'trainSeasons': [2023, 2024],
        'testSeason': 2025,
        'classes': list(CLASSES),
        'fpCodes': FP_CODES,
        'halfCodes': HALF_CODES,
        'distCodes': DIST_CODES,
        'timeCodes': TIME_CODES,
        'note': (
            'LightGBM multiclass on joint inputs. Drive-start for pregame '
            '1st-drive; snap for live current-drive. FG includes makes and misses.'
        ),
    }
    drive_feat = {
        'ytg': 75, 'sec_left': 3600, 'period': 1, 'score_diff': 0,
        'offense_spread': -6.5, 'over_under': 52.5,
        'exp_off': (52.5 - (-6.5)) / 2, 'exp_def': (52.5 + (-6.5)) / 2,
        'drive_n': 1, 'is_home': 1,
        'so_far_td': 0, 'so_far_fg': 0, 'so_far_punt': 0, 'so_far_other': 0,
        'fp_code': 1, 'half_code': 0,
    }
    snap_feat = {
        'down': 3, 'distance': 8, 'ytg': 72, 'sec_left': 210, 'period': 2,
        'score_diff': -7, 'offense_spread': 3.5, 'over_under': 48.5,
        'exp_off': (48.5 - 3.5) / 2, 'exp_def': (48.5 + 3.5) / 2,
        'fp_code': 1, 'dist_code': 2, 'half_code': 0, 'time_code': 0,
    }
    payload = {
        'meta': meta,
        'driveStart': {
            'features': list(DRIVE_FEATURES),
            'lgbm': {k: v for k, v in drive_pack['lgbm'].items() if k != 'importance'},
        },
        'snap': {
            'features': list(SNAP_FEATURES),
            'lgbm': {k: v for k, v in snap_pack['lgbm'].items() if k != 'importance'},
        },
        'fixtures': [
            {'layer': 'driveStart', 'x': drive_feat, 'p': score_exported(drive_pack['lgbm'], drive_feat)},
            {'layer': 'snap', 'x': snap_feat, 'p': score_exported(snap_pack['lgbm'], snap_feat)},
        ],
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(payload, f, separators=(',', ':'))
    eval_only = {
        'meta': payload['meta'],
        'driveStart': drive_pack['eval'],
        'snap': snap_pack['eval'],
        'driveImportance': drive_pack['lgbm']['importance'],
        'snapImportance': snap_pack['lgbm']['importance'],
    }
    with open(OUT_EVAL, 'w', encoding='utf-8') as f:
        json.dump(eval_only, f, indent=2)
    print(f'\nwrote {OUT_JSON} ({os.path.getsize(OUT_JSON):,} bytes)')
    print(f'wrote {OUT_EVAL}')


if __name__ == '__main__':
    main()
