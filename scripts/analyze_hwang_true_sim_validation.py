#!/usr/bin/env python3
"""Validation suite for the Hwang True Simulator v3 model.

Runs against a full-grid dump (see run_hwang_true_sim_example.mjs):

  1. Leave-one-year-out (LOYO) validation: refit flat multipliers and power-law
     curves on 4 seasons, predict pair-level log HVORP ratios in the held-out
     season, and compare against the "market is right" null (predict 0).
  2. Archetype bootstrap: resample the 19 archetypes with replacement and
     recompute baseline multipliers, format factors, and curve params to get
     95% confidence bands.
  3. Seed robustness: point estimates across independent dumps (different
     roster-build seeds).
  4. Equilibrium check: a dump produced with curve-corrected competitor values
     should show ~flat multipliers (~1.0 across positions).

Usage:
  analyze_hwang_true_sim_validation.py MAIN_DIR [--seeds NAME=DIR ...]
      [--eq EQ_DIR] [--boot N]
"""
import argparse
import csv
import math
import os
from collections import defaultdict

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

POS3 = ['RB', 'WR', 'TE']
POS4 = ['QB', 'RB', 'WR', 'TE']
IDX = {'RB': 0, 'WR': 1, 'TE': 2}
VREF = 5000.0
COLORS = {'QB': '#8e44ad', 'RB': '#d1495b', 'WR': '#1f6feb', 'TE': '#2e933c'}

plt.rcParams.update({
    'figure.facecolor': 'white', 'axes.grid': True, 'grid.alpha': 0.3,
    'font.size': 10,
})


def regauge(x):
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


def load_dump(data_dir):
    """Load a dump directory into pair-level and archetype-level structures.

    Returns dict keyed by (basis, fmt):
      pairs:      list of (year, pa, pb, mid_value, ha, hb)
      hv_contrib: {(year,pid): {arch_id: weighted contribution}}
      pair_meta:  list of (year, pa, pb, mid, pidA, pidB)  (hv resolved lazily)
      arch_aggs:  {arch_id: {(pa,pb): [ta, tb, w]}}  (matchups.csv, archetype scope,
                  summed over years)
    """
    cands = defaultdict(dict)
    with open(os.path.join(data_dir, 'candidates.csv')) as f:
        for r in csv.DictReader(f):
            cands[(r['value_basis'], r['format'])][(r['year'], r['player_id'])] = (
                r['position'], float(r['value']), r['name'])

    hv_contrib = defaultdict(lambda: defaultdict(dict))
    with open(os.path.join(data_dir, 'archetype_player_hvorp.csv')) as f:
        for r in csv.DictReader(f):
            avg_w = r['avg_hvorp_weighted']
            if avg_w in ('', 'null'):
                continue
            arch_w = int(r['build_count']) * float(r['avg_base_total']) / 2500.0
            hv_contrib[(r['value_basis'], r['format'])][(r['year'], r['player_id'])][
                r['archetype_id']] = float(avg_w) * arch_w

    pair_meta = defaultdict(list)
    with open(os.path.join(data_dir, 'pairs.csv')) as f:
        for r in csv.DictReader(f):
            key = (r['value_basis'], r['format'])
            c = cands[key]
            a = c[(r['year'], r['player_id_a'])]
            b = c[(r['year'], r['player_id_b'])]
            pa, pb = r['pair_key'].split('_vs_')
            pair_meta[key].append((r['year'], pa, pb, (a[1] + b[1]) / 2,
                                   (r['year'], r['player_id_a']),
                                   (r['year'], r['player_id_b'])))

    arch_aggs = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0])))
    with open(os.path.join(data_dir, 'matchups.csv')) as f:
        for r in csv.DictReader(f):
            if r['scope'] != 'archetype':
                continue
            key = (r['value_basis'], r['format'])
            a = arch_aggs[key][r['archetype_id']][(r['pos_a'], r['pos_b'])]
            a[0] += float(r['total_hvorp_a'])
            a[1] += float(r['total_hvorp_b'])
            a[2] += float(r['weight_sum'])

    out = {}
    for key, metas in pair_meta.items():
        hv = {k: sum(d.values()) for k, d in hv_contrib[key].items()}
        pairs = [(y, pa, pb, mid, hv.get(ka, 0.0), hv.get(kb, 0.0))
                 for (y, pa, pb, mid, ka, kb) in metas]
        out[key] = {
            'pairs': pairs,
            'pair_meta': metas,
            'hv_contrib': hv_contrib[key],
            'arch_aggs': arch_aggs[key],
            'cands': cands[key],
            'hv': hv,
        }
    return out


def aggregate_pairs(pairs, years=None):
    agg = defaultdict(lambda: [0.0, 0.0, 0.0])
    for y, pa, pb, mid, ha, hb in pairs:
        if years is not None and y not in years:
            continue
        wv = mid / VREF
        a = agg[(pa, pb)]
        a[0] += wv * ha
        a[1] += wv * hb
        a[2] += wv
    return agg


def pair_rows(pairs, years=None):
    """Design rows for the power-law fit: (X row, y, w)."""
    rows, ys, ws = [], [], []
    for y, pa, pb, mid, ha, hb in pairs:
        if years is not None and y not in years:
            continue
        if ha <= 0 or hb <= 0 or mid <= 200:
            continue
        xv = math.log(mid / VREF)
        row = np.zeros(6)
        if pb in IDX:
            row[2 * IDX[pb]] += 1
            row[2 * IDX[pb] + 1] += xv
        if pa in IDX:
            row[2 * IDX[pa]] -= 1
            row[2 * IDX[pa] + 1] -= xv
        rows.append(row)
        ys.append(math.log(hb / ha))
        ws.append(mid / VREF)
    return np.array(rows), np.array(ys), np.array(ws)


def fit_curve(pairs, years=None):
    """Weighted power-law fit -> (beta6 in QB gauge, mean-gauge {pos: (c,k)})."""
    X, y, w = pair_rows(pairs, years)
    if len(y) == 0:
        return None, None
    sw = np.sqrt(w)
    beta, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
    qb_gauge = {'QB': (0.0, 0.0)}
    for pos in POS3:
        qb_gauge[pos] = (beta[2 * IDX[pos]], beta[2 * IDX[pos] + 1])
    a_mean = sum(p[0] for p in qb_gauge.values()) / 4
    b_mean = sum(p[1] for p in qb_gauge.values()) / 4
    params = {pos: (math.exp(a - a_mean), b - b_mean)
              for pos, (a, b) in qb_gauge.items()}
    return beta, params


def flat_logs(pairs, years=None):
    """QB-gauge flat log-multipliers from pair aggregates (dict pos->log)."""
    x = ls_solve(aggregate_pairs(pairs, years))
    if x is None:
        return None
    return {'QB': 0.0, 'RB': x[0], 'WR': x[1], 'TE': x[2]}


# ── 1. Leave-one-year-out validation ────────────────────────────────────────

def loyo(dump, out_dir):
    print('=' * 76)
    print('1. LEAVE-ONE-YEAR-OUT VALIDATION (Hwang format)')
    print('   skill = 1 - wMSE(model) / wMSE(null "market prices are right")')
    print('=' * 76)
    results = {}
    for (basis, fmt), d in sorted(dump.items()):
        if fmt != 'hwang':
            continue
        pairs = d['pairs']
        years = sorted({p[0] for p in pairs})
        print(f"\n--- basis: {basis} ---")
        print(f"{'held-out':<10}{'pairs':>7}{'null wRMSE':>12}{'flat wRMSE':>12}"
              f"{'curve wRMSE':>13}{'skill flat':>12}{'skill curve':>13}")
        rows = []
        mult_folds = []
        pooled = {'n': 0, 'null': 0.0, 'flat': 0.0, 'curve': 0.0, 'w': 0.0}
        for hold in years:
            train = [y for y in years if y != hold]
            logs = flat_logs(pairs, set(train))
            hold_logs = flat_logs(pairs, {hold})
            if logs is not None and hold_logs is not None:
                mult_folds.append((hold,
                                   regauge([logs[p] for p in POS3]),
                                   regauge([hold_logs[p] for p in POS3])))
            beta, _ = fit_curve(pairs, set(train))
            X, y, w = pair_rows(pairs, {hold})
            if len(y) == 0 or logs is None or beta is None:
                continue
            yhat_curve = X @ beta
            # Flat prediction: log m_pb - log m_pa. The intercept columns of X
            # already encode +1/-1 position membership (gauge cancels).
            yhat_flat = X[:, [0, 2, 4]] @ np.array([logs['RB'], logs['WR'], logs['TE']])
            mse_null = np.average(y ** 2, weights=w)
            mse_flat = np.average((y - yhat_flat) ** 2, weights=w)
            mse_curve = np.average((y - yhat_curve) ** 2, weights=w)
            sk_f = 1 - mse_flat / mse_null
            sk_c = 1 - mse_curve / mse_null
            rows.append((hold, len(y), sk_f, sk_c))
            wsum = w.sum()
            pooled['n'] += len(y)
            pooled['null'] += mse_null * wsum
            pooled['flat'] += mse_flat * wsum
            pooled['curve'] += mse_curve * wsum
            pooled['w'] += wsum
            print(f"{hold:<10}{len(y):>7}{math.sqrt(mse_null):>12.4f}"
                  f"{math.sqrt(mse_flat):>12.4f}{math.sqrt(mse_curve):>13.4f}"
                  f"{sk_f:>12.3f}{sk_c:>13.3f}")
        pn = pooled['null'] / pooled['w']
        pf = pooled['flat'] / pooled['w']
        pc = pooled['curve'] / pooled['w']
        print(f"{'POOLED':<10}{pooled['n']:>7}{math.sqrt(pn):>12.4f}"
              f"{math.sqrt(pf):>12.4f}{math.sqrt(pc):>13.4f}"
              f"{1 - pf / pn:>12.3f}{1 - pc / pn:>13.3f}")
        results[basis] = (rows, (1 - pf / pn, 1 - pc / pn))

        # Multiplier-level view: does the 4-year fit anticipate the held-out
        # year's own multipliers?
        print('\n  4-year-trained multiplier -> held-out year realized (trained/realized):')
        errs = {p: [] for p in POS4}
        for hold, m_train, m_hold in mult_folds:
            line = f"  {hold:<8}"
            for p in POS4:
                line += f"  {p} {m_train[p]:.2f}/{m_hold[p]:.2f}"
                errs[p].append(abs(math.log(m_train[p] / m_hold[p])))
            print(line)
        print('  mean |log error|: ' + '  '.join(
            f"{p} {sum(errs[p]) / len(errs[p]):.3f}" for p in POS4))

    fig, ax = plt.subplots(figsize=(9, 4.5))
    width = 0.2
    bases = sorted(results)
    all_years = sorted({r[0] for b in bases for r in results[b][0]})
    xs = np.arange(len(all_years))
    for bi, basis in enumerate(bases):
        by_year = {r[0]: r for r in results[basis][0]}
        sf = [by_year[y][2] if y in by_year else np.nan for y in all_years]
        sc = [by_year[y][3] if y in by_year else np.nan for y in all_years]
        ax.bar(xs + (2 * bi - 1.5) * width, sf, width, alpha=0.55,
               label=f'{basis} flat', color='#1f6feb' if basis == 'ktc' else '#d1495b')
        ax.bar(xs + (2 * bi - 0.5) * width, sc, width, alpha=0.95,
               label=f'{basis} curve', color='#1f6feb' if basis == 'ktc' else '#d1495b',
               hatch='//')
    ax.axhline(0, color='#444', lw=1)
    ax.set_xticks(xs)
    ax.set_xticklabels(all_years)
    ax.set_ylabel('out-of-sample skill vs market-null')
    ax.set_title('LOYO validation — pair-level HVORP ratio prediction (Hwang format)')
    ax.legend(fontsize=8)
    fig.tight_layout()
    path = os.path.join(out_dir, 'validation_loyo.png')
    fig.savefig(path, dpi=140)
    plt.close(fig)
    print(f"\nwrote {path}")
    return results


# ── 2. Archetype bootstrap ──────────────────────────────────────────────────

def bootstrap(dump, out_dir, n_boot):
    print()
    print('=' * 76)
    print(f'2. ARCHETYPE BOOTSTRAP ({n_boot} resamples of the 19 archetypes)')
    print('=' * 76)
    rng = np.random.default_rng(7)
    bases = sorted({b for (b, f) in dump if f == 'hwang'})
    ci = {}
    for basis in bases:
        archs = sorted(dump[(basis, 'hwang')]['arch_aggs'].keys())
        n_arch = len(archs)
        samples = {'hwang': [], 'regular': [], 'factor': [], 'curve': []}

        # Pre-index hv contributions per archetype for the curve bootstrap.
        metas = dump[(basis, 'hwang')]['pair_meta']
        hvc = dump[(basis, 'hwang')]['hv_contrib']
        keys = sorted({k for m in metas for k in (m[4], m[5])})
        key_idx = {k: i for i, k in enumerate(keys)}
        contrib = np.zeros((len(keys), n_arch))
        arch_idx = {a: i for i, a in enumerate(archs)}
        for k, d in hvc.items():
            if k not in key_idx:
                continue
            for aid, v in d.items():
                contrib[key_idx[k], arch_idx[aid]] += v

        for _ in range(n_boot):
            mult = np.bincount(rng.integers(0, n_arch, n_arch), minlength=n_arch)
            # Flat multipliers from archetype matchup aggregates.
            ms = {}
            for fmt in ('hwang', 'regular'):
                agg = defaultdict(lambda: [0.0, 0.0, 0.0])
                aggs = dump[(basis, fmt)]['arch_aggs']
                for a, m in zip(archs, mult):
                    if m == 0 or a not in aggs:
                        continue
                    for pk, vals in aggs[a].items():
                        t = agg[pk]
                        t[0] += m * vals[0]
                        t[1] += m * vals[1]
                        t[2] += m * vals[2]
                ms[fmt] = regauge(ls_solve(agg))
            if any(v is None for v in ms['hwang'].values()) or \
               any(v is None for v in ms['regular'].values()):
                continue
            samples['hwang'].append([ms['hwang'][p] for p in POS4])
            samples['regular'].append([ms['regular'][p] for p in POS4])
            samples['factor'].append(
                [ms['hwang'][p] / ms['regular'][p] for p in POS4])
            # Curve params with resampled hv pooling (pair design fixed).
            hv_s = contrib @ mult
            pairs_s = [(y, pa, pb, mid, hv_s[key_idx[ka]], hv_s[key_idx[kb]])
                       for (y, pa, pb, mid, ka, kb) in metas]
            _, params = fit_curve(pairs_s)
            if params is not None:
                samples['curve'].append(
                    [x for p in POS4 for x in params[p]])

        ci[basis] = {}
        for name in ('hwang', 'regular', 'factor'):
            arr = np.array(samples[name])
            ci[basis][name] = {
                p: (np.percentile(arr[:, i], 2.5), np.percentile(arr[:, i], 50),
                    np.percentile(arr[:, i], 97.5))
                for i, p in enumerate(POS4)
            }
        arr = np.array(samples['curve'])
        ci[basis]['curve'] = {
            p: ((np.percentile(arr[:, 2 * i], 2.5), np.percentile(arr[:, 2 * i], 97.5)),
                (np.percentile(arr[:, 2 * i + 1], 2.5), np.percentile(arr[:, 2 * i + 1], 97.5)))
            for i, p in enumerate(POS4)
        }

        print(f"\n--- basis: {basis} (median [2.5%, 97.5%]) ---")
        for name, label in (('hwang', 'Hwang mult'), ('factor', 'format factor')):
            line = f"  {label:<14}"
            for p in POS4:
                lo, med, hi = ci[basis][name][p]
                line += f"  {p} {med:.2f} [{lo:.2f},{hi:.2f}]"
            print(line)
        print('  curve params  ' + '  '.join(
            f"{p} c[{ci[basis]['curve'][p][0][0]:.2f},{ci[basis]['curve'][p][0][1]:.2f}]"
            f" k[{ci[basis]['curve'][p][1][0]:+.2f},{ci[basis]['curve'][p][1][1]:+.2f}]"
            for p in POS4))

    fig, axes = plt.subplots(1, 2, figsize=(11, 4.6), sharey=True)
    for ax, name, title in zip(axes, ('hwang', 'factor'),
                               ['Hwang multiplier (mean-grounded)',
                                'Format factor (Hwang ÷ Regular)']):
        for bi, basis in enumerate(bases):
            xs = np.arange(len(POS4)) + (bi - 0.5) * 0.22
            meds = [ci[basis][name][p][1] for p in POS4]
            los = [ci[basis][name][p][1] - ci[basis][name][p][0] for p in POS4]
            his = [ci[basis][name][p][2] - ci[basis][name][p][1] for p in POS4]
            ax.errorbar(xs, meds, yerr=[los, his], fmt='o', capsize=4,
                        color='#1f6feb' if basis == 'ktc' else '#d1495b',
                        label=basis)
        ax.axhline(1.0, color='#666', ls='--', lw=1)
        ax.set_xticks(np.arange(len(POS4)))
        ax.set_xticklabels(POS4)
        ax.set_title(title, fontsize=10)
    axes[0].legend()
    fig.suptitle('Archetype bootstrap 95% CIs', fontsize=12)
    fig.tight_layout()
    path = os.path.join(out_dir, 'validation_bootstrap_ci.png')
    fig.savefig(path, dpi=140)
    plt.close(fig)
    print(f"\nwrote {path}")
    return ci


# ── 3. Seed robustness ──────────────────────────────────────────────────────

def seed_comparison(main_dir, seed_dirs):
    print()
    print('=' * 76)
    print('3. SEED ROBUSTNESS (independent roster-build randomness)')
    print('=' * 76)
    all_dirs = [('seed1', main_dir)] + seed_dirs
    for basis in ('ktc', 'comp'):
        print(f"\n--- basis: {basis} ---")
        print(f"{'run':<8}" + ''.join(f"  {p} mult/factor/k" for p in POS4))
        for name, d in all_dirs:
            dump = load_dump(d)
            mh = regauge(ls_solve(aggregate_pairs(dump[(basis, 'hwang')]['pairs'])))
            mr = regauge(ls_solve(aggregate_pairs(dump[(basis, 'regular')]['pairs'])))
            _, params = fit_curve(dump[(basis, 'hwang')]['pairs'])
            line = f"{name:<8}"
            for p in POS4:
                line += (f"  {mh[p]:.2f}/{mh[p] / mr[p]:.2f}/{params[p][1]:+.2f}   ")
            print(line)


# ── 4. Equilibrium check ────────────────────────────────────────────────────

def equilibrium(eq_dir):
    print()
    print('=' * 76)
    print('4. EQUILIBRIUM CHECK (corrected comp values fed back in)')
    print('   If the correction is right, multipliers should be ~1.0 across positions.')
    print('=' * 76)
    dump = load_dump(eq_dir)
    for (basis, fmt), d in sorted(dump.items()):
        m = regauge(ls_solve(aggregate_pairs(d['pairs'])))
        _, params = fit_curve(d['pairs'])
        print(f"\n{basis}-corrected / {fmt}")
        print('  flat: ' + '  '.join(f"{p} {m[p]:.3f}" for p in POS4))
        print('  curve: ' + '  '.join(
            f"{p} c={params[p][0]:.2f} k={params[p][1]:+.2f}" for p in POS4))
        bands = [(0, 2000), (2000, 4000), (4000, 6000), (6000, 10 ** 9)]
        for lo, hi in bands:
            sub = [p for p in d['pairs'] if lo <= p[3] < hi]
            if len(sub) < 30:
                continue
            mb = regauge(ls_solve(aggregate_pairs(sub)))
            label = f"{lo // 1000}k-{hi // 1000}k" if hi < 10 ** 9 else f"{lo // 1000}k+"
            print(f"  {label:<8} " + '  '.join(f"{p} {mb[p]:.3f}" for p in POS4)
                  + f"   ({len(sub)} pairs)")


# ── 5. Within-position residuals ────────────────────────────────────────────

def within_position_residuals(dump, basis='comp', fmt='hwang', top=10):
    print()
    print('=' * 76)
    print(f'5. WITHIN-POSITION RESIDUALS ({basis} basis, {fmt} format)')
    print('   realized weighted HVORP vs position value curve (log-quadratic +')
    print('   year effects). ratio > 1: player beat his corrected price tier.')
    print('=' * 76)
    d = dump[(basis, fmt)]
    years = sorted({y for (y, _) in d['cands']})
    for pos in POS4:
        rows, ys, ws, names = [], [], [], []
        for (year, pid), (p, v, name) in d['cands'].items():
            if p != pos or v <= 200:
                continue
            h = d['hv'].get((year, pid), 0.0)
            if h <= 0:
                continue
            x = math.log(v / VREF)
            row = [1.0, x, x * x] + [1.0 if year == yy else 0.0 for yy in years[1:]]
            rows.append(row)
            ys.append(math.log(h))
            ws.append(v / VREF)
            names.append((name, year))
        X = np.array(rows)
        y = np.array(ys)
        w = np.array(ws)
        sw = np.sqrt(w)
        beta, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
        resid = y - X @ beta
        by_name = defaultdict(list)
        for (name, year), r, wt in zip(names, resid, w):
            by_name[name].append((r, wt, year))
        agg = []
        for name, lst in by_name.items():
            wsum = sum(t[1] for t in lst)
            agg.append((sum(t[0] * t[1] for t in lst) / wsum, len(lst), wsum, name))
        # Only players with meaningful value weight to avoid tail-dart noise.
        agg = [a for a in agg if a[2] >= 0.3]
        agg.sort(reverse=True)
        print(f"\n--- {pos} (n player-seasons {len(names)}) ---")
        print('  beat the curve: ' + ', '.join(
            f"{name} ×{math.exp(r):.2f}({n}y)" for r, n, _, name in agg[:top]))
        print('  under the curve: ' + ', '.join(
            f"{name} ×{math.exp(r):.2f}({n}y)" for r, n, _, name in reversed(agg[-top:])))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('main_dir')
    ap.add_argument('--seeds', nargs='*', default=[],
                    help='NAME=DIR entries for extra seed dumps')
    ap.add_argument('--eq', default=None, help='equilibrium dump dir')
    ap.add_argument('--boot', type=int, default=500)
    args = ap.parse_args()

    out_dir = os.path.join(args.main_dir, 'analysis')
    os.makedirs(out_dir, exist_ok=True)

    dump = load_dump(args.main_dir)
    loyo(dump, out_dir)
    bootstrap(dump, out_dir, args.boot)
    within_position_residuals(dump)
    if args.seeds:
        seed_dirs = [tuple(s.split('=', 1)) for s in args.seeds]
        seed_comparison(args.main_dir, seed_dirs)
    if args.eq:
        equilibrium(args.eq)


if __name__ == '__main__':
    main()
