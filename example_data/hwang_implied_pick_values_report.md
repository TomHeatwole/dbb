# Hwang implied pick values (pass 3)

**Question:** Treating picks as having **zero KTC**, and scoring players with
trade-date SF TE+ KTC × pass-2 position multipliers (QB 0.99, RB 1.04, WR
1.00, TE 1.06) plus the calculator Value Adjustment, what are Hwang 1sts /
2nds / 3rds / 4ths worth? For *current-year* picks, split early / mid / late
from known draft slots.

**Working answer (OLS on 52 pick trades, already monotonic):**

| round | implied Hwang value | bootstrap 5–95% | KTC mid (year+1) |
|---|---:|---:|---:|
| 1st | **2,410** | 1,570 – 3,590 | 5,000 |
| 2nd | **1,660** | 1,090 – 2,450 | 1,850 |
| 3rd | **1,440** | 870 – 2,040 | 930 |
| 4th | **1,290** | 430 – 2,130 | 400 |

The curve is **much flatter than KTC**. Hwang does not pay KTC prices for
1sts, and does not treat 3rds/4ths as darts. 2nds are the one round that
lands near KTC.

Current-year early/mid/late **1sts cannot be grounded yet**: zero early 1sts
(1.01–1.03) in the priced sample, one mid, two lates, and those are bundled
with other assets. Current-year **2.02** did trade like a late 1st (~4,050
for Ferguson).

**Data:** 84 completed Hwang trades, 2024–2026. 65 involve picks. Model:
two-team, FAAB ≤ $1, rookie rounds 1–4 (2024 startup leftovers excluded),
every player priced. Script:
`scripts/analyze_hwang_implied_pick_values.mjs`. Payload:
`example_data/hwang_implied_pick_values.json`. Players: historical KTC where
it exists (36 trades); 16 more use live SF TE+ as a fallback for 2025/26
rookies missing from the historical scrape.

---

## 1. Funnel

| bucket | n |
|---|---:|
| Completed trades | 84 |
| No picks (pass 2) | 18 |
| Not two-team | 1 |
| FAAB > $1 | 10 |
| 2024 startup-only | 1 |
| Still unpriced | 1 |
| **Modeled pick trades** | **52** |
| Historical KTC only | 36 |
| Live-KTC fallback (rookies) | 16 |

Pick counts in the 52 (absolute net coverage): 19 firsts, 24 seconds, 17
thirds, 10 fourths. Almost all 1sts are *future* 1sts (coverage 20).
Current-year 1sts: 0 early, 1 mid, 2 late.

Slots for current-year picks come from completed linear drafts
(`slot_to_roster_id`): 10-team early = 1.01–1.03, mid = 1.04–1.07, late =
1.08–1.10. 2024 same-year picks are startup, not rookie, and are excluded.

---

## 2. Methods

Players on each side get `KTC × pos_mult`, then `evaluateKtcStyleTrade` VA.
Picks enter at 0, so they drop out of VA (the formula ignores non-positive
values). Revealed equality:

`value(picks A) − value(picks B) = adjPlayerB − adjPlayerA`

**Method A — OLS, four round dummies, no intercept.** 52 trades. R² 0.66,
RMSE ~1,730 (the residual is the size of a 3rd — this is noisy).

**Method B — isotonic OLS.** Force 1st ≥ 2nd ≥ 3rd ≥ 4th ≥ 0. On the 52-trade
fit the unconstrained OLS is already monotonic, so A and B agree.

**Method C — historical-KTC-only OLS (n=36).** Drops the 16 rookie-fallback
trades. 1st 2,160 / 2nd 1,570 / 3rd 680 / 4th 1,380. 4th > 3rd, so isotonic
pools 3rd=4th at 1,030.

**Method D — clean single-round residuals.** Only trades whose picks are all
the same round. Median implied value. Small n, and 2nds come out *above*
1sts.

**Method E — pick-only vs players.** One side receives only picks of one
round, the other only players. Even smaller n; one 2028 1st for
Mac Jones + Kincaid prints at 6,964 and dominates any 1st median.

**Method F — current-year 1sts split early/mid/late.** OLS dummies. Early:
no observations. Mid 6,370 and late 5,656 sit on 1 and 2 trades that also
move players (Olave+1.06 vs Odunze+1.10). Not usable. Future 1sts in that
same regression: **2,500** (n coverage 20), which matches method A.

---

## 3. Round curve vs KTC

KTC reference is the site’s mid-tier market table (not used in the fit):

| round | Hwang OLS | Hwang hist-only isotonic | KTC current mid | KTC year+1 mid |
|---|---:|---:|---:|---:|
| 1st | 2,410 | 2,160 | 6,200 | 5,000 |
| 2nd | 1,660 | 1,570 | 2,300 | 1,850 |
| 3rd | 1,440 | 1,030 | 1,150 | 930 |
| 4th | 1,290 | 1,030 | 480 | 400 |

Read: a Hwang 1st clears against ~2.4k of position-adjusted player KTC, not
5–6k. A Hwang 4th clears against ~1.3k, not 400. Relative to KTC, this
league **compresses the top and inflates the bottom**.

That is consistent with pass 2 (player-only deals were already near KTC+VA
even) plus a pick market that does not believe KTC’s first-round premium.

Clean single-round medians, for the skeptic:

| round | n | median implied | mean |
|---|---:|---:|---:|
| 1st | 7 | 1,745 | 2,790 |
| 2nd | 12 | 2,380 | 2,160 |
| 3rd | 7 | 1,430 | 1,320 |
| 4th | 4 | 1,610 | 1,540 |

The clean 1st median is pulled down by Love+2026 1st for McBride (implied
1st = 1,277) and McMillan+2028 1st for Tua (1,078). The clean 1st *mean*
is 2,790 because Mac+Kincaid for a 2028 1st is 6,964. OLS is the thing that
uses the messy packages instead of pretending those three trades are the
market.

---

## 4. Current-year early / mid / late

**1sts:** no 1.01–1.03 in the modeled set. The only isolated mid-vs-late
print is 2025-02-19, Olave + **2025 1.06** for Odunze + **2025 1.10**. The
player gap is 714 KTC; if the trade is even, a mid 1st is ~700 more than a
late 1st. That is one swap, two WRs, not a curve.

**2nds:** four current-year 2nds in OLS at **3,730** vs future 2nds at
**1,410**. The cleanest current 2nd is 2026-02-20, Jake Ferguson (4,055) for
**2026 2.02**. An early 2nd in a 10-team league is adjacent to 1.10, and it
traded like a 1st. Do not pool 2.02 with a 2028 2nd.

**3rds / 4ths:** current 4ths never appear. Current 3rds are noisy (OLS 570
on coverage 3).

Until more 1.01–1.03 deals exist, the honest current-year split is:

| asset | implied | n | note |
|---|---:|---:|---|
| Future 1st | 2,500 | 20 | OLS split, main number |
| Current mid 1st | — | 1 | bundled with Olave/Odunze |
| Current late 1st | — | 2 | bundled |
| Current early 2nd (2.02) | ~4,050 | 1 | Ferguson |
| Future 2nd | 1,410 | 20 | OLS split |

---

## 5. What to take into the next pass

1. **Use the flat OLS curve as the prior for unknown-slot picks:**
   1st 2,400 / 2nd 1,660 / 3rd 1,440 / 4th 1,290, or the more conservative
   hist-only isotonic 2,160 / 1,570 / 1,030 / 1,030 if you do not want live
   rookie KTC in the fit.
2. **Do not apply that 1st number to 1.01 or 2.02.** Current-year early
   picks are a different asset; we do not have enough 1sts to split E/M/L,
   but 2.02 already looks like ~4k.
3. **RMSE 1,730** means a single trade should not move the curve. Next
   tightening: years-out on future 1sts, FAAB-inclusive sample, and
   putting VA back *after* assigning pick values (this pass’s VA never
   sees the pick, so a stud+1st vs a package gets no consolidation credit
   for the 1st).
4. **10 FAAB trades and 19 originally-unpriced rookies** are the obvious
   sample expanders. Live fallback recovered 16 of those rookies; the
   remaining hole is FAAB, not KTC.

---

## 6. Methods (detail)

- Position multipliers: pass-2 mixed-position KTC-weighted ratios.
- VA: `site/src/tradeCalculator/ktcValueAdjustment.js`, player values only.
- Current-year slot: Sleeper `slot_to_roster_id` on the 2025 and 2026
  linear rookie drafts, keyed by original `roster_id` on the traded pick.
- OLS: no intercept, 400-resample bootstrap percentile interval.
- 2024 startup rounds > 4 excluded; one 2024-startup-only trade dropped.
