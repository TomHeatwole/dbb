#!/usr/bin/env python3
"""Holdout-size and early/mid/late-season checks for the drive-start model.

Writes example_data/ncaaf_drive_results/holdout_season_eval.json
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_drive_models import (  # noqa: E402
    ROOT, DRIVE_CSV, DRIVE_FEATURES, SNAP_FEATURES, CLASSES,
    load_game_lines, load_drives, load_snaps, split_by_season,
    matrix, labels, fit_lgbm, logloss,
)

OUT = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'holdout_season_eval.json')

# ESPN: season_type 2 = regular, 3 = postseason
PHASES = (
    ('early', 'Weeks 1–4'),
    ('mid', 'Weeks 5–9'),
    ('late', 'Weeks 10–15'),
    ('bowls', 'Bowls / CFP'),
)


def phase_of(season_type, week):
    st = int(season_type) if pd.notna(season_type) else 2
    w = int(week) if pd.notna(week) else 0
    if st != 2 or w >= 16:
        return 'bowls'
    if w <= 4:
        return 'early'
    if w <= 9:
        return 'mid'
    return 'late'


def rates(y):
    n = len(y)
    if n == 0:
        return {c: None for c in CLASSES} | {'n': 0}
    return {CLASSES[i]: round(float((y == i).mean()), 4) for i in range(4)} | {'n': int(n)}


def load_drive_meta():
    cols = ['season', 'game_id', 'week', 'season_type', 'date', 'start_yard', 'result_bucket']
    raw = pd.read_csv(DRIVE_CSV, usecols=cols, low_memory=False)
    raw = raw.dropna(subset=['start_yard', 'result_bucket'])
    return raw


def attach_meta(drives, meta):
    """drives from load_drives is filtered; align by reconstituting phase on game_id.

    load_drives drops some rows, so we merge week/season_type by game_id
    (every drive in a game shares week).
    """
    game = meta.groupby('game_id', sort=False).first()[['week', 'season_type', 'date']]
    # load_drives does not keep game_id. Rebuild a keyed frame from CSV the same way.
    return game


def load_drives_with_meta(lines):
    """Same filters as load_drives, plus week / season_type / game_id."""
    from train_drive_models import (
        map_drive_label, to_float, exp_points, fp_bucket, half_bin,
        FP_CODES, HALF_CODES,
    )
    usecols = [
        'season', 'game_id', 'week', 'season_type', 'date',
        'drive_n', 'offense_side',
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
        week = to_float(rec.week)
        st = to_float(rec.season_type)
        rows.append({
            'season': int(rec.season) if not pd.isna(rec.season) else None,
            'game_id': str(int(rec.game_id)) if not pd.isna(rec.game_id) else '',
            'week': int(week) if not np.isnan(week) else 0,
            'season_type': int(st) if not np.isnan(st) else 2,
            'phase': phase_of(st, week),
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


def card(y, p, pred_name=None):
    out = {
        'n': int(len(y)),
        'logloss': round(logloss(y, p), 5) if len(y) else None,
        'obs': {CLASSES[i]: round(float((y == i).mean()), 4) for i in range(4)} if len(y) else None,
        'pred': {CLASSES[i]: round(float(p[:, i].mean()), 4) for i in range(4)} if len(y) else None,
    }
    if len(y):
        out['punt_residual_pp'] = round(float(((y == 0).mean() - p[:, 0].mean()) * 100), 2)
    return out


def main():
    print('loading…', flush=True)
    lines = load_game_lines()
    drives = load_drives_with_meta(lines)
    snaps = load_snaps(lines)
    d_tr, d_te = split_by_season(drives)
    s_tr, s_te = split_by_season(snaps)

    out = {'observed_rates': {}, 'phase_calibration_2025': {}, 'holdout_protocols': {}}

    for season in (2023, 2024, 2025):
        sub = drives[drives['season'] == season]
        out['observed_rates'][str(season)] = {
            'all': rates(labels(sub)),
            **{ph: rates(labels(sub[sub['phase'] == ph])) for ph, _ in PHASES},
        }

    print('fitting published protocol (23–24 / 2025)…', flush=True)
    booster, p_te = fit_lgbm(d_tr, d_te, DRIVE_FEATURES)
    y_te = labels(d_te)
    out['phase_calibration_2025']['all'] = card(y_te, p_te)
    for ph, _ in PHASES:
        m = d_te['phase'] == ph
        out['phase_calibration_2025'][ph] = card(y_te[m], p_te[m])

    # --- holdout protocols on the same 2025 rows where possible -------------
    games_2025 = d_te['game_id'].drop_duplicates().to_numpy()
    rng = np.random.default_rng(7)
    rng.shuffle(games_2025)
    n_hold = max(1, int(round(0.10 * len(games_2025))))
    hold_games = set(games_2025[:n_hold])
    keep_games = set(games_2025[n_hold:])

    d_te_10 = d_te[d_te['game_id'].isin(hold_games)]
    d_in_90 = d_te[d_te['game_id'].isin(keep_games)]
    train_plus = pd.concat([d_tr, d_in_90], ignore_index=True)

    print(f'fitting 90/10 game split (hold {len(hold_games)} of {len(games_2025)} 2025 games)…', flush=True)
    _, p_old_on_10 = fit_lgbm(d_tr, d_te_10, DRIVE_FEATURES)
    _, p_new_on_10 = fit_lgbm(train_plus, d_te_10, DRIVE_FEATURES)
    y10 = labels(d_te_10)
    out['holdout_protocols']['random_10pct_2025_games'] = {
        'n_games_hold': int(len(hold_games)),
        'n_games_train_2025': int(len(keep_games)),
        'n_drives_hold': int(len(d_te_10)),
        'train_23_24_only': card(y10, p_old_on_10),
        'train_23_24_plus_90pct_2025': card(y10, p_new_on_10),
        'note': (
            'Same-season interpolation. The 10% games share 2025 coaching/tempo '
            'with the 90%, so this overstates the gain you would see in 2026.'
        ),
    }

    late = d_te[d_te['phase'].isin(('late', 'bowls'))]
    early_mid = d_te[d_te['phase'].isin(('early', 'mid'))]
    train_temporal = pd.concat([d_tr, early_mid], ignore_index=True)
    print('fitting temporal 2025 (early+mid train / late+bowls test)…', flush=True)
    _, p_old_late = fit_lgbm(d_tr, late, DRIVE_FEATURES)
    _, p_new_late = fit_lgbm(train_temporal, late, DRIVE_FEATURES)
    y_late = labels(late)
    out['holdout_protocols']['temporal_late_2025'] = {
        'n_drives_hold': int(len(late)),
        'n_drives_added_2025': int(len(early_mid)),
        'train_23_24_only': card(y_late, p_old_late),
        'train_23_24_plus_early_mid_2025': card(y_late, p_new_late),
        'note': (
            'Honest in-season test: train through week 9 of 2025, score weeks 10+ '
            'and bowls. Closer to “will extra 2025 data help next year.”'
        ),
    }

    bowls = d_te[d_te['phase'] == 'bowls']
    regular = d_te[d_te['phase'] != 'bowls']
    train_reg = pd.concat([d_tr, regular], ignore_index=True)
    print('fitting regular-2025 / bowls test…', flush=True)
    _, p_old_bowl = fit_lgbm(d_tr, bowls, DRIVE_FEATURES)
    _, p_new_bowl = fit_lgbm(train_reg, bowls, DRIVE_FEATURES)
    y_bowl = labels(bowls)
    out['holdout_protocols']['bowls_2025'] = {
        'n_drives_hold': int(len(bowls)),
        'n_drives_added_2025': int(len(regular)),
        'train_23_24_only': card(y_bowl, p_old_bowl),
        'train_23_24_plus_regular_2025': card(y_bowl, p_new_bowl),
    }

    # Snap model phase rates only (no extra snap retrains — expensive, same story)
    snap_y = labels(s_te)
    # we need week on snaps — join via game_id if present
    if 'game_id' in snaps.columns:
        gphase = drives.groupby('game_id', sort=False)['phase'].first()
        # snaps from load_snaps may not have game_id
    out['snap_2025_note'] = (
        'Phase check is on drive-start rows (the next-drive quotes). '
        'Snap trees do not use drive_n / so_far.'
    )

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out, indent=2))
    print(f'wrote {OUT}')


if __name__ == '__main__':
    main()
