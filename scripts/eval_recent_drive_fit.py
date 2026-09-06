#!/usr/bin/env python3
"""Score the exported drive-start LightGBM on recent games + first-drive slices.

Writes example_data/ncaaf_drive_results/recent_drive_fit.json
"""
from __future__ import annotations

import csv
import json
import math
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from ncaaf_field_buckets import fp_bucket  # noqa: E402

DRIVE_CSV = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_drives.csv')
MODEL_JSON = os.path.join(ROOT, 'site', 'src', 'drives', 'driveResultModel.json')
OUT_JSON = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'recent_drive_fit.json')

CLASSES = ('punt', 'td', 'fg', 'other')
CLASS_INDEX = {c: i for i, c in enumerate(CLASSES)}
FP_CODES = {'deep': 0, 'kickoff': 1, 'midfield': 2, 'favorable': 3}
HALF_CODES = {'h1': 0, 'h2': 1, 'ot': 2}

# 2026 season so far: last weekend (Aug 27–30) through yesterday/today.
RECENT_DATES = {
    '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30',
    '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06',
}

SPREAD_BINS = (
    ('fav ≤ −21', -99, -21),
    ('fav −21 to −14', -21, -14),
    ('fav −14 to −7', -14, -7),
    ('fav −7 to −3', -7, -3),
    ('pick / small', -3, 3),
    ('dog +3 to +7', 3, 7),
    ('dog +7 to +14', 7, 14),
    ('dog +14 to +21', 14, 21),
    ('dog ≥ +21', 21, 99),
)


def to_float(v):
    if v in ('', None):
        return float('nan')
    try:
        x = float(v)
    except (TypeError, ValueError):
        return float('nan')
    return x if math.isfinite(x) else float('nan')


def map_label(bucket):
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


def walk(node, x):
    if node.get('f') is None:
        return node['v']
    v = x[node['f']]
    go_left = (not math.isfinite(v)) or v <= node['t']
    return walk(node['l'] if go_left else node['r'], x)


def load_scorer():
    with open(MODEL_JSON, encoding='utf-8') as fh:
        model = json.load(fh)
    pack = model['driveStart']['lgbm']
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


def exp_points(ou, offense_spread):
    if not (math.isfinite(ou) and math.isfinite(offense_spread)):
        return float('nan'), float('nan')
    return (ou - offense_spread) / 2.0, (ou + offense_spread) / 2.0


def features_actual(row):
    ytg = to_float(row.get('start_yard'))
    ou = to_float(row.get('cfbd_over_under'))
    if not math.isfinite(ou):
        ou = to_float(row.get('over_under'))
    spread = to_float(row.get('offense_spread'))
    if not math.isfinite(spread):
        home = to_float(row.get('cfbd_spread'))
        if not math.isfinite(home):
            home = to_float(row.get('spread'))
        if math.isfinite(home):
            spread = -home if row.get('offense_side') == 'away' else home
    exp_off, exp_def = exp_points(ou, spread)
    off_s = to_float(row.get('start_offense_score'))
    def_s = to_float(row.get('start_defense_score'))
    score_diff = off_s - def_s if math.isfinite(off_s) and math.isfinite(def_s) else float('nan')
    fp = fp_bucket(ytg)
    return {
        'ytg': ytg,
        'sec_left': to_float(row.get('start_seconds_left')),
        'period': to_float(row.get('start_period')),
        'score_diff': score_diff,
        'offense_spread': spread,
        'over_under': ou,
        'exp_off': exp_off,
        'exp_def': exp_def,
        'drive_n': to_float(row.get('drive_n')),
        'is_home': 1.0 if row.get('offense_side') == 'home' else 0.0,
        'so_far_td': to_float(row.get('so_far_td')) or 0.0,
        'so_far_fg': to_float(row.get('so_far_fg')) or 0.0,
        'so_far_punt': to_float(row.get('so_far_punt')) or 0.0,
        'so_far_other': to_float(row.get('so_far_other')) or 0.0,
        'fp_code': float(FP_CODES[fp]) if fp else float('nan'),
        'half_code': half_code(row.get('start_period')),
    }


def features_site_pregame(row):
    """What /drives prices before kickoff: own-25, Q1 15:00, zeros."""
    feat = features_actual(row)
    feat.update({
        'ytg': 75.0,
        'sec_left': 3600.0,
        'period': 1.0,
        'score_diff': 0.0,
        'drive_n': 1.0,
        'so_far_td': 0.0,
        'so_far_fg': 0.0,
        'so_far_punt': 0.0,
        'so_far_other': 0.0,
        'fp_code': 1.0,
        'half_code': 0.0,
    })
    return feat


def logloss(y, p):
    eps = 1e-15
    return float(-sum(math.log(min(max(pi[yi], eps), 1 - eps)) for yi, pi in zip(y, p)) / len(y))


def brier(y, p):
    tot = 0.0
    for yi, pi in zip(y, p):
        for k in range(4):
            tot += (pi[k] - (1.0 if yi == k else 0.0)) ** 2
    return tot / len(y)


def mean_p(p):
    n = len(p)
    return {CLASSES[k]: round(sum(row[k] for row in p) / n, 4) for k in range(4)}


def obs(y):
    n = len(y)
    return {CLASSES[k]: round(sum(1 for yi in y if yi == k) / n, 4) for k in range(4)}


def spread_bin(spread):
    if not math.isfinite(spread):
        return None
    for name, lo, hi in SPREAD_BINS:
        if lo <= spread < hi:
            return name
    if spread >= 21:
        return 'dog ≥ +21'
    return None


def summarize(rows, p_list, y_list):
    if not rows:
        return None
    out = {
        'n': len(rows),
        'logloss': round(logloss(y_list, p_list), 4),
        'brier': round(brier(y_list, p_list), 4),
        'mean_p': mean_p(p_list),
        'obs': obs(y_list),
        'td': {
            'pred': mean_p(p_list)['td'],
            'obs': obs(y_list)['td'],
            'gap': round(mean_p(p_list)['td'] - obs(y_list)['td'], 4),
        },
    }
    return out


def by_spread(rows, p_list, y_list):
    buckets = defaultdict(lambda: {'rows': [], 'p': [], 'y': []})
    for row, p, y in zip(rows, p_list, y_list):
        name = spread_bin(to_float(row['feat']['offense_spread']))
        if not name:
            continue
        buckets[name]['rows'].append(row)
        buckets[name]['p'].append(p)
        buckets[name]['y'].append(y)
    ordered = []
    for name, *_ in SPREAD_BINS:
        if name not in buckets:
            continue
        b = buckets[name]
        card = summarize(b['rows'], b['p'], b['y'])
        card['bin'] = name
        card['median_spread'] = round(
            sorted(to_float(r['feat']['offense_spread']) for r in b['rows'])[len(b['rows']) // 2],
            1,
        )
        ordered.append(card)
    return ordered


def reliability(y, p, cls='td', edges=None):
    k = CLASS_INDEX[cls]
    edges = edges or (0.0, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.80, 1.01)
    out = []
    for i in range(len(edges) - 1):
        lo, hi = edges[i], edges[i + 1]
        idx = [j for j, pi in enumerate(p) if lo <= pi[k] < hi]
        if not idx:
            continue
        pred = sum(p[j][k] for j in idx) / len(idx)
        hit = sum(1 for j in idx if y[j] == k) / len(idx)
        out.append({
            'lo': lo,
            'hi': hi,
            'n': len(idx),
            'pred': round(pred, 4),
            'obs': round(hit, 4),
            'gap': round(pred - hit, 4),
        })
    return out


def load_drives():
    with open(DRIVE_CSV, newline='', encoding='utf-8') as fh:
        return list(csv.DictReader(fh))


def keep_scored(row):
    y = map_label(row.get('result_bucket'))
    ytg = to_float(row.get('start_yard'))
    return y is not None and math.isfinite(ytg) and 1 <= ytg <= 99


def is_recent(row):
    return (row.get('date') or '')[:10] in RECENT_DATES and str(row.get('season')) == '2026'


def is_first(row):
    try:
        return int(float(row.get('drive_n') or 0)) == 1
    except (TypeError, ValueError):
        return False


def team_first_drives(rows):
    """Each offense's first possession in a game — what DK 1st-drive prices."""
    best = {}
    for row in rows:
        try:
            dn = int(float(row.get('drive_n') or 0))
        except (TypeError, ValueError):
            continue
        if dn < 1:
            continue
        key = (row.get('game_id'), row.get('offense_side') or row.get('offense'))
        prev = best.get(key)
        if prev is None or dn < prev[0]:
            best[key] = (dn, row)
    return [item[1] for item in best.values()]


def ytg_from_start_text(row):
    text = str(row.get('start_text') or '').strip()
    m = re.match(r'^([A-Z0-9]+)\s+(\d+)$', text)
    if not m:
        return None
    abbr, yl = m.group(1), int(m.group(2))
    if yl == 50:
        return 50
    off = str(row.get('offense_abbr') or '').upper()
    home = str(row.get('home_abbr') or '').upper()
    away = str(row.get('away_abbr') or '').upper()
    own = abbr == off or (
        (row.get('offense_side') == 'home' and abbr == home)
        or (row.get('offense_side') == 'away' and abbr == away)
    )
    if own:
        return 100 - yl
    if abbr in (home, away):
        return yl
    return None


def is_true_kickoff_start(row):
    ytg = ytg_from_start_text(row)
    return ytg is not None and 70 <= ytg <= 85


def pack_rows(raw, score, feat_fn):
    rows, probs, ys = [], [], []
    for row in raw:
        if not keep_scored(row):
            continue
        feat = feat_fn(row)
        if not math.isfinite(feat['offense_spread']) or not math.isfinite(feat['over_under']):
            continue
        p = score(feat)
        y = CLASS_INDEX[map_label(row['result_bucket'])]
        rec = {
            'game_id': row.get('game_id'),
            'date': (row.get('date') or '')[:10],
            'week': row.get('week'),
            'home': row.get('home'),
            'away': row.get('away'),
            'offense': row.get('offense'),
            'offense_side': row.get('offense_side'),
            'result': map_label(row['result_bucket']),
            'start_yard': to_float(row.get('start_yard')),
            'feat': feat,
            'p': {CLASSES[i]: round(p[i], 4) for i in range(4)},
        }
        rows.append(rec)
        probs.append(p)
        ys.append(y)
    return rows, probs, ys


def top_overpriced_td(rows, n=15):
    ranked = sorted(rows, key=lambda r: r['p']['td'] - (1.0 if r['result'] == 'td' else 0.0), reverse=True)
    out = []
    for r in ranked[:n]:
        out.append({
            'date': r['date'],
            'offense': r['offense'],
            'vs': r['home'] if r['offense_side'] == 'away' else r['away'],
            'spread': r['feat']['offense_spread'],
            'ou': r['feat']['over_under'],
            'exp_off': round(r['feat']['exp_off'], 1) if math.isfinite(r['feat']['exp_off']) else None,
            'ytg': r['start_yard'],
            'p_td': r['p']['td'],
            'result': r['result'],
        })
    return out


def main():
    print('loading model + drives…', flush=True)
    score = load_scorer()
    all_raw = load_drives()
    recent_raw = [r for r in all_raw if is_recent(r)]
    first_2025 = [r for r in all_raw if str(r.get('season')) == '2025' and is_first(r)]
    first_2026 = [r for r in recent_raw if is_first(r)]
    team_first_2025 = team_first_drives([r for r in all_raw if str(r.get('season')) == '2025'])
    team_first_2026 = team_first_drives(recent_raw)
    kick_2025 = [r for r in team_first_2025 if is_true_kickoff_start(r)]
    kick_2026 = [r for r in team_first_2026 if is_true_kickoff_start(r)]
    print(
        f'  recent 2026 drives {len(recent_raw)}  game-first {len(first_2026)}  '
        f'team-first {len(team_first_2026)}  kickoff-start {len(kick_2026)}',
        flush=True,
    )
    print(
        f'  2025 game-first {len(first_2025)}  team-first {len(team_first_2025)}  '
        f'kickoff-start {len(kick_2025)}',
        flush=True,
    )

    slices = {}
    for key, raw, feat_fn in (
        ('recent_all_actual', recent_raw, features_actual),
        ('recent_game_first_site', first_2026, features_site_pregame),
        ('recent_team_first_site', team_first_2026, features_site_pregame),
        ('recent_kickoff_site', kick_2026, features_site_pregame),
        ('y2025_team_first_site', team_first_2025, features_site_pregame),
        ('y2025_kickoff_site', kick_2025, features_site_pregame),
        ('y2025_first_actual', first_2025, features_actual),
        ('y2025_all_actual', [r for r in all_raw if str(r.get('season')) == '2025'], features_actual),
    ):
        rows, p, y = pack_rows(raw, score, feat_fn)
        print(f'  scored {key}: {len(rows)}', flush=True)
        slices[key] = {
            'summary': summarize(rows, p, y),
            'by_spread': by_spread(rows, p, y),
            'td_reliability': reliability(y, p, 'td') if rows else [],
            'examples': top_overpriced_td(rows) if 'first' in key else [],
        }

    payload = {
        'meta': {
            'recentDates': sorted(RECENT_DATES),
            'note': (
                'Drive-start LightGBM (train 2023–24). '
                'site = own-25 / Q1 15:00 the /drives pregame card uses. '
                'team-first = each offense first possession (DK 1st-drive). '
                'kickoff-start = start_text says own 15–30. '
                'No stored DK/FD first-drive quotes — comparison is model vs ESPN result.'
            ),
        },
        'slices': slices,
    }
    for key, raw, feat_fn in (
        ('recent_team_first_site', team_first_2026, features_site_pregame),
        ('recent_kickoff_site', kick_2026, features_site_pregame),
        ('y2025_team_first_site', team_first_2025, features_site_pregame),
        ('y2025_kickoff_site', kick_2025, features_site_pregame),
    ):
        rows, p, y = pack_rows(raw, score, feat_fn)
        hv_idx = [i for i, r in enumerate(rows) if to_float(r['feat']['offense_spread']) <= -14]
        if hv_idx:
            payload[f'{key}_heavy'] = summarize(
                [rows[i] for i in hv_idx],
                [p[i] for i in hv_idx],
                [y[i] for i in hv_idx],
            )

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2)
    print(f'wrote {OUT_JSON}', flush=True)

    site = slices['y2025_kickoff_site']
    print('\n2025 team-first kickoff starts, priced as the site (own 25):')
    print(' ', site['summary'])
    print('  by spread:')
    for b in site['by_spread']:
        print(
            f"    {b['bin']:18} n={b['n']:5}  "
            f"P(OTD) {b['td']['pred']:.3f}  obs {b['td']['obs']:.3f}  "
            f"gap {b['td']['gap']:+.3f}"
        )
    rec = slices['recent_team_first_site']['summary']
    print('\n2026 team-first, site prices:', rec)


if __name__ == '__main__':
    main()
