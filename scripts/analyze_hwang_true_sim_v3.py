#!/usr/bin/env python3
"""V3 diagnostics for the Hwang True Simulator example dump.

Model changes vs v2 (analyze_hwang_true_sim_example.py):
  - Pair contributions are value-weighted (weight = pair mid value / 5000).
  - Build contributions are points-weighted (weight = base-roster season
    optimal total / 2500), via the engine's weighted per-player HVORP
    averages and weight sums.
  - Multipliers are mean-grounded: the geometric mean of the four positions
    is 1.0, so 1.0x reads "the average same-priced player" and QB gets its
    own multiplier (its noise no longer leaks into RB/WR/TE shapes).

Reads example_data/hwang_true_sim_200_v3/ and produces, per value basis:
  1. Baseline multipliers (all four positions)
  2. Multipliers by 1000-value band
  3. Fitted power laws (mean gauge, incl. QB)
  4. Per-archetype multipliers + spectrum plots
  5. Per-year multipliers (recency check)

Figures land in example_data/hwang_true_sim_200_v3/analysis/.

Usage: /tmp/dbb_venv/bin/python scripts/analyze_hwang_true_sim_v3.py
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
DATA = os.path.join(ROOT, 'example_data', 'hwang_true_sim_200_v3')
OUT = os.path.join(DATA, 'analysis')
os.makedirs(OUT, exist_ok=True)

POS3 = ['RB', 'WR', 'TE']
POS4 = ['QB', 'RB', 'WR', 'TE']
IDX = {'RB': 0, 'WR': 1, 'TE': 2}
BASES = ['ktc', 'comp']
FORMATS = ['hwang', 'regular']
BANDS = [(0, 1000), (1000, 2000), (2000, 3000), (3000, 4000),
         (4000, 5000), (5000, 6000), (6000, 7000), (7000, 10**9)]
VREF = 5000.0

plt.rcParams.update({
    'figure.facecolor': 'white', 'axes.grid': True, 'grid.alpha': 0.3,
    'font.size': 10,
})
COLORS = {'QB': '#8e44ad', 'RB': '#d1495b', 'WR': '#1f6feb', 'TE': '#2e933c'}


def regauge(x):
    """QB-gauge log solution [RB, WR, TE] -> mean-gauge multipliers for all 4."""
    if x is None:
        return {p: None for p in POS4}
    logs = {'QB': 0.0, 'RB': x[0], 'WR': x[1], 'TE': x[2]}
    mean = sum(logs.values()) / 4
    return {p: math.exp(v - mean) for p, v in logs.items()}


def ls_solve(rows):
    """Weighted LS over matchup aggregates {(pa,pb): [ta, tb, w]} -> QB-gauge logs."""
    A = np.zeros((3, 3))
    b = np.zeros(3)
    for (pa, pb), vals in rows.items():
        ta, tb, w = vals[0], vals[1], vals[2]
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
    try:
        return np.linalg.solve(A, b)
    except np.linalg.LinAlgError:
        return None


def load_pairs_with_hvorp():
    """(basis, format) -> list of (posA, posB, mid_value, hvorpA, hvorpB).

    HVORP values are points-weighted: each archetype-year contributes its
    weighted per-player average scaled by its total build weight
    (build_count x avg_base_total / 2500).
    """
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
            key = (r['value_basis'], r['format'])
            c = cands[key]
            a = c[(r['year'], r['player_id_a'])]
            b = c[(r['year'], r['player_id_b'])]
            ha = hv[key][(r['year'], r['player_id_a'])]
            hb = hv[key][(r['year'], r['player_id_b'])]
            pa, pb = r['pair_key'].split('_vs_')
            out[key].append((pa, pb, (a[1] + b[1]) / 2, ha, hb))
    return out


def aggregate(pairs, lo=0, hi=10**9):
    """Value-weighted matchup aggregation. Returns {(pa,pb): [ta, tb, w, n]}."""
    agg = defaultdict(lambda: [0.0, 0.0, 0.0, 0])
    for pa, pb, mid, ha, hb in pairs:
        if not (lo <= mid < hi):
            continue
        wv = mid / VREF
        a = agg[(pa, pb)]
        a[0] += wv * ha
        a[1] += wv * hb
        a[2] += wv
        a[3] += 1
    return agg


def fit_power_law(pairs):
    """Value-weighted fit of log m_pos(v) = a_pos + b_pos*ln(v/VREF), QB-gauge.

    Returns mean-gauge params {pos: (c, k)} meaning m(v) = c * (v/VREF)^k
    for all four positions, plus pair-space weighted R^2 and n.
    """
    rows, ys, ws = [], [], []
    for pa, pb, mid, ha, hb in pairs:
        if ha <= 0 or hb <= 0 or mid <= 200:
            continue
        xv = math.log(mid / VREF)
        row = np.zeros(6)  # [aRB,bRB,aWR,bWR,aTE,bTE]
        if pb in IDX:
            row[2 * IDX[pb]] += 1
            row[2 * IDX[pb] + 1] += xv
        if pa in IDX:
            row[2 * IDX[pa]] -= 1
            row[2 * IDX[pa] + 1] -= xv
        rows.append(row)
        ys.append(math.log(hb / ha))
        ws.append(mid / VREF)
    X = np.array(rows)
    y = np.array(ys)
    sw = np.sqrt(np.array(ws))
    beta, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
    resid = y - X @ beta
    wmean = np.average(y, weights=ws)
    r2 = 1 - np.average(resid**2, weights=ws) / np.average((y - wmean)**2, weights=ws)

    # QB-gauge params: QB (a,b) = (0,0)
    qb_gauge = {'QB': (0.0, 0.0)}
    for pos in POS3:
        qb_gauge[pos] = (beta[2 * IDX[pos]], beta[2 * IDX[pos] + 1])
    # Mean gauge: subtract the average (a, b) across the four positions.
    a_mean = sum(p[0] for p in qb_gauge.values()) / 4
    b_mean = sum(p[1] for p in qb_gauge.values()) / 4
    params = {pos: (math.exp(a - a_mean), b - b_mean)
              for pos, (a, b) in qb_gauge.items()}
    return params, r2, len(y)


def curve(params, pos, v):
    c, k = params[pos]
    return c * (v / VREF) ** k


def main():
    pairs_by_run = load_pairs_with_hvorp()

    print('=' * 76)
    print('1. BASELINE MULTIPLIERS (mean-grounded, value+points weighted)')
    print('=' * 76)
    baseline = {}
    for basis in BASES:
        for fmt in FORMATS:
            m = regauge(ls_solve(aggregate(pairs_by_run[(basis, fmt)])))
            baseline[(basis, fmt)] = m
            print(f"{basis:>5} / {fmt:<8} " +
                  '  '.join(f"{p} {m[p]:.3f}" for p in POS4))
        h, g = baseline[(basis, 'hwang')], baseline[(basis, 'regular')]
        print(f"{basis:>5} / factor   " +
              '  '.join(f"{p} {h[p]/g[p]:.3f}" for p in POS4))

    print()
    print('=' * 76)
    print('2. MULTIPLIERS BY 1000-VALUE BAND (mean-grounded)')
    print('=' * 76)
    band_results = {}
    for basis in BASES:
        print(f"\n--- basis: {basis} (per position: Hwang / Regular / factor) ---")
        hdr = f"{'band':<9}{'pairs':>6} |" + ''.join(f"  {p:>18} |" for p in POS4)
        print(hdr)
        for lo, hi in BANDS:
            aggs = {fmt: aggregate(pairs_by_run[(basis, fmt)], lo, hi) for fmt in FORMATS}
            n = sum(v[3] for v in aggs['hwang'].values())
            if n < 30:
                continue
            ms = {fmt: regauge(ls_solve(aggs[fmt])) for fmt in FORMATS}
            for fmt in FORMATS:
                band_results.setdefault((basis, fmt), []).append(
                    ((lo + min(hi, 9000)) / 2, ms[fmt], n))
            label = f"{lo//1000}k-{hi//1000}k" if hi < 10**9 else f"{lo//1000}k+"
            line = f"{label:<9}{n:>6} |"
            for p in POS4:
                h, g = ms['hwang'][p], ms['regular'][p]
                line += f"  {h:>5.2f}/{g:>5.2f}/{h/g:>5.2f} |"
            print(line)

    print()
    print('=' * 76)
    print('3. FITTED POWER LAWS  m(v) = c * (v/5000)^k   [mean gauge, incl. QB]')
    print('=' * 76)
    fits = {}
    for basis in BASES:
        for fmt in FORMATS:
            params, r2, n = fit_power_law(pairs_by_run[(basis, fmt)])
            fits[(basis, fmt)] = params
            print(f"\n{basis} / {fmt}  (weighted pair-level R^2 = {r2:.3f}, n = {n:,})")
            for pos in POS4:
                c, k = params[pos]
                print(f"  {pos}: m(v) = {c:.3f} * (v/5000)^{k:+.3f}"
                      f"   -> @1k {curve(params, pos, 1000):.2f}x"
                      f"  @3k {curve(params, pos, 3000):.2f}x"
                      f"  @5k {c:.2f}x"
                      f"  @8k {curve(params, pos, 8000):.2f}x")

    # ── Figure: band multipliers + fitted curves ────────────────────────────
    for basis in BASES:
        fig, axes = plt.subplots(1, 2, figsize=(13, 5.5), sharey=True)
        for ax, fmt, title in zip(
                axes, FORMATS,
                ['Hwang format (3RB/2FLEX · 0 PPR · TE +0.5)',
                 'Regular format (2RB/1FLEX · 0.5 PPR · TE +0.5)']):
            bands = band_results[(basis, fmt)]
            vgrid = np.linspace(600, 9200, 200)
            for pos in POS4:
                xs = [b[0] for b in bands]
                ys = [b[1][pos] for b in bands]
                sizes = [18 + 60 * (b[2] / max(bb[2] for bb in bands)) for b in bands]
                ax.scatter(xs, ys, s=sizes, color=COLORS[pos], alpha=0.55, zorder=3,
                           label=f'{pos} (band LS)')
                ax.plot(vgrid, [curve(fits[(basis, fmt)], pos, v) for v in vgrid],
                        color=COLORS[pos], lw=2, zorder=2)
            ax.axhline(1.0, color='#666666', ls='--', lw=1.2, label='avg position = 1.0')
            ax.set_title(title, fontsize=10)
            ax.set_xlabel('pair value (mid)')
        axes[0].set_ylabel('value multiplier vs average same-priced player')
        axes[0].legend(fontsize=8, loc='upper left')
        bname = 'Final KTC' if basis == 'ktc' else 'Competitor-adjusted'
        fig.suptitle(f'V3 value multipliers vs price — {bname} basis, mean-grounded '
                     f'(dots: 1000-band LS, lines: fitted power law)', fontsize=12)
        fig.tight_layout()
        path = os.path.join(OUT, f'multiplier_curves_{basis}.png')
        fig.savefig(path, dpi=140)
        plt.close(fig)
        print(f"\nwrote {path}")

    # ── Per-archetype multipliers (Hwang format, engine-weighted totals) ────
    print()
    print('=' * 76)
    print('4. PER-ARCHETYPE MULTIPLIERS (Hwang format, mean-grounded)')
    print('=' * 76)
    arch_labels = {}
    with open(os.path.join(DATA, 'build_players.csv')) as f:
        for r in csv.DictReader(f):
            arch_labels[r['archetype_id']] = r['archetype_label']

    arch_matchups = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0]))
    year_matchups = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0]))
    with open(os.path.join(DATA, 'matchups.csv')) as f:
        for r in csv.DictReader(f):
            vals = (float(r['total_hvorp_a']), float(r['total_hvorp_b']),
                    float(r['weight_sum']))
            pk = (r['pos_a'], r['pos_b'])
            if r['scope'] == 'archetype' and r['format'] == 'hwang':
                a = arch_matchups[(r['value_basis'], r['archetype_id'])][pk]
                a[0] += vals[0]; a[1] += vals[1]; a[2] += vals[2]
            elif r['scope'] == 'year':
                a = year_matchups[(r['value_basis'], r['format'], r['year'])][pk]
                a[0] += vals[0]; a[1] += vals[1]; a[2] += vals[2]

    arch_mults = {k: regauge(ls_solve(v)) for k, v in arch_matchups.items()}

    for basis in BASES:
        print(f"\n--- basis: {basis} ---")
        aids = sorted({aid for (b, aid) in arch_mults if b == basis},
                      key=lambda aid: -arch_mults[(basis, aid)]['RB'])
        for aid in aids:
            m = arch_mults[(basis, aid)]
            print(f"  {arch_labels.get(aid, aid):<44} " +
                  '  '.join(f"{p} {m[p]:.2f}" for p in POS4))

    for basis in BASES:
        aids = sorted({aid for (b, aid) in arch_mults if b == basis},
                      key=lambda aid: arch_mults[(basis, aid)]['RB'])
        labels = [arch_labels.get(a, a).replace(' — ', ' · ') for a in aids]
        fig, (ax1, ax2) = plt.subplots(
            1, 2, figsize=(14, 7), gridspec_kw={'width_ratios': [1.35, 1]})

        ypos = np.arange(len(aids))
        for pos in POS4:
            vals = [arch_mults[(basis, a)][pos] for a in aids]
            ax1.scatter(vals, ypos, color=COLORS[pos], s=42, label=pos, zorder=3)
        ax1.axvline(1.0, color='#666666', ls='--', lw=1.2, label='avg = 1.0')
        ax1.set_yticks(ypos)
        ax1.set_yticklabels(labels, fontsize=7.5)
        ax1.set_xlabel('multiplier vs average same-priced player')
        ax1.set_title('Spectrum by archetype (sorted by RB)', fontsize=10)
        ax1.legend(fontsize=8, loc='lower right')

        rb = np.array([arch_mults[(basis, a)]['RB'] for a in aids])
        wr = np.array([arch_mults[(basis, a)]['WR'] for a in aids])
        te = np.array([arch_mults[(basis, a)]['TE'] for a in aids])
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
        fig.suptitle(f'V3 per-archetype multipliers — Hwang format, {bname} basis, '
                     f'mean-grounded', fontsize=12)
        fig.tight_layout()
        path = os.path.join(OUT, f'archetype_spectrum_{basis}.png')
        fig.savefig(path, dpi=140)
        plt.close(fig)
        print(f"wrote {path}")

    # ── Per-year multipliers ────────────────────────────────────────────────
    print()
    print('=' * 76)
    print('5. PER-YEAR MULTIPLIERS (mean-grounded)')
    print('=' * 76)
    years = sorted({y for (_, _, y) in year_matchups})
    year_mults = {k: regauge(ls_solve(v)) for k, v in year_matchups.items()}
    for basis in BASES:
        print(f"\n--- basis: {basis} (per position: Hwang / Regular / factor) ---")
        print(f"{'year':<6}" + ''.join(f"  {p:>18} |" for p in POS4))
        for y in years:
            h = year_mults[(basis, 'hwang', y)]
            g = year_mults[(basis, 'regular', y)]
            line = f"{y:<6}"
            for p in POS4:
                line += f"  {h[p]:>5.2f}/{g[p]:>5.2f}/{h[p]/g[p]:>5.2f} |"
            print(line)

    fig, axes = plt.subplots(1, 2, figsize=(13, 5), sharey=True)
    for ax, basis, bname in zip(axes, BASES, ['Final KTC', 'Competitor-adjusted']):
        xs = [int(y) for y in years]
        for pos in POS4:
            hw = [year_mults[(basis, 'hwang', y)][pos] for y in years]
            fac = [year_mults[(basis, 'hwang', y)][pos]
                   / year_mults[(basis, 'regular', y)][pos] for y in years]
            ax.plot(xs, hw, color=COLORS[pos], marker='o', lw=2, label=f'{pos} Hwang mult')
            ax.plot(xs, fac, color=COLORS[pos], marker='s', lw=1.2, ls='--', alpha=0.6,
                    label=f'{pos} format factor')
        ax.axhline(1.0, color='#666666', ls=':', lw=1.2)
        ax.set_xticks(xs)
        ax.set_xlabel('season')
        ax.set_title(f'{bname} basis', fontsize=10)
    axes[0].set_ylabel('multiplier / format factor')
    axes[0].legend(fontsize=7.5, ncol=2)
    fig.suptitle('V3 per-year multipliers, mean-grounded '
                 '(solid: Hwang vs avg player, dashed: Hwang ÷ Regular factor)', fontsize=12)
    fig.tight_layout()
    path = os.path.join(OUT, 'multipliers_by_year.png')
    fig.savefig(path, dpi=140)
    plt.close(fig)
    print(f"\nwrote {path}")


if __name__ == '__main__':
    main()
