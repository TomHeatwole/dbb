#!/usr/bin/env python3
"""Download Premier League corner (and goal) timestamps from ESPN commentary.

ESPN's public soccer summary JSON includes play-by-play commentary with
clock.displayValue like 11' / 45'+1' / 90'+3' and text "Corner, Liverpool.
Conceded by ...". Games are listed from per-season standings + team schedules.

Usage:
  python scripts/scrape_espn_pl_corners.py
  python scripts/scrape_espn_pl_corners.py --seasons 2023 2024 2025
  python scripts/scrape_espn_pl_corners.py --game-id 704406
  python scripts/scrape_espn_pl_corners.py --max-games 5 --sleep 0.4
"""
import argparse
import csv
import json
import os
import random
import re
import ssl
import time
import urllib.error
import urllib.request

UA = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
)
BASE = 'https://site.web.api.espn.com/apis'
LEAGUE = 'eng.1'
LEAGUE_ID = '700'
HEADERS = {
    'User-Agent': UA,
    'Accept': 'application/json',
    'Referer': 'https://www.espn.com/soccer/scoreboard/_/league/eng.1',
}

CORNER_RE = re.compile(
    r'^Corner,\s*(.+?)\.(?:\s*Conceded by (.+?)\.)?', re.IGNORECASE)
CLOCK_RE = re.compile(r"^(\d+)'(?:\+(\d+)')?$")
GOAL_RE = re.compile(r'^Goal!', re.IGNORECASE)

CORNER_FIELDS = [
    'season', 'season_name', 'game_id', 'date', 'home', 'away',
    'home_score', 'away_score', 'team', 'conceded_by',
    'elapsed', 'elapsed_plus', 'minute', 'period',
    'clock_seconds', 'display_time', 'text',
]
GOAL_FIELDS = [
    'season', 'season_name', 'game_id', 'date', 'home', 'away',
    'home_score', 'away_score', 'team', 'elapsed', 'elapsed_plus',
    'minute', 'period', 'clock_seconds', 'display_time', 'play_type', 'text',
]
GAME_FIELDS = [
    'season', 'season_name', 'game_id', 'date', 'home', 'away',
    'home_score', 'away_score', 'commentary_n', 'corners_commentary',
    'corners_boxscore', 'goals_commentary', 'ok', 'note',
]


_SSL_CTX = ssl.create_default_context()


def get_json(url, retries=4, timeout=30):
    global _SSL_CTX
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers=HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(1.5 * (2 ** attempt) + random.random())
                continue
            raise
        except urllib.error.URLError as e:
            reason = str(getattr(e, 'reason', e))
            if 'CERTIFICATE_VERIFY_FAILED' in reason:
                _SSL_CTX = ssl._create_unverified_context()
                continue
            last = e
            if attempt < retries - 1:
                time.sleep(1.5 * (2 ** attempt) + random.random())
                continue
            raise
        except (TimeoutError, json.JSONDecodeError) as e:
            last = e
            if attempt < retries - 1:
                time.sleep(1.5 * (2 ** attempt) + random.random())
                continue
            raise
    raise last


def parse_clock(display, value):
    """Return (elapsed, elapsed_plus, minute, clock_seconds)."""
    disp = (display or '').strip()
    m = CLOCK_RE.match(disp)
    seconds = int(float(value)) if value not in (None, '') else ''
    if not m:
        return '', '', '', seconds
    elapsed = int(m.group(1))
    plus = int(m.group(2) or 0)
    return elapsed, plus, elapsed + plus, seconds


def competitor_map(header):
    comp = header['competitions'][0]
    home = away = None
    home_score = away_score = ''
    for c in comp['competitors']:
        name = (c.get('team') or {}).get('displayName') or ''
        score = c.get('score') or ''
        if c.get('homeAway') == 'home':
            home, home_score = name, score
        else:
            away, away_score = name, score
    date = (comp.get('date') or header.get('competitions', [{}])[0].get('date')
            or '')[:10]
    completed = bool(((comp.get('status') or {}).get('type') or {}).get('completed'))
    return {
        'home': home or '', 'away': away or '',
        'home_score': home_score, 'away_score': away_score,
        'date': date, 'completed': completed,
        'commentary_available': bool(comp.get('commentaryAvailable')),
    }


def boxscore_corners(summary):
    totals = {}
    for t in (summary.get('boxscore') or {}).get('teams') or []:
        name = (t.get('team') or {}).get('displayName') or ''
        for s in t.get('statistics') or []:
            if s.get('name') == 'wonCorners':
                try:
                    totals[name] = int(float(s.get('displayValue') or s.get('value') or 0))
                except (TypeError, ValueError):
                    totals[name] = 0
    return totals


def extract_corners(commentary):
    rows = []
    seen = set()
    for item in commentary or []:
        text = (item.get('text') or '').strip()
        m = CORNER_RE.match(text)
        play = item.get('play') or {}
        ptype = (play.get('type') or {}).get('type') or ''
        if not m and ptype != 'corner-awarded':
            continue
        team = (m.group(1).strip() if m else
                ((play.get('team') or {}).get('displayName') or ''))
        conceded = (m.group(2).strip() if m and m.group(2) else '')
        clock = item.get('time') or play.get('clock') or {}
        elapsed, plus, minute, seconds = parse_clock(
            clock.get('displayValue'), clock.get('value'))
        period = ((play.get('period') or {}).get('number') or '')
        key = (elapsed, plus, team, text)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            'team': team, 'conceded_by': conceded,
            'elapsed': elapsed, 'elapsed_plus': plus, 'minute': minute,
            'period': period, 'clock_seconds': seconds,
            'display_time': clock.get('displayValue') or '',
            'text': text,
        })
    return rows


def extract_goals(commentary, key_events):
    rows = []
    seen = set()
    items = []
    for item in commentary or []:
        play = item.get('play') or {}
        items.append((item.get('text') or '', item.get('time') or play.get('clock') or {},
                      play))
    for ev in key_events or []:
        items.append((ev.get('text') or '', ev.get('clock') or {}, ev))
    for text, clock, play in items:
        text = (text or '').strip()
        ptype = (play.get('type') or {})
        ptype_s = ptype.get('type') or ''
        is_goal = (
            play.get('scoringPlay')
            or ptype_s in {'goal', 'penalty---scored', 'own-goal'}
            or GOAL_RE.match(text)
        )
        if not is_goal:
            continue
        if ptype.get('text') in {'Penalty - Missed', 'Penalty - Saved'}:
            continue
        team = (play.get('team') or {}).get('displayName') or ''
        elapsed, plus, minute, seconds = parse_clock(
            clock.get('displayValue'), clock.get('value'))
        key = (elapsed, plus, team, text[:80])
        if not text or key in seen:
            continue
        seen.add(key)
        rows.append({
            'team': team,
            'elapsed': elapsed, 'elapsed_plus': plus, 'minute': minute,
            'period': (play.get('period') or {}).get('number') or '',
            'clock_seconds': seconds,
            'display_time': clock.get('displayValue') or '',
            'play_type': ptype_s or ptype.get('text') or '',
            'text': text,
        })
    return rows


def season_teams(year):
    url = f'{BASE}/v2/sports/soccer/{LEAGUE}/standings?season={year}'
    data = get_json(url)
    entries = data['children'][0]['standings']['entries']
    name = ((data.get('season') or {}).get('displayName')
            or f'{year}-{str(year + 1)[2:]} English Premier League')
    teams = [(e['team']['id'], e['team']['abbreviation'],
              e['team']['displayName']) for e in entries]
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
        print(f'    {abbr:3s}  unique games {len(by_id)}', flush=True)
    completed = [g for g in by_id.values() if g['completed']]
    return season_name, completed


def scrape_game(game_id):
    url = (f'{BASE}/site/v2/sports/soccer/{LEAGUE}/summary?event={game_id}')
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


def load_done(games_path):
    if not os.path.exists(games_path):
        return set()
    with open(games_path, newline='', encoding='utf-8') as fh:
        return {r['game_id'] for r in csv.DictReader(fh)}


def append_rows(path, fields, rows):
    exists = os.path.exists(path) and os.path.getsize(path) > 0
    with open(path, 'a', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction='ignore')
        if not exists:
            w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seasons', nargs='+', type=int, default=[2023, 2024, 2025],
                    help='ESPN season years (2023 = 2023-24)')
    ap.add_argument('--game-id', help='scrape a single ESPN gameId and exit')
    ap.add_argument('--max-games', type=int, default=0)
    ap.add_argument('--sleep', type=float, default=0.35)
    ap.add_argument('--out-dir', default=None)
    args = ap.parse_args()

    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    out_dir = os.path.abspath(args.out_dir) if args.out_dir else \
        os.path.join(root, 'example_data', 'soccer_event_timing')
    os.makedirs(out_dir, exist_ok=True)
    corners_path = os.path.join(out_dir, 'espn_pl_corners.csv')
    goals_path = os.path.join(out_dir, 'espn_pl_goals.csv')
    games_path = os.path.join(out_dir, 'espn_pl_games.csv')

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
        print(f'  {len(games)} completed PL games', flush=True)

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
