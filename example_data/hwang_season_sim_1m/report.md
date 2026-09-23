# Hwang Dynasty — 2026 Season Simulator (1,000,000 runs)

Monte Carlo season outcomes for the current 2026 rosters, using the same engine and defaults as the web Season Simulator.

**Saved:** 2026-09-11 · **Runtime:** ~9.6 min (9 workers)

---

## Run setup

| Setting | Value |
|---|---|
| Season | 2026 |
| Iterations | 1,000,000 |
| Rosters | Current league rosters |
| Rank source | Hwang ADP |
| Variance | Open tail |
| Monotone | Quantiles |
| Playoff scoring | Both **2024 cumulative** (weeks 15–17 total) and **2025 bracket** (1v4 / 2v3 semis, week 17 final) title rates computed from the **same weekly draws** |

Reproduce: `node scripts/run_hwang_season_sim_1m.mjs --iterations 1000000`

Raw exports: [`results_summary.csv`](results_summary.csv) · [`finish_counts.csv`](finish_counts.csv) · [`meta.json`](meta.json)

---

## Headlines

- **Three-way title race:** DrakeHigginsAchane ² (~25%), The Ladds (~24%), and Swift Otton Pitts (~21%) combine for ~**70%** of championships.
- **Playoff floor is steep:** Top three teams make playoffs **80–84%** of the time; the bottom three essentially never do.
- **Cumulative vs bracket barely moves title odds:** Bracket win % differs from cumulative by at most a few tenths of a point per team — the formats disagree on *who* wins more often in paired comparisons, but aggregate rates stay tight.
- **2000-point bar:** Top teams hit **2,000+ in 14 weeks ~61–67%** of runs and **2,000+ full season ~99%**; mid-tier teams are ~30% on the 14-week mark but still ~95–98% for the full season.

---

## Results summary

Sorted by cumulative (2024-style) win %. Percentages are share of 1M runs.

| # | Team | Owner | Win % (Cum.) | Win % (Bracket) | Playoff % | Avg Finish | Avg Seed | Avg 14 Wk | Avg Playoff | Avg Total | 14-wk ≥2000 | Season ≥2000 |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | DrakeHigginsAchane ² | davisdaniel1 | 24.8% | 24.8% | 83.7% | 2.88 | 2.77 | 2048.2 | 429.7 | 2477.9 | 65.7% | 99.8% |
| 2 | The Ladds | KobeCopters | 24.1% | 23.9% | 80.1% | 3.01 | 2.97 | 2034.5 | 429.6 | 2464.1 | 61.1% | 99.7% |
| 3 | Swift Otton Pitts | dwol11 | 20.6% | 20.8% | 83.0% | 3.05 | 2.71 | 2058.5 | 421.5 | 2480.0 | 66.5% | 99.6% |
| 4 | House of Hwang | mhwang12 | 10.7% | 10.7% | 52.7% | 4.17 | 4.31 | 1934.9 | 406.9 | 2341.8 | 30.3% | 98.4% |
| 5 | Team seanjcrow | seanjcrow | 9.8% | 9.9% | 50.4% | 4.31 | 4.39 | 1927.7 | 402.7 | 2330.4 | 30.6% | 97.2% |
| 6 | Team MrZaccheaus | MrZaccheaus | 5.7% | 5.7% | 27.1% | 5.28 | 5.41 | 1849.1 | 396.6 | 2245.7 | 13.3% | 92.5% |
| 7 | Eat It While She Sleeper | GIVEDADDYASPIKE | 4.2% | 4.2% | 23.1% | 5.38 | 5.52 | 1847.0 | 395.2 | 2242.2 | 8.8% | 95.2% |
| 8 | PUPpy Bowl | sleeperdotcom | 0.0% | 0.0% | 0.0% | 8.11 | 8.11 | 1518.8 | 322.4 | 1841.2 | 0.0% | 12.0% |
| 9 | The Boomers | jheatwole | 0.0% | 0.0% | 0.0% | 8.81 | 8.81 | 1359.5 | 299.0 | 1658.5 | 0.0% | 1.5% |
| 10 | Sell for Sellers | fumland7 | 0.0% | 0.0% | 0.0% | 10.00 | 10.00 | 776.5 | 189.4 | 965.9 | 0.0% | 0.0% |

---

## Finish distribution

Count of each final standing out of 1,000,000 simulated seasons.

| Team | 1st | 2nd | 3rd | 4th | 5th | 6th | 7th | 8th | 9th | 10th |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| DrakeHigginsAchane ² | 248,304 | 220,776 | 196,995 | 170,783 | 85,891 | 51,011 | 25,479 | 745 | 16 | 0 |
| The Ladds | 240,758 | 210,464 | 187,401 | 162,022 | 98,694 | 63,804 | 35,515 | 1,298 | 44 | 0 |
| Swift Otton Pitts | 206,239 | 207,900 | 207,905 | 207,500 | 81,932 | 54,539 | 32,438 | 1,469 | 78 | 0 |
| House of Hwang | 107,383 | 124,928 | 138,548 | 156,025 | 193,130 | 161,968 | 112,474 | 5,279 | 265 | 0 |
| Team seanjcrow | 98,121 | 117,284 | 134,841 | 154,064 | 178,701 | 166,800 | 140,237 | 9,411 | 541 | 0 |
| Team MrZaccheaus | 56,900 | 64,938 | 71,163 | 77,967 | 170,426 | 228,664 | 298,896 | 28,480 | 2,566 | 0 |
| Eat It While She Sleeper | 42,278 | 53,669 | 63,093 | 71,519 | 190,033 | 265,960 | 295,220 | 17,470 | 758 | 0 |
| PUPpy Bowl | 16 | 39 | 54 | 117 | 1,151 | 6,779 | 53,351 | 761,608 | 176,885 | 0 |
| The Boomers | 1 | 2 | 0 | 3 | 42 | 475 | 6,390 | 174,240 | 818,604 | 243 |
| Sell for Sellers | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 243 | 999,757 |

---

## Notes

- **Avg 14 Wk** = regular-season points (weeks 1–14). **Avg Playoff** = weeks 15–17. **Avg Total** = full season.
- **Playoff %** uses the league’s top-4 cutoff by regular-season standing (same as the simulator UI).
- Sell for Sellers is effectively empty (~777 avg 14-wk points); PUPpy Bowl and The Boomers are tank rosters with near-zero title/playoff rates.
- This snapshot reflects rosters and Hwang ADP as of the Sep 11, 2026 run. Re-run the script after roster or engine changes for updated numbers.
