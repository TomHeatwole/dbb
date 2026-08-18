# Hwang player-only trades vs KTC + Value Adjustment (pass 2)

**Question:** Ignoring picks, do Hwang player-for-player trades reveal a
positional KTC bias (QBs overvalued, WRs undervalued, etc.) once packages
are scored with the site trade calculator — historical SF TE+ KTC on the
trade date plus the KTC-style consolidation Value Adjustment?

**Answer:** After Value Adjustment, these trades are mostly KTC-even.
**9 of 13** fully priced no-pick trades land inside the calculator’s 10%
“even” band. The leftover positional signal is small: RB and TE sit ~4–6%
on the expensive-KTC side, QB ~1% cheap, WR dead on par. That is *pointing*
the same way as Hwang Market (RB up, WR not), but it is not a 12% RB
coefficient. This league’s player-only market is close to KTC+VA.

**Data:** Sleeper week/leg 1, Hwang 2024–2026, 84 completed trades. Filter:
no draft picks, two teams, both sides receive at least one player. Values:
`sf_ktc_values_historical.csv` (SF TE+) on the America/New_York trade date.
Scoring: `evaluateKtcStyleTrade` from
`site/src/tradeCalculator/ktcValueAdjustment.js` — the same VA the sandbox
calculator uses. Script: `scripts/analyze_hwang_no_pick_trades.mjs`.
Payload: `example_data/hwang_no_pick_ktc.json`.

---

## 1. Funnel

| bucket | n |
|---|---:|
| Completed trades | 84 |
| Involves draft picks | 65 |
| Two-team, players, no picks | 16 |
| Fully priced on trade-date KTC | **13** |
| Missing a rookie KTC row (dropped) | 3 |
| FAAB-only / empty side | 2 |
| Not two-team | 1 |

One of the 13 has a **$1 FAAB** token (Watson/London ↔ Waddle/McCarthy).
Treated as player-only.

Shapes among the 13: 4× 2-for-2, 3× 1-for-1, 3× 1-for-2, 1× 1-for-3,
1× 2-for-3, 1× 3-for-3.

Value Adjustment applied to **3** trades (uneven counts where the stud is
the consolidating side). Median |ordinary KTC gap| **809** → median
|adjusted gap| **625**. Median adjusted imbalance **8.3%**.

Dropped (no historical KTC row for a 2025/26 rookie):

- 2025-05-26 Purdy + **Luther Burden** for Maye + Benson
- 2025-07-12 Jonathan Taylor + **DJ Giddens** for Bucky Irving
- 2026-07-28 Chris Rodriguez + **Mike Washington** for Otton + McMillan

---

## 2. What Value Adjustment does here

VA is *not* a positional fudge. It credits the side consolidating into the
best single asset when the piece counts are uneven. Three Hwang trades hit
that rule. Ordinary sums make the package look like a smash; VA closes them
to even:

| trade | ordinary | after VA | 10% even? |
|---|---|---|---|
| London (6,633) for Rice + Goedert + Ford (10,248) | package +3,615 | London +2,800 VA → **10,248 vs 9,433** | even (8%) |
| Flowers (4,583) for Warren + Spears (6,091) | package +1,508 | Flowers +1,645 VA → **6,228 vs 6,091** | even (2%) |
| Waddle (4,751) for Watson + Mayer (6,049) | package +1,298 | Waddle +1,675 VA → **6,426 vs 6,049** | even (6%) |

Without VA, those three would have been filed as “Hwang loves depth / hates
studs.” With VA they are KTC-fair consolidations. That was the point of
using the calculator.

The 1-for-2 **Dortch + Dotson (4,440) for Hopkins (2,499)** does *not* get
VA: the best asset in the trade is on the two-player side, so it is not
stud consolidation. KTC still says KobeCopters crushed a same-position WR
dump. Leave it in the list; do not let it drive a positional coefficient.

---

## 3. Every scored no-pick trade

KTC is SF TE+ on the trade date. Totals are calculator adjusted totals
(ordinary + VA on the consolidating side). “Even” = within 10%, matching
the sandbox meter.

| when | shape | side A receives (adj) | side B receives (adj) | KTC+VA |
|---|---|---|---|---|
| 2024-07-31 | 2-for-2 | Boomers: Jefferson 9,700 + Prince 1,285 (**10,985**) | KobeCopters: Chase 8,733 + Polk 3,002 (**11,735**) | even |
| 2024-08-07 | 1-for-2 | KobeCopters: Dortch 1,689 + Dotson 2,751 (**4,440**) | A&S: Hopkins 2,499 (**2,499**) | favors two WRs |
| 2024-08-07 | 2-for-3 | McCaffrey at Home: Lamar 8,736 + Rice 4,180 (**12,916**) | EIWS: Stroud 9,001 + Jamo 3,219 + Allgeier 2,328 (**14,548**) | favors EIWS (~12%) |
| 2024-08-19 | 2-for-2 | Boomers: Watson 3,414 + London 5,804 (**9,218**) | KobeCopters: Waddle 6,028 + McCarthy 4,091 (**10,119**) | even (+$1 FAAB) |
| 2024-08-23 | 1-for-1 | Let James Cook: Geno 2,591 | A&S: B. Robinson 3,216 | favors RB (~21%) |
| 2024-08-23 | 1-for-1 | Let James Cook: B. Robinson 3,216 | EIWS: Pearsall 3,379 | even |
| 2025-06-30 | 1-for-1 | PUPpy Bowl: Doubs 2,379 | Drake & Bake: Javonte 2,707 | favors RB (~13%) |
| 2025-07-21 | 2-for-2 | Boomers: Daniels 9,973 + Conklin 1,633 (**11,606**) | Pittsy: Burrow 8,267 + Mixon 3,492 (**11,759**) | even |
| 2025-07-22 | 1-for-3 | Boomers: Rice 5,295 + Goedert 2,918 + Ford 2,035 (**10,248**) | Drake & Bake: London 6,633 + **VA 2,800** (**9,433**) | even |
| 2025-07-24 | 2-for-2 | Boomers: Legette 2,808 + Roschon 2,328 (**5,136**) | Ladds: Ferguson 3,168 + Okonkwo 2,496 (**5,664**) | even |
| 2025-09-01 | 3-for-3 | aidsonballs: Herbert 6,281 + Adams 3,493 + Rhamondre 2,487 (**12,261**) | Pittsy: Cook 5,020 + Hall 4,944 + Geno 3,106 (**13,070**) | even |
| 2026-02-17 | 1-for-2 | Ladds: Flowers 4,583 + **VA 1,645** (**6,228**) | EIWS: Warren 3,333 + Spears 2,758 (**6,091**) | even |
| 2026-07-01 | 1-for-2 | PUPpy Bowl: Waddle 4,751 + **VA 1,675** (**6,426**) | Ladds: Watson 3,901 + Mayer 2,148 (**6,049**) | even |

The 2024-08-23 pair is still the Let James Cook Pearsall → Robinson → Geno
cycle from pass 1.

**Decisive after VA (outside 10%):** four trades. One is a same-position WR
dump (Hopkins). Two are RB-for-WR/QB 1-for-1s where the RB was the higher
KTC (Robinson vs Geno, Javonte vs Doubs). One is a 2024 startup-ish 2-for-3
(Lamar+Rice vs Stroud+Jamo+Allgeier) that KTC likes for the three-player
side by ~12% — and VA does not apply, because the top asset (Stroud 9,001)
is on the larger package.

---

## 4. Positional read

Framing: Hwang revealed-preference treats the two adjusted packages as
equal. Each player inherits their side’s ratio
`adj_own / adj_other`. KTC-weighted average of that ratio by position:

| position | player appearances (mixed-pos trades) | KTC-weighted mean ratio | reading |
|---|---:|---:|---|
| QB | 9 | **0.99** | ~1% cheap on KTC vs Hwang |
| WR | 16 | **1.00** | par |
| RB | 13 | **1.04** | ~4% expensive on KTC vs Hwang |
| TE | 5 | **1.06** | ~6% expensive, all in “even” trades |

“Expensive on KTC” means: to clear a Hwang-even deal, that position showed
up with slightly *more* KTC than the other side. That is the same direction
as “KTC overvalues this position relative to Hwang” — you needed extra KTC
of it to match the other side.

When the side is *net long* a position (more of that position’s KTC than
the other side), mean adjusted residual:

| net-long position | trades | mean residual for the long side |
|---|---:|---:|
| QB | 5 | **−1.6%** |
| WR | 11 | +3.3% |
| TE | 4 | +2.7% |
| RB | 10 | **+3.9%** |

QB-long sides are the ones that *lose* on KTC+VA. RB-long sides are the
ones that *win*. That is the opposite of “QBs always overvalued on KTC in
this league.” If anything, Hwang’s player-only market treats QBs as a
little cheaper than KTC and RBs as a little dearer — or, equivalently,
Hwang likes RBs more than KTC does, so an RB-heavy package still shows a
KTC surplus when the trade clears.

That lines up in *sign* with Hwang Market (RB 1.12 / WR 0.96) and with True
Sim’s RB premium. The **magnitude here is much smaller** (~4% vs 12–30%),
and the sample is 13 trades, four of them decisive, two of those a linked
cycle. Do not retune coefficients off this pass.

TE’s 1.06 sits entirely inside even trades (Ferguson/Okonkwo vs
Legette/Roschon was 9.8%). Noise.

---

## 5. What this pass is actually good for

1. **VA is doing real work.** Three consolidations that look lopsided on
   raw KTC are even once the calculator runs. Any later pick-inclusive
   estimator should keep this VA, not raw sums.
2. **Player-only Hwang is not a wild positional market.** Most of these
   deals are KTC+VA even. The leftover is a mild RB (and maybe TE) premium,
   not “QBs always overvalued.”
3. **This still cannot identify True Hwang Market Value.** 65/84 trades
   include picks. The player-only slice is the part of the market that
   already looks like KTC. The disagreement, if it exists at scale, is
   probably in how this league prices picks and pick+player packages.

---

## 6. Methods

- 1-for-1 / 2-for-2: VA does not apply (even asset counts).
- Uneven counts: VA only if the trade’s single best asset is on the
  *fewer-pieces* side (stud consolidation). Binary-search a hypothetical
  player that closes the raw-score gap; displayed VA is the ordinary-total
  difference after adding that player to the losing side.
- Even band: `|adjA − adjB| / mean(adjA, adjB) < 10%`, same as
  `EVEN_THRESHOLD` in `TradeCalculator.js`.
- Position ratio: KTC-weighted mean of `adj_own / adj_other` across player
  appearances. Mixed-position trades only for the table in §4 (drops the
  Hopkins WR-for-WR dump).
- Team names: Sleeper users/rosters; 2024 vacant roster 2 mapped to leftover
  user **Let James Cook**.
