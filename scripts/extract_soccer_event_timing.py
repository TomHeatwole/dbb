#!/usr/bin/env python3
"""Extract corner-kick and goal timings from the European Soccer Database dump.

Reads corner_detail.csv and goal_detail.csv from the extracted archive and
writes two tidy CSVs of event timings tagged with league. Corners also carry
the running score at the moment the corner was taken, from the perspective of
the team that took it.

The archive's detail CSVs carry no league column; that mapping lives in the
Match/League/Country tables of the source database.sqlite. Pass --sqlite to
join it in authoritatively. Without it, leagues are inferred from match_id
blocks (see LEAGUE_BLOCKS) and validated against team-co-occurrence clusters.

Usage:
  python scripts/extract_soccer_event_timing.py <archiveDir> [outDir] [--sqlite path]
"""
import argparse
import collections
import csv
import os
import sqlite3

# Per DataDictionary.xlsx, only these goal_type/comment codes are real goals;
# dg (disallowed), npm/psm (missed penalties) and rp (retake) are not.
VALID_GOAL_CODES = {'n', 'o', 'p'}

# Every detail file's "team" column refers to the team of the player who
# performed the action, verified against per-match player->team inference.
# For an own goal that means the conceding side, so the goal is credited to
# the opponent.
OWN_GOAL_CODE = 'o'

# The source database numbers matches in contiguous per-league blocks, ordered
# by country name; each League.id is the first Match.id of its block. Entries
# are (first_match_id, league); the final sentinel bounds the last block.
LEAGUE_BLOCKS = [
    (1, 'Belgium Jupiler League'),
    (1729, 'England Premier League'),
    (4769, 'France Ligue 1'),
    (7809, 'Germany 1. Bundesliga'),
    (10257, 'Italy Serie A'),
    (13274, 'Netherlands Eredivisie'),
    (15722, 'Poland Ekstraklasa'),
    (17642, 'Portugal Liga ZON Sagres'),
    (19694, 'Scotland Premier League'),
    (21518, 'Spain LIGA BBVA'),
    (24558, 'Switzerland Super League'),
    (25980, None),
]

TEAM_SOURCE_FILES = [
    'corner_detail.csv', 'card_detail.csv', 'foulcommit_detail.csv',
    'shoton_detail.csv', 'shotoff_detail.csv', 'cross_detail.csv',
    'goal_detail.csv',
]


def event_minute(row):
    elapsed = row['elapsed'].strip()
    if not elapsed:
        return None
    plus = row['elapsed_plus'].strip()
    return int(elapsed) + (int(plus) if plus else 0)


def league_for(match_id):
    mid = int(match_id)
    for (start, name), (nxt, _) in zip(LEAGUE_BLOCKS, LEAGUE_BLOCKS[1:]):
        if start <= mid < nxt:
            return name or 'UNKNOWN'
    return 'UNKNOWN'


def verify_league_blocks(match_teams):
    """Cross-check inferred leagues against team-co-occurrence clusters.

    Teams only meet within their own domestic league here, so each connected
    component of the co-occurrence graph must sit inside one league block.
    A component straddling a boundary would mean the block table is wrong.
    Only clean two-team matches are used as edges; corrupt records with a
    stray third team would otherwise bridge unrelated leagues.
    """
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for teams in match_teams.values():
        if len(teams) != 2:
            continue
        a, b = teams
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    spans = collections.defaultdict(list)
    for match_id, teams in match_teams.items():
        roots = {find(t) for t in teams if t in parent}
        if len(roots) == 1:
            spans[next(iter(roots))].append(int(match_id))

    straddling = [
        (min(ms), max(ms)) for ms in spans.values()
        if league_for(min(ms)) != league_for(max(ms))
    ]
    return len(spans), straddling


def load_match_teams(archive_dir):
    """Map match_id -> set of team ids seen in any event for that match."""
    teams = collections.defaultdict(set)
    for name in TEAM_SOURCE_FILES:
        path = os.path.join(archive_dir, name)
        if not os.path.exists(path):
            continue
        with open(path, newline='', encoding='utf-8') as fh:
            for row in csv.DictReader(fh):
                team = (row.get('team') or '').strip()
                if team:
                    teams[row['match_id']].add(team)
    return teams


def load_goal_events(archive_dir, match_teams):
    """Map match_id -> list of (minute, credited_team). Returns unresolved count."""
    goals = collections.defaultdict(list)
    unresolved = 0
    path = os.path.join(archive_dir, 'goal_detail.csv')
    with open(path, newline='', encoding='utf-8') as fh:
        for row in csv.DictReader(fh):
            if row.get('del', '').strip() == '1':
                continue
            code = (row.get('comment') or row.get('goal_type') or '').strip()
            if code not in VALID_GOAL_CODES:
                continue
            minute = event_minute(row)
            scorer_team = row['team'].strip()
            if minute is None or not scorer_team:
                continue
            match_id = row['match_id']
            credited = scorer_team
            if code == OWN_GOAL_CODE:
                others = match_teams.get(match_id, set()) - {scorer_team}
                if len(others) != 1:
                    unresolved += 1
                    continue
                credited = next(iter(others))
            goals[match_id].append((minute, credited))
    return goals, unresolved


def score_before(goal_list, team, minute):
    """Goals for/against `team` strictly before `minute`.

    Strict inequality deliberately excludes a goal scored in the same minute as
    the corner, which is usually a goal scored *from* that corner.
    """
    for_, against = 0, 0
    for gm, credited in goal_list:
        if gm < minute:
            if credited == team:
                for_ += 1
            else:
                against += 1
    return for_, against


def load_league_map(sqlite_path):
    con = sqlite3.connect(sqlite_path)
    try:
        rows = con.execute("""
            SELECT Match.id, Country.name, League.name
            FROM Match
            JOIN League ON League.id = Match.league_id
            JOIN Country ON Country.id = League.country_id
        """).fetchall()
    finally:
        con.close()
    return {str(mid): f'{country} {league}' for mid, country, league in rows}


def extract(src, out_path, league_map, goals_only_valid, goal_events=None):
    with_score = goal_events is not None
    kept = dropped_deleted = dropped_invalid = 0
    with open(src, newline='', encoding='utf-8') as fh, \
            open(out_path, 'w', newline='', encoding='utf-8') as out:
        writer = csv.writer(out)
        header = ['league', 'match_id', 'minute', 'elapsed', 'elapsed_plus']
        if with_score:
            header += ['team', 'goals_for', 'goals_against']
        writer.writerow(header)
        for row in csv.DictReader(fh):
            if row.get('del', '').strip() == '1':
                dropped_deleted += 1
                continue
            if goals_only_valid:
                # "comment" is documented as more reliable than "goal_type".
                code = (row.get('comment') or row.get('goal_type') or '').strip()
                if code not in VALID_GOAL_CODES:
                    dropped_invalid += 1
                    continue
            minute = event_minute(row)
            if minute is None:
                dropped_invalid += 1
                continue
            match_id = row['match_id']
            out_row = [
                league_map.get(match_id) or league_for(match_id), match_id,
                minute, int(row['elapsed']),
                int(row['elapsed_plus']) if row['elapsed_plus'].strip() else 0,
            ]
            if with_score:
                team = row['team'].strip()
                if team:
                    for_, against = score_before(
                        goal_events.get(match_id, ()), team, minute)
                    out_row += [team, for_, against]
                else:
                    out_row += ['', '', '']
            writer.writerow(out_row)
            kept += 1
    return kept, dropped_deleted, dropped_invalid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('archive_dir')
    ap.add_argument('out_dir', nargs='?')
    ap.add_argument('--sqlite', help='source database.sqlite for the league mapping')
    args = ap.parse_args()

    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    out_dir = os.path.abspath(args.out_dir) if args.out_dir else \
        os.path.join(root, 'example_data', 'soccer_event_timing')
    os.makedirs(out_dir, exist_ok=True)

    league_map = load_league_map(args.sqlite) if args.sqlite else {}
    if args.sqlite:
        print(f'league mapping: {len(league_map)} matches from sqlite')
    else:
        print('league mapping: inferred from match_id blocks')

    match_teams = load_match_teams(args.archive_dir)
    n_clusters, straddling = verify_league_blocks(match_teams)
    if straddling:
        print(f'  WARNING: {len(straddling)} team clusters cross a league '
              f'boundary, inferred leagues are unreliable: {straddling[:5]}')
    else:
        print(f'  verified: all {n_clusters} team clusters nest inside one league')

    goal_events, unresolved = load_goal_events(args.archive_dir, match_teams)
    print(f'goal events for scoring: {sum(len(v) for v in goal_events.values())}'
          f' ({unresolved} own goals with unresolvable opponent, skipped)')

    for name, goals_only_valid in [('corner', False), ('goal', True)]:
        src = os.path.join(args.archive_dir, f'{name}_detail.csv')
        out_path = os.path.join(out_dir, f'{name}_timing.csv')
        kept, deleted, invalid = extract(
            src, out_path, league_map, goals_only_valid,
            goal_events if name == 'corner' else None)
        print(f'{name:7s} -> {out_path}')
        print(f'         kept={kept} dropped_deleted={deleted} dropped_invalid={invalid}')


if __name__ == '__main__':
    main()
