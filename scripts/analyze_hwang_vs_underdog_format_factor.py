#!/usr/bin/env python3
"""Format factor = (Hwang builds + Hwang scoring) ÷ (Underdog builds + Underdog scoring).

Numerator:  example_data/hwang_true_sim_200_v3b  format=hwang
Denominator: example_data/hwang_true_sim_bbm_50   format=regular
QB is excluded from the ratio. QB coefficient stays the v3b Hwang/comp curve.

Usage: python scripts/analyze_hwang_vs_underdog_format_factor.py
"""
import csv
import math
import os
import sys
from collections import defaultdict

import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
HWANG_DIR = os.path.join(ROOT, 'example_data', 'hwang_true_sim_200_v3b')
UD_DIR = os.path.join(ROOT, 'example_data', 'hwang_true_sim_bbm_50')

SKILL = ['RB', 'WR', 'TE']
MATCHUPS = [('RB', 'WR'), ('RB', 'TE'), ('WR', 'TE')]
IDX = {'WR': 0, 'TE': 1}
VREF = 5000.0
BASES = ['ktc', 'comp']


def load_overall_skill(data_dir, fmt):
    rows = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0, 0]))
    with open(os.path.join(data_dir, 'matchups.csv')) as f:
        for r in csv.DictReader(f):
            if r['scope'] != 'overall' or r['format'] != fmt:
                continue
            pa, pb = r['pos_a'], r['pos_b']
            if pa not in SKILL or pb not in SKILL:
                continue
            a = rows[r['value_basis']][(pa, pb)]
            a[0] += float(r['total_hvorp_a'])
            a[1] += float(r['total_hvorp_b'])
            a[2] += float(r['weight_sum'])
            a[3] += int(float(r['pair_plugs']))
    return rows


def load_year_skill(data_dir, fmt):
    rows = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0, 0]))
    with open(os.path.join(data_dir, 'matchups.csv')) as f:
        for r in csv.DictReader(f):
            if r['scope'] != 'year' or r['format'] != fmt:
                continue
            pa, pb = r['pos_a'], r['pos_b']
            if pa not in SKILL or pb not in SKILL:
                continue
            a = rows[(r['value_basis'], r['year'])][(pa, pb)]
            a[0] += float(r['total_hvorp_a'])
            a[1] += float(r['total_hvorp_b'])
            a[2] += float(r['weight_sum'])
            a[3] += int(float(r['pair_plugs']))
    return rows


def load_skill_pairs(data_dir, fmt):
    cands = defaultdict(dict)
    with open(os.path.join(data_dir, 'candidates.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != fmt:
                continue
            cands[r['value_basis']][(r['year'], r['player_id'])] = (
                r['position'], float(r['value']))
    hv = defaultdict(lambda: defaultdict(float))
    with open(os.path.join(data_dir, 'archetype_player_hvorp.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != fmt:
                continue
            avg_w = r['avg_hvorp_weighted']
            if avg_w in ('', 'null'):
                continue
            arch_w = int(r['build_count']) * float(r['avg_base_total']) / 2500.0
            hv[r['value_basis']][(r['year'], r['player_id'])] += float(avg_w) * arch_w
    out = defaultdict(list)
    with open(os.path.join(data_dir, 'pairs.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != fmt:
                continue
            pa, pb = r['pair_key'].split('_vs_')
            if pa not in SKILL or pb not in SKILL:
                continue
            a = cands[r['value_basis']][(r['year'], r['player_id_a'])]
            b = cands[r['value_basis']][(r['year'], r['player_id_b'])]
            ha = hv[r['value_basis']][(r['year'], r['player_id_a'])]
            hb = hv[r['value_basis']][(r['year'], r['player_id_b'])]
            out[r['value_basis']].append((pa, pb, (a[1] + b[1]) / 2, ha, hb))
    return out


def skill_network(matchup_totals):
    A = np.zeros((2, 2))
    b = np.zeros(2)
    for (pa, pb), (ta, tb, w, n) in matchup_totals.items():
        if ta <= 0 or tb <= 0 or w <= 0:
            continue
        r = math.log(tb / ta)
        terms = []
        if pb in IDX:
            terms.append((IDX[pb], 1))
        if pa in IDX:
            terms.append((IDX[pa], -1))
        for i, si in terms:
            b[i] += w * si * r
            for j, sj in terms:
                A[i, j] += w * si * sj
    x = np.linalg.solve(A, b)
    logs = {'RB': 0.0, 'WR': x[0], 'TE': x[1]}
    mean = sum(logs.values()) / 3
    return {p: math.exp(v - mean) for p, v in logs.items()}


def fit_skill_curves(pairs):
    rows, ys, ws = [], [], []
    for pa, pb, mid, ha, hb in pairs:
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


def direct_ratios(rows):
    out = {}
    for pa, pb in MATCHUPS:
        ta, tb, w, n = rows[(pa, pb)]
        out[f'{pa}/{pb}'] = ta / tb
    return out


def main():
    h_over = load_overall_skill(HWANG_DIR, 'hwang')
    u_over = load_overall_skill(UD_DIR, 'regular')
    h_year = load_year_skill(HWANG_DIR, 'hwang')
    u_year = load_year_skill(UD_DIR, 'regular')
    h_pairs = load_skill_pairs(HWANG_DIR, 'hwang')
    u_pairs = load_skill_pairs(UD_DIR, 'regular')

    print('FORMAT FACTOR = Hwang clubs+Hwang scoring  ÷  Underdog clubs+Underdog scoring')
    print('QB excluded. Direct ratio = HVORP(first)/HVORP(second) among equal-priced pairs.')
    print()

    for basis in BASES:
        hr = direct_ratios(h_over[basis])
        ur = direct_ratios(u_over[basis])
        hn = skill_network(h_over[basis])
        un = skill_network(u_over[basis])
        print(f'=== {basis} ===')
        print(f"{'':12}{'Hwang':>10}{'Underdog':>10}{'factor':>10}")
        for name in ('RB/WR', 'RB/TE', 'WR/TE'):
            print(f"  {name:<10}{hr[name]:>10.3f}{ur[name]:>10.3f}{hr[name]/ur[name]:>10.3f}")
        print('  3-pos network (geo mean = 1):')
        print(f"{'':12}{'Hwang':>10}{'Underdog':>10}{'factor':>10}")
        for p in SKILL:
            print(f"  {p:<10}{hn[p]:>10.3f}{un[p]:>10.3f}{hn[p]/un[p]:>10.3f}")
        print()

        hp = fit_skill_curves(h_pairs[basis])
        up = fit_skill_curves(u_pairs[basis])
        print('  skill-only curves  m(v)=c·(v/5000)^k   and format-factor curve')
        print(f"  {'pos':<4}{'Hwang c^k':>22}{'UD c^k':>22}{'factor c^k':>24}")
        for p in SKILL:
            hc, hk = hp[p]
            uc, uk = up[p]
            fc, fk = hc / uc, hk - uk
            print(f"  {p:<4}{hc:8.3f}^{hk:+.3f}{uc:10.3f}^{uk:+.3f}"
                  f"{fc:10.3f}^{fk:+.3f}")
            for v in (1000, 3000, 5000, 8000):
                hv = hc * (v / VREF) ** hk
                uv = uc * (v / VREF) ** uk
                # silence unused in print of factor at v
            print(f"       factor @1k/{3000}/{5000}/{8000}: "
                  + '  '.join(f"{(hc/uc)*((v/VREF)**(hk-uk)):.2f}x"
                              for v in (1000, 3000, 5000, 8000)))
        print()

    print('=== by year (comp)  Hwang / Underdog / factor ===')
    years = sorted({y for (b, y) in h_year if b == 'comp'})
    print(f"{'year':<8}" + ''.join(f"{n:>22}" for n in ('RB/WR', 'RB/TE', 'WR/TE')))
    for y in years:
        cells = []
        for pa, pb in MATCHUPS:
            hta, htb = h_year[('comp', y)][(pa, pb)][0], h_year[('comp', y)][(pa, pb)][1]
            uta, utb = u_year[('comp', y)][(pa, pb)][0], u_year[('comp', y)][(pa, pb)][1]
            h, u = hta / htb, uta / utb
            cells.append(f"{h:5.2f}/{u:5.2f}/{h/u:5.2f}")
        print(f"{y:<8}" + ''.join(f"{c:>22}" for c in cells))


if __name__ == '__main__':
    main()
