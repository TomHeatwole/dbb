#!/usr/bin/env python3
"""Fit residual power-law curves from an equilibrium dump and compose them
with the correction that produced it.

The equilibrium dump was simulated on prices v' = v * m0(v). Fitting the
residual curve m1 on that dump gives m1 as a function of v', so the total
correction relative to the original board is

    m_total(v) = m0(v) * m1(v * m0(v))

which for power laws m(v) = c * (v/VREF)^k composes to another power law:

    c_tot = c0^(1 + k1) * c1,   k_tot = k0 + k1 + k0 * k1

Usage:
  compose_equilibrium_params.py EQ_DUMP_DIR PREV_PARAMS_JSON OUT_PARAMS_JSON
"""
import importlib.util
import json
import os
import sys
import types

# The analysis module imports matplotlib at top level, but nothing we call
# here plots. Stub it out so a numpy-only environment works.
if importlib.util.find_spec('matplotlib') is None:
    mpl = types.ModuleType('matplotlib')
    mpl.use = lambda *a, **k: None
    mpl.rcParams = {}
    pyplot = types.ModuleType('matplotlib.pyplot')
    pyplot.rcParams = mpl.rcParams
    mpl.pyplot = pyplot
    sys.modules['matplotlib'] = mpl
    sys.modules['matplotlib.pyplot'] = pyplot

spec = importlib.util.spec_from_file_location(
    'val', os.path.join(os.path.dirname(__file__), 'analyze_hwang_true_sim_validation.py'))
val = importlib.util.module_from_spec(spec)
spec.loader.exec_module(val)

eq_dir, prev_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
prev = json.load(open(prev_path))

dump = val.load_dump(eq_dir)
d = dump[('comp', 'hwang')]

flat = val.regauge(val.ls_solve(val.aggregate_pairs(d['pairs'])))
_, resid = val.fit_curve(d['pairs'])

print('Residual flat multipliers:',
      '  '.join(f"{p} {flat[p]:.3f}" for p in val.POS4))
print('Residual fitted curves:',
      '  '.join(f"{p} c={resid[p][0]:.4f} k={resid[p][1]:+.4f}" for p in val.POS4))

composed = {}
for p in val.POS4:
    c0, k0 = prev[p]['c'], prev[p]['k']
    c1, k1 = resid[p]
    composed[p] = {
        'c': round(c0 ** (1 + k1) * c1, 4),
        'k': round(k0 + k1 + k0 * k1, 4),
    }

print('Composed total curves:',
      '  '.join(f"{p} c={composed[p]['c']} k={composed[p]['k']:+}" for p in val.POS4))

with open(out_path, 'w') as f:
    json.dump(composed, f, indent=2)
print(f'wrote {out_path}')
