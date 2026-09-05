#!/usr/bin/env python3
"""Re-fetch ESPN summaries and write every offensive snap with:

  down / distance / yards-to-goal / clock
  → current-drive points {0,3,6,7,8}
  → opponent next-drive start field bucket

Uses the four field buckets in ncaaf_field_buckets.py.

Usage:
  python scripts/scrape_espn_ncaaf_snaps_outcomes.py
  python scripts/scrape_espn_ncaaf_snaps_outcomes.py --max-games 40 --workers 8
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ncaaf_field_buckets import (  # noqa: E402
    dist_bin,
    fp_bucket,
    half_bin,
    next_fp_bucket,
    time_bin,
)

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
KICKOFF_TYPES = {
    'Kickoff', 'Kickoff Return (Offense)', 'Kickoff Return (Defense)',
}

TD_RESULTS = {'TD', 'RUSHING TD', 'PASSING TD', 'RECEIVING TD'}
FG_MADE = {'FG'}
ST_TD_HINTS = (
    'interception', 'fumble return', 'fumble recovery touchdown',
    'punt return', 'kickoff return', 'kick return',
    'blocked punt', 'blocked field goal',
)

SNAP_FIELDS = [
    'season', 'game_id', 'drive_n',
    'down', 'distance', 'ytg',
    'fp_bucket', 'dist_bin',
    'period', 'sec_left_game', 'sec_left_half', 'time_bin', 'half_bin',
    'off_score', 'def_score', 'score_diff',
    'play_type',
    'this_points', 'this_result',
    'next_kind', 'next_ytg', 'next_fp_bucket',
    'next_kickoff', 'next_start_text',
    'seconds_consumed',
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


def team_abbr(drive):
    team = drive.get('team') or {}
    return (team.get('abbreviation') or team.get('displayName') or '').strip()


def play_clock_period(play, drive_start):
    period = ((play.get('period') or {}).get('number')
              or ((drive_start or {}).get('period') or {}).get('number'))
    clock_disp = ((play.get('clock') or {}).get('displayValue')
                  or ((drive_start or {}).get('clock') or {}).get('displayValue'))
    return period, parse_clock_seconds(clock_disp)


def play_started_with_kickoff(drive):
    for play in drive.get('plays') or []:
        ptype = ((play.get('type') or {}).get('text') or '').strip()
        if ptype in {'Timeout', 'End Period', 'Coin Toss', 'End of Regulation'}:
            continue
        return ptype in KICKOFF_TYPES or 'kickoff' in ptype.lower()
    return False


def classify_result(drive):
    raw = str(drive.get('result') or '').strip().upper()
    display = str(drive.get('displayResult') or '').strip()
    plays = drive.get('plays') or []
    last = plays[-1] if plays else {}
    ptype = ((last.get('type') or {}).get('text') or '').strip().lower()
    if raw in FG_MADE or ptype == 'field goal good':
        return 'FG'
    if 'missed fg' in raw.lower() or ptype == 'field goal missed':
        return 'MISSED_FG'
    if raw in {'PUNT', 'BLOCKED PUNT', 'PUNT BLOCK'} or ptype.startswith('punt'):
        return 'PUNT'
    if raw in TD_RESULTS or (ptype.endswith('touchdown') and 'safety' not in ptype):
        blob = f'{ptype} {display}'.lower()
        if any(h in blob for h in ST_TD_HINTS):
            return 'OTHER'
        return 'TD'
    return 'OTHER'


def offense_score_delta(drive, offense_is_home):
    scored = []
    for play in drive.get('plays') or []:
        hs, aws = play.get('homeScore'), play.get('awayScore')
        if hs in (None, '') or aws in (None, ''):
            continue
        try:
            scored.append((int(hs), int(aws)))
        except (TypeError, ValueError):
            continue
    if not scored:
        return None
    first, last = scored[0], scored[-1]
    if offense_is_home:
        return last[0] - first[0]
    return last[1] - first[1]


def parse_points_from_text(blob):
    n = str(blob or '').lower()
    if any(x in n for x in ('two-point', 'two point', '2-pt', '2 pt', '2pt')):
        if 'fail' in n:
            return 6
        return 8
    if any(x in n for x in (
        'kick failed', 'pat failed', 'xp failed', 'missed kick',
        'kick no good', 'pat no good',
    )):
        return 6
    if 'kick' in n and 'touchdown' in n.replace('kickoff', ''):
        return 7
    if re.search(r'\bkick\)|\bkick\b', n) and 'field goal' not in n:
        return 7
    return None


def drive_points(drive, offense_is_home):
    result = classify_result(drive)
    plays = drive.get('plays') or []
    texts = [str(p.get('text') or '') for p in plays[-4:]]
    texts.append(str(drive.get('displayResult') or ''))
    blob = ' '.join(texts)
    parsed = parse_points_from_text(blob)
    delta = offense_score_delta(drive, offense_is_home)

    if result == 'FG':
        return 3
    if result in {'MISSED_FG', 'PUNT', 'OTHER'} and (delta in (None, 0)):
        return 0
    if delta in (3, 6, 7, 8):
        return delta
    if result == 'TD':
        if parsed in (6, 7, 8):
            return parsed
        return 7
    if delta == 0 or delta is None:
        return 0
    # Weird scoring (safety, defensive score). Current offense got none of 3/6/7/8.
    return 0


def offensive_start(drive):
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
                'kickoff': play_started_with_kickoff(drive),
            }
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
                'kickoff': play_started_with_kickoff(drive),
            }
    ytg = start_obj.get('yardLine')
    if ytg in (None, ''):
        return None
    period = (start_obj.get('period') or {}).get('number')
    clock_sec = parse_clock_seconds((start_obj.get('clock') or {}).get('displayValue'))
    return {
        'ytg': int(ytg),
        'period': period,
        'clock_sec': clock_sec,
        'text': start_obj.get('text') or '',
        'kickoff': play_started_with_kickoff(drive),
    }


def next_opponent_drive(drives, idx, offense):
    for j in range(idx + 1, len(drives)):
        other = team_abbr(drives[j])
        if other and other != offense:
            start = offensive_start(drives[j])
            if not start:
                continue
            this_start = drives[idx].get('start') or {}
            try:
                this_period = int((this_start.get('period') or {}).get('number') or 0)
            except (TypeError, ValueError):
                this_period = 0
            try:
                nxt_period = int(start.get('period') or 0)
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
            continue
    return 'game_over', None, None


def header_sides(summary):
    header = summary.get('header') or {}
    comp = (header.get('competitions') or [{}])[0]
    home_abbr = away_abbr = home_id = away_id = ''
    for c in comp.get('competitors') or []:
        team = c.get('team') or {}
        abbr = team.get('abbreviation') or ''
        tid = str(team.get('id') or c.get('id') or '')
        if c.get('homeAway') == 'home':
            home_abbr, home_id = abbr, tid
        else:
            away_abbr, away_id = abbr, tid
    return home_abbr, away_abbr, home_id, away_id


def extract_snaps(summary, game_id, season):
    drives = (summary.get('drives') or {}).get('previous') or []
    home_abbr, away_abbr, home_id, away_id = header_sides(summary)
    rows = []
    for i, drive in enumerate(drives):
        offense = team_abbr(drive)
        if not offense:
            continue
        offense_is_home = offense == home_abbr
        if not offense_is_home and offense != away_abbr:
            # Fall back: match display names loosely via abbreviation already.
            offense_is_home = False
        points = drive_points(drive, offense_is_home)
        result = classify_result(drive)
        next_kind, _nxt, nxt_start = next_opponent_drive(drives, i, offense)

        nxt_ytg = nxt_g = None
        nxt_text = ''
        nxt_kick = False
        nxt_fp = ''
        if nxt_start:
            nxt_ytg = nxt_start['ytg']
            nxt_g = seconds_left_in_game(nxt_start.get('period'), nxt_start.get('clock_sec'))
            nxt_text = nxt_start.get('text') or ''
            nxt_kick = bool(nxt_start.get('kickoff'))
            nxt_fp = next_fp_bucket(nxt_ytg, nxt_kick) or ''

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
            field = fp_bucket(ytg)
            dbin = dist_bin(distance)
            if not field or not dbin:
                continue

            period, clock_sec = play_clock_period(play, drive.get('start'))
            sec_g = seconds_left_in_game(period, clock_sec)
            sec_h = seconds_left_in_half(period, clock_sec)
            hb = half_bin(period) or ''
            tb = time_bin(sec_h) or ''

            hs, aws = play.get('homeScore'), play.get('awayScore')
            try:
                hs = int(hs) if hs not in (None, '') else None
                aws = int(aws) if aws not in (None, '') else None
            except (TypeError, ValueError):
                hs = aws = None
            poss_id = str(((st.get('team') or {}).get('id') or ''))
            off_score = def_score = score_diff = ''
            if hs is not None and aws is not None:
                if poss_id and home_id and poss_id == home_id:
                    off_score, def_score = hs, aws
                elif poss_id and away_id and poss_id == away_id:
                    off_score, def_score = aws, hs
                elif offense_is_home:
                    off_score, def_score = hs, aws
                else:
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
                'fp_bucket': field,
                'dist_bin': dbin,
                'period': period if period not in (None, '') else '',
                'sec_left_game': '' if sec_g is None else sec_g,
                'sec_left_half': '' if sec_h is None else sec_h,
                'time_bin': tb,
                'half_bin': hb,
                'off_score': off_score,
                'def_score': def_score,
                'score_diff': score_diff,
                'play_type': ptype,
                'this_points': points,
                'this_result': result,
                'next_kind': next_kind,
                'next_ytg': '' if nxt_ytg is None else nxt_ytg,
                'next_fp_bucket': nxt_fp,
                'next_kickoff': 1 if nxt_kick else 0,
                'next_start_text': nxt_text,
                'seconds_consumed': consumed,
            })
    return rows


def load_done(path):
    done = set()
    if not os.path.isfile(path):
        return done
    with open(path, newline='', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            gid = (row.get('game_id') or '').strip()
            if gid:
                done.add(gid)
    return done


def append_rows(path, fields, rows):
    if not rows:
        return
    with WRITE_LOCK:
        exists = os.path.isfile(path) and os.path.getsize(path) > 0
        with open(path, 'a', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
            if not exists:
                w.writeheader()
            w.writerows(rows)


def load_game_ids(games_path):
    rows = []
    with open(games_path, newline='', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            if (row.get('ok') or '1') != '1':
                continue
            gid = (row.get('game_id') or '').strip()
            if gid:
                rows.append({
                    'id': gid,
                    'season': row.get('season') or '',
                    'date': row.get('date') or '',
                })
    return rows


def scrape_one(game):
    url = f"{BASE}/summary?event={game['id']}"
    data = get_json(url)
    return game['id'], extract_snaps(data, game['id'], game.get('season') or '')


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_games = os.path.join(root, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_games.csv')
    default_out = os.path.join(
        root, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_snaps_outcomes.csv'
    )
    p = argparse.ArgumentParser()
    p.add_argument('--games', default=default_games)
    p.add_argument('--out', default=default_out)
    p.add_argument('--max-games', type=int, default=0)
    p.add_argument('--workers', type=int, default=10)
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
        futs = {pool.submit(scrape_one, g): g for g in todo}
        for k, fut in enumerate(as_completed(futs), 1):
            g = futs[fut]
            try:
                gid, rows = fut.result()
                append_rows(args.out, SNAP_FIELDS, rows)
                n_ok += 1
                n_rows += len(rows)
                if k % 25 == 0 or k == len(todo):
                    print(
                        f'  [{k}/{len(todo)}] {g.get("date")} {gid} '
                        f'snaps={len(rows)} total={n_rows} ok={n_ok} bad={n_bad}',
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
