#!/usr/bin/env python3

import argparse
import concurrent.futures
import json
import os
import re
import sys
import uuid
from pathlib import Path
from typing import List, Set, Dict, Any, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import traceback
import time
import http.client

# Ensure local imports work when executed from other working directories
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from parse_team_history import parse_game_history_for_player  # noqa: E402

DEFAULT_2024_IDS = str(CURRENT_DIR / '2024_players.txt')
DEFAULT_2025_IDS = str(CURRENT_DIR / '2025_players.txt')
DUMPS_DIR = CURRENT_DIR / 'dumps'

ESPN_SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={event_id}'
ESPN_SCOREBOARD_DATE_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={date_token}'

# Debug / dumping flags and helpers
DEBUG_MODE = False
DUMP_EVENT_SUMMARIES = False

def debug(msg: str) -> None:
    if DEBUG_MODE:
        print(f"[DEBUG] {msg}", file=sys.stderr)


def dump_event_summary_json(dump_path: Path, event_id: str, summary: Dict[str, Any]) -> None:
    try:
        out_dir = dump_path / 'summaries'
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f'{str(event_id)}.json'
        with out_file.open('w', encoding='utf-8') as f:
            json.dump(summary, f, ensure_ascii=False)
    except Exception as e:
        debug(f"failed to write summary dump for eventId={event_id}: {e}")


def http_get_json(url: str, timeout: int = 12) -> Optional[Dict[str, Any]]:
    headers = {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
        'Accept-Encoding': 'identity',
        'Connection': 'close',
    }
    last_err = None
    for attempt in range(3):
        try:
            debug(f"http_get_json GET {url} attempt={attempt+1}")
            req = Request(url, headers=headers)
            with urlopen(req, timeout=timeout) as resp:
                if resp.status != 200:
                    last_err = HTTPError(url, resp.status, f'HTTP {resp.status}', hdrs=None, fp=None)
                    raise last_err
                raw = resp.read().decode('utf-8', errors='ignore')
                debug(f"http_get_json OK {url} bytes={len(raw)}")
                return json.loads(raw)
        except (HTTPError, URLError, TimeoutError, http.client.IncompleteRead, json.JSONDecodeError) as e:
            last_err = e
            debug(f"http_get_json RETRY {url} err={type(e).__name__}: {e}")
            time.sleep(0.4 * (attempt + 1))
            continue
        except Exception as e:
            last_err = e
            debug(f"http_get_json FAIL {url} err={type(e).__name__}: {e}")
            break
    debug(f"http_get_json GAVEUP {url} last_err={last_err}")
    return None


def extract_player_injury_status(summary_json: Dict[str, Any], espn_id: str) -> Optional[str]:
    if not summary_json or not isinstance(summary_json, dict):
        return None
    box = summary_json.get('boxscore') or {}
    players_groups = box.get('players') or []
    for group in players_groups:
        for cat in group.get('statistics', []):
            for athlete in cat.get('athletes', []) or []:
                a = athlete.get('athlete') or {}
                if str(a.get('id')) == str(espn_id):
                    inj = athlete.get('injuries')
                    if isinstance(inj, list) and inj:
                        status = inj[0].get('status') or inj[0].get('shortText') or inj[0].get('type')
                        if isinstance(status, str) and status.strip():
                            return status.strip()
    return None


def normalize_abbr(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    s2 = re.sub(r'[^A-Za-z]', '', str(s)).upper()
    if s2 in ('WAS', 'WSH', 'WASH'):
        return 'WSH'
    if s2 == 'JAX':
        return 'JAC'
    if s2 == 'ARZ':
        return 'ARI'
    if s2 in ('NOR', 'NOS'):
        return 'NO'
    if s2 == 'OAK':
        return 'LV'
    if s2 == 'SD':
        return 'LAC'
    if s2 in ('STL', 'LA'):
        return 'LAR'
    return s2


_scoreboard_cache: Dict[str, Dict[str, Any]] = {}
_event_summary_cache: Dict[str, Dict[str, Any]] = {}


def resolve_event_id_by_date_and_teams(date_iso: str, team_abbr: Optional[str], opp_abbr: Optional[str]) -> Optional[str]:
    if not date_iso:
        return None
    try:
        y, m, d = date_iso.split('-')
        token = f"{y}{m}{d}"
    except Exception:
        return None
    if token not in _scoreboard_cache:
        debug(f"scoreboard fetch for date token={token}")
        _scoreboard_cache[token] = http_get_json(ESPN_SCOREBOARD_DATE_URL.format(date_token=token)) or {}
    sb = _scoreboard_cache.get(token) or {}
    events = sb.get('events') or (sb.get('leagues', [{}])[0].get('events') if isinstance(sb.get('leagues'), list) and sb.get('leagues') else []) or []
    want = {normalize_abbr(team_abbr), normalize_abbr(opp_abbr)}
    for ev in events:
        comp = (ev.get('competitions') or [{}])[0]
        comps = comp.get('competitors') or []
        teams = set()
        for c in comps:
            t = c.get('team') or {}
            abbr = normalize_abbr(t.get('abbreviation') or t.get('shortDisplayName') or t.get('displayName'))
            if abbr:
                teams.add(abbr)
        if want and teams == want:
            eid = str(ev.get('id') or comp.get('id') or '') or None
            debug(f"resolved event by date teams={sorted(list(teams))} token={token} -> eventId={eid}")
            return eid
    debug(f"resolve_event_id_by_date_and_teams miss token={token} want={sorted([x for x in want if x])}")
    return None


def read_player_ids(file_path: str) -> Set[str]:
    ids: Set[str] = set()
    p = Path(file_path)
    if not p.exists():
        return ids
    text = p.read_text(encoding='utf-8').strip()
    try:
        data = json.loads(text)
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    espn_id = str(item.get('espn_id', '')).strip()
                    if espn_id.isdigit():
                        ids.add(espn_id)
            if ids:
                return ids
    except Exception:
        pass
    for m in re.finditer(r'"espn_id"\s*:\s*"?(\d+)"?', text):
        ids.add(m.group(1))
    if ids:
        return ids
    for line in text.splitlines():
        for m in re.finditer(r'\b(\d{3,8})\b', line):
            ids.add(m.group(1))
    return ids


def merge_player_ids(paths: List[str]) -> List[str]:
    merged: Set[str] = set()
    for path in paths:
        merged.update(read_player_ids(path))
    return sorted(merged, key=lambda x: int(x))


def ensure_dump_dir(dump_id: str) -> Path:
    DUMPS_DIR.mkdir(parents=True, exist_ok=True)
    target = DUMPS_DIR / dump_id
    target.mkdir(parents=True, exist_ok=True)
    return target


def already_done_ids(dump_path: Path) -> Set[str]:
    done: Set[str] = set()
    for child in dump_path.glob('*.txt'):
        stem = child.stem
        if stem.isdigit():
            done.add(stem)
    return done


def write_json(path: Path, data: Any) -> None:
    with path.open('w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'))


def write_player_stats(dump_path: Path, player_id: str, data: Dict[str, Any]) -> None:
    write_json(dump_path / f'{player_id}.txt', data)


def fetch_one_history(player_id: str, min_year: Optional[int], max_year: Optional[int], stop_gaps: int) -> Dict[str, Any]:
    return parse_game_history_for_player(player_id, min_year, max_year, stop_gaps)


def collect_event_ids(history: Dict[str, List[Dict[str, Any]]]) -> Set[str]:
    s: Set[str] = set()
    for _, games in (history or {}).items():
        for g in games or []:
            ev = g.get('eventId')
            if not ev and g.get('date') and (g.get('team') or g.get('opponent')):
                ev = resolve_event_id_by_date_and_teams(g.get('date'), g.get('team'), g.get('opponent'))
                if ev:
                    g['eventId'] = ev
            if ev:
                s.add(str(ev))
    return s


def identify_event_season_week(ev: str) -> Optional[tuple]:
    summary = _event_summary_cache.get(ev)
    if summary is None:
        debug(f"fetch summary for eventId={ev}")
        summary = http_get_json(ESPN_SUMMARY_URL.format(event_id=ev)) or {}
        _event_summary_cache[ev] = summary
    if not summary:
        debug(f"no summary for eventId={ev}")
        return None
    header = summary.get('header') or {}
    season = header.get('season') or {}
    year = season.get('year')
    week_num = header.get('week')
    if not isinstance(week_num, int):
        comp = (header.get('competitions') or [{}])[0]
        iso = comp.get('date') or header.get('date')
        if isinstance(iso, str) and len(iso) >= 10:
            token = iso[:10].replace('-', '')
            sb = _scoreboard_cache.get(token)
            if sb is None:
                debug(f"fetch scoreboard for token={token} (identify week) for eventId={ev}")
                sb = http_get_json(ESPN_SCOREBOARD_DATE_URL.format(date_token=token)) or {}
                _scoreboard_cache[token] = sb
            wk = (sb.get('week') or {}).get('number') if isinstance(sb.get('week'), dict) else None
            if isinstance(wk, int):
                week_num = wk
    if isinstance(year, int) and isinstance(week_num, int) and 1 <= week_num <= 17:
        debug(f"eventId={ev} -> season={year} week={week_num}")
        return (str(year), week_num)
    debug(f"could not determine season/week for eventId={ev}")
    return None


def build_weekly_injury_files(event_ids: Set[str], dump_path: Path) -> None:
    debug(f"build_weekly_injury_files start events_count={len(event_ids)} dump={dump_path}")
    # Group events by (seasonYear, week)
    grouped: Dict[str, Dict[int, List[str]]] = {}
    for ev in sorted(event_ids, key=lambda x: int(x)):
        key = identify_event_season_week(ev)
        if not key:
            continue
        year, week = key
        if year not in grouped:
            grouped[year] = {}
        grouped[year].setdefault(week, []).append(ev)

    debug(f"injury grouping seasons={list(sorted(grouped.keys(), key=lambda x: int(x)))}")

    # Prepare resume-aware counts by subtracting already processed events per week
    weekly_remaining: Dict[str, Dict[int, List[str]]] = {}
    total_events_needed = 0
    for year, weeks in grouped.items():
        for week, evs in weeks.items():
            out_file = dump_path / f'injuries_{year}_week_{week}.txt'
            progress_file = dump_path / f'injuries_{year}_week_{week}.events.txt'
            processed_set: Set[str] = set()
            if progress_file.exists():
                try:
                    prev = json.loads(progress_file.read_text(encoding='utf-8'))
                    if isinstance(prev, list):
                        processed_set = {str(x) for x in prev}
                except Exception:
                    processed_set = set()
            remaining = [eid for eid in evs if str(eid) not in processed_set]
            if remaining:
                weekly_remaining.setdefault(year, {})[week] = remaining
                total_events_needed += len(remaining)
            debug(f"week plan year={year} week={week} processed={len(processed_set)} remaining={len(remaining)} out_exists={out_file.exists()}")

    if total_events_needed == 0:
        print('Injuries: nothing to do (all weekly files present).')
        return

    processed = 0
    ok_weeks = 0
    bar_len = 40
    print(f"Injuries [----------------------------------------] 0/{total_events_needed} (0%) weeks_ok=0", end='\r', flush=True)

    # Process per week; merge with existing outputs and append incrementally after each event
    for year in sorted((weekly_remaining.keys()), key=lambda x: int(x)):
        for week in sorted(weekly_remaining[year].keys()):
            out_file = dump_path / f'injuries_{year}_week_{week}.txt'
            progress_file = dump_path / f'injuries_{year}_week_{week}.events.txt'
            # Load existing week map if present
            week_map: Dict[str, str] = {}
            if out_file.exists():
                try:
                    existing = json.loads(out_file.read_text(encoding='utf-8'))
                    if isinstance(existing, dict):
                        # ensure all keys/values are strings
                        week_map = {str(k): str(v) for k, v in existing.items() if isinstance(k, (str, int)) and isinstance(v, str)}
                except Exception:
                    week_map = {}
            # Load processed events set
            processed_events: Set[str] = set()
            if progress_file.exists():
                try:
                    prev_events = json.loads(progress_file.read_text(encoding='utf-8'))
                    if isinstance(prev_events, list):
                        processed_events = {str(x) for x in prev_events}
                except Exception:
                    processed_events = set()

            debug(f"process week injuries year={year} week={week} start_entries={len(week_map)} already_events={len(processed_events)} to_process={len(weekly_remaining[year][week])}")

            for ev in weekly_remaining[year][week]:
                evs = str(ev)
                if evs in processed_events:
                    continue
                summary = _event_summary_cache.get(evs)
                if summary is None:
                    summary = http_get_json(ESPN_SUMMARY_URL.format(event_id=evs)) or {}
                    _event_summary_cache[evs] = summary
                if not summary:
                    debug(f"summary empty for eventId={evs}")
                else:
                    if DUMP_EVENT_SUMMARIES:
                        dump_event_summary_json(dump_path, evs, summary)
                    found_count = 0
                    # 1) Boxscore players path (existing)
                    box = summary.get('boxscore') or {}
                    players_groups = box.get('players') or []
                    debug(f"scan injuries(event) boxscore eventId={evs} groups={len(players_groups)}")
                    for group in players_groups:
                        stats = group.get('statistics', []) or []
                        for cat in stats:
                            athletes = cat.get('athletes', []) or []
                            for athlete in athletes:
                                a = athlete.get('athlete') or {}
                                pid = str(a.get('id') or '')
                                inj = athlete.get('injuries')
                                if isinstance(inj, list) and inj:
                                    status = inj[0].get('status') or inj[0].get('shortText') or (inj[0].get('type') or {}).get('description') or (inj[0].get('type') or {}).get('name')
                                    if isinstance(status, str) and status.strip() and status.strip().lower() != 'active':
                                        week_map[pid] = status.strip()
                                        found_count += 1
                                        debug(f"injury found(boxscore) eventId={evs} pid={pid} status={status.strip()}")
                    # 2) Top-level injuries section
                    top_inj = summary.get('injuries') or []
                    if isinstance(top_inj, list) and top_inj:
                        debug(f"scan injuries(event) top-level count={len(top_inj)}")
                        for t in top_inj:
                            for inj in (t.get('injuries') or []):
                                a = inj.get('athlete') or {}
                                pid = str(a.get('id') or '')
                                status = inj.get('status') or (inj.get('type') or {}).get('description') or (inj.get('type') or {}).get('name')
                                if pid and isinstance(status, str) and status.strip() and status.strip().lower() != 'active':
                                    week_map[pid] = status.strip()
                                    found_count += 1
                                    debug(f"injury found(top) eventId={evs} pid={pid} status={status.strip()}")
                    # 3) Leaders section (some athlete objects carry injuries)
                    leaders_root = summary.get('leaders')
                    leaders_groups = []
                    if isinstance(leaders_root, dict):
                        leaders_groups = leaders_root.get('leaders') or []
                    elif isinstance(leaders_root, list):
                        leaders_groups = leaders_root
                    if isinstance(leaders_groups, list) and leaders_groups:
                        debug(f"scan injuries(event) leaders groups={len(leaders_groups)}")
                        for grp in leaders_groups:
                            for item in (grp.get('leaders') or []):
                                a = (item.get('athlete') or item.get('athletes') or [{}])[0] if item.get('athletes') else (item.get('athlete') or {})
                                if not isinstance(a, dict):
                                    continue
                                pid = str(a.get('id') or '')
                                inj = a.get('injuries')
                                if isinstance(inj, dict):
                                    status = inj.get('status') or (inj.get('type') or {}).get('description') or (inj.get('type') or {}).get('name')
                                    if pid and isinstance(status, str) and status.strip() and status.strip().lower() != 'active':
                                        week_map[pid] = status.strip()
                                        found_count += 1
                                        debug(f"injury found(leaders) eventId={evs} pid={pid} status={status.strip()}")
                    debug(f"injury scan done eventId={evs} found={found_count}")
                # Mark this event processed and persist incrementally
                processed_events.add(evs)
                processed += 1
                write_json(out_file, week_map)
                write_json(progress_file, sorted(processed_events, key=lambda x: int(x)))
                if DEBUG_MODE and processed % 25 == 0:
                    debug(f"incremental write {out_file.name} entries={len(week_map)} events_done={len(processed_events)}")
                filled = int(bar_len * (processed / total_events_needed))
                bar = '#' * filled + '-' * (bar_len - filled)
                pct = int((processed / total_events_needed) * 100)
                print(f"Injuries [{bar}] {processed}/{total_events_needed} ({pct}%) weeks_ok={ok_weeks}", end='\r', flush=True)

            ok_weeks += 1
            debug(f"completed week year={year} week={week} final_entries={len(week_map)}")
    print('\n')


def build_single_week_injury_file(event_ids: Set[str], dump_path: Path, year: str, week: int) -> None:
    out_file = dump_path / f'injuries_{year}_week_{week}.txt'
    progress_file = dump_path / f'injuries_{year}_week_{week}.events.txt'

    # Determine remaining events vs already processed (resume-aware, though redo deletes by default)
    processed_events: Set[str] = set()
    if progress_file.exists():
        try:
            prev_events = json.loads(progress_file.read_text(encoding='utf-8'))
            if isinstance(prev_events, list):
                processed_events = {str(x) for x in prev_events}
        except Exception:
            processed_events = set()

    remaining_events = [str(e) for e in sorted(event_ids, key=lambda x: int(x)) if str(e) not in processed_events]
    total = len(remaining_events)
    if total == 0:
        print(f'Injuries Week {year}/{week}: nothing to do.')
        return

    # Load existing week map if present
    week_map: Dict[str, str] = {}
    if out_file.exists():
        try:
            existing = json.loads(out_file.read_text(encoding='utf-8'))
            if isinstance(existing, dict):
                week_map = {str(k): str(v) for k, v in existing.items() if isinstance(k, (str, int)) and isinstance(v, str)}
        except Exception:
            week_map = {}

    processed = 0
    bar_len = 40
    print(f"Injuries Week {year}/{week} [----------------------------------------] 0/{total} (0%)", end='\r', flush=True)

    for evs in remaining_events:
        summary = _event_summary_cache.get(evs)
        if summary is None:
            summary = http_get_json(ESPN_SUMMARY_URL.format(event_id=evs)) or {}
            _event_summary_cache[evs] = summary
        if not summary:
            debug(f"summary empty for eventId={evs}")
        else:
            if DUMP_EVENT_SUMMARIES:
                dump_event_summary_json(dump_path, evs, summary)
            found_count = 0
            # 1) Boxscore players path
            box = summary.get('boxscore') or {}
            players_groups = box.get('players') or []
            debug(f"scan injuries(event) boxscore eventId={evs} groups={len(players_groups)}")
            for group in players_groups:
                stats = group.get('statistics', []) or []
                for cat in stats:
                    athletes = cat.get('athletes', []) or []
                    for athlete in athletes:
                        a = athlete.get('athlete') or {}
                        pid = str(a.get('id') or '')
                        inj = athlete.get('injuries')
                        if isinstance(inj, list) and inj:
                            status = inj[0].get('status') or inj[0].get('shortText') or (inj[0].get('type') or {}).get('description') or (inj[0].get('type') or {}).get('name')
                            if isinstance(status, str) and status.strip() and status.strip().lower() != 'active':
                                week_map[pid] = status.strip()
                                found_count += 1
                                debug(f"injury found(boxscore) eventId={evs} pid={pid} status={status.strip()}")
            # 2) Top-level injuries section
            top_inj = summary.get('injuries') or []
            if isinstance(top_inj, list) and top_inj:
                debug(f"scan injuries(event) top-level count={len(top_inj)}")
                for t in top_inj:
                    for inj in (t.get('injuries') or []):
                        a = inj.get('athlete') or {}
                        pid = str(a.get('id') or '')
                        status = inj.get('status') or (inj.get('type') or {}).get('description') or (inj.get('type') or {}).get('name')
                        if pid and isinstance(status, str) and status.strip() and status.strip().lower() != 'active':
                            week_map[pid] = status.strip()
                            found_count += 1
                            debug(f"injury found(top) eventId={evs} pid={pid} status={status.strip()}")
            # 3) Leaders section
            leaders_root = summary.get('leaders')
            leaders_groups = []
            if isinstance(leaders_root, dict):
                leaders_groups = leaders_root.get('leaders') or []
            elif isinstance(leaders_root, list):
                leaders_groups = leaders_root
            if isinstance(leaders_groups, list) and leaders_groups:
                debug(f"scan injuries(event) leaders groups={len(leaders_groups)}")
                for grp in leaders_groups:
                    for item in (grp.get('leaders') or []):
                        a = (item.get('athlete') or item.get('athletes') or [{}])[0] if item.get('athletes') else (item.get('athlete') or {})
                        if not isinstance(a, dict):
                            continue
                        pid = str(a.get('id') or '')
                        inj = a.get('injuries')
                        if isinstance(inj, dict):
                            status = inj.get('status') or (inj.get('type') or {}).get('description') or (inj.get('type') or {}).get('name')
                            if pid and isinstance(status, str) and status.strip() and status.strip().lower() != 'active':
                                week_map[pid] = status.strip()
                                found_count += 1
                                debug(f"injury found(leaders) eventId={evs} pid={pid} status={status.strip()}")
            debug(f"injury scan done eventId={evs} found={found_count}")
        processed_events.add(evs)
        processed += 1
        write_json(out_file, week_map)
        write_json(progress_file, sorted(processed_events, key=lambda x: int(x)))
        if DEBUG_MODE and processed % 10 == 0:
            debug(f"single-week incremental write {out_file.name} entries={len(week_map)} events_done={len(processed_events)}/{total}")
        filled = int(bar_len * (processed / total))
        bar = '#' * filled + '-' * (bar_len - filled)
        pct = int((processed / total) * 100)
        print(f"Injuries Week {year}/{week} [{bar}] {processed}/{total} ({pct}%)", end='\r', flush=True)
    print('\n')


def collect_events_from_dump(dump_path: Path) -> Set[str]:
    events: Set[str] = set()
    for f in dump_path.glob('*.txt'):
        stem = f.stem
        if not stem.isdigit():
            continue
        try:
            data = json.loads(f.read_text(encoding='utf-8'))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        for _, games in (data or {}).items():
            if not isinstance(games, list):
                continue
            for g in games:
                if not isinstance(g, dict):
                    continue
                ev = g.get('eventId')
                if not ev:
                    date_iso = g.get('date')
                    team_abbr = g.get('team')
                    opp_abbr = g.get('opponent')
                    if date_iso and (team_abbr or opp_abbr):
                        ev = resolve_event_id_by_date_and_teams(date_iso, team_abbr, opp_abbr)
                if ev:
                    events.add(str(ev))
    return events


def collect_events_from_dump_with_progress(dump_path: Path) -> Set[str]:
    files = [f for f in dump_path.glob('*.txt') if f.stem.isdigit()]
    total = len(files)
    if total == 0:
        print('Events: no player files found to scan.')
        return set()
    events: Set[str] = set()
    processed = 0
    bar_len = 40
    print(f"Events  [----------------------------------------] 0/{total} (0%)", end='\r', flush=True)
    for f in files:
        try:
            data = json.loads(f.read_text(encoding='utf-8'))
        except Exception:
            data = None
        if isinstance(data, dict):
            for _, games in (data or {}).items():
                if not isinstance(games, list):
                    continue
                for g in games:
                    if not isinstance(g, dict):
                        continue
                    ev = g.get('eventId')
                    if not ev:
                        date_iso = g.get('date')
                        team_abbr = g.get('team')
                        opp_abbr = g.get('opponent')
                        if date_iso and (team_abbr or opp_abbr):
                            ev = resolve_event_id_by_date_and_teams(date_iso, team_abbr, opp_abbr)
                    if ev:
                        events.add(str(ev))
        processed += 1
        filled = int(bar_len * (processed / total))
        bar = '#' * filled + '-' * (bar_len - filled)
        pct = int((processed / total) * 100)
        print(f"Events  [{bar}] {processed}/{total} ({pct}%)", end='\r', flush=True)
    print('\n')
    debug(f"collect_events_from_dump complete files={total} events_found={len(events)}")
    return events


def collect_events_for_year_with_progress(dump_path: Path, year: str) -> Set[str]:
    files = [f for f in dump_path.glob('*.txt') if f.stem.isdigit()]
    total = len(files)
    if total == 0:
        print(f'Events {year}: no player files found to scan.')
        return set()
    events: Set[str] = set()
    processed = 0
    bar_len = 40
    print(f"Events {year} [----------------------------------------] 0/{total} (0%)", end='\r', flush=True)
    for f in files:
        try:
            data = json.loads(f.read_text(encoding='utf-8'))
        except Exception:
            data = None
        if isinstance(data, dict):
            for _, games in (data or {}).items():
                if not isinstance(games, list):
                    continue
                for g in games:
                    if not isinstance(g, dict):
                        continue
                    date_iso = g.get('date')
                    if isinstance(date_iso, str) and len(date_iso) >= 4 and date_iso[:4] == str(year):
                        ev = g.get('eventId')
                        if not ev:
                            team_abbr = g.get('team')
                            opp_abbr = g.get('opponent')
                            if team_abbr or opp_abbr:
                                ev = resolve_event_id_by_date_and_teams(date_iso, team_abbr, opp_abbr)
                        if ev:
                            events.add(str(ev))
        processed += 1
        filled = int(bar_len * (processed / total))
        bar = '#' * filled + '-' * (bar_len - filled)
        pct = int((processed / total) * 100)
        print(f"Events {year} [{bar}] {processed}/{total} ({pct}%)", end='\r', flush=True)
    print('\n')
    debug(f"collect_events_for_year complete year={year} files={total} events_found={len(events)}")
    return events


def collect_events_for_year_week_with_progress(dump_path: Path, year: str, week: int) -> Set[str]:
    files = [f for f in dump_path.glob('*.txt') if f.stem.isdigit()]
    total = len(files)
    if total == 0:
        print(f'Events {year}/W{week}: no player files found to scan.')
        return set()
    events: Set[str] = set()
    processed = 0
    bar_len = 40
    print(f"Events {year}/W{week} [----------------------------------------] 0/{total} (0%)", end='\r', flush=True)
    for f in files:
        try:
            data = json.loads(f.read_text(encoding='utf-8'))
        except Exception:
            data = None
        if isinstance(data, dict):
            # Prefer the year key directly if present
            year_games = data.get(str(year))
            candidate_lists = []
            if isinstance(year_games, list):
                candidate_lists.append(year_games)
            else:
                # Fallback: scan all years but check date prefix
                candidate_lists.extend([lst for lst in data.values() if isinstance(lst, list)])
            for games in candidate_lists:
                for g in games:
                    if not isinstance(g, dict):
                        continue
                    # Check year and week via fields to avoid any summary calls
                    g_year_ok = False
                    if str(year) in data and games is year_games:
                        g_year_ok = True
                    else:
                        date_iso = g.get('date')
                        g_year_ok = isinstance(date_iso, str) and len(date_iso) >= 4 and date_iso[:4] == str(year)
                    if not g_year_ok:
                        continue
                    w = g.get('week')
                    if not isinstance(w, int) or int(w) != int(week):
                        continue
                    ev = g.get('eventId')
                    if not ev:
                        date_iso = g.get('date')
                        team_abbr = g.get('team')
                        opp_abbr = g.get('opponent')
                        if date_iso and (team_abbr or opp_abbr):
                            ev = resolve_event_id_by_date_and_teams(date_iso, team_abbr, opp_abbr)
                    if ev:
                        events.add(str(ev))
        processed += 1
        filled = int(bar_len * (processed / total))
        bar = '#' * filled + '-' * (bar_len - filled)
        pct = int((processed / total) * 100)
        print(f"Events {year}/W{week} [{bar}] {processed}/{total} ({pct}%)", end='\r', flush=True)
    print('\n')
    debug(f"collect_events_for_year_week complete {year}/W{week} files={total} events_found={len(events)}")
    return events


def main() -> None:
    parser = argparse.ArgumentParser(description='Build full player game histories (then injuries) for all ESPN IDs from 2024/2025 lists, with concurrency and resume support.')
    parser.add_argument('--ids-2024', type=str, default=DEFAULT_2024_IDS, help='Path to 2024 ESPN IDs file (default: espn_scrape/2024_players.txt)')
    parser.add_argument('--ids-2025', type=str, default=DEFAULT_2025_IDS, help='Path to 2025 ESPN IDs file (default: espn_scrape/2025_players.txt)')
    parser.add_argument('--dump-id', type=str, default='', help='Existing dump ID to resume into (if omitted, a new dump ID is generated)')
    parser.add_argument('--limit', type=int, default=8, help='Max concurrent downloads (default: 8)')
    parser.add_argument('--min-year', type=int, help='Minimum season year to check (default: currentYear-25)')
    parser.add_argument('--max-year', type=int, help='Maximum season year to check (default: currentYear)')
    parser.add_argument('--stop-gaps', type=int, default=3, help='Consecutive missing years after first find before stopping (default: 3)')
    parser.add_argument('--redo-injuries', action='store_true', help='Rebuild weekly injuries for an existing dump (requires --dump-id).')
    parser.add_argument('--debug-mode', action='store_true', help='Enable verbose debug logging to stderr.')
    parser.add_argument('--redo-injury-week', type=str, help='Rebuild injuries for a single week: format YYYY/W (e.g., 2024/1); requires --dump-id.')
    parser.add_argument('--dump-event-summaries', action='store_true', help='Write raw event summary JSON to dumps/<dump_id>/summaries/<event_id>.json during processing.')
    args = parser.parse_args()

    global DEBUG_MODE, DUMP_EVENT_SUMMARIES
    DEBUG_MODE = bool(args.debug_mode)
    DUMP_EVENT_SUMMARIES = bool(args.dump_event_summaries)
    debug(f"args: {args}")

    # Single-week redo mode
    if args.redo_injury_week:
        if not args.dump_id:
            print('Error: --redo-injury-week requires --dump-id <id>', file=sys.stderr)
            sys.exit(2)
        m = re.match(r'^\s*(\d{4})\s*/\s*(\d{1,2})\s*$', str(args.redo_injury_week))
        if not m:
            print('Error: --redo-injury-week must be in format YYYY/W (e.g., 2024/1)', file=sys.stderr)
            sys.exit(2)
        target_year = m.group(1)
        target_week = int(m.group(2))
        if target_week < 1 or target_week > 17:
            print('Error: week must be 1..17', file=sys.stderr)
            sys.exit(2)
        dump_path = DUMPS_DIR / args.dump_id
        debug(f"redo-injury-week dump={dump_path} target={target_year}/{target_week}")
        if not dump_path.exists():
            print(f'Error: dump path not found: {dump_path}', file=sys.stderr)
            sys.exit(2)
        # Delete only the target week files
        out_file = dump_path / f'injuries_{target_year}_week_{target_week}.txt'
        progress_file = dump_path / f'injuries_{target_year}_week_{target_week}.events.txt'
        for f in (out_file, progress_file):
            if f.exists():
                try:
                    f.unlink()
                except FileNotFoundError:
                    pass
        # Collect only events from the specific target year/week from per-player files
        target_events = collect_events_for_year_week_with_progress(dump_path, str(target_year), int(target_week))
        if not target_events:
            print(f'No events found for {target_year}/Week {target_week}.', file=sys.stderr)
            return
        build_single_week_injury_file(target_events, dump_path, str(target_year), int(target_week))
        print('Redo single week injuries complete.')
        return

    # Redo injuries mode: skip player downloads, recompute events from per-player files, rebuild weekly injury files
    if args.redo_injuries:
        if not args.dump_id:
            print('Error: --redo-injuries requires --dump-id <id>', file=sys.stderr)
            sys.exit(2)
        dump_path = DUMPS_DIR / args.dump_id
        debug(f"redo-injuries for dump={dump_path}")
        if not dump_path.exists():
            print(f'Error: dump path not found: {dump_path}', file=sys.stderr)
            sys.exit(2)
        # Delete prior injury files to allow resume-like rebuild
        removed = 0
        for f in dump_path.glob('injuries_*_week_*.txt'):
            try:
                f.unlink()
                removed += 1
            except FileNotFoundError:
                pass
        # Also delete per-week progress markers so we reprocess and show the bar
        for f in dump_path.glob('injuries_*_week_*.events.txt'):
            try:
                f.unlink()
                removed += 1
            except FileNotFoundError:
                pass
        legacy = dump_path / 'injuries.txt'
        if legacy.exists():
            try:
                legacy.unlink()
                removed += 1
            except FileNotFoundError:
                pass
        debug(f"removed prior injury files count={len([*dump_path.glob('injuries_*_week_*.txt')])} and progress markers removed_total={removed}")
        # Re-collect events from all player files (with progress)
        events = collect_events_from_dump_with_progress(dump_path)
        if not events:
            print('Warning: no events found from player files; nothing to rebuild.', file=sys.stderr)
        # Persist merged events list (overwrite with fresh set)
        write_json(dump_path / 'events.txt', sorted(events, key=lambda x: int(x)) )
        debug(f"wrote events.txt events_count={len(events)}")
        # Build weekly injuries (has its own progress bar)
        build_weekly_injury_files(events, dump_path)
        debug("redo-injuries complete")
        print('Redo injuries complete.')
        return

    player_ids = merge_player_ids([args.ids_2024, args.ids_2025])
    if not player_ids:
        print('No player IDs found in inputs.', file=sys.stderr)
        sys.exit(1)

    dump_id = args.dump_id.strip() or uuid.uuid4().hex[:16]
    dump_path = ensure_dump_dir(dump_id)
    print(f'dump_id: {dump_id}')
    debug(f"dump path: {dump_path}")

    done = already_done_ids(dump_path)
    to_fetch = [pid for pid in player_ids if pid not in done]
    debug(f"player_ids total={len(player_ids)} already_done={len(done)} to_fetch={len(to_fetch)}")

    max_workers = max(1, int(args.limit))
    debug(f"starting ThreadPoolExecutor workers={max_workers}")

    aggregated_events: Set[str] = set()

    def task(pid: str) -> Optional[Set[str]]:
        try:
            debug(f"task start pid={pid}")
            history = fetch_one_history(pid, args.min_year, args.max_year, args.stop_gaps)
            write_player_stats(dump_path, pid, history)
            evs = collect_event_ids(history)
            debug(f"task done pid={pid} games={sum(len(v) for v in history.values()) if isinstance(history, dict) else 0} events={len(evs)}")
            return evs
        except Exception as e:
            print(f"FAIL pid={pid}: {e}", file=sys.stderr)
            print(traceback.format_exc(), file=sys.stderr)
            return None

    completed = 0
    successes = 0
    failures = 0
    failed_ids: List[str] = []
    total = len(to_fetch)
    print(f"Progress [----------------------------------------] 0/{total} (0%) ok=0 fail=0", end='\r', flush=True)

    if total:
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(task, pid): pid for pid in to_fetch}
            for fut in concurrent.futures.as_completed(futures):
                pid = futures[fut]
                res = fut.result()
                if res is None:
                    failures += 1
                    failed_ids.append(pid)
                    debug(f"task fail pid={pid}")
                else:
                    successes += 1
                    aggregated_events.update(res)
                    debug(f"task success pid={pid} agg_events={len(aggregated_events)}")
                completed += 1
                bar_len = 40
                ratio = completed / total
                filled = int(bar_len * ratio)
                bar = '#' * filled + '-' * (bar_len - filled)
                print(f"Progress [{bar}] {completed}/{total} ({int(ratio*100)}%) ok={successes} fail={failures}", end='\r', flush=True)
        print('\n')

    # Merge with prior events for completeness and persist
    events_path = dump_path / 'events.txt'
    prior_events: Set[str] = set()
    if events_path.exists():
        try:
            prior = json.loads(events_path.read_text(encoding='utf-8'))
            if isinstance(prior, list):
                prior_events = {str(x) for x in prior}
        except Exception:
            prior_events = set()
    all_events = sorted(prior_events.union(aggregated_events), key=lambda x: int(x))
    write_json(events_path, all_events)
    debug(f"events.txt written merged_count={len(all_events)} (prior={len(prior_events)} new={len(aggregated_events)})")

    # Build weekly injuries files with their own progress bar (resume-aware)
    build_weekly_injury_files(set(all_events), dump_path)

    overall_done = len(done) + successes
    if failures == 0:
        print(f'SUCCESS: downloaded {successes}/{total} remaining players (overall {overall_done}/{len(player_ids)}). dump_id: {dump_id}')
    else:
        print(f'PARTIAL: {successes}/{total} completed, {failures} failed. dump_id: {dump_id}')
        sample = ','.join(failed_ids[:10])
        if sample:
            print(f'Failed IDs (first {min(10, len(failed_ids))}): {sample}')
        print(f'Re-run with --dump-id {dump_id} to resume only the missing players.')


if __name__ == '__main__':
    main() 