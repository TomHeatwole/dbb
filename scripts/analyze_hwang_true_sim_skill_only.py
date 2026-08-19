#!/usr/bin/env python3
"""Skill-only HVORP: RB vs WR, RB vs TE, WR vs TE. QB is ignored.

Reads a true-sim dump (matchups.csv + pair-level HVORP) and reports:
  1. Direct matchup totals (the paired HVORP itself)
  2. 3-position network solve (no QB equations, geo mean RB/WR/TE = 1)
  3. Those two views by year, archetype, and value band
  4. Hwang ÷ Underdog format factors on the three ratios

Usage:
  python scripts/analyze_hwang_true_sim_skill_only.py [dataDir]
"""
import csv
import math
import os
import sys
from collections import defaultdict

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = (os.path.abspath(sys.argv[1]) if len(sys.argv) > 1
        else os.path.join(ROOT, 'example_data', 'hwang_true_sim_bbm_50'))
OUT = os.path.join(DATA, 'analysis')
os.makedirs(OUT, exist_ok=True)

SKILL = ['RB', 'WR', 'TE']
MATCHUPS = [('RB', 'WR'), ('RB', 'TE'), ('WR', 'TE')]
IDX = {'WR': 0, 'TE': 1}  # RB pinned at 0 in QB-less 2-param solve, then re-gauged
BASES = ['ktc', 'comp']
FORMATS = ['hwang', 'regular']
VREF = 5000.0
BANDS = [(0, 2000), (2000, 4000), (4000, 6000), (6000, 10**9)]
COLORS = {'RB': '#d1495b', 'WR': '#1f6feb', 'TE': '#2e933c'}

plt.rcParams.update({
    'figure.facecolor': 'white', 'axes.grid': True, 'grid.alpha': 0.3,
    'font.size': 10,
})


def ratio_label(pa, pb):
    return f'{pa}/{pb}'


def load_direct_matchups():
    """(basis, fmt, scope, year, arch) -> {(pa,pb): (ta, tb, w, n)}"""
    out = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0, 0]))
    with open(os.path.join(DATA, 'matchups.csv')) as f:
        for r in csv.DictReader(f):
            pa, pb = r['pos_a'], r['pos_b']
            if pa not in SKILL or pb not in SKILL:
                continue
            key = (r['value_basis'], r['format'], r['scope'], r['year'], r['archetype_id'])
            a = out[key][(pa, pb)]
            a[0] += float(r['total_hvorp_a'])
            a[1] += float(r['total_hvorp_b'])
            a[2] += float(r['weight_sum'])
            a[3] += int(float(r['pair_plugs']))
    return out


def load_skill_pairs():
    """(basis, fmt) -> list of (year, pa, pb, mid, ha, hb) skill-vs-skill only."""
    cands = defaultdict(dict)
    with open(os.path.join(DATA, 'candidates.csv')) as f:
        for r in csv.DictReader(f):
            cands[(r['value_basis'], r['format'])][(r['year'], r['player_id'])] = (
                r['position'], float(r['value']))
    hv = defaultdict(lambda: defaultdict(float))
    with open(os.path.join(DATA, 'archetype_player_hvorp.csv')) as f:
        for r in csv.DictReader(f):
            avg_w = r['avg_hvorp_weighted']
            if avg_w in ('', 'null'):
                continue
            arch_w = int(r['build_count']) * float(r['avg_base_total']) / 2500.0
            hv[(r['value_basis'], r['format'])][(r['year'], r['player_id'])] += (
                float(avg_w) * arch_w)
    out = defaultdict(list)
    with open(os.path.join(DATA, 'pairs.csv')) as f:
        for r in csv.DictReader(f):
            pa, pb = r['pair_key'].split('_vs_')
            if pa not in SKILL or pb not in SKILL:
                continue
            key = (r['value_basis'], r['format'])
            a = cands[key][(r['year'], r['player_id_a'])]
            b = cands[key][(r['year'], r['player_id_b'])]
            ha = hv[key][(r['year'], r['player_id_a'])]
            hb = hv[key][(r['year'], r['player_id_b'])]
            out[key].append((r['year'], pa, pb, (a[1] + b[1]) / 2, ha, hb))
    return out


def direct_ratio(ta, tb):
    if ta <= 0 or tb <= 0:
        return None
    return tb / ta  # posB / posA for a stored (pa, pb) row


def print_direct(title, rows_by_matchup):
    """rows_by_matchup[(pa,pb)] = (ta, tb, w, n)"""
    print(title)
    print(f"  {'matchup':<10}{'n plugs':>12}{'ratio':>10}{'B beats A by':>14}")
    for pa, pb in MATCHUPS:
        ta, tb, w, n = rows_by_matchup.get((pa, pb), (0, 0, 0, 0))
        if ta <= 0 or tb <= 0:
            print(f"  {pa} vs {pb:<4}{'—':>12}")
            continue
        r = tb / ta  # pb / pa
        # User-facing: how much more HVORP the first named pos has.
        # We want RB vs WR meaning RB/WR.
        # Stored as RB_vs_WR: ta=RB, tb=WR, so RB/WR = ta/tb = 1/r
        first_over_second = ta / tb
        pct = (first_over_second - 1) * 100
        print(f"  {pa} vs {pb:<4}{n:>12,}{first_over_second:>10.3f}{pct:>+13.1f}%")


def skill_network(matchup_totals):
    """Weighted LS among RB/WR/TE only. Returns mean-gauge {pos: m} with geo mean 1."""
    # Pin RB log = 0, solve WR and TE, then subtract mean of three.
    A = np.zeros((2, 2))
    b = np.zeros(2)
    for (pa, pb), (ta, tb, w, n) in matchup_totals.items():
        if ta <= 0 or tb <= 0 or w <= 0:
            continue
        r = math.log(tb / ta)  # log m_pb - log m_pa
        terms = []
        if pb in IDX:
            terms.append((IDX[pb], 1))
        if pa in IDX:
            terms.append((IDX[pa], -1))
        # RB is the omitted category (log 0)
        for i, si in terms:
            b[i] += w * si * r
            for j, sj in terms:
                A[i, j] += w * si * sj
    try:
        x = np.linalg.solve(A, b)
    except np.linalg.LinAlgError:
        return None
    logs = {'RB': 0.0, 'WR': x[0], 'TE': x[1]}
    mean = sum(logs.values()) / 3
    return {p: math.exp(v - mean) for p, v in logs.items()}


def fit_skill_curves(pairs):
    """m(v) = c*(v/5000)^k among RB/WR/TE, mean-gauge, no QB pairs."""
    # Design: log(hb/ha) = (a_pb - a_pa) + (k_pb - k_pa)*ln(v/VREF)
    # Pin RB (a,k)=(0,0), 4 params: aWR,kWR,aTE,kTE then mean-gauge.
    rows, ys, ws = [], [], []
    for year, pa, pb, mid, ha, hb in pairs:
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
    if not rows:
        return None
    X = np.array(rows)
    y = np.array(ys)
    sw = np.sqrt(np.array(ws))
    beta, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
    qb_gauge = {
        'RB': (0.0, 0.0),
        'WR': (beta[0], beta[1]),
        'TE': (beta[2], beta[3]),
    }
    a_mean = sum(p[0] for p in qb_gauge.values()) / 3
    b_mean = sum(p[1] for p in qb_gauge.values()) / 3
    return {pos: (math.exp(a - a_mean), b - b_mean) for pos, (a, b) in qb_gauge.items()}


def curve(params, pos, v):
    c, k = params[pos]
    return c * (v / VREF) ** k


def load_labels():
    labels = {}
    path = os.path.join(DATA, 'build_players.csv')
    if not os.path.exists(path):
        return labels
    with open(path) as f:
        for r in csv.DictReader(f):
            labels[r['archetype_id']] = r['archetype_label']
    return labels


def main():
    direct = load_direct_matchups()
    pairs = load_skill_pairs()
    labels = load_labels()

    overall_ratios = {}
    overall_network = {}

    print('=' * 76)
    print('SKILL-ONLY HVORP  (QB dropped from every comparison)')
    print('Direct ratio = HVORP(first) / HVORP(second) among equal-priced pairs.')
    print('=' * 76)

    for basis in BASES:
        for fmt in FORMATS:
            key = (basis, fmt, 'overall', '', '')
            rows = direct[key]
            print()
            print_direct(f'--- {basis} / {fmt}  DIRECT MATCHUPS ---', rows)
            ratios = {}
            for pa, pb in MATCHUPS:
                ta, tb, w, n = rows[(pa, pb)]
                ratios[ratio_label(pa, pb)] = ta / tb if ta > 0 and tb > 0 else None
            overall_ratios[(basis, fmt)] = ratios
            net = skill_network(rows)
            overall_network[(basis, fmt)] = net
            if net:
                print('  3-pos network (geo mean = 1.0): ' +
                      '  '.join(f"{p} {net[p]:.3f}" for p in SKILL))
                print('  implied  '
                      f"RB/WR {net['RB']/net['WR']:.3f}  "
                      f"RB/TE {net['RB']/net['TE']:.3f}  "
                      f"WR/TE {net['WR']/net['TE']:.3f}")

        print()
        print(f'--- {basis}  FORMAT FACTOR (Hwang ratio ÷ Underdog ratio) ---')
        h, g = overall_ratios[(basis, 'hwang')], overall_ratios[(basis, 'regular')]
        for name in ('RB/WR', 'RB/TE', 'WR/TE'):
            if h[name] and g[name]:
                print(f"  {name:<8}  Hwang {h[name]:.3f}  Underdog {g[name]:.3f}  "
                      f"factor {h[name]/g[name]:.3f}")

    print()
    print('=' * 76)
    print('POWER LAWS on skill-vs-skill pairs only, 3-pos mean gauge')
    print('m(v) = c · (v/5000)^k')
    print('=' * 76)
    fits = {}
    for basis in BASES:
        for fmt in FORMATS:
            params = fit_skill_curves(pairs[(basis, fmt)])
            fits[(basis, fmt)] = params
            n = sum(1 for t in pairs[(basis, fmt)] if t[4] > 0 and t[5] > 0 and t[3] > 200)
            print(f"\n{basis} / {fmt}  (n = {n:,} skill pairs)")
            if not params:
                continue
            for pos in SKILL:
                c, k = params[pos]
                print(f"  {pos}: {c:.3f} · (v/5000)^{k:+.3f}"
                      f"   @1k {curve(params, pos, 1000):.2f}x"
                      f"  @3k {curve(params, pos, 3000):.2f}x"
                      f"  @5k {c:.2f}x"
                      f"  @8k {curve(params, pos, 8000):.2f}x")
            print('  implied ratios @5k  '
                  f"RB/WR {params['RB'][0]/params['WR'][0]:.3f}  "
                  f"RB/TE {params['RB'][0]/params['TE'][0]:.3f}  "
                  f"WR/TE {params['WR'][0]/params['TE'][0]:.3f}")

    print()
    print('=' * 76)
    print('BY VALUE BAND  (direct HVORP(first)/HVORP(second))')
    print('=' * 76)
    band_store = defaultdict(list)
    for basis in BASES:
        print(f"\n--- {basis}  (Hwang / Underdog / factor) ---")
        print(f"{'band':<10}" + ''.join(f"{ratio_label(a,b):>22}" for a, b in MATCHUPS))
        for lo, hi in BANDS:
            line = f"{lo//1000}k-{hi//1000 if hi<10**9 else '+'}k".replace('-+k', '+')
            line = f"{lo//1000}k–{'end' if hi>10**8 else str(hi//1000)+'k':<4}"
            cells = []
            for pa, pb in MATCHUPS:
                rs = {}
                for fmt in FORMATS:
                    sub = [(y, a, b, mid, ha, hb) for (y, a, b, mid, ha, hb)
                           in pairs[(basis, fmt)] if a == pa and b == pb and lo <= mid < hi]
                    # value-weighted HVORP totals
                    ta = sum((mid / VREF) * ha for _, _, _, mid, ha, hb in sub)
                    tb = sum((mid / VREF) * hb for _, _, _, mid, ha, hb in sub)
                    rs[fmt] = ta / tb if ta > 0 and tb > 0 else None
                    band_store[(basis, fmt, pa, pb)].append(((lo + min(hi, 8000)) / 2, rs[fmt], len(sub)))
                h, g = rs['hwang'], rs['regular']
                if h and g:
                    cells.append(f"{h:5.2f}/{g:5.2f}/{h/g:5.2f}")
                else:
                    cells.append('   —')
            print(f"{lo//1000}k–{('+' if hi>10**8 else str(hi//1000)+'k'):<4}" +
                  ''.join(f"{c:>22}" for c in cells))

    print()
    print('=' * 76)
    print('BY YEAR  (direct ratios, Hwang / Underdog / factor)')
    print('=' * 76)
    years = sorted({y for (b, f, scope, y, a) in direct if scope == 'year' and y})
    for basis in BASES:
        print(f"\n--- {basis} ---")
        print(f"{'year':<8}" + ''.join(f"{ratio_label(a,b):>22}" for a, b in MATCHUPS))
        for y in years:
            cells = []
            for pa, pb in MATCHUPS:
                rs = {}
                for fmt in FORMATS:
                    rows = direct[(basis, fmt, 'year', y, '')]
                    ta, tb, w, n = rows[(pa, pb)]
                    rs[fmt] = ta / tb if ta > 0 and tb > 0 else None
                h, g = rs['hwang'], rs['regular']
                cells.append(f"{h:5.2f}/{g:5.2f}/{h/g:5.2f}" if h and g else '   —')
            print(f"{y:<8}" + ''.join(f"{c:>22}" for c in cells))

    print()
    print('=' * 76)
    print('BY ARCHETYPE  (comp basis, direct ratios)')
    print('=' * 76)
    archs = sorted({a for (b, f, scope, y, a) in direct if scope == 'archetype' and a})
    for fmt in FORMATS:
        print(f"\n--- format: {fmt} ---")
        print(f"{'archetype':<44}{'RB/WR':>8}{'RB/TE':>8}{'WR/TE':>8}")
        scored = []
        for aid in archs:
            rows = defaultdict(lambda: [0.0, 0.0, 0.0, 0])
            for (b, f, scope, y, a), mm in direct.items():
                if b != 'comp' or f != fmt or scope != 'archetype' or a != aid:
                    continue
                for pk, vals in mm.items():
                    t = rows[pk]
                    t[0] += vals[0]; t[1] += vals[1]; t[2] += vals[2]; t[3] += vals[3]
            rbw = rows[('RB', 'WR')][0] / rows[('RB', 'WR')][1]
            rbt = rows[('RB', 'TE')][0] / rows[('RB', 'TE')][1]
            wrt = rows[('WR', 'TE')][0] / rows[('WR', 'TE')][1]
            scored.append((rbw, aid, rbt, wrt))
        scored.sort(reverse=True)
        for rbw, aid, rbt, wrt in scored:
            lab = labels.get(aid, aid)
            print(f"  {lab:<42}{rbw:>8.2f}{rbt:>8.2f}{wrt:>8.2f}")

    # Figure: three matchup ratios, Hwang vs Underdog
    fig, axes = plt.subplots(1, 2, figsize=(12, 5), sharey=True)
    x = np.arange(len(MATCHUPS))
    for ax, basis, title in zip(axes, BASES, ['Final KTC pairs', 'Competitor-adjusted pairs']):
        h = [overall_ratios[(basis, 'hwang')][ratio_label(a, b)] for a, b in MATCHUPS]
        g = [overall_ratios[(basis, 'regular')][ratio_label(a, b)] for a, b in MATCHUPS]
        ax.bar(x - 0.18, h, 0.36, label='Hwang (3RB/2FLEX/0 PPR)', color='#1a1a1a')
        ax.bar(x + 0.18, g, 0.36, label='Underdog (2RB/1FLEX/0.5 PPR)', color='#d1495b')
        ax.axhline(1.0, color='#666', ls='--', lw=1)
        ax.set_xticks(x)
        ax.set_xticklabels([f'{a} / {b}' for a, b in MATCHUPS])
        ax.set_title(title, fontsize=10)
        ax.set_ylabel('HVORP ratio (equal-priced pairs)')
    axes[0].legend(fontsize=8, loc='upper right')
    fig.suptitle('Skill-only positional advantage — QB excluded', fontsize=12)
    fig.tight_layout()
    path = os.path.join(OUT, 'skill_only_ratios.png')
    fig.savefig(path, dpi=140)
    plt.close(fig)
    print(f'\nwrote {path}')

    # Curve figure: implied RB/WR etc vs value
    fig, axes = plt.subplots(1, 2, figsize=(12, 5), sharey=True)
    vgrid = np.linspace(800, 9000, 200)
    for ax, basis, title in zip(axes, BASES, ['Final KTC pairs', 'Competitor-adjusted pairs']):
        for fmt, ls, lw in (('hwang', '-', 2.2), ('regular', '--', 1.6)):
            p = fits[(basis, fmt)]
            if not p:
                continue
            ax.plot(vgrid, [curve(p, 'RB', v) / curve(p, 'WR', v) for v in vgrid],
                    color='#d1495b', ls=ls, lw=lw, label=f'RB/WR {fmt}')
            ax.plot(vgrid, [curve(p, 'RB', v) / curve(p, 'TE', v) for v in vgrid],
                    color='#2e933c', ls=ls, lw=lw, label=f'RB/TE {fmt}')
            ax.plot(vgrid, [curve(p, 'WR', v) / curve(p, 'TE', v) for v in vgrid],
                    color='#1f6feb', ls=ls, lw=lw, label=f'WR/TE {fmt}')
        ax.axhline(1.0, color='#666', ls=':', lw=1)
        ax.set_title(title, fontsize=10)
        ax.set_xlabel('pair value (mid)')
    axes[0].set_ylabel('HVORP ratio')
    axes[0].legend(fontsize=7.5, ncol=2)
    fig.suptitle('Skill-only ratio curves (solid Hwang, dashed Underdog)', fontsize=12)
    fig.tight_layout()
    path = os.path.join(OUT, 'skill_only_ratio_curves.png')
    fig.savefig(path, dpi=140)
    plt.close(fig)
    print(f'wrote {path}')


if __name__ == '__main__':
    main()
