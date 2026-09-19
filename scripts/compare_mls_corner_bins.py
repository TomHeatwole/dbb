#!/usr/bin/env python3
"""Compare MLS ESPN corner 5-minute bins against the PL live-model curve."""
import csv
import json
import math
import os
from collections import Counter, defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
TIMING = os.path.join(ROOT, 'example_data', 'soccer_event_timing')

BINS = [
    ('1-5', 1, 5, 'regular'),
    ('6-10', 6, 10, 'regular'),
    ('11-15', 11, 15, 'regular'),
    ('16-20', 16, 20, 'regular'),
    ('21-25', 21, 25, 'regular'),
    ('26-30', 26, 30, 'regular'),
    ('31-35', 31, 35, 'regular'),
    ('36-40', 36, 40, 'regular'),
    ('41-45', 41, 45, 'regular'),
    ('45+', 45, 45, 'ht+'),
    ('46-50', 46, 50, 'regular'),
    ('51-55', 51, 55, 'regular'),
    ('56-60', 56, 60, 'regular'),
    ('61-65', 61, 65, 'regular'),
    ('66-70', 66, 70, 'regular'),
    ('71-75', 71, 75, 'regular'),
    ('76-80', 76, 80, 'regular'),
    ('81-85', 81, 85, 'regular'),
    ('86-90', 86, 90, 'regular'),
    ('90+', 90, 90, 'ft+'),
]

# ESPN PL 2023-26 shares from espn_pl_corner_histogram.md
PL_SHARE = {
    '1-5': 4.47, '6-10': 5.11, '11-15': 4.87, '16-20': 4.72, '21-25': 4.90,
    '26-30': 4.49, '31-35': 4.58, '36-40': 4.96, '41-45': 5.20, '45+': 3.57,
    '46-50': 4.83, '51-55': 5.78, '56-60': 5.34, '61-65': 5.44, '66-70': 5.28,
    '71-75': 4.86, '76-80': 4.51, '81-85': 4.82, '86-90': 4.86, '90+': 7.42,
}
PL_N = {
    '1-5': 527, '6-10': 602, '11-15': 574, '16-20': 556, '21-25': 578,
    '26-30': 529, '31-35': 540, '36-40': 584, '41-45': 613, '45+': 421,
    '46-50': 569, '51-55': 681, '56-60': 629, '61-65': 641, '66-70': 622,
    '71-75': 573, '76-80': 532, '81-85': 568, '86-90': 573, '90+': 874,
}
PL_MATCHES = 1139
PL_CORNERS = 11786
PL_PER_MATCH = PL_CORNERS / PL_MATCHES
PL_HT_STOP = 3.3
PL_FT_STOP = 4.8

FIFTEEN = [
    ('1-15', ['1-5', '6-10', '11-15']),
    ('16-30', ['16-20', '21-25', '26-30']),
    ('31-45', ['31-35', '36-40', '41-45']),
    ('45+', ['45+']),
    ('46-60', ['46-50', '51-55', '56-60']),
    ('61-75', ['61-65', '66-70', '71-75']),
    ('76-90', ['76-80', '81-85', '86-90']),
    ('90+', ['90+']),
]


def bin_of(elapsed, plus):
    try:
        e = int(elapsed)
    except (TypeError, ValueError):
        return None
    try:
        p = int(plus) if plus not in (None, '') else 0
    except (TypeError, ValueError):
        p = 0
    if e == 45 and p > 0:
        return '45+'
    if e >= 90 and p > 0:
        return '90+'
    if e >= 90:
        return '86-90'
    if e <= 0:
        return '1-5'
    for bid, lo, hi, kind in BINS:
        if kind == 'regular' and lo <= e <= hi:
            return bid
    return None


def pearson(xs, ys):
    n = len(xs)
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0 or dy == 0:
        return None
    return num / (dx * dy)


def chi2(obs, exp_shares, total):
    stat = 0.0
    for o, p in zip(obs, exp_shares):
        e = total * p / 100.0
        if e <= 0:
            continue
        stat += (o - e) ** 2 / e
    df = len(obs) - 1
    return stat, df


def cv(values):
    m = sum(values) / len(values)
    if m == 0:
        return None
    var = sum((v - m) ** 2 for v in values) / len(values)
    return math.sqrt(var) / m


def load_games(path):
    games = {}
    with open(path, newline='', encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            games[r['game_id']] = r
    return games


def load_corners(path):
    rows = []
    with open(path, newline='', encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            rows.append(r)
    return rows


def counts_for(rows):
    c = Counter()
    unknown = 0
    for r in rows:
        bid = bin_of(r.get('elapsed'), r.get('elapsed_plus'))
        if bid is None:
            unknown += 1
            continue
        c[bid] += 1
    return c, unknown


def share_vec(counts):
    total = sum(counts[b[0]] for b in BINS)
    shares = []
    for bid, *_ in BINS:
        shares.append(100.0 * counts[bid] / total if total else 0.0)
    return total, shares


def typical_stoppage(rows, elapsed):
    pluses = []
    by_game = defaultdict(int)
    for r in rows:
        try:
            e = int(r.get('elapsed'))
            p = int(r.get('elapsed_plus') or 0)
        except (TypeError, ValueError):
            continue
        if e == elapsed and p > 0:
            gid = r['game_id']
            by_game[gid] = max(by_game[gid], p)
    if by_game:
        pluses = list(by_game.values())
        return sum(pluses) / len(pluses), len(pluses)
    return None, 0


def summarize(label, rows, n_matches):
    counts, unknown = counts_for(rows)
    total, shares = share_vec(counts)
    ids = [b[0] for b in BINS]
    pl_shares = [PL_SHARE[i] for i in ids]
    r = pearson(shares, pl_shares)
    mae = sum(abs(a - b) for a, b in zip(shares, pl_shares)) / len(shares)
    max_abs = max(abs(a - b) for a, b in zip(shares, pl_shares))
    max_i = max(range(len(shares)), key=lambda i: abs(shares[i] - pl_shares[i]))
    chi, df = chi2([counts[i] for i in ids], pl_shares, total)
    reg_ids = [b[0] for b in BINS if b[3] == 'regular']
    reg_shares = [shares[ids.index(i)] for i in reg_ids]
    reg_cv = cv(reg_shares)
    ht, n_ht = typical_stoppage(rows, 45)
    ft, n_ft = typical_stoppage(rows, 90)
    per_match = total / n_matches if n_matches else None
    fifteen = []
    for name, members in FIFTEEN:
        s = sum(shares[ids.index(m)] for m in members)
        pl = sum(PL_SHARE[m] for m in members)
        fifteen.append({'bucket': name, 'mls': s, 'pl': pl, 'diff_pp': s - pl})
    hot_block = sum(shares[ids.index(i)] for i in ('51-55', '56-60', '61-65', '66-70'))
    first_half = sum(shares[ids.index(i)] for i, *_, k in BINS if k == 'regular' and i.startswith(('1-', '6-', '11-', '16-', '21-', '26-', '31-', '36-', '41-')))
    second_half = sum(shares[ids.index(i)] for i in ('46-50', '51-55', '56-60', '61-65', '66-70', '71-75', '76-80', '81-85', '86-90'))
    bins = []
    for i, (bid, *_rest) in enumerate(BINS):
        n = counts[bid]
        bins.append({
            'id': bid,
            'n': n,
            'share': shares[i],
            'pl_share': pl_shares[i],
            'diff_pp': shares[i] - pl_shares[i],
            'rel': shares[i] / 5.0,
            'per_match': n / n_matches if n_matches else None,
        })
    return {
        'label': label,
        'matches': n_matches,
        'corners': total,
        'unknown': unknown,
        'per_match': per_match,
        'pearson_r': r,
        'mae_pp': mae,
        'max_abs_pp': max_abs,
        'max_abs_bin': ids[max_i],
        'chi2': chi,
        'chi2_df': df,
        'regular_cv': reg_cv,
        'ht_stoppage_min': ht,
        'ht_stoppage_games': n_ht,
        'ft_stoppage_min': ft,
        'ft_stoppage_games': n_ft,
        'hot_block_51_70': hot_block,
        'first_half_regular': first_half,
        'second_half_regular': second_half,
        'bins': bins,
        'fifteen': fifteen,
    }


def main():
    games = load_games(os.path.join(TIMING, 'espn_mls_games.csv'))
    corners = load_corners(os.path.join(TIMING, 'espn_mls_corners.csv'))

    # Keep games with commentary (same rule as PL: drop no-commentary)
    usable_ids = {
        gid for gid, g in games.items()
        if int(g.get('commentary_n') or 0) > 0
    }
    corners = [r for r in corners if r['game_id'] in usable_ids]
    n_matches = len(usable_ids)
    n_no_comm = sum(1 for g in games.values() if int(g.get('commentary_n') or 0) == 0)
    n_mismatch = sum(1 for g in games.values() if g.get('ok') != '1' and int(g.get('commentary_n') or 0) > 0)

    by_season = defaultdict(list)
    games_by_season = defaultdict(set)
    for r in corners:
        yr = str(r.get('season') or '')
        by_season[yr].append(r)
        games_by_season[yr].add(r['game_id'])
    # also count usable games with zero corners
    for gid, g in games.items():
        if gid in usable_ids:
            games_by_season[str(g.get('season') or '')].add(gid)

    overall = summarize('MLS 2025-26', corners, n_matches)
    seasons = []
    for yr in sorted(games_by_season):
        ids = games_by_season[yr]
        rows = [r for r in corners if r['game_id'] in ids]
        seasons.append(summarize(f'MLS {yr}', rows, len(ids)))

    season_r = None
    if len(seasons) >= 2:
        a = [b['share'] for b in seasons[0]['bins']]
        b = [x['share'] for x in seasons[1]['bins']]
        season_r = pearson(a, b)

    # verdict features
    s = {b['id']: b for b in overall['bins']}
    features = {
        'regular_almost_flat': overall['regular_cv'] is not None and overall['regular_cv'] < 0.12,
        'kickoff_quiet': s['1-5']['rel'] < 1.0,
        'restart_average': 0.90 <= s['46-50']['rel'] <= 1.10,
        'peak_51_55': s['51-55']['share'] == max(x['share'] for x in overall['bins'] if x['id'] not in ('45+', '90+')),
        'hot_block_51_70': overall['hot_block_51_70'] >= 20.0,
        'dip_76_80': s['76-80']['rel'] < 1.0,
        'ft_stoppage_pileup': s['90+']['share'] >= 6.5,
        'shape_vs_pl': (overall['pearson_r'] or 0) >= 0.60,
        'mae_inside_pl_season_band': overall['mae_pp'] <= 0.55,
    }
    hold = all(features.values())

    out = {
        'games_scraped': len(games),
        'usable_matches': n_matches,
        'no_commentary': n_no_comm,
        'boxscore_mismatches': n_mismatch,
        'pl_matches': PL_MATCHES,
        'pl_corners': PL_CORNERS,
        'pl_per_match': PL_PER_MATCH,
        'pl_regular_cv': 0.07,
        'pl_ht_stoppage_min': PL_HT_STOP,
        'pl_ft_stoppage_min': PL_FT_STOP,
        'pl_hot_block_51_70': 21.8,
        'pl_season_r_band': [0.62, 0.69],
        'pl_season_mae_pp': 0.5,
        'season_to_season_r': season_r,
        'features': features,
        'holds': hold,
        'overall': overall,
        'seasons': seasons,
    }
    out_path = os.path.join(TIMING, 'espn_mls_corner_bins.json')
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=2)
    print(json.dumps({
        'usable_matches': n_matches,
        'corners': overall['corners'],
        'per_match': round(overall['per_match'] or 0, 3),
        'pearson_r': None if overall['pearson_r'] is None else round(overall['pearson_r'], 3),
        'mae_pp': round(overall['mae_pp'], 3),
        'holds': hold,
        'features': features,
        'out': out_path,
    }, indent=2))
    print()
    print(f"{'bin':6s} {'n':>6s} {'MLS%':>7s} {'PL%':>7s} {'dpp':>7s} {'rel':>5s}")
    for b in overall['bins']:
        print(f"{b['id']:6s} {b['n']:6d} {b['share']:7.2f} {b['pl_share']:7.2f} "
              f"{b['diff_pp']:+7.2f} {b['rel']:5.2f}")


if __name__ == '__main__':
    main()
