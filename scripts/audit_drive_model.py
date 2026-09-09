#!/usr/bin/env python3
"""Audit checks for the drive-result model.

1. Train/serve skew: drive-start trees get drive_n / so_far_* = NaN live,
   but training never had them missing. Measure prediction shift + logloss.
2. Snap holdout sliced by down, and 4th-down punt calibration drift in 2025.
Writes example_data/ncaaf_drive_results/drive_model_audit.json
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_drive_models import (  # noqa: E402
    ROOT, DRIVE_FEATURES, SNAP_FEATURES, CLASSES,
    load_game_lines, load_drives, load_snaps, split_by_season,
    matrix, labels, fit_lgbm, logloss,
)

OUT = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'drive_model_audit.json')


def main():
    lines = load_game_lines()
    drives = load_drives(lines)
    snaps = load_snaps(lines)
    d_tr, d_te = split_by_season(drives)
    s_tr, s_te = split_by_season(snaps)

    out = {}

    # --- 1. drive-start NaN skew -------------------------------------------
    booster, p_true = fit_lgbm(d_tr, d_te, DRIVE_FEATURES)
    y = labels(d_te)
    x_nan = matrix(d_te, DRIVE_FEATURES).copy()
    nan_cols = [DRIVE_FEATURES.index(f) for f in
                ('drive_n', 'so_far_td', 'so_far_fg', 'so_far_punt', 'so_far_other')]
    x_nan[:, nan_cols] = np.nan
    p_nan = booster.predict(x_nan)
    shift = np.abs(p_true - p_nan)
    out['drive_start_nan_skew'] = {
        'n': int(len(y)),
        'logloss_true_features': round(logloss(y, p_true), 5),
        'logloss_nan_features': round(logloss(y, p_nan), 5),
        'mean_abs_prob_shift': {CLASSES[i]: round(float(shift[:, i].mean()), 4) for i in range(4)},
        'p90_abs_prob_shift': {CLASSES[i]: round(float(np.quantile(shift[:, i], 0.9)), 4) for i in range(4)},
        'share_rows_any_class_shift_gt_3pts': round(float((shift.max(axis=1) > 0.03).mean()), 4),
        'share_rows_any_class_shift_gt_5pts': round(float((shift.max(axis=1) > 0.05).mean()), 4),
    }

    # --- 2. snap model by down ---------------------------------------------
    sboost, sp = fit_lgbm(s_tr, s_te, SNAP_FEATURES)
    sy = labels(s_te)
    downs = s_te['down'].to_numpy()
    by_down = {}
    y_tr = labels(s_tr)
    tr_downs = s_tr['down'].to_numpy()
    for d in (1.0, 2.0, 3.0, 4.0):
        m = downs == d
        if m.sum() < 100:
            continue
        # down-conditional frequency baseline from train
        tm = tr_downs == d
        freq = np.bincount(y_tr[tm], minlength=4).astype(float)
        freq /= freq.sum()
        base = np.tile(freq, (int(m.sum()), 1))
        by_down[f'down_{int(d)}'] = {
            'n': int(m.sum()),
            'logloss_model': round(logloss(sy[m], sp[m]), 5),
            'logloss_down_freq_baseline': round(logloss(sy[m], base), 5),
            'obs_punt': round(float((sy[m] == 0).mean()), 4),
            'pred_punt': round(float(sp[m, 0].mean()), 4),
        }
    m123 = downs <= 3
    out['snap_by_down'] = by_down
    out['snap_excl_4th'] = {
        'n': int(m123.sum()),
        'logloss_model': round(logloss(sy[m123], sp[m123]), 5),
    }

    # --- 3. 4th-down punt calibration drift 2025 ---------------------------
    m4 = downs == 4.0
    out['fourth_down_2025'] = {
        'n': int(m4.sum()),
        'pred_punt': round(float(sp[m4, 0].mean()), 4),
        'obs_punt': round(float((sy[m4] == 0).mean()), 4),
    }

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out, indent=2))
    print(f'wrote {OUT}')


if __name__ == '__main__':
    main()
