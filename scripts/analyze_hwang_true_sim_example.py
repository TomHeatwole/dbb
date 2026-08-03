#!/usr/bin/env python3
"""Diagnostics for the 200-build Hwang True Simulator example dump.

Reads example_data/hwang_true_sim_200/ and produces, per value basis
(Final KTC / competitor-adjusted):
  1. Baseline QB-grounded multipliers (full comparison network least squares)
  2. Multipliers by 1000-value band
  3. A fitted continuous power-law model  m_pos(v) = exp(a) * (v/5000)^b
     (QB pinned at 1.0 for all v), fitted directly on pair-level log-ratios
  4. Per-archetype multipliers (Hwang format) for the archetype-spectrum plots
  5. Per-year multipliers (recency check): does 2021 tell a different story
     than 2025?

Figures are written to example_data/hwang_true_sim_200/analysis/.

Usage: /tmp/dbb_venv/bin/python scripts/analyze_hwang_true_sim_example.py
"""
import csv
import math
import os
from collections import defaultdict

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'example_data', 'hwang_true_sim_200')
OUT = os.path.join(DATA, 'analysis')
os.makedirs(OUT, exist_ok=True)

POS = ['RB', 'WR', 'TE']
IDX = {'RB': 0, 'WR': 1, 'TE': 2}
BASES = ['ktc', 'comp']
FORMATS = ['hwang', 'regular']
BANDS = [(0, 1000), (1000, 2000), (2000, 3000), (3000, 4000),
         (4000, 5000), (5000, 6000), (6000, 7000), (7000, 10**9)]

plt.rcParams.update({
    'figure.facecolor': 'white', 'axes.grid': True, 'grid.alpha': 0.3,
    'font.size': 10,
})
COLORS = {'RB': '#d1495b', 'WR': '#1f6feb', 'TE': '#2e933c', 'QB': '#666666'}


def load_pairs_with_hvorp():
    """(basis, format) -> list of (posA, posB, mid_value, hvorpA_sum, hvorpB_sum)."""
    cands = defaultdict(dict)
    with open(os.path.join(DATA, 'candidates.csv')) as f:
        for r in csv.DictReader(f):
            cands[(r['value_basis'], r['format'])][(r['year'], r['player_id'])] = (
                r['position'], float(r['value']), r['name'])
    hv = defaultdict(lambda: defaultdict(float))
    with open(os.path.join(DATA, 'archetype_player_hvorp.csv')) as f:
        for r in csv.DictReader(f):
            hv[(r['value_basis'], r['format'])][(r['year'], r['player_id'])] += (
                float(r['avg_hvorp']) * int(r['build_count']))
    out = defaultdict(list)
    with open(os.path.join(DATA, 'pairs.csv')) as f:
        for r in csv.DictReader(f):
            key = (r['value_basis'], r['format'])
            c = cands[key]
            a = c[(r['year'], r['player_id_a'])]
            b = c[(r['year'], r['player_id_b'])]
            ha = hv[key][(r['year'], r['player_id_a'])]
            hb = hv[key][(r['year'], r['player_id_b'])]
            pa, pb = r['pair_key'].split('_vs_')
            out[key].append((pa, pb, (a[1] + b[1]) / 2, ha, hb))
    return out


def ls_multipliers(rows):
    """Weighted LS over aggregated matchup totals. rows: (posA,posB,ha,hb) aggregated."""
    A = np.zeros((3, 3))
    b = np.zeros(3)
    for (pa, pb), (ta, tb, n) in rows.items():
        if ta <= 0 or tb <= 0 or n == 0:
            continue
        r = math.log(tb / ta)
        w = n
        terms = []
        if pb in IDX:
            terms.append((IDX[pb], 1))
        if pa in IDX:
            terms.append((IDX[pa], -1))
        for i, si in terms:
            b[i] += w * si * r
            for j, sj in terms:
                A[i, j] += w * si * sj
    try:
        x = np.linalg.solve(A, b)
        return np.exp(x)
    except np.linalg.LinAlgError:
        return [None] * 3


def aggregate(pairs, lo=0, hi=10**9):
    agg = defaultdict(lambda: [0.0, 0.0, 0])
    for pa, pb, mid, ha, hb in pairs:
        if not (lo <= mid < hi):
            continue
        a = agg[(pa, pb)]
        a[0] += ha
        a[1] += hb
        a[2] += 1
    return agg


def fit_power_law(pairs, vref=5000.0):
    """Fit log m_pos(v) = a_pos + b_pos*ln(v/vref), QB pinned at 0.

    Pair-level equations: logm_B(v) - logm_A(v) = log(hB/hA).
    Returns params dict pos -> (a, b), plus R^2 in pair space.
    """
    rows, ys = [], []
    for pa, pb, mid, ha, hb in pairs:
        if ha <= 0 or hb <= 0 or mid <= 200:
            continue
        x = math.log(mid / vref)
        row = np.zeros(6)  # [aRB,bRB,aWR,bWR,aTE,bTE]
        if pb in IDX:
            row[2 * IDX[pb]] += 1
            row[2 * IDX[pb] + 1] += x
        if pa in IDX:
            row[2 * IDX[pa]] -= 1
            row[2 * IDX[pa] + 1] -= x
        rows.append(row)
        ys.append(math.log(hb / ha))
    X = np.array(rows)
    y = np.array(ys)
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    r2 = 1 - resid.var() / y.var()
    params = {pos: (beta[2 * IDX[pos]], beta[2 * IDX[pos] + 1]) for pos in POS}
    return params, r2, len(y)


def main():
    pairs_by_run = load_pairs_with_hvorp()

    print('=' * 72)
    print('1. BASELINE MULTIPLIERS (full comparison network LS)')
    print('=' * 72)
    baseline = {}
    for basis in BASES:
        for fmt in FORMATS:
            m = ls_multipliers(aggregate(pairs_by_run[(basis, fmt)]))
            baseline[(basis, fmt)] = m
            print(f"{basis:>5} / {fmt:<8} RB {m[0]:.3f}  WR {m[1]:.3f}  TE {m[2]:.3f}")
        h, g = baseline[(basis, 'hwang')], baseline[(basis, 'regular')]
        print(f"{basis:>5} / factor   RB {h[0]/g[0]:.3f}  WR {h[1]/g[1]:.3f}  TE {h[2]/g[2]:.3f}")

    print()
    print('=' * 72)
    print('2. MULTIPLIERS BY 1000-VALUE BAND')
    print('=' * 72)
    band_results = {}  # (basis, fmt) -> list of (band_mid, mults, npairs)
    for basis in BASES:
        print(f"\n--- basis: {basis} ---")
        hdr = f"{'band':<10}{'pairs':>7} |" + ''.join(f"{p+' H':>8}{p+' R':>8}{p+' fac':>9} |" for p in POS)
        print(hdr)
        for lo, hi in BANDS:
            aggs = {fmt: aggregate(pairs_by_run[(basis, fmt)], lo, hi) for fmt in FORMATS}
            n = sum(v[2] for v in aggs['hwang'].values())
            if n < 30:
                continue
            ms = {fmt: ls_multipliers(aggs[fmt]) for fmt in FORMATS}
            for fmt in FORMATS:
                band_results.setdefault((basis, fmt), []).append(
                    ((lo + min(hi, 9000)) / 2, ms[fmt], n))
            label = f"{lo//1000}k-{hi//1000}k" if hi < 10**9 else f"{lo//1000}k+"
            line = f"{label:<10}{n:>7} |"
            for i, p in enumerate(POS):
                h, g = ms['hwang'][i], ms['regular'][i]
                line += f"{h:>7.2f}x{g:>7.2f}x{h/g:>8.2f}x |"
            print(line)

    print()
    print('=' * 72)
    print('3. FITTED POWER-LAW MODEL  m(v) = exp(a) * (v/5000)^b   [QB = 1.0]')
    print('=' * 72)
    fits = {}
    for basis in BASES:
        for fmt in FORMATS:
            params, r2, n = fit_power_law(pairs_by_run[(basis, fmt)])
            fits[(basis, fmt)] = params
            print(f"\n{basis} / {fmt}  (pair-level R^2 = {r2:.3f}, n = {n:,})")
            for pos in POS:
                a, b_ = params[pos]
                print(f"  {pos}: m(v) = {math.exp(a):.3f} * (v/5000)^{b_:+.3f}"
                      f"   -> @1k {math.exp(a)*(1000/5000)**b_:.2f}x"
                      f"  @3k {math.exp(a)*(3000/5000)**b_:.2f}x"
                      f"  @5k {math.exp(a):.2f}x"
                      f"  @8k {math.exp(a)*(8000/5000)**b_:.2f}x")

    # ── Figure: band multipliers + fitted curves (hwang format, per basis) ──
    for basis in BASES:
        fig, axes = plt.subplots(1, 2, figsize=(13, 5.5), sharey=True)
        for ax, fmt, title in zip(
                axes, FORMATS,
                ['Hwang format (3RB/2FLEX · 0 PPR · TE +0.5)',
                 'Regular format (2RB/1FLEX · 0.5 PPR · TE +0.5)']):
            bands = band_results[(basis, fmt)]
            vgrid = np.linspace(600, 9200, 200)
            for i, pos in enumerate(POS):
                xs = [b[0] for b in bands]
                ys = [b[1][i] for b in bands]
                sizes = [18 + 60 * (b[2] / max(bb[2] for bb in bands)) for b in bands]
                ax.scatter(xs, ys, s=sizes, color=COLORS[pos], alpha=0.55, zorder=3,
                           label=f'{pos} (band LS)')
                a, b_ = fits[(basis, fmt)][pos]
                ax.plot(vgrid, np.exp(a) * (vgrid / 5000) ** b_, color=COLORS[pos],
                        lw=2, zorder=2)
            ax.axhline(1.0, color=COLORS['QB'], ls='--', lw=1.2, label='QB = 1.0')
            ax.set_title(title, fontsize=10)
            ax.set_xlabel('pair value (mid)')
        axes[0].set_ylabel('value multiplier vs QB (same price)')
        axes[0].legend(fontsize=8, loc='upper left')
        bname = 'Final KTC' if basis == 'ktc' else 'Competitor-adjusted'
        fig.suptitle(f'Value multipliers vs price — {bname} basis '
                     f'(dots: 1000-band LS, lines: fitted power law)', fontsize=12)
        fig.tight_layout()
        path = os.path.join(OUT, f'multiplier_curves_{basis}.png')
        fig.savefig(path, dpi=140)
        plt.close(fig)
        print(f"\nwrote {path}")

    # ── Per-archetype multipliers (hwang format) ────────────────────────────
    print()
    print('=' * 72)
    print('4. PER-ARCHETYPE MULTIPLIERS (Hwang format)')
    print('=' * 72)
    arch_labels = {}
    with open(os.path.join(DATA, 'build_players.csv')) as f:
        for r in csv.DictReader(f):
            arch_labels[r['archetype_id']] = r['archetype_label']

    arch_matchups = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0]))
    with open(os.path.join(DATA, 'matchups.csv')) as f:
        for r in csv.DictReader(f):
            if r['scope'] != 'archetype' or r['format'] != 'hwang':
                continue
            key = (r['value_basis'], r['archetype_id'])
            a = arch_matchups[key][(r['pos_a'], r['pos_b'])]
            a[0] += float(r['total_hvorp_a'])
            a[1] += float(r['total_hvorp_b'])
            a[2] += int(r['pair_plugs'])

    arch_mults = {}
    for (basis, aid), rows in arch_matchups.items():
        arch_mults[(basis, aid)] = ls_multipliers(rows)

    for basis in BASES:
        print(f"\n--- basis: {basis} ---")
        aids = sorted({aid for (b, aid) in arch_mults if b == basis},
                      key=lambda aid: -arch_mults[(basis, aid)][0])
        for aid in aids:
            m = arch_mults[(basis, aid)]
            print(f"  {arch_labels.get(aid, aid):<44} RB {m[0]:.2f}  WR {m[1]:.2f}  TE {m[2]:.2f}")

    # ── Figure: archetype spectrum (dot-range plot + RB/WR scatter) ─────────
    for basis in BASES:
        aids = sorted({aid for (b, aid) in arch_mults if b == basis},
                      key=lambda aid: arch_mults[(basis, aid)][0])
        labels = [arch_labels.get(a, a).replace(' — ', ' · ') for a in aids]
        fig, (ax1, ax2) = plt.subplots(
            1, 2, figsize=(14, 7), gridspec_kw={'width_ratios': [1.35, 1]})

        ypos = np.arange(len(aids))
        for i, pos in enumerate(POS):
            vals = [arch_mults[(basis, a)][i] for a in aids]
            ax1.scatter(vals, ypos, color=COLORS[pos], s=42, label=pos, zorder=3)
        ax1.axvline(1.0, color=COLORS['QB'], ls='--', lw=1.2, label='QB = 1.0')
        ax1.set_yticks(ypos)
        ax1.set_yticklabels(labels, fontsize=7.5)
        ax1.set_xlabel('multiplier vs QB (same price)')
        ax1.set_title('Spectrum by archetype (sorted by RB)', fontsize=10)
        ax1.legend(fontsize=8, loc='lower right')

        rb = np.array([arch_mults[(basis, a)][0] for a in aids])
        wr = np.array([arch_mults[(basis, a)][1] for a in aids])
        te = np.array([arch_mults[(basis, a)][2] for a in aids])
        sc = ax2.scatter(rb, wr, c=te, cmap='viridis', s=110, edgecolor='k', lw=0.5)
        for i, a in enumerate(aids):
            short = arch_labels.get(a, a).split(' — ')[0]
            ax2.annotate(short, (rb[i], wr[i]), fontsize=6.5,
                         xytext=(4, 3), textcoords='offset points')
        ax2.axvline(np.median(rb), color='gray', ls=':', lw=1)
        ax2.axhline(np.median(wr), color='gray', ls=':', lw=1)
        ax2.set_xlabel('RB multiplier')
        ax2.set_ylabel('WR multiplier')
        ax2.set_title('RB vs WR (color = TE multiplier)', fontsize=10)
        fig.colorbar(sc, ax=ax2, label='TE multiplier', shrink=0.8)

        bname = 'Final KTC' if basis == 'ktc' else 'Competitor-adjusted'
        fig.suptitle(f'Per-archetype value multipliers — Hwang format, {bname} basis',
                     fontsize=12)
        fig.tight_layout()
        path = os.path.join(OUT, f'archetype_spectrum_{basis}.png')
        fig.savefig(path, dpi=140)
        plt.close(fig)
        print(f"wrote {path}")

    # ── Per-year multipliers (recency check) ────────────────────────────────
    print()
    print('=' * 72)
    print('5. PER-YEAR MULTIPLIERS')
    print('=' * 72)
    year_matchups = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0]))
    with open(os.path.join(DATA, 'matchups.csv')) as f:
        for r in csv.DictReader(f):
            if r['scope'] != 'year':
                continue
            key = (r['value_basis'], r['format'], r['year'])
            a = year_matchups[key][(r['pos_a'], r['pos_b'])]
            a[0] += float(r['total_hvorp_a'])
            a[1] += float(r['total_hvorp_b'])
            a[2] += int(r['pair_plugs'])

    years = sorted({y for (_, _, y) in year_matchups})
    year_mults = {k: ls_multipliers(v) for k, v in year_matchups.items()}
    for basis in BASES:
        print(f"\n--- basis: {basis} (Hwang / Regular / factor) ---")
        print(f"{'year':<6}" + ''.join(f"{p+' H':>8}{p+' R':>8}{p+' fac':>9} |" for p in POS))
        for y in years:
            h = year_mults[(basis, 'hwang', y)]
            g = year_mults[(basis, 'regular', y)]
            line = f"{y:<6}"
            for i in range(3):
                line += f"{h[i]:>7.2f}x{g[i]:>7.2f}x{h[i]/g[i]:>8.2f}x |"
            print(line)

    fig, axes = plt.subplots(1, 2, figsize=(13, 5), sharey=True)
    for ax, basis, bname in zip(axes, BASES, ['Final KTC', 'Competitor-adjusted']):
        xs = [int(y) for y in years]
        for i, pos in enumerate(POS):
            hw = [year_mults[(basis, 'hwang', y)][i] for y in years]
            fac = [year_mults[(basis, 'hwang', y)][i] / year_mults[(basis, 'regular', y)][i]
                   for y in years]
            ax.plot(xs, hw, color=COLORS[pos], marker='o', lw=2, label=f'{pos} Hwang mult')
            ax.plot(xs, fac, color=COLORS[pos], marker='s', lw=1.2, ls='--', alpha=0.6,
                    label=f'{pos} format factor')
        ax.axhline(1.0, color=COLORS['QB'], ls=':', lw=1.2)
        ax.set_xticks(xs)
        ax.set_xlabel('season')
        ax.set_title(f'{bname} basis', fontsize=10)
    axes[0].set_ylabel('multiplier vs QB / format factor')
    axes[0].legend(fontsize=7.5, ncol=2)
    fig.suptitle('Per-year multipliers (solid: Hwang vs QB, dashed: Hwang ÷ Regular factor)',
                 fontsize=12)
    fig.tight_layout()
    path = os.path.join(OUT, 'multipliers_by_year.png')
    fig.savefig(path, dpi=140)
    plt.close(fig)
    print(f"\nwrote {path}")


if __name__ == '__main__':
    main()
