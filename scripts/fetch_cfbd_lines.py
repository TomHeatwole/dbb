#!/usr/bin/env python3
"""Download CFBD pregame lines and attach closers to the ESPN drive dump.

CFBD's `spread` / `overUnder` are closing numbers (home-team spread).
`spreadOpen` / `overUnderOpen` are the opens when the book still has them.

Usage:
  export CFBD_API_KEY='...'
  python scripts/fetch_cfbd_lines.py
  python scripts/fetch_cfbd_lines.py --seasons 2023 2024 2025
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import urllib.parse
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT_DIR = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results')
LINES_PATH = os.path.join(OUT_DIR, 'cfbd_lines.csv')
CLOSING_PATH = os.path.join(OUT_DIR, 'cfbd_closing_lines.csv')
GAMES_PATH = os.path.join(OUT_DIR, 'espn_ncaaf_games.csv')
DRIVES_PATH = os.path.join(OUT_DIR, 'espn_ncaaf_drives.csv')
API = 'https://api.collegefootballdata.com/lines'

# Prefer books that actually post a closer; ESPN Bet has the best 2024–25 coverage.
PROVIDER_RANK = {
    'ESPN Bet': 0,
    'DraftKings': 1,
    'Draft Kings': 2,
    'Bovada': 3,
    'consensus': 4,
    'William Hill (New Jersey)': 5,
    'Caesars Sportsbook (Colorado)': 6,
    'teamrankings': 7,
}

LINE_FIELDS = [
    'season', 'season_type', 'week', 'game_id', 'start_date',
    'home', 'away', 'home_score', 'away_score',
    'home_class', 'away_class',
    'provider',
    'spread', 'spread_open', 'formatted_spread',
    'over_under', 'over_under_open',
    'home_moneyline', 'away_moneyline',
]

CLOSE_FIELDS = [
    'season', 'season_type', 'week', 'game_id', 'start_date',
    'home', 'away', 'home_score', 'away_score',
    'provider',
    'spread', 'spread_open', 'formatted_spread',
    'over_under', 'over_under_open',
    'home_moneyline', 'away_moneyline',
    'n_providers',
]


def load_env():
    path = os.path.join(ROOT, '.env.local')
    if not os.path.exists(path):
        return
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, val = line.split('=', 1)
            key, val = key.strip(), val.strip().strip("'").strip('"')
            if key and key not in os.environ:
                os.environ[key] = val


def api_key():
    load_env()
    key = os.environ.get('CFBD_API_KEY', '').strip()
    if not key:
        raise SystemExit('Set CFBD_API_KEY or put it in .env.local')
    return key


def get_json(url, key):
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {key}',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode('utf-8'))


def num(value):
    if value in (None, ''):
        return ''
    try:
        return float(value)
    except (TypeError, ValueError):
        return ''


def season_type_code(label):
    return '3' if str(label).lower() == 'postseason' else '2'


def flatten_game(game):
    rows = []
    for line in game.get('lines') or []:
        rows.append({
            'season': game.get('season') or '',
            'season_type': season_type_code(game.get('seasonType')),
            'week': game.get('week') or '',
            'game_id': str(game.get('id') or ''),
            'start_date': game.get('startDate') or '',
            'home': game.get('homeTeam') or '',
            'away': game.get('awayTeam') or '',
            'home_score': game.get('homeScore') if game.get('homeScore') is not None else '',
            'away_score': game.get('awayScore') if game.get('awayScore') is not None else '',
            'home_class': game.get('homeClassification') or '',
            'away_class': game.get('awayClassification') or '',
            'provider': line.get('provider') or '',
            'spread': num(line.get('spread')),
            'spread_open': num(line.get('spreadOpen')),
            'formatted_spread': line.get('formattedSpread') or '',
            'over_under': num(line.get('overUnder')),
            'over_under_open': num(line.get('overUnderOpen')),
            'home_moneyline': line.get('homeMoneyline') if line.get('homeMoneyline') is not None else '',
            'away_moneyline': line.get('awayMoneyline') if line.get('awayMoneyline') is not None else '',
        })
    return rows


def provider_score(row):
    rank = PROVIDER_RANK.get(row['provider'], 50)
    has_spread = row['spread'] != ''
    has_ou = row['over_under'] != ''
    completeness = (0 if has_spread else 2) + (0 if has_ou else 2)
    return (completeness, rank)


def pick_closer(rows):
    if not rows:
        return None
    return min(rows, key=provider_score)


def fetch_season(year, key):
    rows = []
    for season_type in ('regular', 'postseason'):
        qs = urllib.parse.urlencode({'year': year, 'seasonType': season_type})
        data = get_json(f'{API}?{qs}', key)
        for game in data:
            rows.extend(flatten_game(game))
        print(f'  {year} {season_type}: {len(data)} games', flush=True)
    return rows


def write_csv(path, fields, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction='ignore')
        w.writeheader()
        w.writerows(rows)


def attach_to_games(closers):
    by_id = {row['game_id']: row for row in closers}
    with open(GAMES_PATH, newline='', encoding='utf-8') as fh:
        games = list(csv.DictReader(fh))
        fields = list(games[0].keys()) if games else []
    extra = [
        'cfbd_spread', 'cfbd_over_under', 'cfbd_provider',
        'cfbd_spread_open', 'cfbd_over_under_open',
        'cfbd_home_ml', 'cfbd_away_ml', 'cfbd_formatted_spread',
    ]
    for col in extra:
        if col not in fields:
            fields.append(col)
    hit = 0
    for game in games:
        row = by_id.get(str(game['game_id']))
        if not row:
            for col in extra:
                game.setdefault(col, '')
            continue
        hit += 1
        game['cfbd_spread'] = row['spread']
        game['cfbd_over_under'] = row['over_under']
        game['cfbd_provider'] = row['provider']
        game['cfbd_spread_open'] = row['spread_open']
        game['cfbd_over_under_open'] = row['over_under_open']
        game['cfbd_home_ml'] = row['home_moneyline']
        game['cfbd_away_ml'] = row['away_moneyline']
        game['cfbd_formatted_spread'] = row['formatted_spread']
        # Prefer CFBD closer over the sparse ESPN leftover.
        if row['spread'] != '':
            game['spread'] = row['spread']
        if row['over_under'] != '':
            game['over_under'] = row['over_under']
    write_csv(GAMES_PATH, fields, games)
    return hit, len(games)


def attach_to_drives(closers):
    by_id = {row['game_id']: row for row in closers}
    extra = [
        'cfbd_spread', 'cfbd_over_under', 'cfbd_provider',
        'cfbd_spread_open', 'cfbd_over_under_open',
        'offense_spread',
    ]
    tmp = DRIVES_PATH + '.tmp'
    with open(DRIVES_PATH, newline='', encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        fields = list(reader.fieldnames or [])
        for col in extra:
            if col not in fields:
                fields.append(col)
        n = hit = 0
        with open(tmp, 'w', newline='', encoding='utf-8') as out:
            w = csv.DictWriter(out, fieldnames=fields, extrasaction='ignore')
            w.writeheader()
            for drive in reader:
                n += 1
                row = by_id.get(str(drive['game_id']))
                if row:
                    hit += 1
                    spread = row['spread']
                    drive['cfbd_spread'] = spread
                    drive['cfbd_over_under'] = row['over_under']
                    drive['cfbd_provider'] = row['provider']
                    drive['cfbd_spread_open'] = row['spread_open']
                    drive['cfbd_over_under_open'] = row['over_under_open']
                    if spread != '' and drive.get('offense_side') == 'away':
                        drive['offense_spread'] = -float(spread)
                    else:
                        drive['offense_spread'] = spread
                    if spread != '':
                        drive['spread'] = spread
                    if row['over_under'] != '':
                        drive['over_under'] = row['over_under']
                else:
                    for col in extra:
                        drive.setdefault(col, '')
                w.writerow(drive)
    os.replace(tmp, DRIVES_PATH)
    return hit, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seasons', nargs='+', type=int, default=[2023, 2024, 2025])
    args = ap.parse_args()
    key = api_key()

    all_rows = []
    for year in args.seasons:
        print(f'season {year}', flush=True)
        all_rows.extend(fetch_season(year, key))

    write_csv(LINES_PATH, LINE_FIELDS, all_rows)
    by_game = {}
    for row in all_rows:
        by_game.setdefault(row['game_id'], []).append(row)
    closers = []
    for game_id, rows in by_game.items():
        picked = pick_closer(rows)
        if not picked:
            continue
        closer = {k: picked[k] for k in CLOSE_FIELDS if k != 'n_providers'}
        closer['n_providers'] = len(rows)
        closers.append(closer)
    closers.sort(key=lambda r: (str(r['season']), str(r['season_type']), str(r['week']), r['game_id']))
    write_csv(CLOSING_PATH, CLOSE_FIELDS, closers)

    game_hit, game_n = attach_to_games(closers)
    drive_hit, drive_n = attach_to_drives(closers)
    with_spread = sum(1 for r in closers if r['spread'] != '')
    with_ou = sum(1 for r in closers if r['over_under'] != '')
    print(f'wrote {len(all_rows)} book-rows -> {LINES_PATH}')
    print(f'wrote {len(closers)} closers ({with_spread} spread, {with_ou} ou) -> {CLOSING_PATH}')
    print(f'games matched {game_hit}/{game_n}')
    print(f'drives matched {drive_hit}/{drive_n}')


if __name__ == '__main__':
    main()
