#!/usr/bin/env python3
"""Generate example_data/underdog_bbm_archetypes.{json,csv} from the pick scripts."""
import csv
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_JSON = ROOT / 'example_data' / 'underdog_bbm_archetypes.json'
OUT_CSV = ROOT / 'example_data' / 'underdog_bbm_archetypes.csv'
OUT_ENGINE_CSV = ROOT / 'example_data' / 'underdog_bbm_archetype_rosters.csv'

TEAMS = 12
SLOT = 6  # representative snake seat (1.06 / 2.07 / …)

# Typical Underdog 12-team half-PPR positional rank for a pick in that round.
# Mid-of-round values; a second same-position pick in the same round is +1.
RANK_BY_ROUND = {
    'QB': {3: 1, 4: 3, 5: 5, 6: 7, 7: 9, 8: 11, 9: 13, 10: 15,
           11: 16, 12: 18, 13: 19, 14: 20, 15: 21, 16: 22, 17: 23, 18: 24},
    'RB': {1: 3, 2: 8, 3: 14, 4: 20, 5: 26, 6: 32, 7: 38, 8: 44, 9: 49, 10: 54,
           11: 59, 12: 64, 13: 68, 14: 72, 15: 76, 16: 80, 17: 84, 18: 88},
    'WR': {1: 5, 2: 12, 3: 20, 4: 28, 5: 36, 6: 44, 7: 52, 8: 60, 9: 68, 10: 76,
           11: 84, 12: 90, 13: 96, 14: 102, 15: 108, 16: 114, 17: 120, 18: 126},
    'TE': {1: 1, 2: 2, 3: 3, 4: 5, 5: 7, 6: 9, 7: 11, 8: 13, 9: 15, 10: 16,
           11: 18, 12: 20, 13: 22, 14: 23, 15: 24, 16: 26, 17: 27, 18: 28},
}


def snake_pick(round_n, slot=SLOT, teams=TEAMS):
    if round_n % 2 == 1:
        return (round_n - 1) * teams + slot
    return (round_n - 1) * teams + (teams + 1 - slot)


def ranks_for(positions_by_round):
    used = {p: set() for p in RANK_BY_ROUND}
    picks = []
    for round_n, pos in enumerate(positions_by_round, start=1):
        base = RANK_BY_ROUND[pos][round_n]
        rank = base
        while rank in used[pos]:
            rank += 1
        used[pos].add(rank)
        picks.append({
            'round': round_n,
            'overallPick': snake_pick(round_n),
            'position': pos,
            'posRank': rank,
        })
    return picks


def counts(picks):
    c = Counter(p['position'] for p in picks)
    return {p: c[p] for p in ('QB', 'RB', 'WR', 'TE')}


def rbs_through(picks, last_round):
    return sum(1 for p in picks if p['position'] == 'RB' and p['round'] <= last_round)


def wrs_through(picks, last_round):
    return sum(1 for p in picks if p['position'] == 'WR' and p['round'] <= last_round)


def capital_shares(picks):
    # Linear round weight: R1 = 18 … R18 = 1. Crude ADP-capital proxy.
    w = {p: 0.0 for p in ('QB', 'RB', 'WR', 'TE')}
    for pick in picks:
        w[pick['position']] += (19 - pick['round'])
    total = sum(w.values())
    return {p: round(w[p] / total, 3) for p in w}


SCRIPTS = [
    {
        'id': 'bb_hero_3qb',
        'label': 'Hero RB + late 3QB',
        'rbStrategy': 'hero',
        'qbStrategy': 'late_3qb',
        'notes': (
            '2025 BBM VI winner shape: one early RB, WR-fronted, three late QBs, '
            'two TEs. Field-common “good team.”'
        ),
        'rounds': ['WR', 'RB', 'WR', 'WR', 'TE', 'WR',
                   'RB', 'WR', 'QB', 'RB', 'WR', 'RB',
                   'QB', 'RB', 'QB', 'TE', 'WR', 'RB'],
    },
    {
        'id': 'bb_hero_2qb',
        'label': 'Hero RB + elite 2QB',
        'rbStrategy': 'hero',
        'qbStrategy': 'elite_2qb',
        'notes': (
            'Same Hero RB spine, but spend R3 on an elite QB and stop at two. '
            'The extra roster spot becomes a WR.'
        ),
        'rounds': ['WR', 'RB', 'QB', 'WR', 'WR', 'WR',
                   'RB', 'TE', 'WR', 'RB', 'WR', 'RB',
                   'WR', 'RB', 'TE', 'WR', 'QB', 'RB'],
    },
    {
        'id': 'bb_double_3qb',
        'label': 'Double-anchor + late 3QB',
        'rbStrategy': 'double_anchor',
        'qbStrategy': 'late_3qb',
        'notes': (
            'Winks year-over-year default: 2 RBs through R6, 4 through R10, '
            'finish 5–6. The “average advancing team.”'
        ),
        'rounds': ['RB', 'WR', 'RB', 'WR', 'WR', 'TE',
                   'WR', 'QB', 'RB', 'WR', 'RB', 'QB',
                   'WR', 'RB', 'TE', 'QB', 'WR', 'RB'],
    },
    {
        'id': 'bb_double_2qb',
        'label': 'Double-anchor + elite 2QB',
        'rbStrategy': 'double_anchor',
        'qbStrategy': 'elite_2qb',
        'notes': 'Two early RBs plus an R4 QB. Still WR-solvent (3 WR through R6).',
        'rounds': ['RB', 'WR', 'RB', 'QB', 'WR', 'WR',
                   'WR', 'TE', 'RB', 'WR', 'RB', 'WR',
                   'RB', 'WR', 'TE', 'WR', 'QB', 'RB'],
    },
    {
        'id': 'bb_zero_3qb',
        'label': 'Zero RB + late 3QB',
        'rbStrategy': 'zero',
        'qbStrategy': 'late_3qb',
        'notes': (
            'No RB until R7; 5 WR through R6. The WR-heavy bound of a real '
            'half-PPR best-ball league — the opposite of a Hwang contender.'
        ),
        'rounds': ['WR', 'WR', 'WR', 'TE', 'WR', 'WR',
                   'RB', 'WR', 'RB', 'QB', 'RB', 'WR',
                   'RB', 'QB', 'RB', 'TE', 'QB', 'RB'],
    },
    {
        'id': 'bb_zero_2qb',
        'label': 'Zero RB + elite 2QB',
        'rbStrategy': 'zero',
        'qbStrategy': 'elite_2qb',
        'notes': 'Zero RB with R3 elite QB. Still 0 RBs through R6, 4 WR through R6.',
        'rounds': ['WR', 'WR', 'QB', 'WR', 'WR', 'TE',
                   'RB', 'WR', 'RB', 'WR', 'RB', 'WR',
                   'RB', 'WR', 'TE', 'RB', 'QB', 'RB'],
    },
    {
        'id': 'bb_robust_3qb',
        'label': 'Robust RB + late 3QB',
        'rbStrategy': 'robust',
        'qbStrategy': 'late_3qb',
        'notes': (
            'Three RBs in the first four rounds, finish 5. The RB-heavy bound '
            'of real BBM — still 3 fewer RBs than a typical Hwang archetype.'
        ),
        'rounds': ['RB', 'RB', 'WR', 'RB', 'WR', 'TE',
                   'WR', 'QB', 'WR', 'TE', 'WR', 'QB',
                   'WR', 'RB', 'TE', 'QB', 'WR', 'RB'],
    },
    {
        'id': 'bb_robust_2qb',
        'label': 'Robust RB + elite 2QB',
        'rbStrategy': 'robust',
        'qbStrategy': 'elite_2qb',
        'notes': (
            'Most early RB+QB capital of the set (RB-RB-QB-RB). First WR in R5. '
            'Closest regular-bestball analog to a Hwang RB-first start, and still '
            'only 5 RBs total.'
        ),
        'rounds': ['RB', 'RB', 'QB', 'RB', 'WR', 'WR',
                   'TE', 'WR', 'WR', 'TE', 'WR', 'WR',
                   'RB', 'WR', 'TE', 'WR', 'QB', 'RB'],
    },
]


def build():
    archetypes = []
    for spec in SCRIPTS:
        assert len(spec['rounds']) == 18, spec['id']
        picks = ranks_for(spec['rounds'])
        c = counts(picks)
        assert sum(c.values()) == 18, spec['id']
        # Unique pos ranks within position.
        by_pos = {}
        for p in picks:
            by_pos.setdefault(p['position'], []).append(p['posRank'])
        for pos, ranks in by_pos.items():
            assert len(ranks) == len(set(ranks)), (spec['id'], pos, ranks)
        arch = {
            'id': spec['id'],
            'label': spec['label'],
            'rbStrategy': spec['rbStrategy'],
            'qbStrategy': spec['qbStrategy'],
            'notes': spec['notes'],
            'counts': c,
            'rbsThrough6': rbs_through(picks, 6),
            'rbsThrough10': rbs_through(picks, 10),
            'wrsThrough6': wrs_through(picks, 6),
            'wrsThrough10': wrs_through(picks, 10),
            'capitalShare': capital_shares(picks),
            'picks': picks,
        }
        archetypes.append(arch)
    return archetypes


def main():
    archetypes = build()
    doc = {
        'meta': {
            'source': 'Underdog Best Ball Mania (synthetic rank ladders, not real entries)',
            'rosterSize': 18,
            'teams': 12,
            'rounds': 18,
            'draftSlot': SLOT,
            'scoring': {
                'ppr': 0.5,
                'tePremium': 0,
                'superflex': False,
            },
            'starters': {'QB': 1, 'RB': 2, 'WR': 3, 'TE': 1, 'FLEX': 1, 'SUPER': 0},
            'recommendedSimSlotCounts': {
                'QB': 1, 'RB': 2, 'WR': 3, 'TE': 1, 'FLEX': 1, 'SUPER': 0,
            },
            'rankMeaning': (
                'posRank is a 12-team half-PPR redraft positional rank '
                '(ADP-like), NOT dynasty KTC rank. Instantiate these onto a '
                'season redraft / competitor-adjusted board, never onto the '
                'dynasty KTC board.'
            ),
            'whyNotHyperfragile': (
                '4-early-RB (hyperfragile) is a <5% BBM construction and '
                'historically underperforms. Robust RB is the honest '
                'RB-heavy bound of this format.'
            ),
            'hwangComparison': {
                'hwangRosterSize': 27,
                'hwangTypicalCounts': {'QB': 4.5, 'RB': 8.2, 'WR': 10.0, 'TE': 4.3},
            },
        },
        'archetypes': archetypes,
    }
    OUT_JSON.write_text(json.dumps(doc, indent=2) + '\n')
    print(f'wrote {OUT_JSON}')

    with OUT_CSV.open('w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=[
            'archetype_id', 'label', 'rb_strategy', 'qb_strategy',
            'qb', 'rb', 'wr', 'te',
            'round', 'overall_pick', 'position', 'pos_rank',
        ])
        w.writeheader()
        for a in archetypes:
            for p in a['picks']:
                w.writerow({
                    'archetype_id': a['id'],
                    'label': a['label'],
                    'rb_strategy': a['rbStrategy'],
                    'qb_strategy': a['qbStrategy'],
                    'qb': a['counts']['QB'],
                    'rb': a['counts']['RB'],
                    'wr': a['counts']['WR'],
                    'te': a['counts']['TE'],
                    'round': p['round'],
                    'overall_pick': p['overallPick'],
                    'position': p['position'],
                    'pos_rank': p['posRank'],
                })
    print(f'wrote {OUT_CSV}')

    engine_fields = [
        'archetype_id', 'season', 'finish_rank', 'rank_basis', 'team_name', 'owner',
        'roster_id', 'wins', 'losses', 'fpts', 'sleeper_id', 'player_name',
        'sleeper_position', 'nfl_team', 'ktc_name', 'position',
        'ktc_value', 'ktc_overall_rank', 'ktc_pos_rank',
        'comp_adj_value', 'comp_adj_overall_rank', 'comp_adj_pos_rank',
    ]
    with OUT_ENGINE_CSV.open('w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=engine_fields)
        w.writeheader()
        for i, a in enumerate(archetypes, start=1):
            for p in a['picks']:
                dummy = 1000 * (19 - p['round'])
                name = f"R{p['round']} {p['position']}{p['posRank']}"
                w.writerow({
                    'archetype_id': a['id'],
                    'season': 2026,
                    'finish_rank': i,
                    'rank_basis': 'bbm_synthetic',
                    'team_name': a['label'],
                    'owner': a['id'],
                    'roster_id': i,
                    'wins': 0,
                    'losses': 0,
                    'fpts': 0,
                    'sleeper_id': '',
                    'player_name': name,
                    'sleeper_position': p['position'],
                    'nfl_team': '',
                    'ktc_name': name,
                    'position': p['position'],
                    'ktc_value': dummy,
                    'ktc_overall_rank': p['overallPick'],
                    'ktc_pos_rank': p['posRank'],
                    'comp_adj_value': dummy,
                    'comp_adj_overall_rank': p['overallPick'],
                    'comp_adj_pos_rank': p['posRank'],
                })
    print(f'wrote {OUT_ENGINE_CSV}')

    print('\n=== review table ===')
    print(f"{'id':<18}{'counts':<12}{'RB≤6/10':>8}{'WR≤6/10':>8}  cap QB/RB/WR/TE")
    for a in archetypes:
        c = a['counts']
        cap = a['capitalShare']
        print(
            f"{a['id']:<18}{c['QB']}/{c['RB']}/{c['WR']}/{c['TE']:<6}"
            f"{a['rbsThrough6']}/{a['rbsThrough10']:>1}{a['wrsThrough6']:>5}/{a['wrsThrough10']}"
            f"   {cap['QB']:.0%} {cap['RB']:.0%} {cap['WR']:.0%} {cap['TE']:.0%}  {a['label']}"
        )


if __name__ == '__main__':
    main()
