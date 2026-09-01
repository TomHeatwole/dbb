#!/usr/bin/env python3
"""Map every offensive snap to the opponent's next drive start.

Reads game ids from espn_ncaaf_games.csv, fetches ESPN summaries, and writes
one row per 1st–4th down snap:

  current down / distance / yards-to-goal / score / clock
  → opponent next-drive start yards-to-goal + clock

Yards-to-goal is ESPN's convention (95 = own 5, 25 = opponent 25).

Usage:
  python scripts/scrape_espn_ncaaf_snaps_next_drive.py
  python scripts/scrape_espn_ncaaf_snaps_next_drive.py --max-games 40 --workers 8
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

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

SKIP_TYPES = {
    'Kickoff', 'Timeout', 'End Period', 'End of Half', 'End of Game',
    'Coin Toss', 'End of Regulation',
    'Extra Point Good', 'Extra Point Missed', 'Extra Point Blocked',
    'Two-Point Pass', 'Two-Point Rush',
    'Two Point Pass', 'Two Point Rush',
    'Defensive 2pt Conversion',
}

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

SNAP_FIELDS = [
    'season', 'game_id', 'drive_n',
    'down', 'distance', 'ytg',
    'period', 'sec_left_game', 'sec_left_half',
    'off_score', 'def_score', 'score_diff',
    'play_type',
    'this_result',
    'next_kind',
    'next_ytg', 'next_period', 'next_sec_left_game', 'next_sec_left_half',
    'seconds_consumed',
    'next_start_text',
]

CLOCK_RE = re.compile(r'^(\d+):(\d{2})$')
_SSL_CTX = ssl._create_unverified_context()
WRITE_LOCK = Lock()


def get_json(url, retries=5, timeout=40):
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


def seconds_left_in_game(period, clock_sec):
    if clock_sec is None or not period:
        return None
    try:
        p = int(period)
    except (TypeError, ValueError):
        return None
    if p <= 4:
        return (4 - p) * 15 * 60 + clock_sec
    return clock_sec


def seconds_left_in_half(period, clock_sec):
    if clock_sec is None or not period:
        return None
    try:
        p = int(period)
    except (TypeError, ValueError):
        return None
    if p in (1, 3):
        return 900 + clock_sec
    if p in (2, 4):
        return clock_sec
    return clock_sec


def last_play(drive):
    plays = drive.get('plays') or []
    return plays[-1] if plays else {}


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


def team_abbr(drive):
    team = drive.get('team') or {}
    return (team.get('abbreviation') or team.get('displayName') or '').strip()


def play_clock_period(play, drive_start):
    period = ((play.get('period') or {}).get('number')
              or ((drive_start or {}).get('period') or {}).get('number'))
    clock_disp = ((play.get('clock') or {}).get('displayValue')
                  or ((drive_start or {}).get('clock') or {}).get('displayValue'))
    clock_sec = parse_clock_seconds(clock_disp)
    return period, clock_sec


def offensive_start(drive):
    """First real 1st–4th down of a drive (skip kickoff / PAT / period markers)."""
    start_obj = drive.get('start') or {}
    for play in drive.get('plays') or []:
        ptype = ((play.get('type') or {}).get('text') or '').strip()
        if ptype in SKIP_TYPES:
            continue
        st = play.get('start') or {}
        down = st.get('down')
        ytg = st.get('yardsToEndzone')
        if down in (1, 2, 3, 4) and ytg not in (None, ''):
            period, clock_sec = play_clock_period(play, start_obj)
            return {
                'ytg': int(ytg),
                'period': period,
                'clock_sec': clock_sec,
                'text': st.get('possessionText') or start_obj.get('text') or '',
            }
    # Fallback: first play yards-to-goal even if down is 0 (kickoff return).
    plays = drive.get('plays') or []
    if plays:
        st = plays[0].get('start') or {}
        ytg = st.get('yardsToEndzone')
        if ytg not in (None, ''):
            period, clock_sec = play_clock_period(plays[0], start_obj)
            return {
                'ytg': int(ytg),
                'period': period,
                'clock_sec': clock_sec,
                'text': st.get('possessionText') or start_obj.get('text') or '',
            }
    ytg = start_obj.get('yardLine')
    period = (start_obj.get('period') or {}).get('number')
    clock_sec = parse_clock_seconds((start_obj.get('clock') or {}).get('displayValue'))
    if ytg not in (None, ''):
        return {
            'ytg': int(ytg),
            'period': period,
            'clock_sec': clock_sec,
            'text': start_obj.get('text') or '',
        }
    return None


def next_opponent_drive(drives, idx, offense):
    """First later drive by a different team. Returns (kind, drive, start)."""
    for j in range(idx + 1, len(drives)):
        other = team_abbr(drives[j])
        if other and other != offense:
            start = offensive_start(drives[j])
            if not start:
                continue
            this_start = drives[idx].get('start') or {}
            this_period = (this_start.get('period') or {}).get('number') or 0
            try:
                this_period = int(this_period)
            except (TypeError, ValueError):
                this_period = 0
            nxt_period = start.get('period') or 0
            try:
                nxt_period = int(nxt_period)
            except (TypeError, ValueError):
                nxt_period = 0
            if this_period in (1, 2) and nxt_period >= 3:
                kind = 'opp_next_half'
            elif this_period in (3, 4) and nxt_period > 4:
                kind = 'opp_ot'
            else:
                kind = 'opp_same_half'
            return kind, drives[j], start
        if other == offense:
            # Same team again (2H receive after ending 1H, or after a score+onside, etc.)
            # Keep scanning for the actual opponent.
            continue
    return 'game_over', None, None


def extract_snaps(summary, game_id, season):
    drives = (summary.get('drives') or {}).get('previous') or []
    rows = []
    for i, drive in enumerate(drives):
        offense = team_abbr(drive)
        if not offense:
            continue
        result = classify_bucket(drive)
        next_kind, _nxt_drive, nxt_start = next_opponent_drive(drives, i, offense)

        nxt_ytg = nxt_period = nxt_g = nxt_h = None
        nxt_text = ''
        if nxt_start:
            nxt_ytg = nxt_start['ytg']
            nxt_period = nxt_start['period']
            nxt_g = seconds_left_in_game(nxt_period, nxt_start['clock_sec'])
            nxt_h = seconds_left_in_half(nxt_period, nxt_start['clock_sec'])
            nxt_text = nxt_start.get('text') or ''

        for play in drive.get('plays') or []:
            ptype = ((play.get('type') or {}).get('text') or '').strip()
            if ptype in SKIP_TYPES:
                continue
            st = play.get('start') or {}
            down = st.get('down')
            distance = st.get('distance')
            ytg = st.get('yardsToEndzone')
            if down not in (1, 2, 3, 4):
                continue
            if distance in (None, '') or ytg in (None, ''):
                continue
            try:
                down = int(down)
                distance = int(distance)
                ytg = int(ytg)
            except (TypeError, ValueError):
                continue
            if ytg < 1 or ytg > 99:
                continue

            period, clock_sec = play_clock_period(play, drive.get('start'))
            sec_g = seconds_left_in_game(period, clock_sec)
            sec_h = seconds_left_in_half(period, clock_sec)

            hs = play.get('homeScore')
            aws = play.get('awayScore')
            try:
                hs = int(hs) if hs not in (None, '') else None
                aws = int(aws) if aws not in (None, '') else None
            except (TypeError, ValueError):
                hs = aws = None

            header = summary.get('header') or {}
            comp = (header.get('competitions') or [{}])[0]
            home_id = away_id = None
            for c in comp.get('competitors') or []:
                tid = ((c.get('team') or {}).get('id')
                       or (c.get('id')))
                if c.get('homeAway') == 'home':
                    home_id = str(tid) if tid is not None else None
                else:
                    away_id = str(tid) if tid is not None else None

            poss_id = str(((st.get('team') or {}).get('id') or ''))
            off_score = def_score = score_diff = ''
            if hs is not None and aws is not None:
                if poss_id and home_id and poss_id == home_id:
                    off_score, def_score = hs, aws
                elif poss_id and away_id and poss_id == away_id:
                    off_score, def_score = aws, hs
                else:
                    # Fall back: drive team abbr vs header.
                    home_abbr = away_abbr = ''
                    for c in comp.get('competitors') or []:
                        abbr = ((c.get('team') or {}).get('abbreviation') or '')
                        if c.get('homeAway') == 'home':
                            home_abbr = abbr
                        else:
                            away_abbr = abbr
                    if offense == home_abbr:
                        off_score, def_score = hs, aws
                    elif offense == away_abbr:
                        off_score, def_score = aws, hs
                if off_score != '' and def_score != '':
                    score_diff = off_score - def_score

            consumed = ''
            if sec_g is not None and nxt_g is not None:
                consumed = max(0, sec_g - nxt_g)

            rows.append({
                'season': season,
                'game_id': str(game_id),
                'drive_n': i,
                'down': down,
                'distance': distance,
                'ytg': ytg,
                'period': period if period not in (None, '') else '',
                'sec_left_game': '' if sec_g is None else sec_g,
                'sec_left_half': '' if sec_h is None else sec_h,
                'off_score': off_score,
                'def_score': def_score,
                'score_diff': score_diff,
                'play_type': ptype,
                'this_result': result,
                'next_kind': next_kind,
                'next_ytg': '' if nxt_ytg is None else nxt_ytg,
                'next_period': '' if nxt_period in (None, '') else nxt_period,
                'next_sec_left_game': '' if nxt_g is None else nxt_g,
                'next_sec_left_half': '' if nxt_h is None else nxt_h,
                'seconds_consumed': consumed,
                'next_start_text': nxt_text,
            })
    return rows


def load_done(path):
    done = set()
    if not os.path.isfile(path):
        return done
    with open(path, newline='') as f:
        for row in csv.DictReader(f):
            gid = (row.get('game_id') or '').strip()
            if gid:
                done.add(gid)
    return done


def append_rows(path, fields, rows):
    if not rows:
        return
    exists = os.path.isfile(path)
    with WRITE_LOCK:
        exists = os.path.isfile(path)
        with open(path, 'a', newline='') as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
            if not exists or os.path.getsize(path) == 0:
                w.writeheader()
            for row in rows:
                w.writerow(row)


def load_game_ids(games_path):
    rows = []
    with open(games_path, newline='') as f:
        for row in csv.DictReader(f):
            if (row.get('ok') or '1') != '1':
                continue
            gid = (row.get('game_id') or '').strip()
            if not gid:
                continue
            rows.append({
                'id': gid,
                'season': row.get('season') or '',
                'date': row.get('date') or '',
                'home': row.get('home') or '',
                'away': row.get('away') or '',
            })
    return rows


def scrape_one(game):
    gid = game['id']
    url = f'{BASE}/summary?event={gid}'
    data = get_json(url)
    rows = extract_snaps(data, gid, game.get('season') or '')
    return gid, rows, None


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_games = os.path.join(
        root, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_games.csv'
    )
    default_out = os.path.join(
        root, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_snaps_next_drive.csv'
    )
    p = argparse.ArgumentParser()
    p.add_argument('--games', default=default_games)
    p.add_argument('--out', default=default_out)
    p.add_argument('--max-games', type=int, default=0)
    p.add_argument('--workers', type=int, default=10)
    p.add_argument('--sleep', type=float, default=0.0)
    args = p.parse_args()

    games = load_game_ids(args.games)
    done = load_done(args.out)
    todo = [g for g in games if g['id'] not in done]
    if args.max_games:
        todo = todo[:args.max_games]
    print(f'games listed={len(games)} already={len(done)} todo={len(todo)}', flush=True)
    if not todo:
        return

    n_ok = n_bad = n_rows = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {}
        for g in todo:
            if args.sleep:
                time.sleep(args.sleep)
            futs[pool.submit(scrape_one, g)] = g
        for k, fut in enumerate(as_completed(futs), 1):
            g = futs[fut]
            try:
                gid, rows, err = fut.result()
                append_rows(args.out, SNAP_FIELDS, rows)
                n_ok += 1
                n_rows += len(rows)
                if k % 25 == 0 or k == len(todo):
                    print(
                        f'  [{k}/{len(todo)}] {g.get("date")} {gid} '
                        f'snaps={len(rows)}  total_snaps={n_rows} ok={n_ok} bad={n_bad}',
                        flush=True,
                    )
            except Exception as e:
                n_bad += 1
                print(f'  FAIL {g["id"]} {e}', flush=True)

    print(f'done ok={n_ok} bad={n_bad} snaps={n_rows}')
    print(f'  {args.out}')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
