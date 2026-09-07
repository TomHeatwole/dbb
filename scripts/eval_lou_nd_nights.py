#!/usr/bin/env python3
"""Score Louisville @ Ole Miss and Wisconsin @ Notre Dame vs the live book.

Pulls ESPN summaries, scores snap (current) and drive-start (next) at every
down, writes example_data/ncaaf_drive_results/lou_nd_nights.json
"""
from __future__ import annotations

import json
import math
import os
import ssl
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

from eval_current_next_drive_holdout import (  # noqa: E402
    CLASSES,
    CLASS_INDEX,
    drive_start_features,
    dist_code,
    fp_code,
    half_code,
    load_layer_scorer,
    lookup_cell,
    snap_features,
    time_code,
    clock_from_game_seconds,
)
from fit_next_drive_start import (  # noqa: E402
    dist_bin,
    field_bin,
    half_bin,
    score_bin,
    time_bin,
)
from ncaaf_field_buckets import yards_to_goal  # noqa: E402
from scrape_espn_ncaaf_drives import (  # noqa: E402
    BASE,
    classify_bucket,
    competitor_meta,
    extract_odds,
    get_json,
    parse_clock_seconds,
)
from scrape_espn_ncaaf_snaps_outcomes import (  # noqa: E402
    SKIP_TYPES,
    classify_result,
    extract_snaps,
    play_clock_period,
    seconds_left_in_game,
    seconds_left_in_half,
    team_abbr,
)

MODEL_JSON = os.path.join(ROOT, 'site', 'src', 'drives', 'driveResultModel.json')
TABLES_JSON = os.path.join(ROOT, 'site', 'src', 'drives', 'nextDriveStartTables.json')
OUT_JSON = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'lou_nd_nights.json')

TARGETS = (
    ('Louisville', 'Ole Miss'),
    ('Wisconsin', 'Notre Dame'),
)


def map_drive_label(bucket):
    n = str(bucket or '').strip().lower()
    if n == 'punt':
        return 'punt'
    if n in ('offensive td', 'td'):
        return 'td'
    if n in ('field goal attempt', 'fg'):
        return 'fg'
    if n in ('any other', 'other'):
        return 'other'
    return None


def map_snap_label(result):
    n = str(result or '').strip().upper()
    if n == 'PUNT':
        return 'punt'
    if n == 'TD':
        return 'td'
    if n in ('FG', 'MISSED_FG'):
        return 'fg'
    if n == 'OTHER':
        return 'other'
    return None


def find_games():
    found = {}
    for date in ('20260906', '20260907'):
        try:
            payload = get_json(f'{BASE}/scoreboard?dates={date}&limit=300&groups=80')
        except Exception as err:
            print('scoreboard', date, err)
            continue
        for ev in payload.get('events') or []:
            name = ev.get('name') or ev.get('shortName') or ''
            for away, home in TARGETS:
                if away.lower() in name.lower() and home.lower() in name.lower():
                    found[(away, home)] = str(ev.get('id'))
                    print('found', name, ev.get('id'))
    return found


def load_tables():
    with open(TABLES_JSON, encoding='utf-8') as fh:
        payload = json.load(fh)
    tables = dict(payload.get('tables') or {})
    tables['global'] = payload.get('global')
    return tables


def logloss_one(y, p):
    return -math.log(max(p[CLASS_INDEX[y]], 1e-15))


def own_label(ytg):
    y = int(round(ytg))
    if y >= 50:
        return f'own {100 - y}'
    if y == 50:
        return '50'
    return f'opp {y}'


def clock_label(period, sec_left):
    if not period or sec_left is None:
        return ''
    p = int(period)
    if p <= 4:
        clock = sec_left - (4 - p) * 900
        if clock < 0:
            clock = sec_left
        m, s = divmod(max(0, int(clock)), 60)
        return f'Q{p} {m}:{s:02d}'
    return f'OT {period}'


def drive_rows(summary):
    header = summary.get('header') or {}
    home, away, date, _comp = competitor_meta(header)
    spread, ou = extract_odds(summary)
    try:
        home_spread = float(spread) if spread not in (None, '') else float('nan')
    except (TypeError, ValueError):
        home_spread = float('nan')
    try:
        ou_f = float(ou) if ou not in (None, '') else float('nan')
    except (TypeError, ValueError):
        ou_f = float('nan')
    drives = (summary.get('drives') or {}).get('previous') or []
    out = []
    so_far = {'punt': 0, 'td': 0, 'fg': 0, 'other': 0}
    for i, drive in enumerate(drives):
        bucket = classify_bucket(drive)
        y = map_drive_label(bucket)
        if y is None:
            continue
        offense = team_abbr(drive)
        side = 'home' if offense == home['abbr'] else 'away'
        start = drive.get('start') or {}
        ytg = yards_to_goal(
            start.get('text'),
            offense_abbr=offense,
            home_abbr=home['abbr'],
            away_abbr=away['abbr'],
            offense_side=side,
            yards_to_endzone=start.get('yardsToEndzone'),
            yard_line=start.get('yardLine'),
        )
        period = (start.get('period') or {}).get('number')
        clock_disp = (start.get('clock') or {}).get('displayValue')
        sec = seconds_left_in_game(period, parse_clock_seconds(clock_disp))
        hs = start.get('homeScore')
        aws = start.get('awayScore')
        try:
            hs = int(hs) if hs not in (None, '') else 0
            aws = int(aws) if aws not in (None, '') else 0
        except (TypeError, ValueError):
            hs = aws = 0
        off_score = hs if side == 'home' else aws
        def_score = aws if side == 'home' else hs
        spread_off = home_spread if side == 'home' else (
            -home_spread if math.isfinite(home_spread) else float('nan')
        )
        nxt = None
        for j in range(i + 1, len(drives)):
            other = team_abbr(drives[j])
            if other and other != offense:
                nb = map_drive_label(classify_bucket(drives[j]))
                nxt = {'offense': other, 'y': nb}
                break
        out.append({
            'i': i + 1,
            'offense': offense,
            'side': side,
            'ytg': ytg,
            'period': period,
            'clock': clock_disp,
            'sec_left': sec,
            'score': f'{aws}-{hs}',
            'off_score': off_score,
            'def_score': def_score,
            'score_diff': off_score - def_score,
            'spread': spread_off,
            'ou': ou_f,
            'is_home': 1.0 if side == 'home' else 0.0,
            'y': y,
            'raw': str(drive.get('displayResult') or drive.get('result') or bucket),
            'so_far': dict(so_far),
            'next': nxt,
            'start_text': start.get('text') or '',
        })
        so_far[y] += 1
    return {
        'home': home,
        'away': away,
        'date': date,
        'home_spread': home_spread,
        'ou': ou_f,
        'home_final': home.get('score'),
        'away_final': away.get('score'),
        'drives': out,
    }


def surprise_word(p):
    if p >= 0.35:
        return 'chalk'
    if p >= 0.20:
        return 'normal'
    if p >= 0.12:
        return 'mild'
    if p >= 0.08:
        return 'long'
    return 'bomb'


def analyze_game(gid, label, score_snap, score_start, tables):
    summary = get_json(f'{BASE}/summary?event={gid}')
    meta = drive_rows(summary)
    snaps = extract_snaps(summary, gid, 2026)
    drive_scored = []
    start_ll = []
    for d in meta['drives']:
        if d['ytg'] is None or not d['period']:
            continue
        feat = drive_start_features(
            d['ytg'],
            d['sec_left'] if d['sec_left'] not in (None, '') else float('nan'),
            d['period'],
            d['score_diff'],
            d['spread'],
            d['ou'],
            d['is_home'],
        )
        p = score_start(feat)
        pa = p[CLASS_INDEX[d['y']]]
        ll = logloss_one(d['y'], p)
        start_ll.append(ll)
        drive_scored.append({
            'n': d['i'],
            'offense': d['offense'],
            'spot': own_label(d['ytg']) if d['ytg'] else '',
            'ytg': d['ytg'],
            'clock': f"Q{d['period']} {d['clock']}" if d['clock'] else f"Q{d['period']}",
            'score': d['score'],
            'result': d['y'],
            'raw': d['raw'],
            'p': {c: round(p[i], 4) for i, c in enumerate(CLASSES)},
            'pActual': round(pa, 4),
            'logloss': round(ll, 3),
            'surprise': surprise_word(pa),
        })

    by_i = {d['i'] - 1: d for d in meta['drives']}
    snap_rows = []
    next_rows = []
    by_result = {c: {'n': 0, 'sum_p': 0.0, 'sum_ll': 0.0} for c in CLASSES}
    for s in snaps:
        y = map_snap_label(s.get('this_result'))
        if y is None:
            continue
        d = by_i.get(int(s['drive_n']))
        if not d:
            continue
        off_spread = d['spread']
        feat = {
            'down': float(s['down']),
            'distance': float(s['distance']),
            'ytg': float(s['ytg']),
            'sec_left': float(s['sec_left_game']) if s.get('sec_left_game') not in (None, '') else float('nan'),
            'period': float(s['period']) if s.get('period') not in (None, '') else float('nan'),
            'score_diff': float(s['score_diff']) if s.get('score_diff') not in (None, '') else 0.0,
            'offense_spread': off_spread,
            'over_under': d['ou'],
            'exp_off': (d['ou'] - off_spread) / 2 if math.isfinite(off_spread) and math.isfinite(d['ou']) else float('nan'),
            'exp_def': (d['ou'] + off_spread) / 2 if math.isfinite(off_spread) and math.isfinite(d['ou']) else float('nan'),
            'fp_code': fp_code(s['ytg']),
            'dist_code': dist_code(s['distance']),
            'half_code': half_code(s['period']),
            'time_code': time_code(s['sec_left_half']),
        }
        p = score_snap(feat)
        pa = p[CLASS_INDEX[y]]
        ll = logloss_one(y, p)
        by_result[y]['n'] += 1
        by_result[y]['sum_p'] += p[CLASS_INDEX[y]]
        by_result[y]['sum_ll'] += ll
        snap_rows.append({
            'drive': d['i'],
            'offense': d['offense'],
            'down': int(s['down']),
            'distance': int(s['distance']),
            'spot': own_label(int(s['ytg'])),
            'ytg': int(s['ytg']),
            'period': s.get('period'),
            'clock': clock_label(s.get('period'), s.get('sec_left_game') if s.get('sec_left_game') not in (None, '') else None),
            'result': y,
            'p': {c: round(p[i], 4) for i, c in enumerate(CLASSES)},
            'pActual': round(pa, 4),
            'logloss': round(ll, 3),
            'surprise': surprise_word(pa),
        })
        # next drive from this snap
        nxt = d.get('next')
        if nxt and nxt.get('y') and s.get('next_kind') not in ('game_over',):
            row_bins = {
                'down': int(s['down']),
                'dist': dist_bin(int(s['distance'])),
                'field': field_bin(int(s['ytg'])),
                'score': score_bin(int(s['score_diff']) if s.get('score_diff') not in (None, '') else 0),
                'time': time_bin(int(s['sec_left_half']) if s.get('sec_left_half') not in (None, '') else None),
                'half': half_bin(s.get('period')),
            }
            cell = lookup_cell(tables, row_bins)
            if cell and cell.get('y') and cell['y'][3] is not None:
                pred_ytg = float(cell['y'][3])
                consumed = cell.get('t', [None, None, None, None])[3]
                sec_now = s.get('sec_left_game')
                if sec_now not in (None, '') and consumed is not None:
                    sec_left = max(0.0, float(sec_now) - float(consumed))
                    period, _ = clock_from_game_seconds(sec_left)
                    wait_spread = -off_spread if math.isfinite(off_spread) else float('nan')
                    wait_diff = -(float(s['score_diff']) if s.get('score_diff') not in (None, '') else 0.0)
                    wait_home = 0.0 if d['is_home'] else 1.0
                    nfeat = drive_start_features(
                        pred_ytg, sec_left, period, wait_diff, wait_spread, d['ou'], wait_home,
                    )
                    np_ = score_start(nfeat)
                    nya = np_[CLASS_INDEX[nxt['y']]]
                    next_rows.append({
                        'afterDrive': d['i'],
                        'currentOffense': d['offense'],
                        'nextOffense': nxt['offense'],
                        'fromSpot': own_label(int(s['ytg'])),
                        'down': int(s['down']),
                        'predSpot': own_label(pred_ytg),
                        'result': nxt['y'],
                        'p': {c: round(np_[i], 4) for i, c in enumerate(CLASSES)},
                        'pActual': round(nya, 4),
                        'logloss': round(logloss_one(nxt['y'], np_), 3),
                        'surprise': surprise_word(nya),
                    })

    def summarize(rows, key_ll='logloss'):
        if not rows:
            return None
        mix_obs = {c: sum(1 for r in rows if r['result'] == c) / len(rows) for c in CLASSES}
        mix_p = {c: sum(r['p'][c] for r in rows) / len(rows) for c in CLASSES}
        bombs = [r for r in rows if r['pActual'] < 0.10]
        longs = [r for r in rows if r['pActual'] < 0.15]
        return {
            'n': len(rows),
            'logloss': round(sum(r[key_ll] for r in rows) / len(rows), 4),
            'meanPActual': round(sum(r['pActual'] for r in rows) / len(rows), 4),
            'obs': {c: round(mix_obs[c], 4) for c in CLASSES},
            'model': {c: round(mix_p[c], 4) for c in CLASSES},
            'nLong': len(longs),
            'nBomb': len(bombs),
        }

    # unique next-drive once per current drive (last snap)
    next_last = []
    seen = set()
    for r in reversed(next_rows):
        k = r['afterDrive']
        if k in seen:
            continue
        seen.add(k)
        next_last.append(r)
    next_last.reverse()

    return {
        'label': label,
        'espnId': gid,
        'away': meta['away']['name'],
        'home': meta['home']['name'],
        'awayAbbr': meta['away']['abbr'],
        'homeAbbr': meta['home']['abbr'],
        'score': f"{meta['away']['score']}-{meta['home']['score']}",
        'homeSpread': meta['home_spread'],
        'ou': meta['ou'],
        'nDrives': len(drive_scored),
        'driveStart': summarize(drive_scored),
        'currentSnaps': summarize(snap_rows),
        'nextLastSnap': summarize(next_last),
        'drives': drive_scored,
        'longshotDrives': [r for r in drive_scored if r['pActual'] < 0.15],
        'longshotSnaps': [
            r for r in snap_rows
            if r['pActual'] < 0.12 and r['down'] in (1, 2, 3, 4)
        ],
        'nextDrives': next_last,
        'resultCounts': {
            c: sum(1 for r in drive_scored if r['result'] == c) for c in CLASSES
        },
    }


def main():
    print('loading trees + next-start tables…', flush=True)
    with open(MODEL_JSON, encoding='utf-8') as fh:
        model = json.load(fh)
    score_start = load_layer_scorer(model, 'driveStart')
    score_snap = load_layer_scorer(model, 'snap')
    tables = load_tables()
    ids = find_games()
    if len(ids) < 2:
        raise SystemExit(f'missing games: {ids}')
    games = []
    for (away, home), gid in ids.items():
        print('scoring', away, '@', home, gid, flush=True)
        games.append(analyze_game(gid, f'{away} @ {home}', score_snap, score_start, tables))
        time.sleep(0.3)
    payload = {
        'note': (
            'Current = snap LightGBM at every down. Next = last snap of the '
            'prior drive, next-start tables + drive-start LightGBM vs the '
            'actual following opposing drive. Drive-start = first play of each drive.'
        ),
        'typical': {
            'driveStartLogloss': 1.1544,
            'snapLogloss': 1.0389,
            'nextLogloss': 1.2558,
        },
        'games': games,
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2)
    print('wrote', OUT_JSON)
    for g in games:
        print(g['label'], g['score'],
              'drives', g['nDrives'],
              'startLL', g['driveStart']['logloss'] if g['driveStart'] else None,
              'snapLL', g['currentSnaps']['logloss'] if g['currentSnaps'] else None,
              'nextLL', g['nextLastSnap']['logloss'] if g['nextLastSnap'] else None,
              'counts', g['resultCounts'])


if __name__ == '__main__':
    main()
