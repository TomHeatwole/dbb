# Hwang True Simulator — Underdog BBM Construction Report

**Data:** `example_data/hwang_true_sim_bbm_50/` — 50 jittered builds × 8 Underdog
Best Ball Mania archetypes × 5 seasons (2021–2025) × both value bases (Final
KTC pairs, competitor-adjusted / redraft pairs) × both formats (Hwang, true
Underdog). Mean-grounded, value- and points-weighted — same HVORP engine as
v3b.

**Construction:** 18-man BBM rank ladders from
`example_data/underdog_bbm_archetypes.json`, always instantiated onto the
**competitor-adjusted (redraft) board**. Pair prices follow the value basis, so
the KTC-pair run does not rebuild the roster as a dynasty club.

**Formats (intentional difference from v3b):**

| | Hwang | Regular (this run) | v3b “Regular” |
|---|---|---|---|
| Lineup | 1QB / 3RB / 3WR / 1TE / 2FLEX / **1SF** | 1QB / 2RB / 3WR / 1TE / 1FLEX / **no SF** | 1QB / 2RB / 3WR / 1TE / 1FLEX / **1SF** |
| Scoring | 0 PPR, TE +0.5 | **0.5 PPR, no TEP** | 0.5 PPR, TE +0.5 |
| Roster | 18-man BBM (drop 1 → 17-man HVORP base) | same | 27-man Hwang |

Reproduce: `npx tsx scripts/run_hwang_true_sim_bbm.mjs 1 50` then
`python scripts/analyze_hwang_true_sim_v3.py example_data/hwang_true_sim_bbm_50`.

Archetypes: Zero / Hero / Double-anchor / Robust × late-3QB / elite-2QB.

---

## Headline numbers

**4-position mean-grounded flats** (1.0 = average same-priced player):

| basis / view | QB | RB | WR | TE |
|---|---|---|---|---|
| ktc / Hwang | 0.93 | 1.28 | 0.86 | 0.99 |
| ktc / Underdog | **0.48** | 1.58 | 1.27 | 1.04 |
| ktc / Hwang ÷ Underdog | **1.94** | 0.81 | 0.67 | 0.95 |
| comp / Hwang | 0.94 | 1.32 | 0.87 | 0.93 |
| comp / Underdog | **0.49** | 1.64 | 1.28 | 0.97 |
| comp / Hwang ÷ Underdog | **1.91** | 0.81 | 0.68 | 0.95 |

**Do not read the 0.81 RB “format factor” as “Hwang devalues RBs.”** Dropping
Superflex guts QB HVORP (only one starter slot; BBM rosters already hold 2–3
QBs). Mean-grounding then shoves RB/WR/TE up to keep the four-position
geometric mean at 1.0. That is a 1QB-vs-SF effect, not an RB finding.

---

## What is gauge-invariant (the real results)

Ratios between positions do not depend on the 1.0 pin.

| basis | format | RB/WR | RB/TE | WR/TE | RB/QB |
|---|---|---|---|---|---|
| ktc | Hwang | 1.49 | 1.29 | 0.87 | 1.38 |
| ktc | Underdog | 1.24 | 1.52 | 1.22 | 3.31 |
| ktc | **(Hwang ratio) ÷ (Underdog ratio)** | **1.20** | 0.85 | 0.71 | 0.42 |
| comp | Hwang | 1.52 | 1.42 | 0.93 | 1.41 |
| comp | Underdog | 1.28 | 1.68 | 1.31 | 3.34 |
| comp | **(Hwang ratio) ÷ (Underdog ratio)** | **1.19** | 0.85 | 0.71 | 0.42 |

And a **skill-only** re-gauge (geometric mean of RB, WR, TE = 1.0; QB vs that
basket):

| basis / view | QB | RB | WR | TE |
|---|---|---|---|---|
| comp / Hwang | 0.92 | **1.29** | 0.85 | 0.91 |
| comp / Underdog | 0.39 | **1.29** | 1.01 | 0.77 |
| comp / skill format factor | **2.38** | **1.00** | **0.84** | **1.19** |
| ktc / skill format factor | 2.42 | 1.01 | 0.84 | 1.18 |

That is the decomposition this experiment was built to get:

1. **RB outproduces equal-priced players in *both* formats, by the same
   ~29% vs the skill basket.** That is market / longevity / redraft error, not
   Hwang rules. It is still there on Zero-RB Underdog teams. It is the strand
   that must **not** be fully applied to future dynasty seasons.
2. **Hwang’s format effect, holding BBM construction fixed, is not “RBs are
   +20%.”** Relative to the skill basket, RB is unchanged. Hwang moves value
   **off WR** (0 PPR, extra RB/flex slots) **onto TE** (+TEP) **and onto QB**
   (Superflex). The RB/WR *ratio* still rises ~19% because WR falls, which is
   why the old 1.20–1.22 RB format factor and this 1.19 RB/WR ratio-of-ratios
   agree — they were measuring WR getting cheaper in Hwang, not RB getting
   more expensive vs TE/QB.
3. **Hwang-build saturation was real but was not driving the Hwang-leg
   coefficients.** Same engine, Hwang format, comp pairs:

| construction | QB | RB | WR | TE |
|---|---|---|---|---|
| 19 Hwang 27-man clubs (v3b) | 0.94 | 1.37 | 0.87 | 0.90 |
| 8 BBM 18-man clubs (this) | 0.94 | 1.32 | 0.87 | 0.93 |

Within *this* run, saturation still shows: Zero-RB Underdog RB flats are
1.83–1.90; Robust (3 early RBs) are 1.47–1.55. Averaging the eight BBM
archetypes just does not move the Hwang-format pooled number much vs averaging
the 19 Hwang clubs.

---

## Fitted curves

`m(v) = c · (v/5000)^k`, mean-grounded, values clamped at 100 in the site
lookup. These are the formulas.

### A. Hwang format + BBM construction  ← use on the Hwang SF dynasty board

Same object as v3b `true` / `trueComp`, re-estimated on regular-shaped rosters.

| basis | QB | RB | WR | TE |
|---|---|---|---|---|
| **ktc (apply to Final KTC)** | 0.873 · (v/5k)^**−0.073** | 1.277 · (v/5k)^**+0.246** | 0.875 · (v/5k)^**−0.031** | 1.025 · (v/5k)^**−0.142** |
| flats | 0.93 | 1.28 | 0.86 | 0.99 |
| **comp (apply to competitor-adjusted)** | 0.893 · (v/5k)^**+0.152** | 1.326 · (v/5k)^**+0.077** | 0.869 · (v/5k)^**−0.171** | 0.971 · (v/5k)^**−0.059** |
| flats | 0.94 | 1.32 | 0.87 | 0.93 |

@1k / @3k / @5k / @8k, **comp / Hwang**:

| pos | 1k | 3k | 5k | 8k |
|---|---|---|---|---|
| QB | 0.70 | 0.83 | 0.89 | 0.96 |
| RB | 1.17 | 1.28 | 1.33 | 1.38 |
| WR | 1.14 | 0.95 | 0.87 | 0.80 |
| TE | 1.07 | 1.00 | 0.97 | 0.94 |

v3b comp curves were `0.900^+0.173 / 1.343^+0.121 / 0.871^−0.235 / 0.950^−0.059`.
Shapes match; this RB slope is milder (+0.08 vs +0.12) and the level is ~1%
lower. Pair-level R² is still small (comp/Hwang 0.075) — these are pricing
corrections, not player-outcome predictors.

### B. True Underdog (1QB / 2RB / 1FLEX / 0.5 PPR / no TEP)  ← do **not** put on the Hwang site

| basis | QB | RB | WR | TE |
|---|---|---|---|---|
| ktc | 0.424 · (v/5k)^−0.098 | 1.593 · (v/5k)^+0.362 | 1.340 · (v/5k)^−0.079 | 1.104 · (v/5k)^−0.185 |
| comp | 0.450 · (v/5k)^+0.162 | 1.653 · (v/5k)^+0.140 | 1.296 · (v/5k)^−0.246 | 1.038 · (v/5k)^−0.057 |

QB ~0.45 is the correct 1QB-best-ball number (second QB has nowhere to play).
Applying it in a Superflex league would be a category error.

### C. Format-only skill factors (for the future-value slice)

If the current season gets the full Hwang-on-BBM curve and future seasons
should get *only* the rules effect, the skill-gauge Hwang ÷ Underdog factors
are the clean statement:

```
f_QB = 2.38   # Superflex vs 1QB — NOT the right “vs SF redraft” number
f_RB = 1.00   # vs the skill basket; RB/WR still ~1.19 because WR falls
f_WR = 0.84
f_TE = 1.19
```

For a **Superflex** dynasty future slice, ignore `f_QB` (both sides have SF).
Use WR 0.84 and TE 1.19 vs a 0.5 PPR SF baseline, and treat RB as format-neutral
vs the skill basket (~1.19 vs WR specifically). That replaces the old “future
slice gets RB × 1.22 format factor,” which was mostly WR-down, not RB-up.

---

## Per-archetype (comp basis) — saturation check

Underdog format, sorted by RB multiplier:

| archetype | QB | RB | WR | TE |
|---|---|---|---|---|
| Zero RB + elite 2QB | 0.44 | **1.90** | 1.16 | 1.02 |
| Zero RB + late 3QB | 0.50 | **1.83** | 1.13 | 0.97 |
| Hero RB + elite 2QB | 0.46 | 1.72 | 1.22 | 1.05 |
| Hero RB + late 3QB | 0.45 | 1.71 | 1.27 | 1.02 |
| Robust RB + elite 2QB | 0.47 | **1.55** | 1.49 | 0.91 |
| Double-anchor + late 3QB | 0.51 | 1.49 | 1.31 | 1.00 |
| Robust RB + late 3QB | 0.55 | **1.49** | 1.42 | 0.86 |
| Double-anchor + elite 2QB | 0.54 | 1.47 | 1.27 | 0.99 |

Zero-RB teams still want more RB at equal price; Robust teams are the only
place WR catches RB. The *pooled* Underdog RB 1.64 is an average over a field
that is still WR-fronted. Hwang format compresses that spread (Zero 1.40 vs
Robust 1.28) because extra RB/flex slots soak up the late backs.

---

## Per-year (comp / Hwang vs Underdog)

Direction is stable: every season Hwang RB ≥ 1.20 and Underdog QB ≤ 0.53.

| year | Hwang QB/RB/WR/TE | Underdog QB/RB/WR/TE |
|---|---|---|
| 2021 | 0.97 / 1.20 / 0.90 / 0.95 | 0.51 / 1.53 / 1.35 / 0.95 |
| 2022 | 1.01 / 1.33 / 0.89 / 0.83 | 0.53 / 1.60 / 1.30 / 0.89 |
| 2023 | 0.89 / 1.22 / 0.93 / 0.99 | 0.45 / 1.52 / 1.39 / 1.04 |
| 2024 | 0.90 / 1.37 / 0.87 / 0.93 | 0.45 / 1.70 / 1.29 / 1.02 |
| 2025 | 0.93 / **1.51** / 0.76 / 0.94 | 0.51 / **1.90** / 1.07 / 0.96 |

2025 is again the loudest RB year on both formats — another point that the RB
premium is not Hwang-construction-specific.

Figures: `hwang_true_sim_bbm_50/analysis/multiplier_curves_{ktc,comp}.png`,
`archetype_spectrum_{ktc,comp}.png`, `multipliers_by_year.png`.

---

## Verdict vs the double-counting worry

The worry was: Hwang clubs are already RB-heavy, so measuring regular scoring
on those clubs understates regular-format RB (saturation) and inflates the
Hwang ÷ Regular format factor, which then gets applied on top of a Hwang-leg
RB premium that already includes construction.

**What this run says:**

- Measuring Underdog on *Underdog-shaped* rosters does raise regular-format
  RB (skill-gauge 1.29, 4-gauge 1.64 with the QB crater). Saturation was real.
- It does **not** inflate the Hwang-leg coefficients. Hwang format + BBM
  construction ≈ Hwang format + Hwang construction (RB 1.32 vs 1.37).
- The old 1.22 RB format factor survives as an RB/WR ratio-of-ratios (~1.19)
  and dies as “RB vs the skill basket” (1.00). The format is a WR-down / TE-up
  / SF-QB-up story. Treating 1.22 as extra *RB* future value was the
  double-count.

**What to put on the site (recommendation, not applied in this pass):**

- Replace `true` / `trueComp` Hwang curves with table **A** (BBM construction,
  Hwang format). Modest RB downshift vs the post-equilibrium 1.405; almost a
  no-op vs original v3b 1.343.
- Do **not** load table **B** onto Hwang rankings.
- For a future-value dial, use table **C** skill factors (WR 0.84, TE 1.19,
  RB 1.00 vs skill basket) instead of RB × 1.22.

Not done here: equilibrium iteration on the BBM Hwang curves; a Superflex-held-
constant regular leg (2RB / 1FLEX / 1SF / 0.5 PPR) if we want format factors
that match v3b’s SF-on-both-sides experiment.
