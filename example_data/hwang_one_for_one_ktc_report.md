# Hwang 1-for-1 Player Trades vs Trade-Date KTC (pass 1)

**Question:** In strict one-player-for-one-player swaps (no picks, no packages,
no FAAB), does Hwang’s market systematically disagree with KTC by position —
e.g. QBs overvalued, WRs undervalued?

**Answer:** There is almost no sample. **3 of 84** completed trades qualify.
All three are cross-position. Two of them are an eight-minute three-team cycle
on 2024-08-23. The remaining independent swap is Javonte Williams for Romeo
Doubs. Nothing here supports a positional KTC bias.

**Data:** Sleeper `transactions/1` for Hwang league IDs 2024–2026 (84 completed
trades). KTC is SF TE+ from `site/public/data/sf_ktc_values_historical.csv`,
looked up on the America/New_York calendar date of the trade (exact-date hits
for all three). Script: `scripts/analyze_hwang_one_for_one_trades.py`. Payload:
`example_data/hwang_one_for_one_ktc.json`.

---

## 1. Funnel

| bucket | n | share of 84 |
|---|---:|---:|
| Completed trades, 2024–2026 | 84 | 100% |
| Involves draft picks | 65 | 77% |
| Multi-player package (no picks) | 12 | 14% |
| FAAB involved, no picks | 3 | 4% |
| Not a two-team trade | 1 | 1% |
| **Strict 1-for-1 players** | **3** | **4%** |

No 2026 1-for-1s. No same-position 1-for-1s. No TE in the sample.

This league does not trade players straight up. The next passes (picks,
2-for-1s) are where the market actually lives.

---

## 2. Every 1-for-1 player trade

KTC values are SF TE+ on the trade date. Gap is higher KTC minus lower KTC.

| when | team receives | for | pair | KTC | gap |
|---|---|---|---|---:|---:|
| 2024-08-23 9:42 PM ET | Eat It While She Sleeper: **Ricky Pearsall** (WR) | Let James Cook: **Brian Robinson** (RB) | WR–RB | 3,379 vs 3,216 | +163 (5%) to WR |
| 2024-08-23 9:50 PM ET | Adam(s) and Steve(nson): **Brian Robinson** (RB) | Let James Cook: **Geno Smith** (QB) | RB–QB | 3,216 vs 2,591 | +625 (24%) to RB |
| 2025-06-30 6:04 PM ET | Drake & Bake: **Javonte Williams** (RB) | PUPpy Bowl: **Romeo Doubs** (WR) | RB–WR | 2,707 vs 2,379 | +328 (14%) to RB |

Median KTC ratio (high/low) = **1.14**. These were close to KTC-even deals, not
wild positional mismatches.

### The August 23 cycle

Trades 1 and 2 cleared eight minutes apart, with Let James Cook in the middle:

1. Pearsall → Eat It While She Sleeper; Brian Robinson → Let James Cook
2. Brian Robinson → Adam(s) and Steve(nson); Geno → Let James Cook

Brian Robinson is a pass-through. Net that night:

| team | net in | net out | KTC in | KTC out |
|---|---|---|---:|---:|
| Eat It While She Sleeper | Pearsall (WR) | Brian Robinson (RB) | 3,379 | 3,216 |
| Adam(s) and Steve(nson) | Brian Robinson (RB) | Geno (QB) | 3,216 | 2,591 |
| Let James Cook | Geno (QB) | Pearsall (WR) | 2,591 | 3,379 |

So the independent market events are closer to **two**, not three: one
three-team WR/RB/QB cycle, plus Javonte ↔ Doubs a year later.

Let James Cook later left; 2024 roster 2 is vacant in the current Sleeper
payload. The 2024 user list still has **Let James Cook** (`mehrj14`) as the
unattached owner, and that account created the Pearsall trade, so the name is
the contemporaneous one.

---

## 3. KTC positional gaps

Framing: a 1-for-1 is (noisily) a Hwang-market equality. If KTC overvalues
position A, A should show up as the **higher-KTC** side of the swap.

| position | times in a 1-for-1 | mean KTC minus other | times KTC-higher |
|---|---:|---:|---:|
| QB | 1 | −625 (−19%) | 0 / 1 |
| RB | 3 | +263 (+11%) | 2 / 3 |
| WR | 2 | −82 (−4%) | 1 / 2 |
| TE | 0 | — | — |

Pair view:

| pair | n | KTC note |
|---|---:|---|
| QB–RB | 1 | Geno 2,591 vs Brian Robinson 3,216. QB was the cheaper side. |
| RB–WR | 2 | One each way, and both gaps are small (5% and 14%). |
| anything involving TE | 0 | — |
| same-position | 0 | — |

The usual hypothesis (“QBs always overvalued on KTC / WRs always undervalued”)
does **not** show up. The only QB in the sample was traded *below* the RB’s
KTC, and the three-team net is Geno (2,591) for Pearsall (3,379) — someone
gave 788 KTC of WR to buy a cheaper QB. That is the opposite of “you have to
overpay in KTC to get a QB.” It is also one mid-tier QB in an August 2024
roster shuffle. It is not a law.

RB is the higher-KTC side in two of three prints, which is at least *pointing*
the same direction as the True Sim RB premium, but n=3 with a linked cycle is
not evidence.

---

## 4. Why this pass is empty

Hwang does not clear player-for-player. 77% of historical trades include
picks. Another 14% are multi-player packages. Strict 1-for-1s are the leftover
4%, and half of that leftover is one three-team execute.

That is useful negative information: **True Hwang Market Value cannot be
identified from 1-for-1 positional swaps.** Any later estimator needs to price
picks and uneven packages, or there is nothing to fit.

---

## 5. Methods

- Universe: every `type=trade`, `status=complete` transaction on Sleeper
  week/leg 1 for league IDs `1119869508891660288` (2024),
  `1194868087212167168` (2025), `1326575946462920704` (2026). Weeks 0 and 2–25
  are empty for every year.
- 1-for-1 rule: exactly two rosters, empty `draft_picks`, no FAAB amounts,
  `adds` maps exactly one player onto each roster.
- KTC: `sf_ktc_values_historical.csv` (non-TEP board with TE+ overlay). Exact
  trade-date match for all three players (`ktc_slack_days = 0`).
- Team names: Sleeper `users` + `rosters`. 2024 roster 2 has `owner_id = null`
  today; mapped to the leftover 2024 user **Let James Cook**.
