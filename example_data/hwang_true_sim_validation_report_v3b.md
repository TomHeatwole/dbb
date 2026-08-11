# Hwang True Simulator — Validation Report (v3b)

**Data:** `example_data/hwang_true_sim_200_v3b/` — 200 builds × 19 archetypes ×
5 seasons (2021–2025), both value bases (Final KTC, competitor-adjusted) × both
formats (Hwang, Regular), mean-grounded, value- and points-weighted. Archetypes
include the corrected 2026 boards (Eat It While She Sleeper post-trade).
Analysis scripts: `scripts/analyze_hwang_true_sim_v3.py`,
`scripts/analyze_hwang_true_sim_validation.py`,
`scripts/run_hwang_true_sim_equilibrium.mjs`.

**v3b baselines** (essentially unchanged from v3 — the trade moved nothing
by more than 0.01):

| basis / view | QB | RB | WR | TE |
|---|---|---|---|---|
| ktc / Hwang | 0.97 | 1.30 | 0.85 | 0.94 |
| ktc / format factor | 1.00 | 1.20 | 0.86 | 0.97 |
| comp / Hwang | 0.94 | 1.37 | 0.87 | 0.90 |
| comp / format factor | 0.99 | 1.22 | 0.86 | 0.96 |

Fitted curves, m(v) = c·(v/5000)^k, mean gauge:

| basis | QB | RB | WR | TE |
|---|---|---|---|---|
| ktc | 0.932^(−0.175) | 1.263^(+0.345) | 0.866^(−0.030) | 0.981^(−0.140) |
| comp | 0.900^(+0.173) | 1.343^(+0.121) | 0.871^(−0.235) | 0.950^(−0.059) |

---

## 1. Out-of-sample validation (leave-one-year-out)

For each season, the flat multipliers and the power-law curves were refit on
the *other four* seasons, then used to predict pair-level log HVORP ratios in
the held-out season. Skill is measured against the null "market prices are
right" (predict equal HVORP for equal-priced players).

**Comp basis (Hwang format):**

| held-out | pairs | skill flat | skill curve |
|---|---|---|---|
| 2021 | 383 | +0.003 | +0.039 |
| 2022 | 679 | +0.069 | +0.046 |
| 2023 | 857 | −0.010 | −0.003 |
| 2024 | 881 | +0.019 | +0.039 |
| 2025 | 689 | +0.080 | +0.099 |
| **pooled** | **3,489** | **+0.030** | **+0.041** |

KTC basis pooled: flat +0.000, curve +0.007.

More decision-relevant: does a 4-year fit anticipate the held-out year's own
multipliers? Comp basis, trained → realized:

| held-out | QB | RB | WR | TE |
|---|---|---|---|---|
| 2021 | 0.94 → 0.90 | 1.39 → 1.26 | 0.86 → 0.92 | 0.89 → 0.96 |
| 2022 | 0.92 → 0.99 | 1.36 → 1.39 | 0.86 → 0.89 | 0.92 → 0.81 |
| 2023 | 0.93 → 0.95 | 1.41 → 1.22 | 0.86 → 0.92 | 0.89 → 0.95 |
| 2024 | 0.95 → 0.87 | 1.35 → 1.44 | 0.86 → 0.89 | 0.90 → 0.89 |
| 2025 | 0.93 → 0.96 | 1.33 → 1.58 | 0.90 → 0.74 | 0.90 → 0.89 |

Mean |log error|: QB 0.05, RB 0.10, WR 0.08, TE 0.06.

**Read:** the *direction* of every correction generalizes — in all five
held-out seasons RB realized ≥ 1.22 and WR realized ≤ 0.92 on the comp basis.
The pair-level skill numbers look small (3–10%) because individual player
outcomes are hugely noisy (wRMSE ≈ 1.3 in log space); the multiplier is a
pricing correction, not a player-outcome predictor, and at the multiplier
level it transfers with ~5–10% error. The comp basis validates clearly better
than the KTC basis — another point in favor of using competitor-adjusted
values as the foundation. 2023 is the one soft year (multipliers were mildest
then; see the per-year table in the v3 report).

Figure: `hwang_true_sim_200_v3b/analysis/validation_loyo.png`

---

## 2. Uncertainty bands (archetype bootstrap, 500 resamples)

The 19 archetypes were resampled with replacement; multipliers, format
factors, and curve params refit each time. 95% intervals:

**Comp basis:**

| | QB | RB | WR | TE |
|---|---|---|---|---|
| Hwang mult | 0.93 [0.88, 0.99] | **1.37 [1.33, 1.42]** | 0.87 [0.85, 0.89] | 0.90 [0.88, 0.92] |
| format factor | 0.99 [0.98, 1.00] | **1.22 [1.20, 1.24]** | 0.86 [0.84, 0.88] | 0.96 [0.94, 0.98] |
| curve c | [0.84, 0.96] | [1.30, 1.40] | [0.85, 0.89] | [0.93, 0.98] |
| curve k | [+0.10, +0.20] | [+0.09, +0.15] | [−0.25, −0.20] | [−0.08, −0.00] |

KTC basis: RB Hwang mult [1.25, 1.35], RB k [+0.29, +0.36], WR mult
[0.84, 0.87].

**Read:** nothing about the headline conclusions is fragile to which teams we
chose as archetypes. The RB premium's *entire confidence interval* sits above
1.3 (comp basis), WR's entire interval below 0.9, and the format factors are
pinned within ±0.02. The only parameter with real width is the QB curve
level (0.84–0.96) — QB is the position most sensitive to roster construction,
which matches the archetype spectrum plots.

Figure: `hwang_true_sim_200_v3b/analysis/validation_bootstrap_ci.png`

---

## 3. Equilibrium iteration

The fitted comp curves were applied to the competitor-adjusted board
(v′ = v·m(v)), and the Hwang simulation re-run on the corrected prices
(within-position order is preserved, so roster builds are identical; only
cross-position pairing changes). If the correction is right, no residual
edge should remain:

| | QB | RB | WR | TE |
|---|---|---|---|---|
| uncorrected board | 0.94 | 1.37 | 0.87 | 0.90 |
| **corrected board** | **1.03** | **1.05** | **1.00** | **0.94** |
| corrected curve k | +0.00 | −0.01 | +0.00 | +0.01 |

**Read:** one iteration removes ~90% of the measured mispricing, and the
value-slopes vanish entirely (all k ≈ 0). The system is near a fixed point —
the curves are a *self-consistent* repricing, not an artifact that chases its
own tail. Residuals: RB +5% and TE −6% remain; band detail shows the leftover
RB signal is concentrated in the cheapest band (sub-2k RBs still ~1.4 after
correction), i.e. a single power law slightly undercorrects the very cheapest
RBs — depth RBs are even more valuable than the curve says. Worth remembering
when pricing waiver-tier backs; not worth a more complex functional form yet.

---

## 4. Seed robustness

Full grids were re-run with seeds 2 and 3 (independent jitter, independent
roster builds):

| basis | run | QB m/f | RB m/f | WR m/f | TE m/f |
|---|---|---|---|---|---|
| comp | seed 1 | 0.94 / 0.99 | 1.37 / 1.22 | 0.87 / 0.86 | 0.90 / 0.96 |
| comp | seed 2 | 0.94 / 0.99 | 1.37 / 1.22 | 0.87 / 0.86 | 0.90 / 0.96 |
| comp | seed 3 | 0.94 / 0.99 | 1.37 / 1.22 | 0.87 / 0.86 | 0.90 / 0.96 |

KTC basis identical to two decimals as well; curve slopes match to ±0.01.

**Read:** at 200 builds × 19 archetypes × 5 years, build-level randomness is
fully averaged out. Monte Carlo noise is a non-issue; all remaining
uncertainty is structural (archetype and season selection, sections 1–2).

---

## 5. Within-position residuals

For each player-season, realized (weighted) HVORP was compared against a
within-position value curve (log-quadratic with year effects), comp basis,
Hwang format. Recurring residuals show which *styles* the position-level
correction still misses:

- **RB — beat the curve:** D'Onta Foreman ×4.2, Rico Dowdle ×3.3, Justice
  Hill ×3.0, Tyler Allgeier ×2.2, Gus Edwards ×2.1, Kyren Williams ×2.0,
  Chuba Hubbard ×1.9. Grinders and committee hammers — exactly the profile
  0 PPR favors. The under-performers (Penny, Mostert, Mitchell, Sermon) are
  injury/committee busts rather than a style.
- **WR — beat the curve:** Slayton ×2.4, Michael Wilson ×2.3, Alec Pierce
  ×2.2, Shaheed ×1.8, Pickens ×1.7 — field-stretchers whose yardage/TD
  production survives 0 PPR. **Under the curve:** Renfrow ×0.22, Toney
  ×0.22, Curtis Samuel ×0.11, JuJu ×0.34 — slot/reception-dependent types
  who lose their PPR floor.
- **TE:** Taysom Hill ×2.8 (the 0 PPR cheat code personified), Tucker Kraft,
  Trey McBride vs. pure-target busts (Dulcich, Musgrave).
- **QB:** mostly generic hit/miss (Allen/Goff over, Lance/Richardson under) —
  no obvious style axis, as expected for a position scored identically.

**Read:** there *is* a second-order style effect inside RB/WR — reception
share — that a per-position multiplier can't see. It's the natural v4
refinement (e.g. a reception-share tilt within position), but the first-order
position correction is much larger and is what the market misprices most.

---

## Verdict

| check | result |
|---|---|
| out-of-sample (LOYO) | direction transfers in 5/5 seasons; multiplier-level error 5–10%; comp > ktc basis |
| bootstrap CIs | all headline effects far from 1.0; format factors pinned ±0.02 |
| equilibrium | ~90% of mispricing removed in one pass; slopes vanish |
| seed robustness | identical to 2 decimals across seeds |
| within-position | style residuals exist (reception share) but are second-order |

The competitor-adjusted-basis curves are stable, self-consistent, and
predictive out of sample. They are now live in the site (see below).

## Applied to the site (task 6)

`site/src/lookups/hwangPositionCoefficients.js` now carries the v3b fitted
curves instead of hand-tuned flat coefficients:

- **Hwang True Value Adjusted KTC** (`true`): KTC-basis curves applied to
  Final KTC values.
- **Hwang Adjusted Competitor / Rebuild** (`trueComp`, the new composite
  key): comp-basis curves applied to competitor-adjusted values.
- **Hwang Market** is untouched (flat QB 1.0 / RB 1.12 / WR 0.96 / TE 1.0).

Coefficients are value-dependent (`m(v) = c·(v/5000)^k`, values clamped at
100), mean-grounded — 1.0 means "the average same-priced player", so most
boards will show QBs slightly shaded down and RBs up, with the RB boost
growing with price. Rankings viewer, PlayerDB, Dynasty roster view, and the
trade calculator all pick the curves up through the shared lookup.

For the question of whether these multipliers should apply to future value
as well as the current season, see `example_data/true_value_philosophy.md`.

---

## Addendum (Aug 2026): equilibrium iteration 2 — finding the fixed point

Question: should the section-3 correction be iterated until no residual edge
remains, or is one pass the right stopping point? Three runs (200 builds,
seed 1, comp basis / Hwang format; dumps in
`hwang_true_sim_200_v3b_eq{1,2,3}/`, composition helper
`scripts/compose_equilibrium_params.py`):

| board | update rule | QB | RB | WR | TE |
|---|---|---|---|---|---|
| eq1 = v3b curves (replicates §3) | — | 1.03 | 1.05 | 0.99 | 0.94 |
| eq2 = eq1 ∘ fitted residual *curve* | curve fit | 0.98 | **1.15** | 0.96 | 0.93 |
| eq3 = eq1 × flat residuals | flat LS | **1.02** | **1.01** | **0.99** | **0.98** |

**Read:**

1. **The leftover bias in §3 was real, and the flat update converges in one
   step.** Multiplying the fitted curves' levels by the iteration-1 flat
   residuals (QB ×1.027, RB ×1.046, WR ×0.995, TE ×0.935) produces a board
   whose re-run residuals are all within ±2% — the fixed point. Those
   composed curves (QB 0.924, RB 1.405, WR 0.867, TE 0.888; k unchanged)
   are now live in `hwangPositionCoefficients.js` as `trueComp`.
2. **Iterating with the pair-level curve fit diverges.** At residual scale
   the curve estimator is dominated by shape misfit (it wanted RB *down* 9%
   while the flat aggregate wanted it up 5%); following it pushed RB's flat
   residual from 1.05 to 1.15. The two estimators disagree by more than the
   distance to 1.0, so only the flat update rule is trustworthy here.
3. **The shape residuals survive at the fixed point and are not fixable by
   any per-position power law.** At eq3, sub-2k RBs still run ~1.34 and QB
   remains non-monotone across bands (0.83 in 0–2k, 1.23 in 2k–4k). Zeroing
   these requires a richer functional form (piecewise / spline), not more
   iterations — the natural v4 refinement alongside the reception-share
   tilt from §5.

Net: one flat-update iteration captured the remaining ~5% RB / −6% TE level
bias; anything beyond that is below the noise floor of this sample.
