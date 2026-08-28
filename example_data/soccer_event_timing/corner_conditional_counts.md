# Poisson edge by clock bucket

ESPN PL 2023–26. **1,139** matches, **11,786** corners. Each bin uses **its own** Poisson(λ = mean corners in that bin), so a hot window is not credited as clustering just because more corners happen there.

**Edge** = empirical / Poisson − 1 on the three conditionals:

| | |
|---|---|
| 1 → 2 | `P(n ≥ 2 \| n ≥ 1)` |
| 1 → 3 | `P(n ≥ 3 \| n ≥ 1)` |
| 2 → 3 | `P(n ≥ 3 \| n ≥ 2)` |

**Punchline:** the known hot pockets are hotter *rates*, not fatter tails. Pooled **51–70** (the regular-time hot block) is **+0% / +7% / +7%** over Poisson. Pooled **1–5 + 26–30 + 76–80** (the cold bins) is **+5% / +2% / −3%**. Every regular-time 1 → 2 edge is inside a 95% Wilson interval of Poisson. You cannot harvest extra 2+ from “this is a hot minute” beyond Poisson at that minute’s λ.

`*` = Poisson sits outside the empirical 95% CI (real). Everything else is noise at this sample size (~400–500 bins with a first corner, ~100 with a second).

---

## 5-minute

Rate is mean / regular-time mean (0.51). Flat = `1.00`. `45+` / `90+` are not 5 minutes of clock — `45+`’s huge edge is a duration bug, not clustering.

| Bin | Rate | 1 → 2 | 1 → 3 | 2 → 3 |
|---|---:|---:|---:|---:|
| 1–5 | 0.90× | **−2%** | −11% | −9% |
| 6–10 | 1.03× | **+5%** | −26% | −29% |
| 11–15 | 0.98× | **+10%** | −15% | −23% |
| 16–20 | 0.95× | **−1%** | +24% | +24% |
| 21–25 | 0.99× | **+4%** | −6% | −9% |
| 26–30 | 0.91× | **+8%** | −2% | −10% |
| 31–35 | 0.93× | **+6%** | +14% | +8% |
| 36–40 | 1.00× | **+2%** | +21% | +19% |
| 41–45 | 1.05× | **−10%** | +46%* | +61%* |
| **45+** | 0.72× | **+42%*** | +154%* | +78%* |
| 46–50 | 0.98× | **+13%** | +32% | +17% |
| **51–55** | **1.17×** | **+6%** | +13% | +7% |
| 56–60 | 1.08× | **−5%** | +12% | +18% |
| 61–65 | 1.10× | **−9%** | +11% | +22% |
| 66–70 | 1.07× | **+8%** | −12% | −18% |
| 71–75 | 0.98× | **0%** | +53%* | +53%* |
| 76–80 | 0.91× | **+9%** | +21% | +10% |
| 81–85 | 0.97× | **+2%** | +18% | +16% |
| 86–90 | 0.98× | **+2%** | +9% | +7% |
| **90+** | **1.50×** | **+5%** | +12% | +7% |
| *regular, pooled* | 1.00× | **+3%** | +12% | +9% |
| *51–70, pooled* | 1.10× | **+0%** | +7% | +7% |
| *cold 1–5/26–30/76–80* | 0.91× | **+5%** | +2% | −3% |

**51–55** is the hottest regular 5 minutes (1.17× rate) and only **+6%** on 1 → 2 — Poisson already prices the extra corners. **90+** is the same: 1.50× rate, **+5%** residual. The restart **46–50** is the largest regular 1 → 2 number (**+13%**) and is still inside the CI.

The two regular bins that *do* reject Poisson are both on triples, not doubles: **41–45** and **71–75** (2 → 3 ≈ +50–60%). Those are ~100 doubles / ~25 triples each. Real enough to note, not a clock-wide regime. 41–45 is the end of the first half; 71–75 is not a known rate hot spot.

---

## 10-minute

Rate vs regular 10-minute mean (1.02). `41–45+` and `86–90+` mix 5 minutes of regular time with stoppage.

| Bin | Rate | 1 → 2 | 1 → 3 | 2 → 3 |
|---|---:|---:|---:|---:|
| 1–10 | 0.97× | **+2%** | −3% | −4% |
| 11–20 | 0.97× | **+2%** | +12% | +10% |
| 21–30 | 0.95× | **+8%** | −9% | −16% |
| 31–40 | 0.97× | **0%** | +6% | +6% |
| 41–45+ | 0.89× | **+1%** | +26%* | +24%* |
| **46–55** | **1.07×** | **+2%** | +10% | +9% |
| **56–65** | **1.09×** | **+4%** | −2% | −6% |
| 66–75 | 1.03× | **−7%** | +10% | +18%* |
| 76–85 | 0.95× | **−3%** | +9% | +12% |
| **86–90+** | **1.24×** | **−1%** | +5% | +6% |
| *regular, pooled* | 1.00× | **+1%** | +5% | +4% |

Hot 10-minute pockets (`46–55`, `56–65`, `86–90+`) are **+2% / +4% / −1%** on 1 → 2. No extra double. The end-of-half 10-minute bin (`41–45+`) again shows the triple bump, same as 41–45.

---

## What to take

1. **Do not add a clustering bump in 51–55 or 90+.** Raise λ to the histogram. Poisson 1 → 2 / 1 → 3 / 2 → 3 at that λ is the price.
2. **1 → 2 is Poisson everywhere that is actually 5 or 10 minutes of clock.** The only 1 → 2 that rejects Poisson is `45+`, which is ~3 minutes tagged as a 5-minute bin.
3. **Triples have a couple of late-half nits (41–45, 71–75)** at ~+50% on 2 → 3. If you shade 3+ anywhere, shade those two windows, not the 51–70 rate peak.
4. Sample: 1 → 2 is estimated off ~420–500 firsts per 5-minute bin. 2 → 3 is ~100 doubles. Treat 1 → 3 / 2 → 3 wiggles of ±20% as noise unless starred.

Source: `espn_pl_corners.csv`. Same universe as `espn_pl_corner_histogram.md` (all commentary games; 44 boxscore mismatches kept).
