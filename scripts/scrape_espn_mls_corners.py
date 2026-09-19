#!/usr/bin/env python3
"""Download MLS corner timestamps from ESPN commentary.

Same commentary parser as scrape_espn_pl_corners.py; league is usa.1 (id 770).
Standings are split East/West, so teams are collected from every child table.

Usage:
  python scripts/scrape_espn_mls_corners.py
  python scripts/scrape_espn_mls_corners.py --seasons 2025 2026
  python scripts/scrape_espn_mls_corners.py --max-games 5 --sleep 0.3
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scrape_espn_pl_corners import (  # noqa: E402
    CORNER_FIELDS,
    GAME_FIELDS,
    GOAL_FIELDS,
    append_rows,
    boxscore_corners,
    competitor_map,
    extract_corners,
    extract_goals,
    get_json,
    load_done,
)

LEAGUE = 'usa.1'
LEAGUE_ID = '770'
BASE = 'https://site.web.api.espn.com/apis'


def season_teams(year):
    url = f'{BASE}/v2/sports/soccer/{LEAGUE}/standings?season={year}'
    data = get_json(url)
    name = ((data.get('season') or {}).get('displayName') or f'{year} MLS')
    teams = []
    seen = set()
    for child in data.get('children') or []:
        entries = ((child.get('standings') or {}).get('entries')) or []
        for e in entries:
            tid = e['team']['id']
            if tid in seen:
                continue
            seen.add(tid)
            teams.append((tid, e['team']['abbreviation'], e['team']['displayName']))
    return name, teams


def team_games(team_id, year):
    url = (f'{BASE}/site/v2/sports/soccer/{LEAGUE}/teams/{team_id}'
           f'/schedule?season={year}')
    data = get_json(url)
    games = []
    for ev in data.get('events') or []:
        league = ev.get('league') or {}
        if str(league.get('id')) != LEAGUE_ID and league.get('slug') != LEAGUE:
            continue
        comp = (ev.get('competitions') or [{}])[0]
        status = ((comp.get('status') or {}).get('type') or {})
        games.append({
            'id': str(ev['id']),
            'date': (ev.get('date') or '')[:10],
            'completed': bool(status.get('completed')),
        })
    return games


def list_season_games(year, sleep):
    season_name, teams = season_teams(year)
    print(f'  {season_name}: {len(teams)} teams', flush=True)
    by_id = {}
    for tid, abbr, name in teams:
        time.sleep(sleep)
        for g in team_games(tid, year):
            by_id.setdefault(g['id'], g)
        print(f'    {abbr:4s}  unique games {len(by_id)}', flush=True)
    completed = [g for g in by_id.values() if g['completed']]
    return season_name, completed


def scrape_game(game_id):
    url = f'{BASE}/site/v2/sports/soccer/{LEAGUE}/summary?event={game_id}'
    summary = get_json(url)
    header = summary.get('header') or {}
    meta = competitor_map(header)
    season = header.get('season') or {}
    commentary = summary.get('commentary') or []
    corners = extract_corners(commentary)
    goals = extract_goals(commentary, summary.get('keyEvents') or [])
    box = boxscore_corners(summary)
    box_total = sum(box.values())
    note = ''
    ok = True
    if not commentary:
        ok = False
        note = 'no commentary'
    elif box_total and box_total != len(corners):
        ok = False
        note = f'boxscore corners {box_total} != commentary {len(corners)}'
    base = {
        'season': season.get('year') or '',
        'season_name': season.get('name') or '',
        'game_id': str(header.get('id') or game_id),
        'date': meta['date'],
        'home': meta['home'],
        'away': meta['away'],
        'home_score': meta['home_score'],
        'away_score': meta['away_score'],
    }
    corner_rows = [{**base, **c} for c in corners]
    goal_rows = [{**base, **g} for g in goals]
    game_row = {
        **base,
        'commentary_n': len(commentary),
        'corners_commentary': len(corners),
        'corners_boxscore': box_total,
        'goals_commentary': len(goals),
        'ok': '1' if ok else '0',
        'note': note,
    }
    return corner_rows, goal_rows, game_row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seasons', nargs='+', type=int, default=[2025, 2026],
                    help='ESPN MLS season years')
    ap.add_argument('--game-id', help='scrape a single ESPN gameId and exit')
    ap.add_argument('--max-games', type=int, default=0)
    ap.add_argument('--sleep', type=float, default=0.25)
    ap.add_argument('--out-dir', default=None)
    args = ap.parse_args()

    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    out_dir = os.path.abspath(args.out_dir) if args.out_dir else \
        os.path.join(root, 'example_data', 'soccer_event_timing')
    os.makedirs(out_dir, exist_ok=True)
    corners_path = os.path.join(out_dir, 'espn_mls_corners.csv')
    goals_path = os.path.join(out_dir, 'espn_mls_goals.csv')
    games_path = os.path.join(out_dir, 'espn_mls_games.csv')

    if args.game_id:
        cr, gr, gm = scrape_game(args.game_id)
        print(json.dumps(gm, indent=2))
        print(f'corners {len(cr)}  goals {len(gr)}')
        for c in cr:
            print(f"  {c['display_time']:8s} {c['team']:20s}  {c['text']}")
        append_rows(corners_path, CORNER_FIELDS, cr)
        append_rows(goals_path, GOAL_FIELDS, gr)
        append_rows(games_path, GAME_FIELDS, [gm])
        return

    done = load_done(games_path)
    print(f'already scraped: {len(done)} games', flush=True)

    all_games = []
    for year in args.seasons:
        print(f'season {year}', flush=True)
        time.sleep(args.sleep)
        season_name, games = list_season_games(year, args.sleep)
        for g in games:
            g['season'] = year
            g['season_name'] = season_name
        all_games.extend(games)
        print(f'  {len(games)} completed MLS games', flush=True)

    todo = [g for g in all_games if g['id'] not in done]
    todo.sort(key=lambda g: (g['season'], g['date'], g['id']))
    if args.max_games:
        todo = todo[:args.max_games]
    print(f'scraping {len(todo)} games -> {out_dir}', flush=True)

    n_ok = n_bad = n_corners = 0
    for i, g in enumerate(todo, 1):
        time.sleep(args.sleep)
        try:
            cr, gr, gm = scrape_game(g['id'])
        except Exception as e:
            gm = {
                'season': g['season'], 'season_name': g['season_name'],
                'game_id': g['id'], 'date': g['date'],
                'home': '', 'away': '', 'home_score': '', 'away_score': '',
                'commentary_n': 0, 'corners_commentary': 0,
                'corners_boxscore': 0, 'goals_commentary': 0,
                'ok': '0', 'note': f'error: {e}',
            }
            cr, gr = [], []
        append_rows(corners_path, CORNER_FIELDS, cr)
        append_rows(goals_path, GOAL_FIELDS, gr)
        append_rows(games_path, GAME_FIELDS, [gm])
        n_corners += len(cr)
        if gm['ok'] == '1':
            n_ok += 1
        else:
            n_bad += 1
        flag = '' if gm['ok'] == '1' else f"  WARN {gm['note']}"
        print(f"  [{i}/{len(todo)}] {g['date']} {g['id']}  "
              f"corners={len(cr)}{flag}", flush=True)

    print(f'done  ok={n_ok} mismatches/errors={n_bad} corners_written={n_corners}')
    print(f'  {corners_path}')
    print(f'  {goals_path}')
    print(f'  {games_path}')


if __name__ == '__main__':
    main()
