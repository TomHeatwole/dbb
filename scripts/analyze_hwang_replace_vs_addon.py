#!/usr/bin/env python3
"""Compare replace-mode HVORP vs add-on v3b Hwang (format=hwang only).

Add-on:  example_data/hwang_true_sim_200_v3b  (200 builds, 27th player)
Replace: example_data/hwang_true_sim_replace  (300 builds, swap similar-value C)
"""
import csv
import json
import math
import os
from collections import defaultdict

import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ADDON = os.path.join(ROOT, 'example_data', 'hwang_true_sim_200_v3b')
REPLACE = os.path.join(ROOT, 'example_data', 'hwang_true_sim_replace')
OUT = os.path.join(REPLACE, 'analysis')
os.makedirs(OUT, exist_ok=True)

POS3 = ['RB', 'WR', 'TE']
POS4 = ['QB', 'RB', 'WR', 'TE']
IDX3 = {'WR': 0, 'TE': 1}
IDX4 = {'RB': 0, 'WR': 1, 'TE': 2}
MATCHUPS = [('RB', 'WR'), ('RB', 'TE'), ('WR', 'TE')]
MATCHUPS4 = [('QB', 'RB'), ('QB', 'WR'), ('QB', 'TE'),
             ('RB', 'WR'), ('RB', 'TE'), ('WR', 'TE')]
BASES = ['ktc', 'comp']
VREF = 5000.0
BANDS = [(0, 1000), (1000, 2000), (2000, 3000), (3000, 4000),
         (4000, 5000), (5000, 6000), (6000, 7000), (7000, 10**9)]
FMT = 'hwang'


def load_overall(data_dir):
    rows = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0, 0]))
    with open(os.path.join(data_dir, 'matchups.csv')) as f:
        for r in csv.DictReader(f):
            if r['scope'] != 'overall' or r['format'] != FMT:
                continue
            a = rows[r['value_basis']][(r['pos_a'], r['pos_b'])]
            a[0] += float(r['total_hvorp_a'])
            a[1] += float(r['total_hvorp_b'])
            a[2] += float(r['weight_sum'])
            a[3] += int(float(r['pair_plugs']))
    return rows


def load_year(data_dir):
    rows = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0, 0]))
    with open(os.path.join(data_dir, 'matchups.csv')) as f:
        for r in csv.DictReader(f):
            if r['scope'] != 'year' or r['format'] != FMT:
                continue
            key = (r['value_basis'], r['year'])
            a = rows[key][(r['pos_a'], r['pos_b'])]
            a[0] += float(r['total_hvorp_a'])
            a[1] += float(r['total_hvorp_b'])
            a[2] += float(r['weight_sum'])
            a[3] += int(float(r['pair_plugs']))
    return rows


def load_pairs(data_dir):
    cands = defaultdict(dict)
    with open(os.path.join(data_dir, 'candidates.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != FMT:
                continue
            cands[r['value_basis']][(r['year'], r['player_id'])] = (
                r['position'], float(r['value']))
    hv = defaultdict(lambda: defaultdict(float))
    with open(os.path.join(data_dir, 'archetype_player_hvorp.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != FMT:
                continue
            avg_w = r['avg_hvorp_weighted']
            if avg_w in ('', 'null'):
                continue
            arch_w = int(r['build_count']) * float(r['avg_base_total']) / 2500.0
            hv[r['value_basis']][(r['year'], r['player_id'])] += float(avg_w) * arch_w
    out = defaultdict(list)
    with open(os.path.join(data_dir, 'pairs.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != FMT:
                continue
            pa, pb = r['pair_key'].split('_vs_')
            a = cands[r['value_basis']][(r['year'], r['player_id_a'])]
            b = cands[r['value_basis']][(r['year'], r['player_id_b'])]
            ha = hv[r['value_basis']][(r['year'], r['player_id_a'])]
            hb = hv[r['value_basis']][(r['year'], r['player_id_b'])]
            out[r['value_basis']].append((pa, pb, (a[1] + b[1]) / 2, ha, hb))
    return out


def net3(matchup_totals):
    A = np.zeros((2, 2))
    b = np.zeros(2)
    for (pa, pb), (ta, tb, w, n) in matchup_totals.items():
        if pa not in POS3 or pb not in POS3:
            continue
        if ta <= 0 or tb <= 0 or w <= 0:
            continue
        r = math.log(tb / ta)
        terms = []
        if pb in IDX3:
            terms.append((IDX3[pb], 1))
        if pa in IDX3:
            terms.append((IDX3[pa], -1))
        for i, si in terms:
            b[i] += w * si * r
            for j, sj in terms:
                A[i, j] += w * si * sj
    x = np.linalg.solve(A, b)
    logs = {'RB': 0.0, 'WR': x[0], 'TE': x[1]}
    mean = sum(logs.values()) / 3
    return {p: math.exp(v - mean) for p, v in logs.items()}


def net4(matchup_totals):
    A = np.zeros((3, 3))
    b = np.zeros(3)
    for (pa, pb), (ta, tb, w, n) in matchup_totals.items():
        if pa not in POS4 or pb not in POS4:
            continue
        if ta <= 0 or tb <= 0 or w <= 0:
            continue
        r = math.log(tb / ta)
        terms = []
        if pb in IDX4:
            terms.append((IDX4[pb], 1))
        if pa in IDX4:
            terms.append((IDX4[pa], -1))
        for i, si in terms:
            b[i] += w * si * r
            for j, sj in terms:
                A[i, j] += w * si * sj
    x = np.linalg.solve(A, b)
    logs = {'QB': 0.0, 'RB': x[0], 'WR': x[1], 'TE': x[2]}
    mean = sum(logs.values()) / 4
    return {p: math.exp(v - mean) for p, v in logs.items()}


def direct_ratios(rows, pairs=None):
    out = {}
    src = pairs or MATCHUPS
    for pa, pb in src:
        ta, tb, w, n = rows[(pa, pb)]
        out[f'{pa}/{pb}'] = {
            'ratio': ta / tb if tb else None,
            'plugs': n,
            'weight': w,
            'hvorp_a': ta,
            'hvorp_b': tb,
        }
    return out


def fit_skill_curves(pairs):
    rows, ys, ws = [], [], []
    for pa, pb, mid, ha, hb in pairs:
        if pa not in POS3 or pb not in POS3:
            continue
        if ha <= 0 or hb <= 0 or mid <= 200:
            continue
        xv = math.log(mid / VREF)
        row = np.zeros(4)
        for pos, sign in ((pb, 1), (pa, -1)):
            if pos == 'WR':
                row[0] += sign
                row[1] += sign * xv
            elif pos == 'TE':
                row[2] += sign
                row[3] += sign * xv
        rows.append(row)
        ys.append(math.log(hb / ha))
        ws.append(mid / VREF)
    X, y, sw = np.array(rows), np.array(ys), np.sqrt(np.array(ws))
    beta, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
    rb_gauge = {'RB': (0.0, 0.0), 'WR': (beta[0], beta[1]), 'TE': (beta[2], beta[3])}
    a_mean = sum(p[0] for p in rb_gauge.values()) / 3
    b_mean = sum(p[1] for p in rb_gauge.values()) / 3
    return {pos: (math.exp(a - a_mean), b - b_mean) for pos, (a, b) in rb_gauge.items()}


def fit_4pos_curves(pairs):
    rows, ys, ws = [], [], []
    for pa, pb, mid, ha, hb in pairs:
        if ha <= 0 or hb <= 0 or mid <= 200:
            continue
        xv = math.log(mid / VREF)
        row = np.zeros(6)
        if pb in IDX4:
            row[2 * IDX4[pb]] += 1
            row[2 * IDX4[pb] + 1] += xv
        if pa in IDX4:
            row[2 * IDX4[pa]] -= 1
            row[2 * IDX4[pa] + 1] -= xv
        rows.append(row)
        ys.append(math.log(hb / ha))
        ws.append(mid / VREF)
    X, y, sw = np.array(rows), np.array(ys), np.sqrt(np.array(ws))
    beta, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
    qb_gauge = {'QB': (0.0, 0.0)}
    for pos in POS3:
        qb_gauge[pos] = (beta[2 * IDX4[pos]], beta[2 * IDX4[pos] + 1])
    a_mean = sum(p[0] for p in qb_gauge.values()) / 4
    b_mean = sum(p[1] for p in qb_gauge.values()) / 4
    return {pos: (math.exp(a - a_mean), b - b_mean) for pos, (a, b) in qb_gauge.items()}


def band_network(pairs, lo, hi, which='4'):
    agg = defaultdict(lambda: [0.0, 0.0, 0.0, 0])
    for pa, pb, mid, ha, hb in pairs:
        if not (lo <= mid < hi):
            continue
        if ha <= 0 or hb <= 0:
            continue
        wv = mid / VREF
        a = agg[(pa, pb)]
        a[0] += wv * ha
        a[1] += wv * hb
        a[2] += wv
        a[3] += 1
    n = sum(v[3] for v in agg.values())
    if n < 20:
        return None, n
    m = net3(agg) if which == '3' else net4(agg)
    return m, n


def pair_value_hist(pairs):
    counts = defaultdict(int)
    for pa, pb, mid, ha, hb in pairs:
        for lo, hi in BANDS:
            if lo <= mid < hi:
                counts[(lo, hi)] += 1
                break
    return counts


def fmt_ck(c, k):
    return f'{c:.3f}^({k:+.3f})'


def main():
    addon_over = load_overall(ADDON)
    repl_over = load_overall(REPLACE)
    addon_year = load_year(ADDON)
    repl_year = load_year(REPLACE)
    addon_pairs = load_pairs(ADDON)
    repl_pairs = load_pairs(REPLACE)

    report = {'bases': {}, 'sample': {}, 'years': {}}

    print('REPLACE vs ADD-ON  (Hwang format only)')
    print('Add-on: 200 builds × 19 archetypes, 27th player')
    print('Replace: 300 builds × 19 archetypes, swap similar-value roster player')
    print()

    for basis in BASES:
        print(f'========== {basis} ==========')
        ao = addon_over[basis]
        ro = repl_over[basis]
        ar = direct_ratios(ao, MATCHUPS4)
        rr = direct_ratios(ro, MATCHUPS4)
        an3, rn3 = net3(ao), net3(ro)
        an4, rn4 = net4(ao), net4(ro)
        ac3, rc3 = fit_skill_curves(addon_pairs[basis]), fit_skill_curves(repl_pairs[basis])
        ac4, rc4 = fit_4pos_curves(addon_pairs[basis]), fit_4pos_curves(repl_pairs[basis])

        print('Direct HVORP ratios (equal-priced pairs):')
        print(f"  {'pair':<8}{'add-on':>10}{'replace':>10}{'repl/add':>10}{'add plugs':>14}{'repl plugs':>14}")
        for name in ('QB/RB', 'QB/WR', 'QB/TE', 'RB/WR', 'RB/TE', 'WR/TE'):
            a, b = ar[name], rr[name]
            print(f"  {name:<8}{a['ratio']:>10.3f}{b['ratio']:>10.3f}"
                  f"{b['ratio']/a['ratio']:>10.3f}{a['plugs']:>14,}{b['plugs']:>14,}")

        print('  3-pos network (geo mean = 1):')
        print(f"  {'pos':<8}{'add-on':>10}{'replace':>10}{'repl/add':>10}")
        for p in POS3:
            print(f"  {p:<8}{an3[p]:>10.3f}{rn3[p]:>10.3f}{rn3[p]/an3[p]:>10.3f}")

        print('  4-pos network (geo mean = 1):')
        print(f"  {'pos':<8}{'add-on':>10}{'replace':>10}{'repl/add':>10}")
        for p in POS4:
            print(f"  {p:<8}{an4[p]:>10.3f}{rn4[p]:>10.3f}{rn4[p]/an4[p]:>10.3f}")

        print('  skill-only curves  m(v)=c·(v/5000)^k')
        print(f"  {'pos':<4}{'add-on':>22}{'replace':>22}{'c ratio':>10}{'Δk':>8}")
        for p in POS3:
            ac, ak = ac3[p]
            rc, rk = rc3[p]
            print(f"  {p:<4}{fmt_ck(ac, ak):>22}{fmt_ck(rc, rk):>22}"
                  f"{rc/ac:>10.3f}{rk-ak:>+8.3f}")
            print('       @1k/3k/5k/8k add:  ' + '  '.join(
                f"{ac*(v/VREF)**ak:.2f}" for v in (1000, 3000, 5000, 8000)))
            print('       @1k/3k/5k/8k repl: ' + '  '.join(
                f"{rc*(v/VREF)**rk:.2f}" for v in (1000, 3000, 5000, 8000)))

        print('  4-pos curves  m(v)=c·(v/5000)^k')
        for p in POS4:
            ac, ak = ac4[p]
            rc, rk = rc4[p]
            print(f"  {p:<4}{fmt_ck(ac, ak):>22}{fmt_ck(rc, rk):>22}"
                  f"{rc/ac:>10.3f}{rk-ak:>+8.3f}")

        print('  4-pos network by value band:')
        print(f"  {'band':<12}{'n_add':>7}{'n_rep':>7} |" +
              ''.join(f" {p+' add':>9}{p+' rep':>9}" for p in POS4))
        band_rows = []
        for lo, hi in BANDS:
            ma, na = band_network(addon_pairs[basis], lo, hi, '4')
            mr, nr = band_network(repl_pairs[basis], lo, hi, '4')
            label = f'{lo}-{hi if hi < 10**8 else "+"}'
            if ma is None or mr is None:
                print(f"  {label:<12}{na:>7}{nr:>7}  (skip)")
                continue
            cells = ''.join(f"{ma[p]:>9.3f}{mr[p]:>9.3f}" for p in POS4)
            print(f"  {label:<12}{na:>7}{nr:>7} |{cells}")
            band_rows.append({
                'band': label, 'n_addon': na, 'n_replace': nr,
                'addon': {p: round(ma[p], 4) for p in POS4},
                'replace': {p: round(mr[p], 4) for p in POS4},
            })

        report['bases'][basis] = {
            'direct': {k: {
                'addon': round(ar[k]['ratio'], 4),
                'replace': round(rr[k]['ratio'], 4),
                'ratio': round(rr[k]['ratio'] / ar[k]['ratio'], 4),
                'plugs_addon': ar[k]['plugs'],
                'plugs_replace': rr[k]['plugs'],
            } for k in ('QB/RB', 'QB/WR', 'QB/TE', 'RB/WR', 'RB/TE', 'WR/TE')},
            'net3': {p: {
                'addon': round(an3[p], 4),
                'replace': round(rn3[p], 4),
                'ratio': round(rn3[p] / an3[p], 4),
            } for p in POS3},
            'net4': {p: {
                'addon': round(an4[p], 4),
                'replace': round(rn4[p], 4),
                'ratio': round(rn4[p] / an4[p], 4),
            } for p in POS4},
            'skill_curves': {
                p: {
                    'addon': {'c': round(ac3[p][0], 4), 'k': round(ac3[p][1], 4)},
                    'replace': {'c': round(rc3[p][0], 4), 'k': round(rc3[p][1], 4)},
                    'at': {
                        str(v): {
                            'addon': round(ac3[p][0] * (v / VREF) ** ac3[p][1], 3),
                            'replace': round(rc3[p][0] * (v / VREF) ** rc3[p][1], 3),
                        } for v in (1000, 3000, 5000, 8000)
                    },
                } for p in POS3
            },
            'pos4_curves': {
                p: {
                    'addon': {'c': round(ac4[p][0], 4), 'k': round(ac4[p][1], 4)},
                    'replace': {'c': round(rc4[p][0], 4), 'k': round(rc4[p][1], 4)},
                } for p in POS4
            },
            'bands': band_rows,
        }
        print()

    # sample size
    print('========== sample size ==========')
    for basis in BASES:
        a_plugs = sum(addon_over[basis][k][3] for k in MATCHUPS4)
        r_plugs = sum(repl_over[basis][k][3] for k in MATCHUPS4)
        a_pairs = len(addon_pairs[basis])
        r_pairs = len(repl_pairs[basis])
        print(f'  {basis}: pair-plugs add-on {a_plugs:,}  replace {r_plugs:,}  '
              f'({r_plugs/a_plugs:.2f}x)   unique pairs {a_pairs} vs {r_pairs}')
        report['sample'][basis] = {
            'plugs_addon': a_plugs,
            'plugs_replace': r_plugs,
            'plugs_ratio': round(r_plugs / a_plugs, 3),
            'unique_pairs_addon': a_pairs,
            'unique_pairs_replace': r_pairs,
        }

    # replace skip stats from years.csv
    skip = defaultdict(lambda: [0, 0, 0, 0])
    with open(os.path.join(REPLACE, 'years.csv')) as f:
        for r in csv.DictReader(f):
            s = skip[r['value_basis']]
            s[0] += int(r['replace_attempts'])
            s[1] += int(r['replace_hits'])
            s[2] += int(r['replace_skip_both'])
            s[3] += int(r['replace_skip_no_target'])
    print()
    print('Replace skip rates:')
    for basis in BASES:
        att, hit, both, none = skip[basis]
        print(f'  {basis}: hit {hit/att:.1%}  both-on-roster {both/att:.1%}  '
              f'no-target {none/att:.1%}  ({hit:,}/{att:,})')
        report['sample'][basis]['hit_rate'] = round(hit / att, 4)
        report['sample'][basis]['skip_both'] = round(both / att, 4)
        report['sample'][basis]['skip_no_target'] = round(none / att, 4)

    print()
    print('========== by year (4-pos RB/WR) ==========')
    years = sorted({y for (b, y) in addon_year if b == 'ktc'})
    for basis in BASES:
        print(f'--- {basis} ---')
        print(f"  {'year':<8}{'RB/WR add':>12}{'RB/WR rep':>12}{'factor':>8}"
              f"{'RB add':>8}{'RB rep':>8}{'WR add':>8}{'WR rep':>8}")
        yrows = []
        for y in years:
            ao = addon_year[(basis, y)]
            ro = repl_year[(basis, y)]
            ar = ao[('RB', 'WR')][0] / ao[('RB', 'WR')][1]
            rr = ro[('RB', 'WR')][0] / ro[('RB', 'WR')][1]
            an4, rn4 = net4(ao), net4(ro)
            print(f"  {y:<8}{ar:>12.3f}{rr:>12.3f}{rr/ar:>8.3f}"
                  f"{an4['RB']:>8.3f}{rn4['RB']:>8.3f}"
                  f"{an4['WR']:>8.3f}{rn4['WR']:>8.3f}")
            yrows.append({
                'year': y,
                'rb_wr_addon': round(ar, 4),
                'rb_wr_replace': round(rr, 4),
                'net4_addon': {p: round(an4[p], 4) for p in POS4},
                'net4_replace': {p: round(rn4[p], 4) for p in POS4},
            })
        report['years'][basis] = yrows

    path = os.path.join(OUT, 'replace_vs_addon.json')
    with open(path, 'w') as f:
        json.dump(report, f, indent=2)
    print(f'\nWrote {path}')


if __name__ == '__main__':
    main()
