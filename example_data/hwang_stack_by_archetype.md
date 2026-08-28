# Hwang stack vs destack, by archetype

Reference for the four paired stacking studies on the 19 competitive Hwang
archetypes, 2021–2025.

Data:

- `example_data/hwang_stack_study/` — QB + WR1 (`scripts/run_hwang_stack_study.mjs`)
- `example_data/hwang_qb_rb_stack_study/` — QB + RB1 (`scripts/run_hwang_qb_rb_stack_study.mjs`)
- `example_data/hwang_rb_committee_study/` — same-team RB1+RB2 (`scripts/run_hwang_rb_committee_study.mjs`)
- `example_data/hwang_passcatcher_study/` — same-team WR/TE doubles and triples (`scripts/run_hwang_passcatcher_study.mjs`)

Seed 1, 60 builds per archetype-year, 10% rank jitter, rank window
±max(4, 22% of slot rank). Construction is competitor-adjusted KTC.
Scoring is Hwang weekly-optimal starters, 17 weeks, 1QB / 3RB / 3WR / 1TE /
2FLEX / 1SF, 0 PPR, TE +0.5. League-winning = ≥2,500.

---

## What an archetype is

An archetype is a **rank template**, not a roster.

It is a list of positional ranks copied off one real Hwang team in one
season (QB2, RB3, WR7, …) and then emptied of those players. Each build
fills those ranks from that historical year’s board. Over 5 years × 60
draws you get hundreds of different actual clubs per template.

The names below (Let James Cook, House of Hwang, Drake & Bake, …) are
**IDs for the source team**. The players listed under “template taken
from” are the people whose competitor-adjusted ranks *defined* the
slots. They are not who got scored in 2021–2025. A “3× RB12 / 0× WR12”
template run on 2021 is three early RBs and no early WR from the 2021
board, not Bijan / Cook / Henry.

QB12 / RB12 / WR12 = positional rank ≤ 12 on the template. TE8 = TE
positional rank ≤ 8.

---

## How pairing works

Each jittered draw is destacked, then rebuilt with the stack under test.
Only the stacked positions move, and only inside the rank window of the
slot they replace:

| Study | Stack definition | Held fixed | Destack rule |
|---|---|---|---|
| QB+WR1 | That NFL team’s board QB1 + WR1 | RB, TE | Keep QB, swap WR1 off the team |
| QB+RB1 | That NFL team’s board QB1 + RB1 | WR, TE | Keep QB, swap RB1 off the team |
| RB committee | That NFL team’s ADP RB1 + RB2, RB2 still top-50 RB ADP | QB, WR, TE | Keep the higher-ADP back, swap the extra |
| WR/TE double / triple | Any 2 or 3 of that NFL team’s WRs/TEs inside top-200 overall ADP | QB, RB | Keep the highest overall-ADP catcher, swap extras |

Deltas are **stacked minus destacked twin** on the same draw. Positive =
the stack beat destacking that draw.

---

## Five-year paired totals (all templates pooled)

| Stack | n | Δ mean | Δ median | Stacked wins the coin flip | ≥2,500 vs twin | Weekly std vs twin |
|---|---:|---:|---:|---:|---|---|
| QB+WR1 | 5,700 | +2.3 | +2.3 | 51.4% | 22.9 → 22.8 | 23.8 → 24.2 |
| 2× QB+WR | 5,698 | +4.3 | +5.6 | 52.3% | 22.9 → 23.2 | 23.8 → 24.7 |
| **QB+RB1** | **5,700** | **+2.5** | **+3.2** | **52.0%** | **22.7 → 22.8** | **23.8 → 24.0** |
| **2× QB+RB** | **5,695** | **+5.8** | **+2.3** | **50.6%** | **22.7 → 23.9** | **23.8 → 24.2** |
| 1 RB committee | 5,675 | +4.5 | +5.8 | 53.3% | 22.6 → 22.8 | 23.9 → 24.0 |
| 2× RB committee | 4,781 | −0.7 | +2.5 | 50.9% | 25.3 → 25.1 | 23.9 → 23.9 |
| WR/TE double | 5,700 | −1.5 | −0.8 | 48.6% | 23.9 → 23.6 | 24.0 → 24.0 |
| WR/TE triple | 5,441 | −4.3 | −6.3 | 45.6% | 24.4 → 24.1 | 23.9 → 23.9 |

Pooled, every 1-stack is a rounding error. The interesting structure is
**which template the stack lands on**, not the five-year mean.

2× RB committee and WR/TE triples drop draws that cannot fit the extra
slots. Their destacked twins are already a stronger subset — do not
compare unmatched medians.

---

## QB+RB1 (new)

Same design as QB+WR1, swapping the partner to that NFL team’s highest
KTC RB. Examples of what got forced, by year, are whatever filled
QB1+RB1 on that year’s board (Allen/Cook, Hurts/Barkley, Jackson/Henry,
and so on — **in the historical season**, not on the source Hwang team).

Pooled it looks like QB+WR1: **+2.5 mean, 22.7% → 22.8% at 2,500**,
almost no extra weekly volatility (23.8 → 24.0; QB+WR1 went to 24.2).

By season, 1-stack mean Δ:

| Year | QB+RB1 Δ mean | ≥2,500 vs twin | 2× QB+RB Δ mean | ≥2,500 vs twin |
|---|---:|---|---:|---|
| 2021 | −6 | 16.4 → 15.6 | −4 | 16.5 → 16.7 |
| 2022 | −2 | 19.3 → 17.7 | −3 | 19.3 → 17.5 |
| 2023 | **+19** | 21.1 → 24.3 | **+34** | 21.1 → 28.3 |
| 2024 | −8 | 39.7 → 38.1 | −17 | 39.7 → 36.9 |
| 2025 | +9 | 16.9 → 18.3 | +19 | 16.9 → 20.0 |

2023 is the smash year; 2024 gives it back. That is the opposite of the
RB-committee year pattern (committees paid in 2021 and 2024, died in
2022 and 2025). A QB+RB1 stack is not a committee.

On templates, QB+RB1 **flips** the RB-heavy / WR-light rooms that hated
committees:

- 3× RB12 / 0× WR12 templates (Let James Cook 2024, aidsonballs 2025,
  MrZaccheaus 2026): committees are a tax (−8 to −27). QB+RB1 is **+19
  to +37**. You keep the early RB ranks on different NFL teams *from
  each other*, and you glue one of them to the QB.
- 3× WR12 / 0× QB12 (The Boomers 2024): QB+WR is +38 / +66. QB+RB1 is
  −9. The scarce slots are WRs; spending an early RB rank on the QB’s
  back is the wrong correlation.

---

## How to read a template (four families)

1. **Early WR, or two early QBs plus early WRs.** QB+WR pays. QB+RB and
   WR/TE triples usually do not — those WR ranks are already the scarce
   ones.
2. **Early RB and no early WR.** QB+RB pays. A second *committee* (two
   RBs, same NFL team) is a tax. Destack the backfields from each other;
   stack one of them with the QB.
3. **Two early QBs + early TE + WR depth, not three early RBs.** RB
   committees pay. QB+WR is a tax. The early QB slot is already the
   “stack”; spreading WR ranks beats gluing one to the QB.
4. **One of each (1× WR12, 1× RB12, TE8, at most 1× QB12).** Mild
   effects. A leftover mid WR/TE triple can pay; a second QB+RB usually
   does not.

---

## All 19 templates

Deltas are paired mean 17-week points vs destack, rounded. Best / worst
are across the eight stack types.

### 2024 #1 — Let James Cook (16-2)

Template taken from **2024**: Bijan Robinson (RB2), James Cook (RB6),
Derrick Henry (RB12).
Rank mix: **0× QB12 / 3× RB12 / 0× WR12 / 0× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| −6 | −1 | **+19** | **+37** | −8 | −23 | −4 | −27 |

Best: 2× QB+RB (+37). Worst: WR/TE triple (−27). Early RB ranks, no
early WR: glue one RB to the QB; do not glue two RBs to each other and
do not spend WR slots on a same-team triple.

### 2024 #2 — Age is just a number (15-3)

Template taken from **2024**: Ja'Marr Chase (WR1), Dak Prescott (QB8).
Rank mix: **1× QB12 / 0× RB12 / 1× WR12 / 0× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| +4 | **+16** | −6 | −24 | +7 | +5 | +2 | −3 |

Best: 2× QB+WR (+16). Worst: 2× QB+RB (−24). One early WR, no early RB:
QB+WR is the stack that fits; QB+RB burns the late RB ranks.

### 2024 #3 — Adam(s) and Steve(nson) (12-6)

Template taken from **2024**: Jayden Daniels (QB5), Christian McCaffrey
(RB5), Jalen Hurts (QB7), Kyle Pitts (TE7), A.J. Brown (WR8), Kenneth
Walker (RB10), DeVonta Smith (WR11).
Rank mix: **2× QB12 / 2× RB12 / 2× WR12 / 1× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| +24 | **+34** | −14 | −16 | −2 | −14 | −12 | −26 |

Best: 2× QB+WR (+34). Worst: WR/TE triple (−26). Two early QBs and two
early WRs: stack the QBs with WRs, not with RBs, and do not also lock
same-team catchers.

### 2024 #4 — We Have McCaffrey at Home (11-7)

Template taken from **2024**: Lamar Jackson (QB2), Jonathan Taylor (RB3),
De'Von Achane (RB9), Nico Collins (WR9), Rashee Rice (WR12).
Rank mix: **1× QB12 / 2× RB12 / 2× WR12 / 0× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| −13 | −23 | +17 | **+21** | −1 | −34 | −2 | +5 |

Best: 2× QB+RB (+21). Worst: 2× RB committee (−34). One elite QB rank
plus two early RBs: QB+RB pays; a second *committee* (both backs, same
NFL team) is the largest tax in the study. 2× RB n = 188 on this
template (does not always fit).

### 2024 #5 — The Boomers (11-7)

Template taken from **2024**: CeeDee Lamb (WR5), Justin Jefferson (WR6),
Saquon Barkley (RB7), Drake London (WR7).
Rank mix: **0× QB12 / 1× RB12 / 3× WR12 / 0× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| +38 | **+66** | −9 | +1 | +20 | +35 | +17 | +22 |

Best: 2× QB+WR (+66). Worst: QB+RB1 (−9). Three early WR slots: almost
every stack that uses those WR ranks pays, and QB+RB (which does not)
is the one that does not. 2× RB committee n = 27 here — treat +35 as a
small-sample footnote. ≥2,500 share does not move on this template
because the destacked baseline still sits below the cutoff; the +66 is
real on the mean, invisible at the league-winning line.

### 2024 #6 — seanjcrow (9-9)

Template taken from **2024**: Josh Allen (QB1), Jahmyr Gibbs (RB1),
Jaxon Smith-Njigba (WR3), Matthew Stafford (QB11), Chase Brown (RB11).
Rank mix: **2× QB12 / 2× RB12 / 1× WR12 / 0× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | +12 | +23 | **+37** | +7 | +2 | +3 | +9 |

Best: 2× QB+RB (+37). Worst: QB+WR1 (0). Two early QBs, two early RBs,
only one early WR: the QB+RB pairing matches the scarce ranks better
than QB+WR.

### 2025 #1 — Lord Pittsy Flacco Joedy (15-3)

Template taken from **2025**: Joe Burrow (QB3), Amon-Ra St. Brown (WR4),
Christian McCaffrey (RB5), James Cook (RB6), Jalen Hurts (QB7), Kyle
Pitts (TE7), A.J. Brown (WR8), Kenneth Walker (RB10), DeVonta Smith
(WR11).
Rank mix: **2× QB12 / 3× RB12 / 3× WR12 / 1× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| +17 | **+26** | −6 | −16 | +8 | +5 | −17 | −15 |

Best: 2× QB+WR (+26). Worst: WR/TE double (−17). Loaded at every
position; the WR ranks are still the ones to stack with the QBs, not to
lock to each other.

### 2025 #2 — seanjcrow (14-4)

Template taken from **2025**: Josh Allen (QB1), Jahmyr Gibbs (RB1),
Jaxon Smith-Njigba (WR3), Harold Fannin (TE6), Chase Brown (RB11),
Jaxson Dart (QB12).
Rank mix: **2× QB12 / 2× RB12 / 1× WR12 / 1× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| +1 | +7 | +6 | **+16** | −2 | +1 | +3 | −5 |

Best: 2× QB+RB (+16). Worst: WR/TE triple (−5). Same family as 2024 #6:
two early QBs, two early RBs, one early WR.

### 2025 #3 — Drake & Bake (13-5)

Template taken from **2025**: Lamar Jackson (QB2), Trey McBride (TE2),
Drake London (WR7), De'Von Achane (RB9), Nico Collins (WR9), Matthew
Stafford (QB11).
Rank mix: **2× QB12 / 1× RB12 / 2× WR12 / 1× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| −10 | −20 | +13 | **+30** | +14 | +18 | +3 | +8 |

Best: 2× QB+RB (+30). Worst: 2× QB+WR (−20). Early QB + early TE + WR
depth: correlating the QB with a WR is the tax; correlating him with an
RB, or taking a committee, pays. This is the same template family as
2026 #4, with a slightly thinner RB mix (1× RB12 vs 2×).

### 2025 #4 — The Ladds (12-6)

Template taken from **2025**: Drake Maye (QB4), Ashton Jeanty (RB4),
Tyler Warren (TE4), Trevor Lawrence (QB10), George Pickens (WR10).
Rank mix: **2× QB12 / 1× RB12 / 1× WR12 / 1× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| −8 | −19 | +13 | **+32** | +8 | +6 | +1 | +12 |

Best: 2× QB+RB (+32). Worst: 2× QB+WR (−19). Early QB + early RB + early
TE, only one early WR: QB+RB matches; QB+WR does not.

### 2025 #5 — House of Hwang (11-7)

Template taken from **2025**: Ja'Marr Chase (WR1), Jonathan Taylor (RB3),
Tucker Kraft (TE5), Dak Prescott (QB8).
Rank mix: **1× QB12 / 1× RB12 / 1× WR12 / 1× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| +4 | +1 | −9 | −31 | +11 | +12 | −1 | **+16** |

Best: WR/TE triple (+16). Worst: 2× QB+RB (−31). One of each early slot:
a leftover mid WR/TE triple can pay; forcing two QB+RB pairs does not.

### 2025 #6 — aidsonballs (11-7)

Template taken from **2025**: Bijan Robinson (RB2), Saquon Barkley (RB7),
Justin Herbert (QB9), Derrick Henry (RB12).
Rank mix: **1× QB12 / 3× RB12 / 0× WR12 / 0× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| −4 | −17 | +18 | **+28** | −5 | −27 | −6 | −20 |

Best: 2× QB+RB (+28). Worst: 2× RB committee (−27). Same family as 2024
#1 and 2026 #7: three early RBs, no early WR. Stack QB with an RB; do
not stack two RBs from the same NFL team.

### 2026 #1 — The Ladds

Template taken from **2026**: Drake Maye (QB4), Ashton Jeanty (RB4),
Tyler Warren (TE4), Trevor Lawrence (QB10).
Rank mix: **2× QB12 / 1× RB12 / 0× WR12 / 1× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| −8 | −3 | −26 | −23 | −4 | −11 | 0 | **+1** |

Best: WR/TE triple (+1). Worst: QB+RB1 (−26). Same source team as 2025
#4 but **zero** WR12s this snapshot. Nothing really pays; QB+RB is the
tax. The 2025 version of this team (with Pickens as WR10) was a QB+RB
room. Dropping the early WR slot changed the result.

### 2026 #2 — seanjcrow

Template taken from **2026**: Josh Allen (QB1), Jahmyr Gibbs (RB1),
Jaxon Smith-Njigba (WR3), Harold Fannin (TE6), George Pickens (WR10),
Chase Brown (RB11), Jaxson Dart (QB12).
Rank mix: **2× QB12 / 2× RB12 / 2× WR12 / 1× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| −3 | −4 | +13 | **+23** | −4 | −28 | −1 | +2 |

Best: 2× QB+RB (+23). Worst: 2× RB committee (−28). Two early QBs and
two early RBs still want QB+RB, not a committee, even with two early
WRs this year.

### 2026 #3 — Eat It While She Sleeper

Template taken from **2026**: Brock Bowers (TE1), Caleb Williams (QB6),
Justin Jefferson (WR6).
Rank mix: **1× QB12 / 0× RB12 / 1× WR12 / 1× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| +4 | +8 | +7 | +19 | +1 | **+21** | 0 | −13 |

Best: 2× RB committee (+21). Worst: WR/TE triple (−13). No early RB
slot: a committee that *fits leftover mid RB ranks* can pay (n = 226
for 2× RB). A WR/TE triple on a room that already has TE1 + WR6 is the
tax.

### 2026 #4 — Drake & Bake

Template taken from **2026**: Lamar Jackson (QB2), Trey McBride (TE2),
Drake London (WR7), Omarion Hampton (RB8), De'Von Achane (RB9), Nico
Collins (WR9), Matthew Stafford (QB11).
Rank mix: **2× QB12 / 2× RB12 / 2× WR12 / 1× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| −16 | −26 | −4 | −10 | +19 | **+34** | −1 | −4 |

Best: 2× RB committee (+34). Worst: 2× QB+WR (−26). Same source team as
2025 #3, now with two early RBs. Committees pay; QB+WR is still the
tax. QB+RB flipped from +30 (2025, 1× RB12) to −4 (2026, 2× RB12) —
once you already have two early RB ranks, gluing them to the QBs is
worse than taking true committees into those RB slots.

### 2026 #5 — Lord Pittsy Flacco Joedy

Template taken from **2026**: Joe Burrow (QB3), Amon-Ra St. Brown (WR4),
Christian McCaffrey (RB5), James Cook (RB6), Jalen Hurts (QB7), Kyle
Pitts (TE7), A.J. Brown (WR8), Kenneth Walker (RB10), DeVonta Smith
(WR11).
Rank mix: **2× QB12 / 3× RB12 / 3× WR12 / 1× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| +15 | **+22** | −3 | −12 | +2 | +1 | −6 | −23 |

Best: 2× QB+WR (+22). Worst: WR/TE triple (−23). Same source team as
2025 #1, same result: stack the two early QBs with WRs, destack the
catchers from each other.

### 2026 #6 — House of Hwang

Template taken from **2026**: Ja'Marr Chase (WR1), Jonathan Taylor (RB3),
Tucker Kraft (TE5), Dak Prescott (QB8).
Rank mix: **1× QB12 / 1× RB12 / 1× WR12 / 1× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| +5 | +7 | −14 | −28 | +15 | **+18** | −1 | +9 |

Best: 2× RB committee (+18). Worst: 2× QB+RB (−28). Same source team as
2025 #5. One-of-each: committees into the RB rank pay; a second QB+RB
does not.

### 2026 #7 — MrZaccheaus

Template taken from **2026**: Bijan Robinson (RB2), Saquon Barkley (RB7),
Justin Herbert (QB9), Derrick Henry (RB12).
Rank mix: **1× QB12 / 3× RB12 / 0× WR12 / 0× TE8**.

| QB+WR1 | 2× QB+WR | QB+RB1 | 2× QB+RB | 1 RB | 2× RB | WR/TE 2 | WR/TE 3 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| −1 | −5 | +9 | **+25** | +1 | −17 | −6 | −17 |

Best: 2× QB+RB (+25). Worst: 2× RB committee / WR/TE triple (−17). Same
family as 2024 #1 and 2025 #6.

---

## Compact ranking (best stack per template)

| Template | Source team (year) | Rank mix | Best stack | Δ | Worst stack | Δ |
|---|---|---|---|---:|---|---:|
| 2024 #1 | Let James Cook | 3×RB12, 0×WR12 | 2× QB+RB | +37 | WR/TE triple | −27 |
| 2024 #2 | Age is just a number | 1×WR12, 0×RB12 | 2× QB+WR | +16 | 2× QB+RB | −24 |
| 2024 #3 | Adam(s) and Steve(nson) | 2×QB12, 2×WR12 | 2× QB+WR | +34 | WR/TE triple | −26 |
| 2024 #4 | We Have McCaffrey at Home | 1×QB12, 2×RB12, 2×WR12 | 2× QB+RB | +21 | 2× RB committee | −34 |
| 2024 #5 | The Boomers | 3×WR12 | 2× QB+WR | +66 | QB+RB1 | −9 |
| 2024 #6 | seanjcrow | 2×QB12, 2×RB12, 1×WR12 | 2× QB+RB | +37 | QB+WR1 | 0 |
| 2025 #1 | Lord Pittsy Flacco Joedy | 2×QB12, 3×WR12 | 2× QB+WR | +26 | WR/TE double | −17 |
| 2025 #2 | seanjcrow | 2×QB12, 2×RB12, 1×WR12 | 2× QB+RB | +16 | WR/TE triple | −5 |
| 2025 #3 | Drake & Bake | 2×QB12, TE8, 2×WR12 | 2× QB+RB | +30 | 2× QB+WR | −20 |
| 2025 #4 | The Ladds | 2×QB12, 1×RB12, TE8 | 2× QB+RB | +32 | 2× QB+WR | −19 |
| 2025 #5 | House of Hwang | 1 of each | WR/TE triple | +16 | 2× QB+RB | −31 |
| 2025 #6 | aidsonballs | 3×RB12, 0×WR12 | 2× QB+RB | +28 | 2× RB committee | −27 |
| 2026 #1 | The Ladds | 2×QB12, 0×WR12, TE8 | WR/TE triple | +1 | QB+RB1 | −26 |
| 2026 #2 | seanjcrow | 2×QB12, 2×RB12, 2×WR12 | 2× QB+RB | +23 | 2× RB committee | −28 |
| 2026 #3 | Eat It While She Sleeper | TE8, 0×RB12, 1×WR12 | 2× RB committee | +21 | WR/TE triple | −13 |
| 2026 #4 | Drake & Bake | 2×QB12, TE8, 2×RB12 | 2× RB committee | +34 | 2× QB+WR | −26 |
| 2026 #5 | Lord Pittsy Flacco Joedy | 2×QB12, 3×WR12 | 2× QB+WR | +22 | WR/TE triple | −23 |
| 2026 #6 | House of Hwang | 1 of each | 2× RB committee | +18 | 2× QB+RB | −28 |
| 2026 #7 | MrZaccheaus | 3×RB12, 0×WR12 | 2× QB+RB | +25 | 2× RB committee | −17 |

---

## Reproduce

```bash
npx tsx scripts/run_hwang_stack_study.mjs 1 60
npx tsx scripts/run_hwang_qb_rb_stack_study.mjs 1 60
npx tsx scripts/run_hwang_rb_committee_study.mjs 1 60
npx tsx scripts/run_hwang_passcatcher_study.mjs 1 60
```

Scoring is weekly-optimal (best-ball-like). A manager locked into stacked
players every week would feel more substitution than these lineups.
Forced stacks never move a player outside the rank window of the
template slot they replaced — a WR12 slot does not become a WR40 just
to complete a stack.
