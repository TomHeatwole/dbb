#!/usr/bin/env python3
"""Grade the /drives pregame 1st-drive mixture on 2026 weeks 1–2.

Serving path (coin toss unknown): 50/50 blend of
  receive = kickoff-return start mix
  go-second = opponent opening-result LightGBM × empirical start bins

Writes example_data/ncaaf_drive_results/pregame_first_drive_2026.json
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

from eval_recent_drive_fit import (  # noqa: E402
    CLASS_INDEX,
    CLASSES,
    DRIVE_CSV,
    FP_CODES,
    brier,
    features_site_pregame,
    fp_bucket,
    game_first_receiver,
    load_pregame_start_tables,
    load_scorer,
    logloss,
    map_label,
    mean_p,
    obs,
    spread_bin,
    team_first_drives,
    to_float,
)
OUT_JSON = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'pregame_first_drive_2026.json')
OPENING_RESULTS = ('td', 'fg', 'punt', 'other')
SCORE_AFTER = {'td': -7.0, 'fg': -3.0, 'punt': 0.0, 'other': 0.0}
SHRINKAGE = 40.0
WEEKS = {'1', '2'}


def period_from_sec_left(sec):
    if not math.isfinite(sec) or sec <= 0:
        return 1.0
    return float(min(4, max(1, 4 - math.floor((sec - 0.001) / 900))))


def clock_sec_from_sec_left(sec):
    period = period_from_sec_left(sec)
    if not math.isfinite(sec):
        return 900.0
    return sec - (4 - period) * 900


def empty_hist():
    return {'n': 0, 'bins': {}}


def shrink_hist(tables, spread_pack, global_pack):
    global_h = global_pack or empty_hist()
    local = spread_pack or empty_hist()
    n = float(local.get('n') or 0)
    g_n = float(global_h.get('n') or 0)
    w = 0.0 if g_n <= 0 else n / (n + SHRINKAGE)
    start_bins = tables.get('startBins') or []
    rows = []
    for b in start_bins:
        bid = b['id']
        g = (global_h.get('bins') or {}).get(bid) or {}
        s = (local.get('bins') or {}).get(bid) or {}
        gp = (float(g.get('n') or 0) / g_n) if g_n > 0 else 0.0
        sp = (float(s.get('n') or 0) / n) if n > 0 else 0.0
        p = w * sp + (1 - w) * gp
        if p <= 1e-6:
            continue
        g_ytg = to_float(g.get('ytg'))
        s_ytg = to_float(s.get('ytg'))
        if math.isfinite(s_ytg) and math.isfinite(g_ytg):
            ytg = w * s_ytg + (1 - w) * g_ytg
        else:
            ytg = s_ytg if math.isfinite(s_ytg) else g_ytg
        g_sec = to_float(g.get('secLeft'))
        s_sec = to_float(s.get('secLeft'))
        if math.isfinite(s_sec) and math.isfinite(g_sec):
            sec = w * s_sec + (1 - w) * g_sec
        else:
            sec = s_sec if math.isfinite(s_sec) else g_sec
        if not math.isfinite(ytg):
            continue
        rows.append({
            'id': bid,
            'p': p,
            'ytg': ytg,
            'secLeft': sec if math.isfinite(sec) else None,
        })
    z = sum(r['p'] for r in rows)
    if z > 0:
        for r in rows:
            r['p'] /= z
    return rows


def spread_bin_id(spread):
    if not math.isfinite(spread):
        return None
    for key, lo, hi in (
        ('fav_le_21', -99, -21),
        ('fav_21_14', -21, -14),
        ('fav_14_7', -14, -7),
        ('fav_7_3', -7, -3),
        ('pick', -3, 3),
        ('dog_3_7', 3, 7),
        ('dog_7_14', 7, 14),
        ('dog_14_21', 14, 21),
        ('dog_ge_21', 21, 99),
    ):
        if lo <= spread < hi:
            return key
    return None


def mix_root(tables, root, spread):
    bid = spread_bin_id(spread)
    local = ((root or {}).get('bySpread') or {}).get(bid) if bid else None
    return shrink_hist(tables, local, (root or {}).get('global'))


def mix_probs(parts):
    out = [0.0, 0.0, 0.0, 0.0]
    wsum = 0.0
    for p, w in parts:
        if w <= 0:
            continue
        wsum += w
        for i in range(4):
            out[i] += w * p[i]
    if wsum > 0 and abs(wsum - 1) > 1e-9:
        out = [x / wsum for x in out]
    return out


def ctx_from_row(row):
    feat = features_site_pregame(row)
    return {
        'spread': feat['offense_spread'],
        'ou': feat['over_under'],
        'exp_off': feat['exp_off'],
        'exp_def': feat['exp_def'],
        'is_home': feat['is_home'],
    }


def score_start(score, ctx, ytg, sec_left, drive_n, score_diff=0.0, so_far=None):
    so_far = so_far or {'td': 0.0, 'fg': 0.0, 'punt': 0.0, 'other': 0.0}
    period = period_from_sec_left(sec_left)
    clock_sec = clock_sec_from_sec_left(sec_left)
    fp = fp_bucket(ytg)
    feat = {
        'ytg': ytg,
        'sec_left': sec_left,
        'clock_sec': clock_sec,
        'period': period,
        'score_diff': score_diff,
        'offense_spread': ctx['spread'],
        'over_under': ctx['ou'],
        'exp_off': ctx['exp_off'],
        'exp_def': ctx['exp_def'],
        'drive_n': float(drive_n),
        'is_home': ctx['is_home'],
        'so_far_td': so_far['td'],
        'so_far_fg': so_far['fg'],
        'so_far_punt': so_far['punt'],
        'so_far_other': so_far['other'],
        'fp_code': float(FP_CODES[fp]) if fp else float('nan'),
        'half_code': 0.0 if period <= 2 else 1.0,
    }
    return score(feat)


def score_receive(score, tables, ctx):
    bins = mix_root(tables, tables.get('receiveMix'), ctx['spread'])
    parts = []
    for b in bins:
        sec = float(b['secLeft']) if b.get('secLeft') is not None else 3600.0
        p = score_start(score, ctx, b['ytg'], sec, 1)
        parts.append((p, b['p']))
    return mix_probs(parts) if parts else None


def flip_ctx(ctx):
    return {
        'spread': -ctx['spread'] if math.isfinite(ctx['spread']) else float('nan'),
        'ou': ctx['ou'],
        'exp_off': ctx['exp_def'],
        'exp_def': ctx['exp_off'],
        'is_home': 0.0 if ctx['is_home'] == 1.0 else 1.0,
    }


def score_after(score, tables, ctx):
    opening = score_receive(score, tables, flip_ctx(ctx))
    if not opening:
        return None
    parts = []
    after = tables.get('afterOpponentMix') or {}
    for result in OPENING_RESULTS:
        w_open = opening[CLASS_INDEX[result]]
        if w_open <= 0:
            continue
        bins = mix_root(tables, after.get(result), ctx['spread'])
        so_far = {k: 1.0 if k == result else 0.0 for k in OPENING_RESULTS}
        score_diff = SCORE_AFTER[result]
        for b in bins:
            sec = float(b['secLeft']) if b.get('secLeft') is not None else 3300.0
            p = score_start(score, ctx, b['ytg'], sec, 2, score_diff, so_far)
            parts.append((p, w_open * b['p']))
    return mix_probs(parts) if parts else None


def score_blend(score, tables, ctx):
    recv = score_receive(score, tables, ctx)
    after = score_after(score, tables, ctx)
    if not recv or not after:
        return None
    return mix_probs([(recv, 0.5), (after, 0.5)])


def summarize(p_list, y_list):
    if not p_list:
        return None
    mp = mean_p(p_list)
    ob = obs(y_list)
    gaps = {k: round(mp[k] - ob[k], 4) for k in CLASSES}
    acc = sum(1 for p, y in zip(p_list, y_list) if p.index(max(p)) == y) / len(y_list)
    return {
        'n': len(y_list),
        'logloss': round(logloss(y_list, p_list), 4),
        'brier': round(brier(y_list, p_list), 4),
        'argmax_acc': round(acc, 4),
        'mean_p': mp,
        'obs': ob,
        'gap': gaps,
    }


def slice_rows(rows, pred='blend'):
    p = [r[pred] for r in rows if r.get(pred)]
    y = [r['y'] for r in rows if r.get(pred)]
    return summarize(p, y)


def by_key(rows, key_fn, pred='blend'):
    buckets = defaultdict(list)
    for r in rows:
        if not r.get(pred):
            continue
        buckets[key_fn(r)].append(r)
    out = []
    for name, chunk in buckets.items():
        card = slice_rows(chunk, pred)
        if not card:
            continue
        card['bin'] = name
        out.append(card)
    return out


def reliability(rows, cls='td', pred='blend', edges=None):
    k = CLASS_INDEX[cls]
    edges = edges or (0.0, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.80, 1.01)
    out = []
    scored = [r for r in rows if r.get(pred)]
    for i in range(len(edges) - 1):
        lo, hi = edges[i], edges[i + 1]
        chunk = [r for r in scored if lo <= r[pred][k] < hi]
        if not chunk:
            continue
        pred_m = sum(r[pred][k] for r in chunk) / len(chunk)
        hit = sum(1 for r in chunk if r['y'] == k) / len(chunk)
        out.append({
            'lo': lo,
            'hi': hi,
            'n': len(chunk),
            'pred': round(pred_m, 4),
            'obs': round(hit, 4),
            'gap': round(pred_m - hit, 4),
        })
    return out


def simulated_edges(rows, cls, pred='blend', min_p=0.0, min_gap=0.0):
    """When model p(cls) is high, how often it hits. Not a book edge."""
    k = CLASS_INDEX[cls]
    picked = [r for r in rows if r.get(pred) and r[pred][k] >= min_p]
    if min_gap:
        picked = [r for r in picked if r[pred][k] - max(r[pred][j] for j in range(4) if j != k) >= min_gap]
    if not picked:
        return None
    hit = sum(1 for r in picked if r['y'] == k) / len(picked)
    pred_m = sum(r[pred][k] for r in picked) / len(picked)
    return {
        'class': cls,
        'n': len(picked),
        'pred': round(pred_m, 4),
        'hit': round(hit, 4),
        'gap': round(pred_m - hit, 4),
        'min_p': min_p,
    }


def main():
    print('loading model…', flush=True)
    score = load_scorer()
    tables = load_pregame_start_tables()
    raw = list(csv.DictReader(open(DRIVE_CSV, encoding='utf-8')))
    w12 = [r for r in raw if str(r.get('season')) == '2026' and str(r.get('week')) in WEEKS]
    firsts = team_first_drives(w12)
    recv = game_first_receiver(w12)
    print(f'  2026 w1–2 drives {len(w12)}  team-first {len(firsts)}', flush=True)

    rows = []
    skipped = 0
    for row in firsts:
        y = map_label(row.get('result_bucket'))
        if y is None:
            skipped += 1
            continue
        ctx = ctx_from_row(row)
        if not math.isfinite(ctx['spread']) or not math.isfinite(ctx['ou']):
            skipped += 1
            continue
        blend = score_blend(score, tables, ctx)
        own25 = score(
            {**features_site_pregame(row),
             'ytg': 75.0, 'sec_left': 3600.0, 'period': 1.0, 'score_diff': 0.0,
             'drive_n': 1.0, 'so_far_td': 0.0, 'so_far_fg': 0.0,
             'so_far_punt': 0.0, 'so_far_other': 0.0, 'fp_code': 1.0, 'half_code': 0.0}
        )
        did_recv = recv.get(row.get('game_id')) == row.get('offense_side')
        oracle = score_receive(score, tables, ctx) if did_recv else score_after(score, tables, ctx)
        rec = {
            'week': str(row.get('week')),
            'date': (row.get('date') or '')[:10],
            'home': row.get('home'),
            'away': row.get('away'),
            'offense': row.get('offense'),
            'side': row.get('offense_side'),
            'spread': ctx['spread'],
            'ou': ctx['ou'],
            'role': 'receive' if did_recv else 'kick',
            'result': y,
            'y': CLASS_INDEX[y],
            'blend': blend,
            'own25': own25,
            'oracle': oracle,
        }
        rows.append(rec)
        if len(rows) % 50 == 0:
            print(f'  scored {len(rows)}', flush=True)

    def spread_name(r):
        return spread_bin(r['spread']) or 'unknown'

    payload = {
        'meta': {
            'season': 2026,
            'weeks': [1, 2],
            'n': len(rows),
            'skipped': skipped,
            'note': (
                'Pregame serving = 50/50 coin-toss blend of receive mix vs '
                'going-second mixture. No DK/FD 1st-drive quotes stored for '
                'settled games — this is model vs ESPN result, not vs the board.'
            ),
        },
        'overall': {
            'blend': slice_rows(rows, 'blend'),
            'own25': slice_rows(rows, 'own25'),
            'oracle': slice_rows(rows, 'oracle'),
        },
        'by_week': {w: slice_rows([r for r in rows if r['week'] == w]) for w in ('1', '2')},
        'by_role': {
            'receive': slice_rows([r for r in rows if r['role'] == 'receive']),
            'kick': slice_rows([r for r in rows if r['role'] == 'kick']),
        },
        'oracle_by_role': {
            'receive': slice_rows([r for r in rows if r['role'] == 'receive'], 'oracle'),
            'kick': slice_rows([r for r in rows if r['role'] == 'kick'], 'oracle'),
        },
        'by_spread': sorted(
            by_key(rows, spread_name),
            key=lambda c: (
                ['fav ≤ −21', 'fav −21 to −14', 'fav −14 to −7', 'fav −7 to −3',
                 'pick / small', 'dog +3 to +7', 'dog +7 to +14', 'dog +14 to +21',
                 'dog ≥ +21'].index(c['bin']) if c['bin'] in {
                    'fav ≤ −21', 'fav −21 to −14', 'fav −14 to −7', 'fav −7 to −3',
                    'pick / small', 'dog +3 to +7', 'dog +7 to +14', 'dog +14 to +21',
                    'dog ≥ +21'} else 99
            ),
        ),
        'reliability': {cls: reliability(rows, cls) for cls in CLASSES},
        'high_p': {
            'td_ge_40': simulated_edges(rows, 'td', min_p=0.40),
            'td_ge_50': simulated_edges(rows, 'td', min_p=0.50),
            'punt_ge_45': simulated_edges(rows, 'punt', min_p=0.45),
            'punt_ge_50': simulated_edges(rows, 'punt', min_p=0.50),
            'fg_ge_16': simulated_edges(rows, 'fg', min_p=0.16),
            'other_ge_22': simulated_edges(rows, 'other', min_p=0.22),
        },
        'heavy': {
            'fav_le_14_td': slice_rows([r for r in rows if r['spread'] <= -14]),
            'dog_ge_14': slice_rows([r for r in rows if r['spread'] >= 14]),
            'pick': slice_rows([r for r in rows if abs(r['spread']) < 7]),
        },
        'own25_vs_blend_ll': {
            'blend': slice_rows(rows, 'blend')['logloss'] if rows else None,
            'own25': slice_rows(rows, 'own25')['logloss'] if rows else None,
        },
    }

    # Per-class hit when that class is the model's top pick.
    top_pick = {}
    for cls in CLASSES:
        k = CLASS_INDEX[cls]
        picked = [r for r in rows if r['blend'] and r['blend'].index(max(r['blend'])) == k]
        if not picked:
            continue
        hit = sum(1 for r in picked if r['y'] == k) / len(picked)
        top_pick[cls] = {
            'n': len(picked),
            'hit': round(hit, 4),
            'pred': round(sum(r['blend'][k] for r in picked) / len(picked), 4),
        }
    payload['top_pick'] = top_pick

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2)
    print(f'wrote {OUT_JSON}', flush=True)
    print('BLEND', payload['overall']['blend'])
    print('OWN25', payload['overall']['own25'])
    print('ORACLE', payload['overall']['oracle'])
    print('ROLE', payload['by_role'])
    print('HEAVY', payload['heavy'])
    print('HIGH_P', payload['high_p'])
    print('TOP_PICK', payload['top_pick'])


if __name__ == '__main__':
    main()
