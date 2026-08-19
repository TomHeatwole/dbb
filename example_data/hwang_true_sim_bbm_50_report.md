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
`python scripts/analyze_hwang_true_sim_skill_only.py example_data/hwang_true_sim_bbm_50`
(QB-free) and `python scripts/analyze_hwang_true_sim_v3.py example_data/hwang_true_sim_bbm_50`
(four-position, Superflex-contaminated — kept below for archive).

Archetypes: Zero / Hero / Double-anchor / Robust × late-3QB / elite-2QB.

---

## Skill-only results (QB excluded)

QB is out of every comparison below. Numbers are **direct paired HVORP**:
among equal-priced RB–WR (or RB–TE, WR–TE) pairs, total RB HVORP ÷ total WR
HVORP. The 3-position network solve (no QB equations, geo mean of RB/WR/TE = 1)
agrees to ~0.02.

### Direct ratios

| basis | format | **RB / WR** | **RB / TE** | **WR / TE** |
|---|---|---|---|---|
| ktc | Hwang | **1.47** | 1.33 | 0.85 |
| ktc | Underdog | 1.22 | **1.58** | 1.21 |
| ktc | Hwang ÷ Underdog | **1.20** | 0.84 | 0.71 |
| **comp** | **Hwang** | **1.52** | **1.39** | **0.94** |
| **comp** | **Underdog** | **1.27** | **1.63** | **1.33** |
| **comp** | **Hwang ÷ Underdog** | **1.20** | **0.85** | **0.70** |

Read:

- **Equal-priced RBs beat WRs in both formats** — +27% Underdog, +52% Hwang
  (comp pairs). That +27% is the market/longevity strand (still there on
  WR-fronted BBM clubs). The extra +20% in the *ratio* is the format.
- **Equal-priced RBs beat TEs even more in Underdog (+63%) than in Hwang
  (+39%).** Hwang’s TE premium + extra TE-eligible flex reverses part of the
  RB edge vs TE. Format factor 0.85: Hwang makes TEs *closer* to RBs.
- **WRs vs TEs flips with the rules.** Underdog (0.5 PPR, no TEP): WR/TE =
  1.33. Hwang (0 PPR, TE +0.5): WR/TE = 0.94. Format factor 0.70 — the
  largest skill-position format effect, and it is WR-down / TE-up, not RB-up.

KTC pairs tell the same story as comp (format factors 1.20 / 0.84 / 0.71).

### 3-position network (geo mean RB·WR·TE = 1)

| basis / format | RB | WR | TE |
|---|---|---|---|
| comp / Hwang | 1.29 | 0.85 | 0.92 |
| comp / Underdog | 1.28 | 1.01 | 0.77 |
| ktc / Hwang | 1.25 | 0.84 | 0.96 |
| ktc / Underdog | 1.24 | 1.00 | 0.81 |

RB’s *share of skill-position value* is the same in both formats (~1.25–1.29).
Hwang does not make RBs more important vs the skill basket. It reprices WR
down and TE up, which is why RB/WR rises 20% while RB vs the basket does not.

### Skill-only curves

`m(v) = c · (v/5000)^k`, **3-position mean gauge, skill-vs-skill pairs only.**
Implied ratios at v=5000 match the direct matchups.

**Competitor-adjusted pairs:**

| format | RB | WR | TE | RB/WR @5k | RB/TE @5k | WR/TE @5k |
|---|---|---|---|---|---|---|
| Hwang | 1.271 · (v/5k)^+0.119 | 0.825 · (v/5k)^−0.144 | 0.953 · (v/5k)^+0.025 | 1.54 | 1.33 | 0.87 |
| Underdog | 1.253 · (v/5k)^+0.187 | 0.990 · (v/5k)^−0.208 | 0.806 · (v/5k)^+0.022 | 1.27 | 1.55 | 1.23 |

**Final KTC pairs:**

| format | RB | WR | TE | RB/WR @5k | RB/TE @5k | WR/TE @5k |
|---|---|---|---|---|---|---|
| Hwang | 1.232 · (v/5k)^+0.235 | 0.837 · (v/5k)^−0.065 | 0.970 · (v/5k)^−0.171 | 1.47 | 1.27 | 0.86 |
| Underdog | 1.214 · (v/5k)^+0.341 | 1.014 · (v/5k)^−0.110 | 0.812 · (v/5k)^−0.231 | 1.20 | 1.50 | 1.25 |

Comp / Hwang @1k / 3k / 5k / 8k:

| ratio | 1k | 3k | 5k | 8k |
|---|---|---|---|---|
| RB/WR | 1.01 | 1.36 | 1.54 | 1.74 |
| RB/TE | 1.15 | 1.27 | 1.33 | 1.39 |
| WR/TE | 1.14 | 0.94 | 0.87 | 0.80 |

Cheap-band WRs hold up; expensive WRs are the ones Hwang (0 PPR) punishes.

### By year (comp, Hwang / Underdog / factor)

Every season: Hwang RB/WR > Underdog RB/WR, factor 1.14–1.24. WR/TE factor
stuck at ~0.70.

| year | RB/WR | RB/TE | WR/TE |
|---|---|---|---|
| 2021 | 1.40 / 1.20 / **1.17** | 1.25 / 1.59 / 0.79 | 0.88 / 1.31 / 0.67 |
| 2022 | 1.51 / 1.22 / **1.24** | 1.54 / 1.74 / 0.89 | 1.16 / 1.62 / 0.72 |
| 2023 | 1.31 / 1.07 / **1.22** | 1.19 / 1.38 / 0.87 | 0.92 / 1.31 / 0.70 |
| 2024 | 1.55 / 1.28 / **1.21** | 1.47 / 1.65 / 0.89 | 0.95 / 1.34 / 0.71 |
| 2025 | 2.09 / 1.83 / **1.14** | 1.51 / 1.84 / 0.82 | 0.82 / 1.14 / 0.72 |

### By BBM archetype (comp)

Saturation is a **regular-format** story. Hwang’s extra RB/flex slots flatten
it. Direct RB/WR:

| archetype | Hwang RB/WR | Underdog RB/WR |
|---|---|---|
| Zero RB + late 3QB | 1.64 | **1.62** |
| Zero RB + elite 2QB | 1.63 | **1.62** |
| Hero RB | 1.52–1.54 | 1.34–1.39 |
| Double-anchor | 1.46–1.47 | 1.13–1.15 |
| Robust RB | 1.48 | **1.02–1.04** |

On Robust Underdog teams, equal-priced RB ≈ WR. On Zero-RB Underdog teams,
RB still beats WR by 62% — the same as Hwang. The pooled Underdog RB/WR of
1.27 is an average over a WR-fronted field; the pooled Hwang 1.52 is *not*
an average of a much hungrier field, it is the extra slots + 0 PPR lifting
every archetype’s RB/WR into the 1.46–1.64 band.

Figures: `analysis/skill_only_ratios.png`, `analysis/skill_only_ratio_curves.png`.

### Skill-only formulas to use

For the Hwang SF board, ignore QB here and apply the **3-pos Hwang / comp**
curve to RB/WR/TE (table above). Relative to an equal-priced skill player:

- RB ≈ `1.271 · (v/5000)^+0.119`
- WR ≈ `0.825 · (v/5000)^−0.144`
- TE ≈ `0.953 · (v/5000)^+0.025`

Format-only (Hwang ÷ Underdog), for a future-value dial that must not
re-credit longevity:

- RB vs WR: **× 1.20**
- RB vs TE: **× 0.85**
- WR vs TE: **× 0.70**

---

## Corrected format factor (the actual study)

The section above scored **the same Underdog rosters** under both rule sets.
That is the wrong experiment. The format factor we care about is:

**Hwang dynasty clubs + Hwang scoring**  
÷  
**Underdog BBM clubs + Underdog scoring**

Numerator is the trusted v3b dump (`hwang_true_sim_200_v3b`, Hwang format).
Denominator is this dump’s Underdog format. QB still excluded. Reproduce:
`python scripts/analyze_hwang_vs_underdog_format_factor.py`.

### Direct ratios (comp / redraft-adjusted pairs)

| | Hwang clubs + Hwang rules | Underdog clubs + Underdog rules | **factor** |
|---|---|---|---|
| RB / WR | 1.58 | 1.27 | **1.24** |
| RB / TE | 1.47 | 1.63 | **0.90** |
| WR / TE | 0.97 | 1.33 | **0.73** |

KTC pairs: factors **1.23 / 0.91 / 0.74** — same story.

### 3-position coefficients (geo mean RB·WR·TE = 1, then divide)

These are the Hwang value adjustments vs a fair best-ball baseline:

| | Hwang clubs | Underdog clubs | **Hwang ÷ Underdog** |
|---|---|---|---|
| RB | 1.33 | 1.28 | **1.04** |
| WR | 0.85 | 1.01 | **0.84** |
| TE | 0.89 | 0.77 | **1.15** |

### Format-factor curves (comp), `m(v) = c · (v/5000)^k`

| pos | Hwang clubs | Underdog clubs | **factor (apply this)** |
|---|---|---|---|
| RB | 1.288^+0.172 | 1.253^+0.187 | **1.028^(−0.015)** |
| WR | 0.826^−0.211 | 0.990^−0.208 | **0.834^(−0.002)** |
| TE | 0.940^+0.039 | 0.806^+0.022 | **1.166^(+0.017)** |

Factor @1k / 3k / 5k / 8k: RB 1.05/1.04/1.03/1.02 · WR 0.84/0.84/0.83/0.83 · TE 1.13/1.16/1.17/1.18.

QB is not in this table. Use the v3b Hwang / competitor-adjusted curve unchanged:
`0.924 · (v/5000)^+0.173` (~0.92× at $5k).

---

## Four-position numbers (archive — Superflex leaks into the gauge)

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
