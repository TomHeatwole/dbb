# Once a corner lands, is another one coming?

ESPN Premier League commentary, **2023–24 through 2025–26**. **1,095** matches where commentary corner count matches the box score (45 games dropped for mismatches / missing commentary). **11,260** corners, **10.28** per match.

**Punchline:** for *match totals* in a clock-aligned bucket, no. Given a first corner in a 5-minute window, a second arrives **23.9%** of the time — almost exactly the Poisson / binomial null (**23.3–23.6%**). That is *lower* than the 39.5% chance a random 5-minute bucket has at least one corner, because the first one often eats most of the window. The clustering you can feel is **same-team**: given a team has already won one in the bucket, they win a second **18%** of the time vs **14%** after you give them their match volume, and **11%** under a naive Poisson.

| Given… in the same bucket | Then… | 5-min | vs no-cluster | 10-min | vs no-cluster |
|---|---|---:|---:|---:|---:|
| 1st | 2nd | **23.9%** | 1.02× | **42.8%** | 1.00× |
| 1st | 3rd | **4.3%** | 1.09× | **13.6%** | 1.02× |
| 2nd | 3rd | **17.8%** | 1.07× | **31.7%** | 1.01× |

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

19,710 match-bins. Mean **0.51** corners / bin. Variance **0.52**. Dispersion **1.03** — Poisson lives here.

| | Empirical | 95% CI | Poisson(λ=0.51) | Binomial (match total × clock) |
|---|---:|---:|---:|---:|
| P(≥ 1) | 39.5% | 38.8–40.2 | 39.9% | — |
| P(≥ 2) | 9.5% | 9.1–9.9 | 9.3% | — |
| P(≥ 3) | 1.7% | 1.5–1.9 | 1.5% | — |
| **1st → 2nd** | **23.9%** | 23.0–24.9 | 23.3% | 23.6% |
| **1st → 3rd** | **4.3%** | 3.8–4.7 | 3.8% | 3.9% |
| **2nd → 3rd** | **17.8%** | 16.1–19.6 | 16.2% | 16.6% |

Count histogram: 0: 11,927 · 1: 5,920 · 2: 1,532 · 3: 289 · 4: 36 · 5: 6.

So: **once a first corner has occurred, a second follows 24% of the time, a third 4%.** That 24% is *not* higher than the 39% “does this bucket have a corner?” rate. It is 1–2 percentage points above a no-clustering model — detectable with 19k bins, useless as a betting adjustment on totals.

Triples are the only place a bit of extra mass shows up (1.09× vs binomial). Four-plus is 42 bins in the whole sample.

---

## Match totals: 10-minute buckets

8,760 match-bins. Mean **1.02**. Dispersion **1.03**. Same story, even closer to the null.

| | Empirical | 95% CI | Poisson(λ=1.02) | Binomial (match total × clock) |
|---|---:|---:|---:|---:|
| P(≥ 1) | 63.1% | 62.1–64.1 | 63.8% | — |
| P(≥ 2) | 27.0% | 26.1–28.0 | 27.0% | — |
| P(≥ 3) | 8.6% | 8.0–9.2 | 8.3% | — |
| **1st → 2nd** | **42.8%** | 41.5–44.1 | 42.3% | 42.7% |
| **1st → 3rd** | **13.6%** | 12.7–14.5 | 13.0% | 13.4% |
| **2nd → 3rd** | **31.7%** | 29.9–33.6 | 30.8% | 31.4% |

Folding the awkward half-ends (`41–45+`, `86–90+`) back in does not change the picture: 1st → 2nd **43.2%** vs Poisson **42.8%**.

---

## Remaining time is the whole 5-minute effect

The 23.9% is an average over *when* the first corner landed. Split on minutes left in the aligned bucket:

| First corner’s remaining minutes | P(a 2nd still arrives in this bucket) | n |
|---:|---:|---:|
| 4 (opened the bin) | **37.4%** | 1,882 |
| 3 | 29.8% | 1,733 |
| 2 | 23.9% | 1,549 |
| 1 | 16.6% | 1,407 |
| 0 (last minute) | 3.2% | 1,212 |

Open the bin and 37% get another — basically the unconditional 39.5% “is there a corner in a 5-minute pocket?” Last minute of the bin and you are almost done. Mean first-corner position is the middle of the bin (minute offset 2.0 of 0–4), which is why the pooled number sits at 24%.

Same pattern in 10-minute bins: first-minute **60.8%**, last-minute **4.4%**, pooled 42.8%. Unconditional P(≥ 1) is 63%.

**Do not use the pooled 24% / 43% as a live price unless you also know remaining time in the bucket.** They are the right numbers for “this clock bucket already has a corner, we don’t know when.”

---

## Where clustering actually is: same team

A team-bin is `(match, team, bucket)`. Mean **0.23** corners per 5-minute team-bin. Dispersion **1.18** — now we are overdispersed.

| | Empirical | Poisson(λ=0.23) | Binomial (that team’s match total × clock) | Lift vs binomial |
|---|---:|---:|---:|---:|
| P(team ≥ 1) | 18.7% | 20.3% | — | — |
| **1st → 2nd** | **17.9%** | 10.9% | 13.6% | **1.31×** |
| **1st → 3rd** | **2.8%** | 0.8% | 1.4% | **2.00×** |
| **2nd → 3rd** | **15.8%** | 7.4% | 10.4% | **1.52×** |

10-minute team-bins, same pattern, a bit diluted:

| | Empirical | Poisson | Binomial | Lift vs binomial |
|---|---:|---:|---:|---:|
| P(team ≥ 1) | 32.8% | 36.3% | — | — |
| **1st → 2nd** | **29.0%** | 20.9% | 25.4% | **1.14×** |
| **1st → 3rd** | **7.1%** | 3.0% | 5.1% | **1.41×** |
| **2nd → 3rd** | **24.6%** | 14.5% | 19.9% | **1.24×** |

Naive Poisson overstates the clustering because some teams (and some matches) simply win a lot of corners all game. The binomial already hands each team its full-match total. What remains is **short-window siege**: once a team has a corner in this pocket, they are 31% more likely to get a second in the same 5 minutes, and twice as likely to get to three, than their match rate plus the clock would say.

That is why match *totals* look Poisson. When team A is camping in the box, team B is not — the extra A corners replace B corners in the same window, so the combined count barely overdisperses.

---

## Live: next 5 / 10 minutes from *this* corner

Clock-aligned buckets are the wrong object if a corner just happened and you can bet the next few minutes. Restrict to corners with a full 5 (resp. 10) minutes of regular time left in the half:

| After a corner, with room on the clock | Empirical | Compare to |
|---|---:|---|
| Another (either team) within 5 min | **42.2%** | 39.5% of random 5-min buckets have ≥ 1 |
| Another (either team) within 10 min | **65.0%** | 63.1% of random 10-min buckets have ≥ 1 |
| Same team within 5 min | **29.1%** | 18.7% of random 5-min *team*-bins have ≥ 1 |
| Same team within 10 min | **44.8%** | 32.8% of random 10-min team-bins have ≥ 1 |

Either-team forward windows are only a couple of points above the bucket base rate (and only ~1.05× an exponential gap with the observed 7.1 min mean intra-half spacing). **Same-team forward 5 minutes is the clustered event: 29% vs 19%.**

Same-half regular-time gaps, either team: mean **7.1 min**, median **5**, p10 **1**, p90 **16**. `P(gap ≤ 5) = 53%` if you don’t require a full 5 minutes left (corners near 45' / 90' get a truncated window, so this is not a clean 5-minute rate).

---

## 5-minute bins (match totals)

Lift is empirical 1st → 2nd vs Poisson at that bin’s own mean. `n≥1` is the sample for the conditionals (out of 1,095 matches).

| Bin | Mean | P(≥1) | 1st→2nd | Poisson | Lift | 1st→3rd | 2nd→3rd | n≥1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1–5 | 0.47 | 37.4% | 21.0% | 21.4% | 0.98 | 2.9% | 14.0% | 410 |
| 6–10 | 0.53 | 40.6% | 25.4% | 24.0% | 1.06 | 2.9% | 11.5% | 445 |
| 11–15 | 0.50 | 38.7% | 25.5% | 22.8% | 1.12 | 2.6% | 10.2% | 424 |
| 16–20 | 0.48 | 38.2% | 21.8% | 22.1% | 0.99 | 4.1% | 18.7% | 418 |
| 21–25 | 0.51 | 39.5% | 24.7% | 23.3% | 1.06 | 3.7% | 15.0% | 433 |
| 26–30 | 0.46 | 36.5% | 22.8% | 21.2% | 1.07 | 2.8% | 12.1% | 400 |
| 31–35 | 0.47 | 36.4% | 24.1% | 21.6% | 1.11 | 4.0% | 16.7% | 399 |
| 36–40 | 0.51 | 39.1% | 23.8% | 23.1% | 1.03 | 4.7% | 19.6% | 428 |
| 41–45 | 0.53 | 41.5% | 21.1% | 24.2% | 0.87 | 5.9% | 28.1% | 454 |
| 46–50 | 0.50 | 37.9% | 26.3% | 22.8% | 1.15 | 5.1% | 19.3% | 415 |
| 51–55 | 0.59 | 43.8% | 28.3% | 26.6% | 1.07 | 5.6% | 19.9% | 480 |
| 56–60 | 0.55 | 42.6% | 23.3% | 25.0% | 0.93 | 5.1% | 22.0% | 467 |
| 61–65 | 0.56 | 43.7% | 22.5% | 25.4% | 0.89 | 4.8% | 21.3% | 479 |
| 66–70 | 0.55 | 41.5% | 26.7% | 24.8% | 1.08 | 4.0% | 14.9% | 454 |
| 71–75 | 0.50 | 38.5% | 22.5% | 22.8% | 0.99 | 5.7% | 25.3% | 422 |
| 76–80 | 0.46 | 36.1% | 23.3% | 21.4% | 1.09 | 3.8% | 16.3% | 395 |
| 81–85 | 0.51 | 39.0% | 23.9% | 23.1% | 1.03 | 4.4% | 18.6% | 427 |
| 86–90 | 0.51 | 39.5% | 23.3% | 23.1% | 1.01 | 3.9% | 16.8% | 433 |
| **45+** | 0.37 | 28.5% | 24.4% | 17.4% | 1.40 | 5.4% | 22.4% | 312 |
| **90+** | 0.76 | 51.6% | 35.0% | 33.2% | 1.06 | 8.7% | 24.7% | 565 |

No regular-time pocket is a clustering regime. Lifts bounce around 0.87–1.15 with `n≥1` ≈ 400; that is noise. **46–50** is the only regular bin that looks hot on 1st → 2nd, and it is one of the *cold* opening-the-half windows on raw rate — small-sample, not a mechanism.

Stoppage is a different length of clock. `45+` looks clustered on a 5-minute Poisson (lift 1.40) because the bin is ~2–4 minutes of added time plus whatever ESPN tagged; do not read it as 5-minute clustering. `90+` is busier (mean 0.76) and only 1.06× its own Poisson.

---

## 10-minute bins (match totals)

| Bin | Mean | P(≥1) | 1st→2nd | Poisson | Lift | 1st→3rd | 2nd→3rd | n≥1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1–10 | 0.99 | 62.6% | 42.0% | 41.5% | 1.01 | 12.2% | 29.2% | 686 |
| 11–20 | 0.98 | 61.6% | 41.9% | 41.0% | 1.02 | 13.0% | 31.1% | 675 |
| 21–30 | 0.97 | 61.3% | 44.6% | 40.7% | 1.10 | 10.7% | 24.1% | 671 |
| 31–40 | 0.97 | 61.3% | 41.1% | 40.9% | 1.01 | 13.3% | 32.2% | 671 |
| 46–55 | 1.09 | 64.8% | 45.6% | 44.7% | 1.02 | 16.3% | 35.8% | 710 |
| 56–65 | 1.11 | 66.9% | 46.9% | 45.5% | 1.03 | 14.7% | 31.4% | 733 |
| 66–75 | 1.04 | 64.7% | 40.4% | 43.2% | 0.94 | 15.0% | 37.1% | 708 |
| 76–85 | 0.97 | 61.4% | 39.7% | 40.7% | 0.98 | 13.1% | 33.0% | 672 |
| **41–45+** | 0.90 | 57.7% | 38.4% | 38.4% | 1.00 | 13.0% | 33.7% | 632 |
| **86–90+** | 1.26 | 70.8% | 49.8% | 50.2% | 0.99 | 19.5% | 39.1% | 775 |

Again: clock changes the *base rate*, not the conditional lift. Late first-half / early second-half 10-minute pockets are hotter on means (`46–55`, `56–65`); they are not hotter on 1st → 2nd given that mean.

---

## What this means for a next-5 / next-10 corner model

1. **Do not bump match-total 2+ / 3+ in a clock bucket just because one corner has landed**, beyond the mechanical `P(n ≥ k | n ≥ 1) = P(n ≥ k) / P(n ≥ 1)` from the Poisson (or from remaining time). A 1.02× clustering multiplier on 5-minute totals is in the noise for pricing.

2. **Do bump the *winning team’s* next-corner rate.** Same-team 1st → 2nd in a 5-minute bucket is **1.31×** a volume-aware binomial, 1st → 3rd is **2.0×**. A live attack-state / “this team just won a corner” flag belongs in the model; a generic “corners cluster” flag on the match total does not.

3. **Condition on remaining time, not on “this 0–5 / 5–10 bucket already has one.”** Remainder table: 37% → 3% as the first corner slides from minute 0 to minute 4 of a 5-minute bin. If the market is “corners in 20:00–25:00” and it is 23:00 with one already in, you want ~17%, not 24%.

4. **Forward 5 minutes from the event ≈ the bucket base rate for either team (42% vs 39%), and a real bump for the same team (29% vs 19%).** That is the number to use if you can bet a rolling window rather than a pre-aligned bucket.

5. **Overdispersion of match-bin totals is ~1.03.** A Poisson (or independent Bernoulli-per-minute) next-5 total is not conservative on clustering grounds. If 3+ / 4+ match-bin overs look like they need a fatter tail, it is not coming from within-bucket bunching of *totals*. It would have to come from match-level λ (this is a 14-corner game) or from team-siege leaking into the total, which empirically it barely does.

6. **Stoppage is its own market.** `90+` mean 0.76 in a short, intense window. Do not paste 5-minute regular-time conditionals onto added time.

---

## Method

- Source: `espn_pl_corners.csv` / `espn_pl_games.csv` from `scripts/scrape_espn_pl_corners.py`. Seasons 2023 (365 ok), 2024 (363), 2025 (367).
- Dropped 45 games where ESPN commentary count ≠ box-score `wonCorners` (almost all off-by-one) or commentary was missing.
- Clock: `elapsed` / `elapsed_plus` as tagged (`45'+1'` → `45+`, `90'+3'` → `90+`). Minute `0` folded into `1–5`.
- Poisson null: single λ = mean of the pooled match-bins (or team-bins).
- Binomial null: for each match (or team-match), `n_bin ~ Binomial(N, p_bin)` with `N` = that unit’s corners in the bins being analyzed and `p_bin` = empirical clock share. This already includes “some matches / teams take more corners.” Lift vs this is leftover *within-window* bunching.
- Forward windows use minute resolution (ESPN `elapsed`), same half, `elapsed_plus = 0`. “Full room” requires `elapsed + width` still inside 1–45 or 46–90.
- Remaining-time table: first corner of that match-bin only, so it matches `P(n ≥ 2 | n ≥ 1)` when pooled.
