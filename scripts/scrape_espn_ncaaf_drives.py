#!/usr/bin/env python3
"""Download NCAAF drive results from ESPN for the last few seasons.

One row per drive. Result is bucketed into Offensive TD / Field Goal Attempt /
Punt / Any Other. Each row also has score at the snap, clock at drive start,
final scores, winner/margin, and drive-result counts so far (game + offense).

Pregame spread / total are stored when ESPN still has them on the summary
(often gone after the game). Final score is the proxy either way.

Usage:
  python scripts/scrape_espn_ncaaf_drives.py
  python scripts/scrape_espn_ncaaf_drives.py --seasons 2023 2024 2025
  python scripts/scrape_espn_ncaaf_drives.py --game-id 401628374
  python scripts/scrape_espn_ncaaf_drives.py --max-games 8 --sleep 0.25
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
BASE = 'https://site.web.api.espn.com/apis/site/v2/sports/football/college-football'
HEADERS = {
    'User-Agent': UA,
    'Accept': 'application/json',
    'Referer': 'https://www.espn.com/college-football/scoreboard',
}

# ESPN group ids: 80 = FBS, 81 = FCS.
GROUPS = ('80', '81')
SEASON_TYPES = (2, 3)  # regular, postseason

BUCKET_TD = 'Offensive TD'
BUCKET_FG = 'Field Goal Attempt'
BUCKET_PUNT = 'Punt'
BUCKET_OTHER = 'Any Other'

FG_RESULTS = {
    'FG', 'MISSED FG', 'FG MISSED', 'BLOCKED FG', 'FG BLOCKED',
    'MISSED_FG', 'BLOCKED_FG',
}
PUNT_RESULTS = {'PUNT', 'BLOCKED PUNT', 'PUNT BLOCK', 'BLOCKED_PUNT'}
TD_RESULTS = {'TD', 'RUSHING TD', 'PASSING TD', 'RECEIVING TD'}

ST_TD_HINTS = (
    'interception', 'fumble return', 'fumble recovery touchdown',
    'punt return', 'kickoff return', 'kick return',
    'blocked punt', 'blocked field goal',
)

DRIVE_FIELDS = [
    'season', 'season_type', 'week', 'game_id', 'date',
    'home', 'away', 'home_abbr', 'away_abbr',
    'home_final', 'away_final', 'winner', 'margin',
    'spread', 'over_under',
    'drive_n', 'drive_id',
    'offense', 'offense_abbr', 'offense_side',
    'start_period', 'start_clock', 'start_seconds_left',
    'start_yard', 'start_text',
    'start_home_score', 'start_away_score',
    'start_offense_score', 'start_defense_score',
    'raw_result', 'display_result', 'result_bucket',
    'yards', 'offensive_plays', 'is_score',
    'so_far_td', 'so_far_fg', 'so_far_punt', 'so_far_other',
    'off_so_far_td', 'off_so_far_fg', 'off_so_far_punt', 'off_so_far_other',
    'so_far_seq',
]
GAME_FIELDS = [
    'season', 'season_type', 'week', 'game_id', 'date',
    'home', 'away', 'home_abbr', 'away_abbr',
    'home_final', 'away_final', 'winner', 'margin',
    'spread', 'over_under',
    'n_drives', 'n_td', 'n_fg', 'n_punt', 'n_other',
    'ok', 'note',
]

CLOCK_RE = re.compile(r'^(\d+):(\d{2})$')
_SSL_CTX = ssl.create_default_context()


def get_json(url, retries=5, timeout=40):
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
                time.sleep(1.6 * (2 ** attempt) + random.random())
                continue
            raise
        except urllib.error.URLError as e:
            reason = str(getattr(e, 'reason', e))
            if 'CERTIFICATE_VERIFY_FAILED' in reason:
                _SSL_CTX = ssl._create_unverified_context()
                continue
            last = e
            if attempt < retries - 1:
                time.sleep(1.6 * (2 ** attempt) + random.random())
                continue
            raise
        except (TimeoutError, json.JSONDecodeError) as e:
            last = e
            if attempt < retries - 1:
                time.sleep(1.6 * (2 ** attempt) + random.random())
                continue
            raise
    raise last


def parse_clock_seconds(display):
    m = CLOCK_RE.match(str(display or '').strip())
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


def seconds_left_in_game(period, clock_display):
    clock = parse_clock_seconds(clock_display)
    if clock is None or not period:
        return ''
    try:
        p = int(period)
    except (TypeError, ValueError):
        return ''
    if p <= 4:
        return (4 - p) * 15 * 60 + clock
    return clock


def last_play(drive):
    plays = drive.get('plays') or []
    return plays[-1] if plays else {}


def first_play(drive):
    plays = drive.get('plays') or []
    return plays[0] if plays else {}


def classify_bucket(drive):
    raw = str(drive.get('result') or '').strip().upper()
    display = str(drive.get('displayResult') or '').strip()
    play = last_play(drive)
    ptype = ((play.get('type') or {}).get('text') or '').strip().lower()

    if raw in FG_RESULTS or 'field goal' in ptype or 'field goal' in display.lower():
        return BUCKET_FG
    if raw in PUNT_RESULTS or ptype.startswith('punt') or display.lower() in {'punt', 'blocked punt'}:
        return BUCKET_PUNT
    if raw in TD_RESULTS or (ptype.endswith('touchdown') and 'safety' not in ptype):
        if any(h in ptype for h in ST_TD_HINTS):
            return BUCKET_OTHER
        if any(h in display.lower() for h in ST_TD_HINTS):
            return BUCKET_OTHER
        return BUCKET_TD
    return BUCKET_OTHER


def extract_odds(summary, competition=None):
    spread = over_under = ''
    pick = (summary or {}).get('pickcenter') or []
    if pick and isinstance(pick, list):
        row = pick[0] or {}
        if row.get('spread') not in (None, ''):
            spread = row.get('spread')
        if row.get('overUnder') not in (None, ''):
            over_under = row.get('overUnder')
    odds = (summary or {}).get('odds') or []
    if isinstance(odds, dict):
        odds = [odds]
    if odds:
        row = odds[0] or {}
        details = row.get('details') or row
        if spread == '' and details.get('spread') not in (None, ''):
            spread = details.get('spread')
        ou = details.get('overUnder') or row.get('overUnder')
        if over_under == '' and ou not in (None, ''):
            over_under = ou
    comp = competition or {}
    if spread == '' or over_under == '':
        for row in comp.get('odds') or []:
            if spread == '' and row.get('spread') not in (None, ''):
                spread = row.get('spread')
            if over_under == '' and row.get('overUnder') not in (None, ''):
                over_under = row.get('overUnder')
    return (
        '' if spread in (None, '') else str(spread),
        '' if over_under in (None, '') else str(over_under),
    )


def competitor_meta(header):
    comp = ((header or {}).get('competitions') or [{}])[0]
    home = away = {'name': '', 'abbr': '', 'score': ''}
    for c in comp.get('competitors') or []:
        team = c.get('team') or {}
        row = {
            'name': team.get('displayName') or '',
            'abbr': team.get('abbreviation') or '',
            'score': c.get('score') if c.get('score') not in (None, '') else '',
        }
        if c.get('homeAway') == 'home':
            home = row
        else:
            away = row
    date = (comp.get('date') or (header or {}).get('competitions', [{}])[0].get('date') or '')[:10]
    return home, away, date, comp


def winner_margin(home_score, away_score):
    try:
        h = int(float(home_score))
        a = int(float(away_score))
    except (TypeError, ValueError):
        return '', ''
    if h > a:
        return 'home', h - a
    if a > h:
        return 'away', a - h
    return 'tie', 0


def scoreboard_url(year, seasontype, week, group):
    return (
        f'{BASE}/scoreboard?dates={year}&seasontype={seasontype}'
        f'&week={week}&limit=400&groups={group}'
    )


def list_weeks(year, seasontype, sleep):
    time.sleep(sleep)
    data = get_json(scoreboard_url(year, seasontype, 1, GROUPS[0]))
    weeks = []
    for block in ((data.get('leagues') or [{}])[0].get('calendar') or []):
        if str(block.get('value')) != str(seasontype):
            continue
        for entry in block.get('entries') or []:
            try:
                weeks.append(int(entry.get('value')))
            except (TypeError, ValueError):
                continue
    if weeks:
        return weeks
    return list(range(1, 17 if seasontype == 2 else 7))


def events_from_scoreboard(data, year, seasontype, week, group):
    rows = []
    for ev in data.get('events') or []:
        comp = (ev.get('competitions') or [{}])[0]
        status = ((comp.get('status') or {}).get('type') or {})
        if not status.get('completed'):
            continue
        home, away, date, _ = competitor_meta({'competitions': [comp], 'id': ev.get('id')})
        if not home['name'] and not away['name']:
            for c in comp.get('competitors') or []:
                team = c.get('team') or {}
                row = {
                    'name': team.get('displayName') or '',
                    'abbr': team.get('abbreviation') or '',
                    'score': c.get('score') if c.get('score') not in (None, '') else '',
                }
                if c.get('homeAway') == 'home':
                    home = row
                else:
                    away = row
            date = (comp.get('date') or ev.get('date') or '')[:10]
        spread, over_under = extract_odds({}, comp)
        rows.append({
            'id': str(ev.get('id') or ''),
            'season': year,
            'season_type': seasontype,
            'week': week,
            'group': group,
            'date': date,
            'home': home['name'],
            'away': away['name'],
            'completed': True,
            'spread': spread,
            'over_under': over_under,
        })
    return rows


def list_season_games(year, sleep):
    by_id = {}
    for seasontype in SEASON_TYPES:
        try:
            weeks = list_weeks(year, seasontype, sleep)
        except Exception as e:
            print(f'  season {year} type {seasontype} calendar failed: {e}', flush=True)
            weeks = list(range(1, 17 if seasontype == 2 else 7))
        label = 'regular' if seasontype == 2 else 'post'
        print(f'  {year} {label}: weeks {weeks[0] if weeks else "-"}-{weeks[-1] if weeks else "-"}', flush=True)
        for week in weeks:
            for group in GROUPS:
                time.sleep(sleep)
                try:
                    data = get_json(scoreboard_url(year, seasontype, week, group))
                except Exception as e:
                    print(f'    week {week} group {group} fail: {e}', flush=True)
                    continue
                for row in events_from_scoreboard(data, year, seasontype, week, group):
                    prev = by_id.get(row['id'])
                    if prev is None or (prev.get('season_type') == 2 and seasontype == 3):
                        by_id[row['id']] = row
            print(f'    week {week}: unique completed {len(by_id)}', flush=True)
    return list(by_id.values())


def scrape_game(game_id, listing=None):
    listing = listing or {}
    summary = get_json(f'{BASE}/summary?event={game_id}')
    header = summary.get('header') or {}
    home, away, date, comp = competitor_meta(header)
    season = header.get('season') or {}
    season_year = season.get('year') or listing.get('season') or ''
    season_type = season.get('type') or listing.get('season_type') or ''
    week_raw = header.get('week')
    if isinstance(week_raw, dict):
        week = week_raw.get('number') or listing.get('week') or ''
    elif week_raw not in (None, ''):
        week = week_raw
    else:
        week = listing.get('week') or ''
    spread, over_under = extract_odds(summary, comp)
    if spread == '':
        spread = listing.get('spread') or ''
    if over_under == '':
        over_under = listing.get('over_under') or ''

    try:
        hf = int(float(home['score'])) if home['score'] != '' else ''
        af = int(float(away['score'])) if away['score'] != '' else ''
    except (TypeError, ValueError):
        hf = af = ''
    winner, margin = winner_margin(hf, af)

    drives_blob = summary.get('drives') or {}
    drives = []
    if isinstance(drives_blob, dict):
        drives.extend(drives_blob.get('previous') or [])
        current = drives_blob.get('current')
        if current:
            drives.append(current)
    elif isinstance(drives_blob, list):
        drives = drives_blob

    so_far = {BUCKET_TD: 0, BUCKET_FG: 0, BUCKET_PUNT: 0, BUCKET_OTHER: 0}
    off_so_far = {}
    seq = []
    rows = []
    run_home, run_away = 0, 0
    for i, drive in enumerate(drives, 1):
        team = drive.get('team') or {}
        offense = team.get('displayName') or team.get('shortDisplayName') or ''
        offense_abbr = team.get('abbreviation') or ''
        if offense_abbr == home['abbr']:
            side = 'home'
        elif offense_abbr == away['abbr']:
            side = 'away'
        elif offense == home['name']:
            side = 'home'
        elif offense == away['name']:
            side = 'away'
        else:
            side = ''

        start = drive.get('start') or {}
        period = (start.get('period') or {}).get('number') or ''
        clock = (start.get('clock') or {}).get('displayValue') or ''
        # Kickoffs often stay 0-0. Carry the running score from the previous drive.
        sh, sa = run_home, run_away
        last = last_play(drive)
        try:
            lh = last.get('homeScore')
            la = last.get('awayScore')
            if lh not in (None, '') and la not in (None, ''):
                lh, la = int(lh), int(la)
                if lh + la >= run_home + run_away:
                    run_home, run_away = lh, la
        except (TypeError, ValueError):
            pass
        if side == 'home':
            off_score, def_score = sh, sa
        elif side == 'away':
            off_score, def_score = sa, sh
        else:
            off_score = def_score = ''

        bucket = classify_bucket(drive)
        key = offense_abbr or offense or f'drive-{i}'
        prior = off_so_far.setdefault(key, {BUCKET_TD: 0, BUCKET_FG: 0, BUCKET_PUNT: 0, BUCKET_OTHER: 0})

        rows.append({
            'season': season_year,
            'season_type': season_type,
            'week': week,
            'game_id': str(header.get('id') or game_id),
            'date': date or listing.get('date') or '',
            'home': home['name'],
            'away': away['name'],
            'home_abbr': home['abbr'],
            'away_abbr': away['abbr'],
            'home_final': hf,
            'away_final': af,
            'winner': winner,
            'margin': margin,
            'spread': spread,
            'over_under': over_under,
            'drive_n': i,
            'drive_id': drive.get('id') or '',
            'offense': offense,
            'offense_abbr': offense_abbr,
            'offense_side': side,
            'start_period': period,
            'start_clock': clock,
            'start_seconds_left': seconds_left_in_game(period, clock),
            'start_yard': (start.get('yardLine') if start.get('yardLine') is not None else ''),
            'start_text': start.get('text') or '',
            'start_home_score': sh,
            'start_away_score': sa,
            'start_offense_score': off_score,
            'start_defense_score': def_score,
            'raw_result': drive.get('result') or '',
            'display_result': drive.get('displayResult') or '',
            'result_bucket': bucket,
            'yards': drive.get('yards') if drive.get('yards') is not None else '',
            'offensive_plays': drive.get('offensivePlays') if drive.get('offensivePlays') is not None else '',
            'is_score': 1 if drive.get('isScore') else 0,
            'so_far_td': so_far[BUCKET_TD],
            'so_far_fg': so_far[BUCKET_FG],
            'so_far_punt': so_far[BUCKET_PUNT],
            'so_far_other': so_far[BUCKET_OTHER],
            'off_so_far_td': prior[BUCKET_TD],
            'off_so_far_fg': prior[BUCKET_FG],
            'off_so_far_punt': prior[BUCKET_PUNT],
            'off_so_far_other': prior[BUCKET_OTHER],
            'so_far_seq': '|'.join(seq),
        })
        so_far[bucket] += 1
        prior[bucket] += 1
        seq.append({
            BUCKET_TD: 'TD', BUCKET_FG: 'FG', BUCKET_PUNT: 'PUNT', BUCKET_OTHER: 'OTHER',
        }[bucket])

    note = ''
    ok = True
    if not drives:
        ok = False
        note = 'no drives'
    game_row = {
        'season': season_year,
        'season_type': season_type,
        'week': week,
        'game_id': str(header.get('id') or game_id),
        'date': date or listing.get('date') or '',
        'home': home['name'],
        'away': away['name'],
        'home_abbr': home['abbr'],
        'away_abbr': away['abbr'],
        'home_final': hf,
        'away_final': af,
        'winner': winner,
        'margin': margin,
        'spread': spread,
        'over_under': over_under,
        'n_drives': len(rows),
        'n_td': so_far[BUCKET_TD],
        'n_fg': so_far[BUCKET_FG],
        'n_punt': so_far[BUCKET_PUNT],
        'n_other': so_far[BUCKET_OTHER],
        'ok': '1' if ok else '0',
        'note': note,
    }
    return rows, game_row


def load_done(games_path):
    if not os.path.exists(games_path):
        return set()
    with open(games_path, newline='', encoding='utf-8') as fh:
        return {r['game_id'] for r in csv.DictReader(fh)}


def append_rows(path, fields, rows):
    if not rows:
        return
    exists = os.path.exists(path) and os.path.getsize(path) > 0
    with open(path, 'a', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction='ignore')
        if not exists:
            w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seasons', nargs='+', type=int, default=[2023, 2024, 2025],
                    help='ESPN season years (2023 = 2023 NCAAF season)')
    ap.add_argument('--game-id', help='scrape a single ESPN gameId and exit')
    ap.add_argument('--max-games', type=int, default=0)
    ap.add_argument('--sleep', type=float, default=0.22)
    ap.add_argument('--out-dir', default=None)
    args = ap.parse_args()

    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    out_dir = os.path.abspath(args.out_dir) if args.out_dir else \
        os.path.join(root, 'example_data', 'ncaaf_drive_results')
    os.makedirs(out_dir, exist_ok=True)
    drives_path = os.path.join(out_dir, 'espn_ncaaf_drives.csv')
    games_path = os.path.join(out_dir, 'espn_ncaaf_games.csv')

    if args.game_id:
        dr, gm = scrape_game(args.game_id)
        print(json.dumps(gm, indent=2))
        for row in dr:
            print(
                f"  Q{row['start_period']} {row['start_clock']:>5}  "
                f"{row['start_home_score']}-{row['start_away_score']}  "
                f"{row['offense_abbr']:4}  {row['result_bucket']:20}  "
                f"{row['raw_result']}"
            )
        append_rows(drives_path, DRIVE_FIELDS, dr)
        append_rows(games_path, GAME_FIELDS, [gm])
        return

    done = load_done(games_path)
    print(f'already scraped: {len(done)} games', flush=True)

    all_games = []
    for year in args.seasons:
        print(f'season {year}', flush=True)
        games = list_season_games(year, args.sleep)
        all_games.extend(games)
        print(f'  {len(games)} completed games', flush=True)

    todo = [g for g in all_games if g['id'] not in done]
    todo.sort(key=lambda g: (g['season'], g['season_type'], g['week'], g['date'], g['id']))
    if args.max_games:
        todo = todo[:args.max_games]
    print(f'scraping {len(todo)} games -> {out_dir}', flush=True)

    n_ok = n_bad = n_drives = 0
    for i, g in enumerate(todo, 1):
        time.sleep(args.sleep)
        try:
            dr, gm = scrape_game(g['id'], g)
        except Exception as e:
            gm = {
                'season': g.get('season'), 'season_type': g.get('season_type'),
                'week': g.get('week'), 'game_id': g['id'], 'date': g.get('date'),
                'home': g.get('home'), 'away': g.get('away'),
                'home_abbr': '', 'away_abbr': '',
                'home_final': '', 'away_final': '', 'winner': '', 'margin': '',
                'spread': g.get('spread') or '', 'over_under': g.get('over_under') or '',
                'n_drives': 0, 'n_td': 0, 'n_fg': 0, 'n_punt': 0, 'n_other': 0,
                'ok': '0', 'note': f'error: {e}',
            }
            dr = []
        append_rows(drives_path, DRIVE_FIELDS, dr)
        append_rows(games_path, GAME_FIELDS, [gm])
        n_drives += len(dr)
        if gm['ok'] == '1':
            n_ok += 1
        else:
            n_bad += 1
        flag = '' if gm['ok'] == '1' else f"  WARN {gm['note']}"
        print(
            f"  [{i}/{len(todo)}] {g.get('date')} {g['id']}  "
            f"{g.get('away','')} @ {g.get('home','')}  drives={len(dr)}{flag}",
            flush=True,
        )

    print(f'done  ok={n_ok} missing/errors={n_bad} drives_written={n_drives}')
    print(f'  {drives_path}')
    print(f'  {games_path}')


if __name__ == '__main__':
    main()
