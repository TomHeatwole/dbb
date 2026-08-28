#!/usr/bin/env python3
"""Fit Hwang-adjusted rank coefficients from a combined format-factor study.

Numerator and denominator MUST use the same HVORP mode (add-on or removal).
Mixing a 27th-man add-on dump with a leave-one-out removal dump is refused.

Default (add-on, live rankings):
  Numerator:   Hwang clubs + Hwang scoring          (v3b, format=hwang)
  Denominator: Underdog BBM clubs + UD lineup/PPR
               + TE premium 0.5                     (bbm_50_tep, format=regular)

Removal same-club (spectrum / format-factor check):
  python scripts/fit_hwang_format_factor_coeffs.py \\
    --hwang-dir example_data/hwang_true_sim_removal \\
    --ud-dir example_data/hwang_true_sim_removal \\
    --ud-format regular

RB and WR come from the RB-vs-WR pair curve only when pairs.csv exists
(add-on board pairs). Removal dumps have no board-pair CSV; then only
flat Hwang÷Regular factors from matchups.csv are printed. TE is then fit
against that gauge when pairs exist. QB is not produced here — it stays
1.0 (unadjusted; no valid 1QB Underdog denominator).

Usage:
  python scripts/fit_hwang_format_factor_coeffs.py
"""
import argparse
import csv
import math
import os
import sys

import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DEFAULT_HWANG = os.path.join(ROOT, 'example_data', 'hwang_true_sim_200_v3b')
DEFAULT_UD = os.path.join(ROOT, 'example_data', 'hwang_true_sim_bbm_50_tep')
VREF = 5000.0
BASES = ['ktc', 'comp']


def load_hvorp_mode(data_dir):
    path = os.path.join(data_dir, 'config.csv')
    if not os.path.exists(path):
        return 'addon'
    modes = set()
    with open(path) as f:
        for r in csv.DictReader(f):
            modes.add(r.get('hvorp_mode') or 'addon')
    if not modes:
        return 'addon'
    if len(modes) > 1:
        raise SystemExit(f'{data_dir} mixes HVORP modes {sorted(modes)}')
    return next(iter(modes))


def pairs_csv_usable(data_dir):
    path = os.path.join(data_dir, 'pairs.csv')
    if not os.path.exists(path):
        return False
    with open(path) as f:
        f.readline()
        rest = f.readline()
    return bool(rest)


def load_skill_pairs(data_dir, fmt):
    cands = {}
    with open(os.path.join(data_dir, 'candidates.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != fmt:
                continue
            cands.setdefault(r['value_basis'], {})[(r['year'], r['player_id'])] = (
                r['position'], float(r['value']))
    hv = {}
    with open(os.path.join(data_dir, 'archetype_player_hvorp.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != fmt:
                continue
            avg_w = r['avg_hvorp_weighted']
            if avg_w in ('', 'null'):
                continue
            arch_w = int(r['build_count']) * float(r['avg_base_total']) / 2500.0
            key = (r['year'], r['player_id'])
            hv.setdefault(r['value_basis'], {})
            hv[r['value_basis']][key] = hv[r['value_basis']].get(key, 0.0) + float(avg_w) * arch_w
    out = {b: [] for b in BASES}
    with open(os.path.join(data_dir, 'pairs.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != fmt:
                continue
            pa, pb = r['pair_key'].split('_vs_')
            if pa not in ('RB', 'WR', 'TE') or pb not in ('RB', 'WR', 'TE'):
                continue
            a = cands[r['value_basis']][(r['year'], r['player_id_a'])]
            b = cands[r['value_basis']][(r['year'], r['player_id_b'])]
            ha = hv[r['value_basis']].get((r['year'], r['player_id_a']), 0.0)
            hb = hv[r['value_basis']].get((r['year'], r['player_id_b']), 0.0)
            out[r['value_basis']].append((pa, pb, (a[1] + b[1]) / 2, ha, hb))
    return out


def load_overall_direct(data_dir, fmt):
    rows = {b: {} for b in BASES}
    with open(os.path.join(data_dir, 'matchups.csv')) as f:
        for r in csv.DictReader(f):
            if r['scope'] != 'overall' or r['format'] != fmt:
                continue
            pa, pb = r['pos_a'], r['pos_b']
            if pa not in ('RB', 'WR', 'TE') or pb not in ('RB', 'WR', 'TE'):
                continue
            rec = rows[r['value_basis']].setdefault((pa, pb), [0.0, 0.0, 0.0])
            rec[0] += float(r['total_hvorp_a'])
            rec[1] += float(r['total_hvorp_b'])
            rec[2] += float(r['weight_sum'])
    return rows


def lstsq(xs, ys, ws):
    X = np.column_stack([np.ones(len(xs)), xs])
    y = np.array(ys)
    sw = np.sqrt(np.array(ws))
    beta, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
    return float(beta[0]), float(beta[1])


def fit_rb_wr(pairs):
    xs, ys, ws = [], [], []
    for pa, pb, mid, ha, hb in pairs:
        if {pa, pb} != {'RB', 'WR'} or ha <= 0 or hb <= 0 or mid <= 200:
            continue
        if pa == 'RB' and pb == 'WR':
            y = math.log(hb / ha)
        else:
            y = math.log(ha / hb)
        xs.append(math.log(mid / VREF))
        ys.append(y)
        ws.append(mid / VREF)
    a, b = lstsq(xs, ys, ws)
    return {
        'RB': (math.exp(-a / 2), -b / 2),
        'WR': (math.exp(a / 2), b / 2),
    }


def fit_te(pairs, rbwr):
    xs, ys, ws = [], [], []
    for pa, pb, mid, ha, hb in pairs:
        if 'TE' not in (pa, pb) or ha <= 0 or hb <= 0 or mid <= 200:
            continue
        other = pb if pa == 'TE' else pa
        if other not in rbwr:
            continue
        h_te = ha if pa == 'TE' else hb
        h_ot = hb if pa == 'TE' else ha
        c, k = rbwr[other]
        m_ot = c * (mid / VREF) ** k
        xs.append(math.log(mid / VREF))
        ys.append(math.log(h_te / h_ot) + math.log(m_ot))
        ws.append(mid / VREF)
    a, b = lstsq(xs, ys, ws)
    return math.exp(a), b


def round_coeff(c, k, flat):
    return {
        'c': round(c, 3),
        'k': round(k, 3),
        'flat': round(flat, 2),
    }


def eval_m(ck, v):
    c, k = ck
    return c * (v / VREF) ** k


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--hwang-dir', default=DEFAULT_HWANG)
    parser.add_argument('--ud-dir', default=DEFAULT_UD)
    parser.add_argument('--hwang-format', default='hwang')
    parser.add_argument('--ud-format', default='regular')
    args = parser.parse_args()
    hwang_dir = os.path.abspath(args.hwang_dir)
    ud_dir = os.path.abspath(args.ud_dir)

    h_mode = load_hvorp_mode(hwang_dir)
    u_mode = load_hvorp_mode(ud_dir)
    if h_mode != u_mode:
        raise SystemExit(
            f'Refusing to mix HVORP modes: numerator {hwang_dir} is {h_mode}, '
            f'denominator {ud_dir} is {u_mode}. Format factor is Hwang ÷ baseline '
            f'from the SAME experiment (add-on vs add-on, or removal vs removal).'
        )

    have_pairs = pairs_csv_usable(hwang_dir) and pairs_csv_usable(ud_dir)
    h_pairs = load_skill_pairs(hwang_dir, args.hwang_format) if have_pairs else None
    u_pairs = load_skill_pairs(ud_dir, args.ud_format) if have_pairs else None
    h_over = load_overall_direct(hwang_dir, args.hwang_format)
    u_over = load_overall_direct(ud_dir, args.ud_format)

    print('Combined format-factor coefficients')
    print(f'HVORP mode: {h_mode}')
    print(f'numerator:   {hwang_dir} format={args.hwang_format}')
    print(f'denominator: {ud_dir} format={args.ud_format}')
    if have_pairs:
        print('RB/WR from pair curve, geo-mean 1; TE vs that gauge')
    else:
        print('No board-pair CSV (typical of removal dumps); flats from matchups.csv only')
    print()

    out = {}
    for basis in BASES:
        hr = h_over[basis][('RB', 'WR')]
        ur = u_over[basis][('RB', 'WR')]
        rbw_h, rbw_u = hr[0] / hr[1], ur[0] / ur[1]
        rbw_f = rbw_h / rbw_u
        flat_rb = math.sqrt(rbw_f)
        flat_wr = 1 / flat_rb

        ht = h_over[basis][('WR', 'TE')]
        ut = u_over[basis][('WR', 'TE')]
        wrte_h, wrte_u = ht[0] / ht[1], ut[0] / ut[1]
        # TE vs WR, then vs WR's geo-split level
        flat_te = flat_wr * (wrte_u / wrte_h)
        flats = {'RB': flat_rb, 'WR': flat_wr, 'TE': flat_te}

        print(f'=== {basis} ===')
        print(f'  overall RB/WR factor {rbw_f:.3f}  →  RB {flat_rb:.3f}  WR {flat_wr:.3f}  TE {flat_te:.3f}')

        if not have_pairs:
            out[basis] = {pos: round_coeff(flats[pos], 0.0, flats[pos])
                          for pos in ('RB', 'WR', 'TE')}
            for pos in ('RB', 'WR', 'TE'):
                r = out[basis][pos]
                print(f"  {pos:<4}flat {r['flat']}")
            print()
            continue

        h_rbwr = fit_rb_wr(h_pairs[basis])
        u_rbwr = fit_rb_wr(u_pairs[basis])
        h_te = fit_te(h_pairs[basis], h_rbwr)
        u_te = fit_te(u_pairs[basis], u_rbwr)

        factor = {}
        for pos in ('RB', 'WR'):
            hc, hk = h_rbwr[pos]
            uc, uk = u_rbwr[pos]
            factor[pos] = (hc / uc, hk - uk)
        factor['TE'] = (h_te[0] / u_te[0], h_te[1] - u_te[1])

        rounded = {pos: round_coeff(factor[pos][0], factor[pos][1], flats[pos])
                   for pos in ('RB', 'WR', 'TE')}
        out[basis] = rounded

        print(f"  {'pos':<4}{'Hwang':>16}{'baseline':>16}{'factor':>16}  rounded")
        for pos in ('RB', 'WR'):
            hc, hk = h_rbwr[pos]
            uc, uk = u_rbwr[pos]
            fc, fk = factor[pos]
            r = rounded[pos]
            print(f'  {pos:<4}{hc:7.3f}^{hk:+.3f}  {uc:7.3f}^{uk:+.3f}  {fc:7.3f}^{fk:+.3f}  '
                  f"{r['c']}^{r['k']:+.3f}  flat {r['flat']}")
        hc, hk = h_te
        uc, uk = u_te
        fc, fk = factor['TE']
        r = rounded['TE']
        print(f'  {"TE":<4}{hc:7.3f}^{hk:+.3f}  {uc:7.3f}^{uk:+.3f}  {fc:7.3f}^{fk:+.3f}  '
              f"{r['c']}^{r['k']:+.3f}  flat {r['flat']}")
        print('  factor @1k/3k/5k/8k:')
        for pos in ('RB', 'WR', 'TE'):
            vals = '  '.join(f'{eval_m(factor[pos], v):.3f}' for v in (1000, 3000, 5000, 8000))
            print(f'    {pos}  {vals}')
        print()

    print('JS snippet (QB filled in by caller):')
    print(f'  # HVORP mode: {h_mode}')
    print('  true: {  # ktc basis')
    for pos in ('RB', 'WR', 'TE'):
        r = out['ktc'][pos]
        print(f"    {pos}: {{ c: {r['c']}, k: {r['k']}, flat: {r['flat']} }},")
    print('  trueComp: {  # comp basis')
    for pos in ('RB', 'WR', 'TE'):
        r = out['comp'][pos]
        print(f"    {pos}: {{ c: {r['c']}, k: {r['k']}, flat: {r['flat']} }},")
    return out


if __name__ == '__main__':
    main()
