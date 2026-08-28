# Once a corner lands, is another one coming?

ESPN Premier League commentary, every completed match in **2023-24, 2024-25, and 2025-26**. **1,139** matches (one 2025-26 game had no commentary and is out). **11,786** corners, **10.35** per match. 44 games are off-by-one vs the box score; they stay in. Dropping them does not move any headline number by more than half a point.

**Punchline:** for *match totals* in a clock-aligned bucket, no. Given a first corner in a 5-minute window, a second arrives **24.1%** of the time — almost exactly the Poisson / binomial null (**23.4–23.7%**). That is *lower* than the 39.7% chance a random 5-minute bucket has at least one corner, because the first one often eats most of the window. The clustering you can feel is **same-team**: given a team has already won one in the bucket, they win a second **18.0%** of the time vs **13.7%** after you give them their match volume, and **11.0%** under a naive Poisson.

| Given… in the same bucket | Then… | 5-min | vs no-cluster | 10-min | vs no-cluster |
|---|---|---:|---:|---:|---:|
| 1st | 2nd | **24.1%** | 1.02× | **43.0%** | 1.00× |
| 1st | 3rd | **4.3%** | 1.08× | **13.8%** | 1.02× |
| 2nd | 3rd | **17.8%** | 1.07× | **32.1%** | 1.02× |

“No-cluster” is a binomial that already knows the match’s total corners and the clock shape. Homogeneous Poisson is almost the same. Match-total corners in 5- and 10-minute pockets are **not** a clustered process. Team corners are.

---

## What these conditionals are

For each match and each clock bucket, `n` = corners (both teams, unless noted).

| Name | Definition | Plain English |
|---|---|---|
| 1st → 2nd | `P(n ≥ 2 \| n ≥ 1)` | A first corner happened in this bucket. Does a second? |
| 1st → 3rd | `P(n ≥ 3 \| n ≥ 1)` | A first happened. Do we get to three? |
| 2nd → 3rd | `P(n ≥ 3 \| n ≥ 2)` | We already have two. Does a third arrive? |

Two baselines that are easy to mix up:

1. **Unconditional `P(n ≥ 2)`** — chance a *random* bucket has two or more. The conditional is always larger (`P(n ≥ 2 \| n ≥ 1) = P(n ≥ 2) / P(n ≥ 1)`). That comparison is true by arithmetic and is not evidence of clustering.
2. **`P(n ≥ 1)`**, the “regular” chance a bucket has a corner at all. Under a Poisson process this is *larger* than `P(n ≥ 2 \| n ≥ 1)`, because the first event uses up random time in the window. Clustering has to be strong enough to overcome that.

The fair clustering test is empirical vs Poisson/binomial with the same mean.

**Buckets.** Regular 5-minute: `1–5` … `41–45`, `46–50` … `86–90` (18 bins; `45+` / `90+` held out). Regular 10-minute: `1–10` … `31–40`, `46–55` … `76–85` (8 true 10-minute bins; last five of each half held out so every bin is the same width). 95% Wilson intervals.

---

## Match totals: 5-minute buckets

20,502 match-bins. Mean **0.51** corners / bin. Variance **0.52**. Dispersion **1.03** — Poisson lives here.

| | Empirical | 95% CI | Poisson(λ=0.51) | Binomial (match total × clock) |
|---|---:|---:|---:|---:|
| P(≥ 1) | 39.7% | 39.0–40.4 | 40.0% | — |
| P(≥ 2) | 9.5% | 9.1–10.0 | 9.4% | — |
| P(≥ 3) | 1.7% | 1.5–1.9 | 1.5% | — |
| **1st → 2nd** | **24.1%** | 23.1–25.0 | 23.4% | 23.7% |
| **1st → 3rd** | **4.3%** | 3.9–4.8 | 3.8% | 4.0% |
| **2nd → 3rd** | **17.8%** | 16.2–19.6 | 16.3% | 16.7% |

Count histogram: 0: 12,368 · 1: 6,177 · 2: 1,608 · 3: 304 · 4: 39 · 5: 6.

So: **once a first corner has occurred, a second follows 24% of the time, a third 4%.** That 24% is *not* higher than the 40% “does this bucket have a corner?” rate. It is 0–1 percentage points above a no-clustering model — detectable with 20k bins, useless as a betting adjustment on totals.

Triples are the only place a bit of extra mass shows up (1.08× vs binomial). Four-plus is 45 bins in the whole sample.

---

## Match totals: 10-minute buckets

9,112 match-bins. Mean **1.02**. Dispersion **1.04**. Same story, even closer to the null.

| | Empirical | 95% CI | Poisson(λ=1.02) | Binomial (match total × clock) |
|---|---:|---:|---:|---:|
| P(≥ 1) | 63.3% | 62.3–64.2 | 64.0% | — |
| P(≥ 2) | 27.2% | 26.3–28.1 | 27.2% | — |
| P(≥ 3) | 8.7% | 8.2–9.3 | 8.4% | — |
| **1st → 2nd** | **43.0%** | 41.7–44.3 | 42.5% | 42.8% |
| **1st → 3rd** | **13.8%** | 12.9–14.7 | 13.2% | 13.5% |
| **2nd → 3rd** | **32.1%** | 30.3–33.9 | 31.0% | 31.6% |

Folding the awkward half-ends (`41–45+`, `86–90+`) back in does not change the picture: 1st → 2nd **43.3%** vs Poisson **42.9%**.

---

## Remaining time is the whole 5-minute effect

The 24.1% is an average over *when* the first corner landed. Split on minutes left in the aligned bucket:

| First corner’s remaining minutes | P(a 2nd still arrives in this bucket) | n |
|---:|---:|---:|
| 4 (opened the bin) | **38.0%** | 1,975 |
| 3 | 29.7% | 1,811 |
| 2 | 23.8% | 1,612 |
| 1 | 16.6% | 1,483 |
| 0 (last minute) | 3.1% | 1,253 |

Open the bin and 38% get another — basically the unconditional 39.7% “is there a corner in a 5-minute pocket?” Last minute of the bin and you are almost done. Mean first-corner position is the middle of the bin, which is why the pooled number sits at 24%.

Same pattern in 10-minute bins: first-minute **61.6%**, last-minute **4.3%**, pooled 43.0%. Unconditional P(≥ 1) is 63%.

**Do not use the pooled 24% / 43% as a live price unless you also know remaining time in the bucket.** They are the right numbers for “this clock bucket already has a corner, we don’t know when.”

---

## Where clustering actually is: same team

A team-bin is `(match, team, bucket)`. Mean **0.23** corners per 5-minute team-bin. Dispersion **1.18** — now we are overdispersed.

| | Empirical | Poisson(λ=0.23) | Binomial (that team’s match total × clock) | Lift vs binomial |
|---|---:|---:|---:|---:|
| P(team ≥ 1) | 18.9% | 20.4% | — | — |
| **1st → 2nd** | **18.0%** | 11.0% | 13.7% | **1.32×** |
| **1st → 3rd** | **2.8%** | 0.8% | 1.4% | **1.97×** |
| **2nd → 3rd** | **15.6%** | 7.5% | 10.4% | **1.49×** |

10-minute team-bins, same pattern, a bit diluted:

| | Empirical | Poisson | Binomial | Lift vs binomial |
|---|---:|---:|---:|---:|
| P(team ≥ 1) | 33.0% | 36.6% | — | — |
| **1st → 2nd** | **29.1%** | 21.0% | 25.5% | **1.14×** |
| **1st → 3rd** | **7.2%** | 3.1% | 5.1% | **1.41×** |
| **2nd → 3rd** | **24.7%** | 14.6% | 19.9% | **1.24×** |

Naive Poisson overstates the clustering because some teams (and some matches) simply win a lot of corners all game. The binomial already hands each team its full-match total. What remains is **short-window siege**: once a team has a corner in this pocket, they are 32% more likely to get a second in the same 5 minutes, and twice as likely to get to three, than their match rate plus the clock would say.

That is why match *totals* look Poisson. When team A is camping in the box, team B is not — the extra A corners replace B corners in the same window, so the combined count barely overdisperses.

---

## Live: next 5 / 10 minutes from *this* corner

Clock-aligned buckets are the wrong object if a corner just happened and you can bet the next few minutes. Restrict to corners with a full 5 (resp. 10) minutes of regular time left in the half:

| After a corner, with room on the clock | Empirical | Compare to |
|---|---:|---|
| Another (either team) within 5 min | **42.5%** | 39.7% of random 5-min buckets have ≥ 1 |
| Another (either team) within 10 min | **65.2%** | 63.3% of random 10-min buckets have ≥ 1 |
| Same team within 5 min | **29.3%** | 18.9% of random 5-min *team*-bins have ≥ 1 |
| Same team within 10 min | **45.0%** | 33.0% of random 10-min team-bins have ≥ 1 |

Either-team forward windows are only a couple of points above the bucket base rate. **Same-team forward 5 minutes is the clustered event: 29% vs 19%.**

---

## 5-minute bins (match totals)

Lift is empirical 1st → 2nd vs Poisson at that bin’s own mean. `n≥1` is the sample for the conditionals (out of 1,139 matches).

| Bin | Mean | P(≥1) | 1st→2nd | Poisson | Lift | 1st→3rd | 2nd→3rd | n≥1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1–5 | 0.46 | 37.3% | 20.9% | 21.4% | 0.98 | 2.8% | 13.5% | 425 |
| 6–10 | 0.53 | 40.9% | 25.3% | 24.1% | 1.05 | 3.0% | 11.9% | 466 |
| 11–15 | 0.50 | 39.1% | 25.4% | 23.1% | 1.10 | 3.1% | 12.4% | 445 |
| 16–20 | 0.49 | 38.5% | 22.3% | 22.4% | 1.00 | 4.3% | 19.4% | 439 |
| 21–25 | 0.51 | 39.7% | 24.1% | 23.2% | 1.04 | 3.5% | 14.7% | 452 |
| 26–30 | 0.46 | 36.7% | 23.2% | 21.4% | 1.08 | 3.1% | 13.4% | 418 |
| 31–35 | 0.47 | 37.1% | 23.2% | 21.8% | 1.06 | 3.8% | 16.3% | 423 |
| 36–40 | 0.51 | 39.7% | 23.9% | 23.5% | 1.02 | 4.6% | 19.4% | 452 |
| 41–45 | 0.54 | 41.7% | 22.1% | 24.5% | 0.90 | 6.1% | 27.6% | 475 |
| 46–50 | 0.50 | 38.2% | 26.0% | 22.9% | 1.13 | 4.8% | 18.6% | 435 |
| 51–55 | 0.60 | 44.3% | 28.5% | 26.9% | 1.06 | 5.7% | 20.1% | 505 |
| 56–60 | 0.55 | 42.7% | 23.9% | 25.1% | 0.95 | 4.9% | 20.7% | 486 |
| 61–65 | 0.56 | 43.5% | 23.2% | 25.5% | 0.91 | 5.0% | 21.7% | 496 |
| 66–70 | 0.55 | 41.5% | 26.8% | 24.8% | 1.08 | 3.8% | 14.2% | 473 |
| 71–75 | 0.50 | 38.9% | 23.0% | 23.1% | 1.00 | 5.6% | 24.5% | 443 |
| 76–80 | 0.47 | 36.2% | 23.5% | 21.5% | 1.09 | 3.9% | 16.5% | 412 |
| 81–85 | 0.50 | 38.7% | 23.4% | 22.9% | 1.02 | 4.3% | 18.4% | 441 |
| 86–90 | 0.50 | 39.3% | 23.4% | 23.1% | 1.02 | 4.0% | 17.1% | 448 |
| **45+** | 0.37 | 28.4% | 24.7% | 17.3% | 1.42 | 5.2% | 21.3% | 324 |
| **90+** | 0.77 | 52.1% | 35.1% | 33.5% | 1.05 | 8.9% | 25.5% | 593 |

No regular-time pocket is a clustering regime. Lifts bounce around 0.90–1.13 with `n≥1` ≈ 450; that is noise. **51–55** is the hottest *rate* bin (mean 0.60, P(≥1) 44%) and only 1.06× its own Poisson once a first has landed.

Stoppage is a different length of clock. `45+` looks clustered on a 5-minute Poisson (lift 1.42) because the bin is ~3 minutes of added time, not 5; do not read it as 5-minute clustering. `90+` is busier (mean 0.77) and only 1.05× its own Poisson.

---

## 10-minute bins (match totals)

| Bin | Mean | P(≥1) | 1st→2nd | Poisson | Lift | 1st→3rd | 2nd→3rd | n≥1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1–10 | 0.99 | 62.7% | 42.3% | 41.5% | 1.02 | 12.2% | 28.8% | 714 |
| 11–20 | 0.99 | 61.7% | 42.5% | 41.5% | 1.02 | 14.1% | 33.1% | 703 |
| 21–30 | 0.97 | 61.5% | 43.9% | 40.8% | 1.08 | 11.0% | 25.0% | 701 |
| 31–40 | 0.99 | 62.0% | 41.4% | 41.4% | 1.00 | 13.2% | 31.8% | 706 |
| 46–55 | 1.10 | 65.3% | 45.7% | 45.0% | 1.01 | 16.4% | 35.9% | 744 |
| 56–65 | 1.11 | 66.7% | 47.6% | 45.6% | 1.04 | 15.0% | 31.5% | 760 |
| 66–75 | 1.05 | 64.9% | 40.6% | 43.4% | 0.93 | 15.2% | 37.3% | 739 |
| 76–85 | 0.97 | 61.2% | 39.6% | 40.6% | 0.97 | 13.1% | 33.0% | 697 |
| **41–45+** | 0.91 | 57.7% | 39.1% | 38.6% | 1.01 | 13.5% | 34.6% | 657 |
| **86–90+** | 1.27 | 70.9% | 49.9% | 50.4% | 0.99 | 19.8% | 39.7% | 808 |

Clock changes the *base rate*, not the conditional lift. Early-second-half 10-minute pockets are hotter on means (`46–55`, `56–65`); they are not hotter on 1st → 2nd given that mean.

---

## What this means for a next-5 / next-10 corner model

1. **Do not bump match-total 2+ / 3+ in a clock bucket just because one corner has landed**, beyond the mechanical `P(n ≥ k | n ≥ 1) = P(n ≥ k) / P(n ≥ 1)` from the Poisson (or from remaining time). A 1.02× clustering multiplier on 5-minute totals is in the noise for pricing.

2. **Do bump the *winning team’s* next-corner rate.** Same-team 1st → 2nd in a 5-minute bucket is **1.32×** a volume-aware binomial, 1st → 3rd is **1.97×**. A live attack-state / “this team just won a corner” flag belongs in the model; a generic “corners cluster” flag on the match total does not.

3. **Condition on remaining time, not on “this 0–5 / 5–10 bucket already has one.”** Remainder table: 38% → 3% as the first corner slides from minute 0 to minute 4 of a 5-minute bin. If the market is “corners in 20:00–25:00” and it is 23:00 with one already in, you want ~17%, not 24%.

4. **Forward 5 minutes from the event ≈ the bucket base rate for either team (43% vs 40%), and a real bump for the same team (29% vs 19%).** That is the number to use if you can bet a rolling window rather than a pre-aligned bucket.

5. **Overdispersion of match-bin totals is ~1.03.** A Poisson (or independent Bernoulli-per-minute) next-5 total is not conservative on clustering grounds. If 3+ / 4+ match-bin overs look like they need a fatter tail, it is not coming from within-bucket bunching of *totals*. It would have to come from match-level λ (this is a 14-corner game) or from team-siege leaking into the total, which empirically it barely does.

6. **Stoppage is its own market.** `90+` mean 0.77 in a short, intense window. Do not paste 5-minute regular-time conditionals onto added time.

---

## Footnote: 2008–16 does not change the clustering story

European Soccer Database, England Premier League, **3,039** matches / **33,252** corners (10.94 per match). Wrong file for the *clock shape* of a 2026 book — 90+ is 5.0% then vs 7.4% now — but a longer panel for within-match bunching. Same definitions, same bins.

| | ESPN 2023–26 | 2008–16 |
|---|---:|---:|
| Match 5-min 1st → 2nd | 24.1% (1.02× binomial) | 27.2% (1.06×) |
| Match 5-min 1st → 3rd | 4.3% (1.08×) | 5.4% (1.14×) |
| Match 5-min 2nd → 3rd | 17.8% (1.07×) | 20.0% (1.08×) |
| Match 10-min 1st → 2nd | 43.0% (1.00×) | 46.5% (1.01×) |
| Team 5-min 1st → 2nd | 18.0% (**1.32×**) | 19.5% (**1.33×**) |
| Team 5-min 1st → 3rd | 2.8% (**1.97×**) | 3.2% (**1.98×**) |
| Team 5-min 2nd → 3rd | 15.6% (**1.49×**) | 16.6% (**1.49×**) |
| Same-team forward 5 min | 29.3% | 28.5% |

Match totals were a hair more bunched in the old file (1.06× vs 1.02× on 5-minute 1st → 2nd). That is still not a pricing adjustment. **Same-team siege lift vs a volume-aware binomial is identical to two decimals** across a decade and a change of data source. Use ESPN for the live book; 2008–16 is a replication check, not a second model.

---

## Method

- Focus file: `espn_pl_corners.csv` from `scripts/scrape_espn_pl_corners.py`. Seasons 2023 (380), 2024 (380), 2025 (379). Dropped the one game with `note = no commentary`. Kept 44 boxscore-mismatch games (almost all off-by-one).
- Clock: `elapsed` / `elapsed_plus` as tagged (`45'+1'` → `45+`, `90'+3'` → `90+`). Minute `0` folded into `1–5`.
- Poisson null: single λ = mean of the pooled match-bins (or team-bins).
- Binomial null: for each match (or team-match), `n_bin ~ Binomial(N, p_bin)` with `N` = that unit’s corners in the bins being analyzed and `p_bin` = empirical clock share. This already includes “some matches / teams take more corners.” Lift vs this is leftover *within-window* bunching.
- Forward windows use minute resolution (ESPN `elapsed`), same half, `elapsed_plus = 0`. “Full room” requires `elapsed + width` still inside 1–45 or 46–90.
- Remaining-time table: first corner of that match-bin only, so it matches `P(n ≥ 2 | n ≥ 1)` when pooled.
- Footnote file: `corner_timing.csv` filtered to `England Premier League`. Team-bins use whatever team IDs appear in the match (109 matches show only one team in the corner file; that slightly inflates old-file team `P(≥ 1)` and does not touch the 1st → 2nd / 3rd conditionals).
