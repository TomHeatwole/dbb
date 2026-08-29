#!/usr/bin/env python3
"""Pull first/second-half added time from ESPN commentary for scraped PL games.

Two clocks per half:
  announced — "Fourth official has announced N minutes of added time."
  played    — clock on "First/Second Half ends" (45'+X' / 90'+X').

Played is the one that actually happened. Announced is the board, and is
missing on a minority of older commentaries.

Usage:
  python scripts/scrape_espn_pl_stoppage.py
  python scripts/scrape_espn_pl_stoppage.py --max-games 20 --sleep 0.25
"""
import argparse
import csv
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
HEADERS = {
    'User-Agent': UA,
    'Accept': 'application/json',
    'Referer': 'https://www.espn.com/soccer/scoreboard/_/league/eng.1',
}

CLOCK_RE = re.compile(r"^(\d+)'(?:\+(\d+)')?$")
ANNOUNCED_RE = re.compile(
    r'(?:fourth official has )?announced\s+(\d+)\s+minutes?\s+of added time',
    re.I,
)
ENDS_RE = re.compile(r'^(First|Second) Half ends', re.I)

FIELDS = [
    'season', 'season_name', 'game_id', 'date', 'home', 'away',
    'home_score', 'away_score', 'commentary_n',
    'ht_announced', 'ht_played', 'ht_ends_clock', 'ht_announced_clock',
    'ft_announced', 'ft_played', 'ft_ends_clock', 'ft_announced_clock',
    'ht_overrun', 'ft_overrun', 'ok', 'note',
]

_SSL_CTX = ssl.create_default_context()


def get_json(url, retries=4, timeout=30):
    global _SSL_CTX
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers=HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
                return json_loads(resp.read())
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
        except (TimeoutError, ValueError) as e:
            last = e
            if attempt < retries - 1:
                time.sleep(1.5 * (2 ** attempt) + random.random())
                continue
            raise
    raise last


def json_loads(raw):
    import json
    return json.loads(raw.decode('utf-8'))


def parse_clock(display):
    m = CLOCK_RE.match((display or '').strip())
    if not m:
        return None, None
    return int(m.group(1)), int(m.group(2) or 0)


def item_clock(item):
    play = item.get('play') or {}
    clock = item.get('time') or play.get('clock') or {}
    return (clock.get('displayValue') or '').strip()


def extract_stoppage(commentary):
    ht_ann = ft_ann = None
    ht_ann_clock = ft_ann_clock = ''
    ht_end = ft_end = None
    ht_end_clock = ft_end_clock = ''

    for item in commentary or []:
        text = (item.get('text') or '').strip()
        disp = item_clock(item)
        elapsed, plus = parse_clock(disp)

        m = ANNOUNCED_RE.search(text)
        if m:
            n = int(m.group(1))
            if elapsed == 45 or (elapsed is not None and elapsed < 46):
                ht_ann, ht_ann_clock = n, disp
            elif elapsed == 90 or (elapsed is not None and elapsed >= 46):
                ft_ann, ft_ann_clock = n, disp
            elif ht_ann is None:
                ht_ann, ht_ann_clock = n, disp
            else:
                ft_ann, ft_ann_clock = n, disp
            continue

        em = ENDS_RE.match(text)
        if em:
            which = em.group(1).lower()
            if which == 'first':
                ht_end = plus if elapsed == 45 else (plus if plus is not None else None)
                if elapsed == 45:
                    ht_end = plus
                elif elapsed is not None and elapsed <= 45:
                    ht_end = max(0, elapsed + (plus or 0) - 45)
                ht_end_clock = disp
            else:
                if elapsed == 90:
                    ft_end = plus
                elif elapsed is not None and elapsed >= 46:
                    ft_end = max(0, elapsed + (plus or 0) - 90)
                ft_end_clock = disp

    return {
        'ht_announced': ht_ann,
        'ht_played': ht_end,
        'ht_ends_clock': ht_end_clock,
        'ht_announced_clock': ht_ann_clock,
        'ft_announced': ft_ann,
        'ft_played': ft_end,
        'ft_ends_clock': ft_end_clock,
        'ft_announced_clock': ft_ann_clock,
    }


def scrape_game(game_id):
    url = f'{BASE}/site/v2/sports/soccer/{LEAGUE}/summary?event={game_id}'
    summary = get_json(url)
    header = summary.get('header') or {}
    season = header.get('season') or {}
    comp = (header.get('competitions') or [{}])[0]
    home = away = ''
    home_score = away_score = ''
    for c in comp.get('competitors') or []:
        name = (c.get('team') or {}).get('displayName') or ''
        score = c.get('score') or ''
        if c.get('homeAway') == 'home':
            home, home_score = name, score
        else:
            away, away_score = name, score
    date = (comp.get('date') or '')[:10]
    commentary = summary.get('commentary') or []
    stop = extract_stoppage(commentary)
    notes = []
    if not commentary:
        notes.append('no commentary')
    if stop['ht_played'] is None:
        notes.append('missing HT ends')
    if stop['ft_played'] is None:
        notes.append('missing FT ends')
    if stop['ht_announced'] is None:
        notes.append('missing HT announced')
    if stop['ft_announced'] is None:
        notes.append('missing FT announced')
    ht_over = ''
    ft_over = ''
    if stop['ht_played'] is not None and stop['ht_announced'] is not None:
        ht_over = stop['ht_played'] - stop['ht_announced']
    if stop['ft_played'] is not None and stop['ft_announced'] is not None:
        ft_over = stop['ft_played'] - stop['ft_announced']
    ok = bool(commentary) and stop['ht_played'] is not None and stop['ft_played'] is not None
    return {
        'season': season.get('year') or '',
        'season_name': season.get('name') or '',
        'game_id': str(header.get('id') or game_id),
        'date': date,
        'home': home,
        'away': away,
        'home_score': home_score,
        'away_score': away_score,
        'commentary_n': len(commentary),
        'ht_announced': '' if stop['ht_announced'] is None else stop['ht_announced'],
        'ht_played': '' if stop['ht_played'] is None else stop['ht_played'],
        'ht_ends_clock': stop['ht_ends_clock'],
        'ht_announced_clock': stop['ht_announced_clock'],
        'ft_announced': '' if stop['ft_announced'] is None else stop['ft_announced'],
        'ft_played': '' if stop['ft_played'] is None else stop['ft_played'],
        'ft_ends_clock': stop['ft_ends_clock'],
        'ft_announced_clock': stop['ft_announced_clock'],
        'ht_overrun': ht_over,
        'ft_overrun': ft_over,
        'ok': '1' if ok else '0',
        'note': '; '.join(notes),
    }


def load_done(path):
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return set()
    with open(path, newline='', encoding='utf-8') as fh:
        return {r['game_id'] for r in csv.DictReader(fh)}


def append_row(path, row):
    exists = os.path.exists(path) and os.path.getsize(path) > 0
    with open(path, 'a', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS, extrasaction='ignore')
        if not exists:
            w.writeheader()
        w.writerow(row)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sleep', type=float, default=0.25)
    ap.add_argument('--max-games', type=int, default=0)
    ap.add_argument('--game-id')
    ap.add_argument('--out-dir', default=None)
    args = ap.parse_args()

    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    out_dir = os.path.abspath(args.out_dir) if args.out_dir else \
        os.path.join(root, 'example_data', 'soccer_event_timing')
    games_path = os.path.join(out_dir, 'espn_pl_games.csv')
    out_path = os.path.join(out_dir, 'espn_pl_stoppage.csv')

    if args.game_id:
        row = scrape_game(args.game_id)
        print(row)
        append_row(out_path, row)
        return

    if not os.path.exists(games_path):
        raise SystemExit(f'missing {games_path}; run scrape_espn_pl_corners.py first')

    with open(games_path, newline='', encoding='utf-8') as fh:
        games = list(csv.DictReader(fh))

    done = load_done(out_path)
    todo = [g for g in games if g['game_id'] not in done]
    if args.max_games:
        todo = todo[:args.max_games]
    print(f'{len(games)} games, {len(done)} already scraped, {len(todo)} to fetch',
          flush=True)

    ok_n = miss = 0
    for i, g in enumerate(todo, 1):
        try:
            row = scrape_game(g['game_id'])
            # keep season labels from the games index if header is thin
            if not row['season']:
                row['season'] = g.get('season', '')
            if not row['season_name']:
                row['season_name'] = g.get('season_name', '')
            append_row(out_path, row)
            if row['ok'] == '1':
                ok_n += 1
            else:
                miss += 1
            ht = row['ht_played']
            ft = row['ft_played']
            print(
                f"  {i}/{len(todo)} {g['game_id']}  HT {ht} (ann {row['ht_announced']})  "
                f"FT {ft} (ann {row['ft_announced']})  {row['note']}",
                flush=True,
            )
        except Exception as e:
            print(f"  {i}/{len(todo)} {g['game_id']} ERR {e}", flush=True)
            miss += 1
        time.sleep(args.sleep + random.random() * 0.1)

    print(f'done. ok={ok_n} issues={miss}  wrote {out_path}', flush=True)


if __name__ == '__main__':
    main()
