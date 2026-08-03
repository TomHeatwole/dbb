# Proposal: Deconstructing Dynasty Value into Current + Future

*How to split every player's dynasty price into a current-season slice and a
future slice, so the full Hwang multiplier applies to the part we measured and
the format factor applies to the part we didn't.*

---

## 1. Target

Two lenses, one formula:

- **Competitor lens** (already live): `comp_value × m_comp(v)` — the full
  comp-basis curve on competitor-adjusted value. Nothing changes here.
- **Total lens** (new): every player's dynasty value `V` gets split into a
  current-season slice `S` and a future slice `F = V − S`, and

```
TrueTotal = S × m_comp(v_comp)  +  F × f(V)
```

where `m_comp` is the fitted comp-basis Hwang curve (full correction: format
effect + market redraft error) and `f` is the format factor (Hwang ÷ Regular
— the structural part that persists into future seasons). For v1 I'd use the
flat factors (QB 0.99, RB 1.22, WR 0.86, TE 0.96); the curve-ratio version
exists but is a difference of two noisy slopes, so save it for v2.

The deconstruction — finding `S` — is the hard part. Here's how.

## 2. The core idea: let the market tell us how much value survives a season

A dynasty price is a recursion:

```
V_t = S_t + δ · E[V_{t+1}]
```

This year's price = this year's production value, plus the discounted
expectation of what the asset will still be worth *next* preseason (which in
turn contains all remaining seasons — the recursion handles the infinite
future for us). Rearranged:

```
S = V · (1 − δ · g)        where  g = E[V_{t+1} / V_t]
```

So we need exactly two objects, and we can estimate **both from data we
already have**:

### 2a. `g` — value survival rates, from the KTC panel

`final_ktc_values.csv` holds six preseason snapshots (2020–2025) keyed by
`sleeper_id` — five year-over-year transitions, ~1,600 player-transitions.
For each cohort, measure how much of a player's value is still there next
September:

- Estimate `g(position, age bucket, value tier)` — e.g. age buckets
  ≤23 / 24–25 / 26–27 / 28–29 / 30+, tiers deep / mid / elite. Ages come from
  the Sleeper player DB (`birth_date` is populated).
- **Survivorship is the one big trap**: players who fall off the KTC board
  next year must enter the average at ~0, not get dropped. The expectation is
  over the *full cohort*, busts included. (This is why old RBs will get the
  low `g` they deserve.)
- Small cells (elite old TEs…) get empirical-Bayes shrinkage toward their
  position×age mean. With ~1,600 transitions across ~40 cells this is
  workable but the shrinkage matters.

Note the timing is exactly right, with no double counting: a Sept→Sept
transition measures what's left *after* the season we're crediting to `S`
has been consumed.

### 2b. `δ` — the market's discount rate, from pick prices

KTC prices rookie picks across vintages **right now**: 2027 Early 1st = 7367,
2028 Early 1st = 5633, etc. Picks are pure future value (S = 0), so
same-slot, adjacent-vintage ratios are direct reads of the one-year discount
— e.g. 5633/7367 ≈ 0.76 for Early 1sts. Estimate δ as a robust median across
all slots (Early/Mid/Late × 1st/2nd/3rd) and adjacent vintage pairs.

One known wrinkle: 2026 Early 1st (6209) prices *below* 2027 (7367) because
of perceived class strength, so raw adjacent ratios confound discount with
class quality. Mitigation: use the 2027→2028 pairs as primary (class priors
are flat two years out), and cross-check with historical pick rows in the
KTC archive if needed. Expect δ ≈ 0.75–0.85.

## 3. What the split looks like when it works

Sanity anchors the method must reproduce (these fall out of `g` naturally,
which is the appeal):

| asset | g | S/V | behavior in TrueTotal |
|---|---|---|---|
| 30-year-old workhorse RB | ~0.5 | ~60–65% | most of his price gets the full 1.3–1.4× — correct, his price *is* this season |
| prime WR1 | ~0.85 | ~30% | mild net shading (small slice down-weighted, big slice ×0.86 factor) |
| 22-year-old stash | ~1.0+ | ~0–20% | rides at ≈ market × format factor; no redraft correction to apply |
| rookie pick | — | 0% by definition | stays at market value (blended factor ≈ 1.0) |
| league aggregate | — | ~40–55% | global sanity check on δ and g jointly |

Edge cases: if `δ·g > 1` (post-injury players priced to appreciate), clamp
`S ≥ 0` — a pure stash. Rookies have no transition history; they get their
own cohort. Picks skip the whole machine.

## 4. Fallback (v0, one afternoon): redraft-share anchoring

If the survival table turns out too noisy, there's a cheaper split that
reuses the redraft index we already build: take the *shape* of `S` from the
comp/ADP signal and calibrate only its *level*: `S_p = α · Z · comp_p`, with
one global α (≈ the league-wide current-season share, from section 2's
aggregate) and Z a normalizer. It has the right flavor — redraft-strong
players get bigger current slices — but it can't distinguish "cheap because
old" from "cheap because unproven" the way `g` does. I'd build Method A and
keep this as the cross-check, not the product.

## 5. Validation plan (same discipline as the simulator)

1. **Out-of-sample on transitions**: fit `g` on four transition years,
   predict the fifth (does `F = δgV` predict next-Sept value better than
   naive `V`?). This validates the survival table itself.
2. **HVORP backtest**: within historical seasons, `S` should track realized
   in-season HVORP *better* than `V` does, especially at the extremes (old
   RBs, stashes) — that's the whole point of the split.
3. **Aggregate checks**: league S-share in 40–55%; totals preserved after
   the final renormalization (mean-grounded curves shrink/grow totals
   slightly, so rescale TrueTotal to Σ V for board comparability).
4. **Name-level smell test**: a fixed table of ~20 representative players
   rendered before/after, reviewed by you.

## 6. Implementation plan in this repo

1. `scripts/estimate_value_survival.py` — joins the KTC panel with Sleeper
   birth dates, handles exits, fits shrunk `g` table →
   `site/public/data/ktc_value_survival.csv` (position, age_bucket, tier,
   g_raw, n, g_shrunk). Also emits the δ estimate from pick rows with its
   derivation in a meta JSON.
2. `site/src/data_parse/build_deconstructed_value_index.js` — per player:
   `V`, `comp`, `age`, `g`, `S`, `F`, `m_comp(v_comp)`, `f(V)`,
   `true_competitor`, `true_total`, `s_share` →
   `site/public/data/hwang_deconstructed_value.csv`.
3. Web: new rankings source **"Hwang True Total Value"** next to the
   existing competitor lens, with `S/F` split and `s_share` as columns in
   PlayerDB (the split itself is half the product — seeing *why* a player
   moves is the insight).
4. Validation script + writeup md, same pattern as the v3b validation
   report.

Rough shape of effort: the survival table is the only genuinely new
estimation (one script + careful survivorship handling); everything else is
plumbing through existing infrastructure (the curve lookup from task 6
already evaluates `m(v)` and can serve `f` too).

## 7. What I'd decide up front (my recommendations)

- **δ source**: pick-implied, 2027→2028 pairs primary. *(Market-implied
  beats hand-picked.)*
- **g granularity**: position × 5 age buckets × 3 tiers with shrinkage.
  *(Fine enough to separate old RBs from young ones, coarse enough to
  estimate.)*
- **f form**: flat format factors for v1. *(The curve ratio is v2.)*
- **Gauge**: renormalize TrueTotal to preserve total league value. *(Keeps
  the board in familiar KTC-scale dollars.)*
- **Rebuilder index**: leave uncorrected (or format-factor-only) — per the
  philosophy doc, exchange-oriented rosters live closer to market prices.
