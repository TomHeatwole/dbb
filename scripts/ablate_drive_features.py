#!/usr/bin/env python3
"""Ablate drive-start features on the 2025 holdout.

Also scores 2023→2024 as a second temporal fold, and compares
hand-buckets vs the raw continuous inputs.
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import train_drive_models as t  # noqa: E402

SO_FAR = ['so_far_td', 'so_far_fg', 'so_far_punt', 'so_far_other']
LINE_RAW = ['offense_spread', 'over_under']
LINE_EXP = ['exp_off', 'exp_def']
LINE_ALL = LINE_RAW + LINE_EXP


def without(feats, drop):
    drop = set(drop)
    return [f for f in feats if f not in drop]


def add_bins(df):
    out = df.copy()
    ytg = out['ytg']
    out['ytg_bin'] = np.where(ytg >= 86, 0, np.where(ytg >= 70, 1, np.where(ytg >= 45, 2, 3))).astype(float)
    sec = out['sec_left']
    # late ≤3 min half is already in snap time bins; here use game-clock coarse bins
    out['sec_bin'] = np.where(sec <= 180, 0, np.where(sec <= 480, 1, np.where(sec <= 1800, 2, 3))).astype(float)
    spr = out['offense_spread']
    # dog / pick / short / mid / big favorite
    out['spread_bin'] = np.select(
        [spr >= 14, spr >= 7, spr >= 2.5, spr > -2.5, spr > -7, spr > -14],
        [0, 1, 2, 3, 4, 5],
        default=6,
    ).astype(float)
    ou = out['over_under']
    out['ou_bin'] = np.where(ou < 45, 0, np.where(ou < 50, 1, np.where(ou < 55, 2, np.where(ou < 60, 3, 4)))).astype(float)
    return out


def run(name, train, test, features):
    _, pred = t.fit_lgbm(train, test, features)
    y = t.labels(test)
    return {
        'name': name,
        'n_feat': len(features),
        'logloss': round(t.logloss(y, pred), 5),
        'acc': round(t.accuracy(y, pred), 4),
        'ece': round(t.ece(y, pred), 4),
    }


def print_table(title, rows, baseline):
    print(f'\n=== {title} ===')
    print(f'{"name":<32} {"ll":>8} {"Δll":>8} {"acc":>7} {"ece":>6} {"k":>3}')
    for r in rows:
        delta = r['logloss'] - baseline
        print(
            f"{r['name']:<32} {r['logloss']:8.5f} {delta:+8.5f} "
            f"{r['acc']:7.3f} {r['ece']:6.3f} {r['n_feat']:3d}"
        )


def main():
    print('loading drives…', flush=True)
    lines = t.load_game_lines()
    drives = add_bins(t.load_drives(lines))
    folds = {
        'train 23-24 / test 25': (
            drives[drives['season'].isin((2023, 2024))],
            drives[drives['season'] == 2025],
        ),
        'train 23 / test 24': (
            drives[drives['season'] == 2023],
            drives[drives['season'] == 2024],
        ),
    }

    specs = [
        ('full', t.DRIVE_FEATURES),
        ('drop half_code', without(t.DRIVE_FEATURES, ['half_code'])),
        ('drop fp_code', without(t.DRIVE_FEATURES, ['fp_code'])),
        ('drop so_far_*', without(t.DRIVE_FEATURES, SO_FAR)),
        ('drop drive_n', without(t.DRIVE_FEATURES, ['drive_n'])),
        ('drop is_home', without(t.DRIVE_FEATURES, ['is_home'])),
        ('drop period', without(t.DRIVE_FEATURES, ['period'])),
        ('drop score_diff', without(t.DRIVE_FEATURES, ['score_diff'])),
        ('drop exp_off/def', without(t.DRIVE_FEATURES, LINE_EXP)),
        ('drop spread/ou', without(t.DRIVE_FEATURES, LINE_RAW)),
        ('drop all lines', without(t.DRIVE_FEATURES, LINE_ALL)),
        ('drop sec_left', without(t.DRIVE_FEATURES, ['sec_left'])),
        ('drop ytg', without(t.DRIVE_FEATURES, ['ytg'])),
        ('only ytg (no fp)', without(t.DRIVE_FEATURES, ['fp_code'])),
        ('fp instead of ytg', ['fp_code' if f == 'ytg' else f for f in t.DRIVE_FEATURES if f != 'fp_code']),
        (
            'binned ytg/time/line',
            [
                'ytg_bin' if f == 'ytg' else
                'sec_bin' if f == 'sec_left' else
                'spread_bin' if f == 'offense_spread' else
                'ou_bin' if f == 'over_under' else f
                for f in without(t.DRIVE_FEATURES, LINE_EXP + ['fp_code', 'half_code'])
            ],
        ),
        (
            'slim: ytg clock score exp_off is_home',
            ['ytg', 'sec_left', 'score_diff', 'exp_off', 'is_home'],
        ),
    ]

    for fold_name, (train, test) in folds.items():
        print(f'\n{fold_name}: train {len(train):,}  test {len(test):,}', flush=True)
        rows = []
        for name, feats in specs:
            print(f'  {name}…', flush=True)
            rows.append(run(name, train, test, feats))
        print_table(fold_name, rows, rows[0]['logloss'])


if __name__ == '__main__':
    main()
