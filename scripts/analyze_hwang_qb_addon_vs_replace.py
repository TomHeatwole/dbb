#!/usr/bin/env python3
"""QB-only: add-on vs replace relative to RB/WR/TE. Hwang format."""
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

FMT = 'hwang'
BASES = ['ktc', 'comp']
SKILL = ['RB', 'WR', 'TE']
QB_PAIRS = [('QB', 'RB'), ('QB', 'WR'), ('QB', 'TE')]
VREF = 5000.0
BANDS = [(0, 2000), (2000, 4000), (4000, 6000), (6000, 10000)]
IDX = {'RB': 0, 'WR': 1, 'TE': 2}


def load_matchups(data_dir, scope='overall'):
    rows = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0, 0]))
    extra = defaultdict(list)
    with open(os.path.join(data_dir, 'matchups.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != FMT or r['scope'] != scope:
                continue
            if (r['pos_a'], r['pos_b']) not in QB_PAIRS:
                continue
            key = r['value_basis'] if scope == 'overall' else (r['value_basis'], r['year'])
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
                r['position'], float(r['value']), r['name'], float(r['season_pts'] or 0))
    hv = defaultdict(lambda: defaultdict(float))
    wn = defaultdict(lambda: defaultdict(float))
    with open(os.path.join(data_dir, 'archetype_player_hvorp.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != FMT:
                continue
            avg_w = r['avg_hvorp_weighted']
            if avg_w in ('', 'null'):
                continue
            arch_w = int(r['build_count']) * float(r['avg_base_total']) / 2500.0
            key = (r['year'], r['player_id'])
            hv[r['value_basis']][key] += float(avg_w) * arch_w
            wn[r['value_basis']][key] += arch_w
    pairs = defaultdict(list)
    qb_hv = defaultdict(dict)
    for basis, d in hv.items():
        for key, tot in d.items():
            if key not in cands[basis]:
                continue
            pos, val, name, pts = cands[basis][key]
            if pos == 'QB' and wn[basis][key] > 0:
                qb_hv[basis][key] = {
                    'name': name, 'value': val, 'year': key[0],
                    'pts': pts, 'hvorp': tot / wn[basis][key],
                }
    with open(os.path.join(data_dir, 'pairs.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != FMT:
                continue
            pa, pb = r['pair_key'].split('_vs_')
            if pa != 'QB' or pb not in SKILL:
                continue
            a = cands[r['value_basis']][(r['year'], r['player_id_a'])]
            b = cands[r['value_basis']][(r['year'], r['player_id_b'])]
            ha = hv[r['value_basis']][(r['year'], r['player_id_a'])]
            hb = hv[r['value_basis']][(r['year'], r['player_id_b'])]
            wa = wn[r['value_basis']][(r['year'], r['player_id_a'])]
            wb = wn[r['value_basis']][(r['year'], r['player_id_b'])]
            if wa <= 0 or wb <= 0:
                continue
            pairs[r['value_basis']].append((
                pb, (a[1] + b[1]) / 2, ha / wa, hb / wb, a[1], b[1],
            ))
    return pairs, qb_hv


def qb_grounded(rows):
    """Pin QB=1 from QB vs skill matchups. Returns skill multipliers vs QB."""
    A = np.zeros((3, 3))
    b = np.zeros(3)
    for (pa, pb), (ta, tb, w, n) in rows.items():
        if pa != 'QB' or pb not in IDX or ta <= 0 or tb <= 0 or w <= 0:
            continue
        r = math.log(tb / ta)  # log(skill/QB)
        i = IDX[pb]
        b[i] += w * r
        A[i, i] += w
    try:
        x = np.linalg.solve(A, b)
    except np.linalg.LinAlgError:
        return None
    return {p: math.exp(x[IDX[p]]) for p in SKILL}


def band_direct(pairs, lo, hi):
    agg = defaultdict(lambda: [0.0, 0.0, 0.0, 0])
    for pb, mid, ha, hb, va, vb in pairs:
        if not (lo <= mid < hi):
            continue
        if ha <= 0 or hb <= 0:
            continue
        w = mid / VREF
        a = agg[pb]
        a[0] += w * ha
        a[1] += w * hb
        a[2] += w
        a[3] += 1
    out = {}
    for pb, (ta, tb, w, n) in agg.items():
        if tb <= 0 or n < 8:
            continue
        out[pb] = {'qb_over_skill': ta / tb, 'n': n, 'mean_hvorp_qb': ta / w, 'mean_hvorp_skill': tb / w}
    return out


def on_roster_qb():
    """Share of stored add-on builds where a QB candidate is already on the club."""
    cands = defaultdict(dict)
    with open(os.path.join(ADDON, 'candidates.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != FMT or r['position'] != 'QB':
                continue
            cands[(r['value_basis'], r['year'])][r['player_id']] = float(r['value'])
    # builds: count appearances
    seen_builds = set()
    on = defaultdict(lambda: [0, 0.0, 0])  # (basis, band) → [on, value_sum_on, n_qb_slots]
    tot_builds = defaultdict(int)
    with open(os.path.join(ADDON, 'build_players.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != FMT:
                continue
            bkey = (r['value_basis'], r['year'], r['archetype_id'], r['build_index'])
            if bkey not in seen_builds:
                seen_builds.add(bkey)
                tot_builds[r['value_basis']] += 1
            if r['position'] != 'QB' or r['dropped'] == '1':
                continue
            val = float(r['value'] or 0)
            band = '7k+' if val >= 7000 else '5-7k' if val >= 5000 else '3-5k' if val >= 3000 else '<3k'
            a = on[(r['value_basis'], band)]
            a[0] += 1
            a[1] += val
            a[2] += 1
    # unique QB ids on roster vs candidate pool, by value
    qb_on = defaultdict(set)
    with open(os.path.join(ADDON, 'build_players.csv')) as f:
        for r in csv.DictReader(f):
            if r['format'] != FMT or r['position'] != 'QB' or r['dropped'] == '1':
                continue
            qb_on[(r['value_basis'], r['year'])].add(r['player_id'])
    pool_hit = defaultdict(lambda: [0, 0])
    for (basis, year), pool in cands.items():
        for pid, val in pool.items():
            band = '7k+' if val >= 7000 else '5-7k' if val >= 5000 else '3-5k' if val >= 3000 else '<3k'
            pool_hit[(basis, band)][1] += 1
            if pid in qb_on.get((basis, year), set()):
                pool_hit[(basis, band)][0] += 1
    return tot_builds, on, pool_hit


def main():
    addon_over = load_matchups(ADDON, 'overall')
    repl_over = load_matchups(REPLACE, 'overall')
    addon_year = load_matchups(ADDON, 'year')
    repl_year = load_matchups(REPLACE, 'year')
    addon_pairs, addon_qb = load_pairs(ADDON)
    repl_pairs, repl_qb = load_pairs(REPLACE)
    tot_builds, on_slots, pool_hit = on_roster_qb()

    report = {'bases': {}, 'on_roster': {}, 'player': {}}

    print('QB STUDY  add-on vs replace  (Hwang, 2021-2025)')
    print('Add-on HVORP is leave-one-out when the QB is already on the 26-man base.')
    print()

    print('=== stored add-on builds with a QB on roster (v3b build_players, first 10 builds/arch) ===')
    print(f"  stored builds ktc={tot_builds['ktc']}  comp={tot_builds['comp']}")
    print('  candidate QBs that appear on ≥1 stored build, by KTC band:')
    for basis in BASES:
        print(f'  {basis}:')
        for band in ('<3k', '3-5k', '5-7k', '7k+'):
            hit, n = pool_hit[(basis, band)]
            print(f'    {band:<6} {hit}/{n}  ({hit/n:.1%} of candidate-years)')
        report['on_roster'][basis] = {
            band: {'hit': pool_hit[(basis, band)][0], 'n': pool_hit[(basis, band)][1]}
            for band in ('<3k', '3-5k', '5-7k', '7k+')
        }

    print()
    for basis in BASES:
        print(f'========== {basis} ==========')
        ao, ro = addon_over[basis], repl_over[basis]
        print(f"  {'pair':<8}{'add QB':>10}{'add skill':>11}{'add Q/S':>9}"
              f"{'rep QB':>10}{'rep skill':>11}{'rep Q/S':>9}{'Q/S Δ':>8}")
        pair_out = {}
        for pa, pb in QB_PAIRS:
            ta, tb, wa, na = ao[(pa, pb)]
            tr, tbr, wr, nr = ro[(pa, pb)]
            mq_a, ms_a = ta / wa, tb / wa
            mq_r, ms_r = tr / wr, tbr / wr
            rs_a, rs_r = ta / tb, tr / tbr
            print(f"  {pa}/{pb:<5}{mq_a:>10.1f}{ms_a:>11.1f}{rs_a:>9.3f}"
                  f"{mq_r:>10.1f}{ms_r:>11.1f}{rs_r:>9.3f}{rs_r/rs_a:>8.3f}")
            pair_out[f'{pa}/{pb}'] = {
                'addon_hvorp_qb': round(mq_a, 2),
                'addon_hvorp_skill': round(ms_a, 2),
                'addon_ratio': round(rs_a, 4),
                'replace_hvorp_qb': round(mq_r, 2),
                'replace_hvorp_skill': round(ms_r, 2),
                'replace_ratio': round(rs_r, 4),
                'ratio_factor': round(rs_r / rs_a, 4),
                'qb_hvorp_factor': round(mq_r / mq_a, 4),
                'skill_hvorp_factor': round(ms_r / ms_a, 4),
                'plugs_addon': na,
                'plugs_replace': nr,
            }
        ag, rg = qb_grounded(ao), qb_grounded(ro)
        print('  skill per 1.00 QB (QB-grounded):')
        print(f"  {'pos':<6}{'add-on':>10}{'replace':>10}{'factor':>10}")
        g_out = {}
        for p in SKILL:
            print(f"  {p:<6}{ag[p]:>10.3f}{rg[p]:>10.3f}{rg[p]/ag[p]:>10.3f}")
            g_out[p] = {
                'addon': round(ag[p], 4),
                'replace': round(rg[p], 4),
                'factor': round(rg[p] / ag[p], 4),
            }

        print('  by pair midpoint band (QB HVORP / skill HVORP):')
        print(f"  {'band':<10}{'n_add':>7}{'n_rep':>7}  "
              + '  '.join(f'{p} add/rep' for p in SKILL))
        bands_out = []
        for lo, hi in BANDS:
            ba = band_direct(addon_pairs[basis], lo, hi)
            br = band_direct(repl_pairs[basis], lo, hi)
            label = f'{lo}-{hi if hi < 10000 else "+"}'
            n_a = sum(v['n'] for v in ba.values())
            n_r = sum(v['n'] for v in br.values())
            bits = []
            row = {'band': label, 'n_addon': n_a, 'n_replace': n_r, 'by_pos': {}}
            for p in SKILL:
                if p in ba and p in br:
                    bits.append(f"{ba[p]['qb_over_skill']:.2f}/{br[p]['qb_over_skill']:.2f}")
                    row['by_pos'][p] = {
                        'addon': round(ba[p]['qb_over_skill'], 3),
                        'replace': round(br[p]['qb_over_skill'], 3),
                        'addon_hvorp_qb': round(ba[p]['mean_hvorp_qb'], 1),
                        'replace_hvorp_qb': round(br[p]['mean_hvorp_qb'], 1),
                        'addon_hvorp_skill': round(ba[p]['mean_hvorp_skill'], 1),
                        'replace_hvorp_skill': round(br[p]['mean_hvorp_skill'], 1),
                    }
                else:
                    bits.append('—')
            print(f"  {label:<10}{n_a:>7}{n_r:>7}  " + '  '.join(bits))
            bands_out.append(row)

        # player-level QB HVORP
        keys = sorted(set(addon_qb[basis]) & set(repl_qb[basis]))
        xs, ys, vs = [], [], []
        by_band = defaultdict(lambda: [0.0, 0.0, 0])
        print('  player-level QB HVORP (same QBs, weighted arch avg):')
        print(f"  {'band':<10}{'n':>5}{'add':>8}{'rep':>8}{'rep/add':>9}")
        player_bands = []
        for key in keys:
            a, b = addon_qb[basis][key], repl_qb[basis][key]
            xs.append(a['hvorp'])
            ys.append(b['hvorp'])
            vs.append(a['value'])
            val = a['value']
            band = '7k+' if val >= 7000 else '5-7k' if val >= 5000 else '3-5k' if val >= 3000 else '<3k'
            by_band[band][0] += a['hvorp']
            by_band[band][1] += b['hvorp']
            by_band[band][2] += 1
        for band in ('<3k', '3-5k', '5-7k', '7k+'):
            s = by_band[band]
            if s[2] == 0:
                continue
            print(f"  {band:<10}{s[2]:>5}{s[0]/s[2]:>8.1f}{s[1]/s[2]:>8.1f}{(s[1]/s[2])/(s[0]/s[2]):>9.3f}")
            player_bands.append({
                'band': band, 'n': s[2],
                'addon': round(s[0] / s[2], 2),
                'replace': round(s[1] / s[2], 2),
                'factor': round((s[1] / s[2]) / (s[0] / s[2]), 4),
            })
        corr = float(np.corrcoef(xs, ys)[0, 1]) if len(xs) > 2 else None
        # largest replace/add gaps
        gaps = []
        for key in keys:
            a, b = addon_qb[basis][key], repl_qb[basis][key]
            if a['hvorp'] <= 5:
                continue
            gaps.append((b['hvorp'] / a['hvorp'], a, b))
        gaps.sort(reverse=True)
        print(f'  corr(add, replace) QB HVORP = {corr:.3f}  n={len(keys)}')
        print('  biggest replace/add (studs, add HVORP>5):')
        for f, a, b in gaps[:5]:
            print(f"    {a['year']} {a['name']:<22} ktc={a['value']:.0f}  add={a['hvorp']:.0f}  rep={b['hvorp']:.0f}  {f:.2f}x")
        gaps.sort()
        print('  smallest replace/add:')
        for f, a, b in gaps[:5]:
            print(f"    {a['year']} {a['name']:<22} ktc={a['value']:.0f}  add={a['hvorp']:.0f}  rep={b['hvorp']:.0f}  {f:.2f}x")

        report['bases'][basis] = {
            'pairs': pair_out,
            'skill_per_qb': g_out,
            'bands': bands_out,
            'player_bands': player_bands,
            'player_corr': None if corr is None else round(corr, 4),
            'player_n': len(keys),
        }
        print()

    print('========== by year, QB/WR ratio ==========')
    years = ['2021', '2022', '2023', '2024', '2025']
    year_out = {}
    for basis in BASES:
        print(f'--- {basis} ---')
        print(f"  {'year':<8}{'QB/WR add':>12}{'QB/WR rep':>12}{'factor':>8}{'QB/RB add':>12}{'QB/RB rep':>12}")
        year_out[basis] = []
        for y in years:
            ao = addon_year[(basis, y)]
            ro = repl_year[(basis, y)]
            def ratio(rows, pair):
                ta, tb, w, n = rows[pair]
                return ta / tb
            aw, rw = ratio(ao, ('QB', 'WR')), ratio(ro, ('QB', 'WR'))
            ar, rr = ratio(ao, ('QB', 'RB')), ratio(ro, ('QB', 'RB'))
            print(f"  {y:<8}{aw:>12.3f}{rw:>12.3f}{rw/aw:>8.3f}{ar:>12.3f}{rr:>12.3f}")
            year_out[basis].append({
                'year': y,
                'qb_wr_addon': round(aw, 4), 'qb_wr_replace': round(rw, 4),
                'qb_rb_addon': round(ar, 4), 'qb_rb_replace': round(rr, 4),
            })
    report['years'] = year_out

    path = os.path.join(OUT, 'qb_addon_vs_replace.json')
    with open(path, 'w') as f:
        json.dump(report, f, indent=2)
    print(f'\nWrote {path}')


if __name__ == '__main__':
    main()
