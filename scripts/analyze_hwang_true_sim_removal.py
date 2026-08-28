#!/usr/bin/env python3
"""Leave-one-out (removal) HVORP spectrum for Hwang archetypes.

Reads example_data/hwang_true_sim_removal/ (matchups.csv) and writes
per-archetype multipliers + a spectrum PNG. Hwang-only; bases from config.

Usage: python scripts/analyze_hwang_true_sim_removal.py [dataDir]
"""
import csv
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = (os.path.abspath(sys.argv[1]) if len(sys.argv) > 1
        else os.path.join(ROOT, 'example_data', 'hwang_true_sim_removal'))
OUT = os.path.join(DATA, 'analysis')
os.makedirs(OUT, exist_ok=True)

POS4 = ['QB', 'RB', 'WR', 'TE']
IDX = {'RB': 0, 'WR': 1, 'TE': 2}

COLORS = {'QB': '#8e44ad', 'RB': '#d1495b', 'WR': '#1f6feb', 'TE': '#2e933c'}


def regauge(x):
    if x is None:
        return {p: None for p in POS4}
    logs = {'QB': 0.0, 'RB': x[0], 'WR': x[1], 'TE': x[2]}
    mean = sum(logs.values()) / 4
    return {p: math.exp(v - mean) for p, v in logs.items()}


def ls_solve(rows):
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


def load_config():
    bases = []
    formats = []
    builds = None
    mode = 'addon'
    with open(os.path.join(DATA, 'config.csv')) as f:
        for r in csv.DictReader(f):
            if r['value_basis'] not in bases:
                bases.append(r['value_basis'])
            if r['format'] not in formats:
                formats.append(r['format'])
            builds = int(float(r['builds_per_archetype']))
            mode = r.get('hvorp_mode') or mode
    return bases or ['comp'], formats, builds, mode


def load_labels():
    labels = {}
    path = os.path.join(DATA, 'build_players.csv')
    if not os.path.exists(path):
        return labels
    with open(path) as f:
        for r in csv.DictReader(f):
            labels[r['archetype_id']] = r['archetype_label']
    return labels


def load_matchups(bases, formats):
    overall = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0, 0]))
    arch = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0, 0]))
    year = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0, 0]))
    with open(os.path.join(DATA, 'matchups.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] not in formats or r['value_basis'] not in bases:
                continue
            pk = (r['pos_a'], r['pos_b'])
            vals = (float(r['total_hvorp_a']), float(r['total_hvorp_b']),
                    float(r['weight_sum']), int(float(r['pair_plugs'] or 0)))
            if r['scope'] == 'overall':
                a = overall[(r['value_basis'], r['format'])][pk]
            elif r['scope'] == 'archetype':
                a = arch[(r['value_basis'], r['format'], r['archetype_id'])][pk]
            elif r['scope'] == 'year':
                a = year[(r['value_basis'], r['format'], r['year'])][pk]
            else:
                continue
            a[0] += vals[0]
            a[1] += vals[1]
            a[2] += vals[2]
            a[3] += vals[3]
    return overall, arch, year


def short_label(label):
    s = label.replace(' — ', ' · ')
    s = s.replace('Eat It While She Sleeper', 'Eat It')
    s = s.replace('We Have McCaffrey at Home', 'CMC-home')
    s = s.replace('Lord Pittsy Flacco Joedy', 'Pittsy')
    s = s.replace('House of Hwang', 'Hwang')
    s = s.replace('The Boomers', 'Boomers')
    s = s.replace('Adam(s) and Steve(nson)', 'Adams')
    s = s.replace('Age is just a number', 'Age')
    s = s.replace('Let James Cook', 'Cook')
    s = s.replace('MrZaccheaus', 'Zaccheaus')
    s = s.replace('The Ladds', 'Ladds')
    return s


def fmt(x):
    return None if x is None else round(float(x), 3)


def xml_esc(s):
    return (str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def write_spectrum_svg(path, aids, plot_labels, arch_mults, chart_basis, bname, builds):
    """Two-panel spectrum matching the add-on PNG, no matplotlib required."""
    n = len(aids)
    left_x0, left_y0, left_w, row_h = 220, 48, 420, 26
    left_h = n * row_h
    xmin, xmax = 0.65, 1.85
    right_x0, right_y0, right_w, right_h = 720, 80, 360, min(left_h - 40, 420)
    width, height = 1120, left_y0 + left_h + 56
    title = f'Per-archetype leave-one-out multipliers — Hwang, {bname}, {builds} builds'

    def lx(v):
        return left_x0 + (v - xmin) / (xmax - xmin) * left_w

    def ly(i):
        return left_y0 + (n - 1 - i) * row_h + row_h / 2

    rbs = [arch_mults[(chart_basis, 'hwang', a)]['RB'] for a in aids]
    wrs = [arch_mults[(chart_basis, 'hwang', a)]['WR'] for a in aids]
    tes = [arch_mults[(chart_basis, 'hwang', a)]['TE'] for a in aids]
    qbs = [arch_mults[(chart_basis, 'hwang', a)]['QB'] for a in aids]
    rxmin, rxmax = min(rbs) - 0.08, max(rbs) + 0.08
    rymin, rymax = min(wrs) - 0.08, max(wrs) + 0.08
    tmin, tmax = min(tes), max(tes)

    def rx(v):
        return right_x0 + (v - rxmin) / (rxmax - rxmin) * right_w

    def ry(v):
        return right_y0 + right_h - (v - rymin) / (rymax - rymin) * right_h

    def te_color(t):
        u = 0 if tmax == tmin else (t - tmin) / (tmax - tmin)
        r = int(68 + u * (253 - 68))
        g = int(1 + u * (231 - 1))
        b = int(84 + u * (37 - 84))
        return f'rgb({r},{g},{b})'

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" font-family="Helvetica, Arial, sans-serif">',
        f'<rect width="{width}" height="{height}" fill="white"/>',
        f'<text x="{width/2}" y="22" text-anchor="middle" font-size="15" fill="#222">'
        f'{xml_esc(title)}</text>',
        f'<text x="{left_x0 + left_w/2}" y="{left_y0 - 18}" text-anchor="middle" '
        f'font-size="11" fill="#444">Spectrum by archetype (sorted by RB)</text>',
        f'<line x1="{lx(1)}" y1="{left_y0}" x2="{lx(1)}" y2="{left_y0 + left_h}" '
        f'stroke="#666" stroke-dasharray="4 3" stroke-width="1"/>',
    ]
    for i, lab in enumerate(plot_labels):
        y = ly(i)
        parts.append(
            f'<text x="{left_x0 - 8}" y="{y + 4}" text-anchor="end" font-size="9" fill="#333">'
            f'{xml_esc(lab)}</text>'
        )
        for pos, val in (('QB', qbs[i]), ('RB', rbs[i]), ('WR', wrs[i]), ('TE', tes[i])):
            parts.append(
                f'<circle cx="{lx(val)}" cy="{y}" r="5" fill="{COLORS[pos]}" '
                f'stroke="white" stroke-width="0.6"/>'
            )
    for tick in (0.8, 1.0, 1.2, 1.4, 1.6, 1.8):
        parts.append(
            f'<text x="{lx(tick)}" y="{left_y0 + left_h + 16}" text-anchor="middle" '
            f'font-size="9" fill="#555">{tick:.1f}</text>'
        )
    parts.append(
        f'<text x="{left_x0 + left_w/2}" y="{left_y0 + left_h + 34}" text-anchor="middle" '
        f'font-size="10" fill="#444">multiplier vs average same-priced removal</text>'
    )
    legend_x = left_x0 + 12
    legend_y = left_y0 + left_h - 8
    for i, pos in enumerate(POS4):
        x = legend_x + i * 70
        parts.append(f'<circle cx="{x}" cy="{legend_y}" r="5" fill="{COLORS[pos]}"/>')
        parts.append(
            f'<text x="{x + 10}" y="{legend_y + 4}" font-size="10" fill="#333">{pos}</text>'
        )

    parts.append(
        f'<text x="{right_x0 + right_w/2}" y="{right_y0 - 28}" text-anchor="middle" '
        f'font-size="11" fill="#444">RB vs WR (color = TE)</text>'
    )
    parts.append(
        f'<rect x="{right_x0}" y="{right_y0}" width="{right_w}" height="{right_h}" '
        f'fill="none" stroke="#ccc"/>'
    )
    rmed = float(np.median(rbs))
    wmed = float(np.median(wrs))
    parts.append(
        f'<line x1="{rx(rmed)}" y1="{right_y0}" x2="{rx(rmed)}" y2="{right_y0 + right_h}" '
        f'stroke="#999" stroke-dasharray="3 3"/>'
    )
    parts.append(
        f'<line x1="{right_x0}" y1="{ry(wmed)}" x2="{right_x0 + right_w}" y2="{ry(wmed)}" '
        f'stroke="#999" stroke-dasharray="3 3"/>'
    )
    for i, a in enumerate(aids):
        x, y = rx(rbs[i]), ry(wrs[i])
        parts.append(
            f'<circle cx="{x}" cy="{y}" r="7" fill="{te_color(tes[i])}" '
            f'stroke="#222" stroke-width="0.6"/>'
        )
        short = plot_labels[i].split(' · ')[0]
        parts.append(
            f'<text x="{x + 9}" y="{y + 3}" font-size="8" fill="#333">{xml_esc(short)}</text>'
        )
    parts.append(
        f'<text x="{right_x0 + right_w/2}" y="{right_y0 + right_h + 22}" text-anchor="middle" '
        f'font-size="10" fill="#444">RB multiplier</text>'
    )
    parts.append(
        f'<text x="{right_x0 - 28}" y="{right_y0 + right_h/2}" text-anchor="middle" '
        f'font-size="10" fill="#444" transform="rotate(-90 {right_x0 - 28} {right_y0 + right_h/2})">'
        f'WR multiplier</text>'
    )
    parts.append('</svg>')
    with open(path, 'w') as f:
        f.write('\n'.join(parts))
        f.write('\n')


def main():
    bases, formats, builds, mode = load_config()
    labels = load_labels()
    overall, arch, year = load_matchups(bases, formats)

    print('=' * 76)
    print(f'REMOVAL HVORP (same-roster leave-one-out, mean-grounded, mode={mode})')
    print(f'data: {DATA}')
    print(f'builds_per_archetype: {builds}')
    print(f'formats: {", ".join(formats)}')
    print('=' * 76)

    pooled = {}
    for basis in bases:
        for format_name in formats:
            key = (basis, format_name)
            if key not in overall:
                continue
            m = regauge(ls_solve(overall[key]))
            pooled[key] = m
            n = sum(v[3] for v in overall[key].values())
            print(f"\n{basis:>5} / {format_name:<8}  pairs={n:,}  " +
                  '  '.join(f"{p} {m[p]:.3f}" if m[p] else f"{p}  n/a" for p in POS4))
        if (basis, 'hwang') in pooled and (basis, 'regular') in pooled:
            h, g = pooled[(basis, 'hwang')], pooled[(basis, 'regular')]
            print(f"{basis:>5} / factor    " +
                  '  '.join(f"{p} {h[p]/g[p]:.3f}" for p in POS4) +
                  '   (Hwang ÷ Regular, removal)')

    arch_mults = {k: regauge(ls_solve(v)) for k, v in arch.items()}
    summary_arch = []
    print()
    print('=' * 76)
    print('PER-ARCHETYPE HWANG (sorted by RB multiplier)')
    print('=' * 76)
    for basis in bases:
        print(f"\n--- basis: {basis} / format: hwang ---")
        aids = sorted({aid for (b, f, aid) in arch_mults if b == basis and f == 'hwang'},
                      key=lambda aid: -(arch_mults[(basis, 'hwang', aid)]['RB'] or 0))
        for aid in aids:
            m = arch_mults[(basis, 'hwang', aid)]
            n = sum(v[3] for v in arch[(basis, 'hwang', aid)].values())
            lab = labels.get(aid, aid)
            print(f"  {lab:<44} n={n:>7,}  " +
                  '  '.join(f"{p} {m[p]:.2f}" if m[p] else f"{p} n/a" for p in POS4))
            if basis == 'comp' or (basis == bases[0] and 'comp' not in bases):
                summary_arch.append({
                    'archetype_id': aid,
                    'label': lab,
                    'short': short_label(lab),
                    'n_pairs': n,
                    'QB': fmt(m['QB']),
                    'RB': fmt(m['RB']),
                    'WR': fmt(m['WR']),
                    'TE': fmt(m['TE']),
                    'rb_minus_wr': fmt((m['RB'] or 0) - (m['WR'] or 0)),
                })

    chart_basis = 'comp' if 'comp' in bases else bases[0]
    aids = sorted({aid for (b, f, aid) in arch_mults if b == chart_basis and f == 'hwang'},
                  key=lambda aid: arch_mults[(chart_basis, 'hwang', aid)]['RB'] or 0)
    plot_labels = [short_label(labels.get(a, a)) for a in aids]
    bname = 'Final KTC' if chart_basis == 'ktc' else 'Competitor-adjusted'
    png = os.path.join(OUT, f'archetype_spectrum_{chart_basis}.png')
    svg = os.path.join(OUT, f'archetype_spectrum_{chart_basis}.svg')
    write_spectrum_svg(svg, aids, plot_labels, arch_mults, chart_basis, bname, builds)
    print(f"\nwrote {svg}")
    if HAS_MPL:
        fig, (ax1, ax2) = plt.subplots(
            1, 2, figsize=(14, 7), gridspec_kw={'width_ratios': [1.35, 1]})
        ypos = np.arange(len(aids))
        for pos in POS4:
            vals = [arch_mults[(chart_basis, 'hwang', a)][pos] for a in aids]
            ax1.scatter(vals, ypos, color=COLORS[pos], s=42, label=pos, zorder=3)
        ax1.axvline(1.0, color='#666666', ls='--', lw=1.2, label='avg = 1.0')
        ax1.set_yticks(ypos)
        ax1.set_yticklabels(plot_labels, fontsize=7.5)
        ax1.set_xlabel('multiplier vs average same-priced removal')
        ax1.set_title('Spectrum by archetype (sorted by RB)', fontsize=10)
        ax1.legend(fontsize=8, loc='lower right')

        rb = np.array([arch_mults[(chart_basis, 'hwang', a)]['RB'] for a in aids])
        wr = np.array([arch_mults[(chart_basis, 'hwang', a)]['WR'] for a in aids])
        te = np.array([arch_mults[(chart_basis, 'hwang', a)]['TE'] for a in aids])
        sc = ax2.scatter(rb, wr, c=te, cmap='viridis', s=110, edgecolor='k', lw=0.5)
        for i, a in enumerate(aids):
            ax2.annotate(short_label(labels.get(a, a)).split(' · ')[0],
                         (rb[i], wr[i]), fontsize=6.5,
                         xytext=(4, 3), textcoords='offset points')
        ax2.axvline(np.median(rb), color='gray', ls=':', lw=1)
        ax2.axhline(np.median(wr), color='gray', ls=':', lw=1)
        ax2.set_xlabel('RB multiplier')
        ax2.set_ylabel('WR multiplier')
        ax2.set_title('RB vs WR (color = TE multiplier)', fontsize=10)
        fig.colorbar(sc, ax=ax2, label='TE multiplier', shrink=0.8)
        fig.suptitle(f'Per-archetype leave-one-out multipliers — Hwang, {bname}, '
                     f'mean-grounded, {builds} builds', fontsize=12)
        fig.tight_layout()
        fig.savefig(png, dpi=140)
        plt.close(fig)
        print(f"wrote {png}")
    else:
        png = svg

    year_mults = {k: regauge(ls_solve(v)) for k, v in year.items()}
    years = sorted({y for (b, f, y) in year_mults if b == chart_basis and f == 'hwang'})
    print()
    print('=' * 76)
    print(f'PER-YEAR HWANG ({chart_basis})')
    print('=' * 76)
    for y in years:
        m = year_mults[(chart_basis, 'hwang', y)]
        print(f"  {y}  " + '  '.join(f"{p} {m[p]:.2f}" for p in POS4))

    format_factors = {}
    for basis in bases:
        if (basis, 'hwang') in pooled and (basis, 'regular') in pooled:
            h, g = pooled[(basis, 'hwang')], pooled[(basis, 'regular')]
            format_factors[basis] = {p: fmt(h[p] / g[p]) for p in POS4}

    summary = {
        'hvorp_mode': mode,
        'builds_per_archetype': builds,
        'chart_basis': chart_basis,
        'pooled': {f'{b}/{format_name}': {p: fmt(pooled[(b, format_name)][p]) for p in POS4}
                   for b, format_name in pooled},
        'format_factor_hwang_over_regular': format_factors,
        'archetypes': sorted(summary_arch, key=lambda r: -(r['RB'] or 0)),
        'years': {y: {p: fmt(year_mults[(chart_basis, 'hwang', y)][p]) for p in POS4}
                  for y in years},
        'png': os.path.relpath(png, ROOT),
        'svg': os.path.relpath(svg, ROOT),
    }
    out_json = os.path.join(DATA, 'summary.json')
    with open(out_json, 'w') as f:
        json.dump(summary, f, indent=2)
        f.write('\n')
    print(f"wrote {out_json}")


if __name__ == '__main__':
    main()
