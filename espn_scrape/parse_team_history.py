#!/usr/bin/env python3

import argparse
import json
import re
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple, List
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# Minimal, explicit mapping of NFL team long names to ESPN-style abbreviations
TEAM_NAME_TO_ABBR: Dict[str, str] = {
    'Arizona Cardinals': 'ARI',
    'Atlanta Falcons': 'ATL',
    'Baltimore Ravens': 'BAL',
    'Buffalo Bills': 'BUF',
    'Carolina Panthers': 'CAR',
    'Chicago Bears': 'CHI',
    'Cincinnati Bengals': 'CIN',
    'Cleveland Browns': 'CLE',
    'Dallas Cowboys': 'DAL',
    'Denver Broncos': 'DEN',
    'Detroit Lions': 'DET',
    'Green Bay Packers': 'GB',
    'Houston Texans': 'HOU',
    'Indianapolis Colts': 'IND',
    'Jacksonville Jaguars': 'JAX',
    'Kansas City Chiefs': 'KC',
    'Las Vegas Raiders': 'LV',
    'Los Angeles Chargers': 'LAC',
    'Los Angeles Rams': 'LAR',
    'Miami Dolphins': 'MIA',
    'Minnesota Vikings': 'MIN',
    'New England Patriots': 'NE',
    'New Orleans Saints': 'NO',
    'New York Giants': 'NYG',
    'New York Jets': 'NYJ',
    'Philadelphia Eagles': 'PHI',
    'Pittsburgh Steelers': 'PIT',
    'San Francisco 49ers': 'SF',
    'Seattle Seahawks': 'SEA',
    'Tampa Bay Buccaneers': 'TB',
    'Tennessee Titans': 'TEN',
    'Washington Commanders': 'WSH',
}

# Map ESPN slug tokens to abbreviations (derived from game URL last segment)
SLUG_TO_ABBR: Dict[str, str] = {
    'cardinals': 'ARI',
    'falcons': 'ATL',
    'ravens': 'BAL',
    'bills': 'BUF',
    'panthers': 'CAR',
    'bears': 'CHI',
    'bengals': 'CIN',
    'browns': 'CLE',
    'cowboys': 'DAL',
    'broncos': 'DEN',
    'lions': 'DET',
    'packers': 'GB',
    'texans': 'HOU',
    'colts': 'IND',
    'jaguars': 'JAX',
    'chiefs': 'KC',
    'raiders': 'LV',
    'chargers': 'LAC',
    'rams': 'LAR',
    'dolphins': 'MIA',
    'vikings': 'MIN',
    'patriots': 'NE',
    'saints': 'NO',
    'giants': 'NYG',
    'jets': 'NYJ',
    'eagles': 'PHI',
    'steelers': 'PIT',
    '49ers': 'SF',
    'seahawks': 'SEA',
    'buccaneers': 'TB',
    'titans': 'TEN',
    'commanders': 'WSH',
}

MONTH_NAME_TO_NUM: Dict[str, int] = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
}

DAY_ABBR = {'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'}


USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36'


def fetch_html(url: str, timeout: int = 15) -> Optional[str]:
    req = Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            return data.decode('utf-8', errors='ignore')
    except (HTTPError, URLError, TimeoutError):
        return None


def parse_page_timestamp(html: str) -> Optional[datetime]:
    m = re.search(r"<!--\s*ESPNFITT\s*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*([^|<]+GMT)\s*-->", html)
    if not m:
        return None
    ts_str = m.group(1).strip()
    try:
        return datetime.strptime(ts_str, '%a, %d %b %Y %H:%M:%S GMT')
    except Exception:
        return None


def is_gamelog_page(html: str) -> bool:
    title = extract_title_text(html)
    return bool(title and ('Stats per Game' in title or 'gamelog' in title.lower()))


def extract_title_text(html: str) -> Optional[str]:
    m = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    if m:
        return re.sub(r'\s+', ' ', m.group(1)).strip()
    return None


def extract_current_team_abbr_from_profile(html: str) -> Optional[str]:
    block = None
    b = re.search(r'PlayerHeader__Team_Info[\s\S]{0,4000}', html)
    if b:
        block = b.group(0)
    else:
        block = html[:50000]
    link = re.search(r'href="/nfl/team/_/name/[^"]+">([^<]+)</a>', block)
    if not link:
        return None
    team_name = link.group(1).strip()
    return TEAM_NAME_TO_ABBR.get(team_name)


def extract_release_or_trade_month_from_profile(html: str) -> Optional[int]:
    text = re.sub(r'<[^>]+>', ' ', html)
    text = re.sub(r'\s+', ' ', text)
    m = re.search(r'\b(released|signed|waived)\b[^.]*\b(in|on)\b\s+([A-Za-z]+)', text, re.IGNORECASE)
    if m:
        month_word = m.group(3).lower()
        return MONTH_NAME_TO_NUM.get(month_word)
    return None


def is_free_agent_from_profile(html: str) -> bool:
    text = re.sub(r'<[^>]+>', ' ', html)
    text = re.sub(r'\s+', ' ', text).lower()
    # Look for explicit cues
    if re.search(r'\b(released|waived|cut)\b', text):
        return True
    if re.search(r'\bfree agent\b', text):
        return True
    return False


def extract_relative_time_mentions(html: str) -> List[Tuple[str, str]]:
    results: List[Tuple[str, str]] = []
    for m in re.finditer(r'class="time-elapsed">([^<]+)</li>', html):
        token = m.group(1).strip()
        start = max(0, m.start() - 500)
        context = html[start:m.start()]
        h = re.search(r'class=\"(?:contentItem__title|MediaList__item__description)[^>]*\">([^<]+)</', context)
        headline = h.group(1).strip() if h else ''
        results.append((headline, token))
    return results


def apply_relative_token(base: datetime, token: str) -> Optional[datetime]:
    token = token.strip()
    try:
        if token.endswith('d'):
            days = int(token[:-1])
            return base - timedelta(days=days)
        if token.endswith('h'):
            hours = int(token[:-1])
            return base - timedelta(hours=hours)
        if token.endswith('m'):
            minutes = int(token[:-1])
            return base - timedelta(minutes=minutes)
        if token.endswith('M'):
            months = int(token[:-1])
            return base - timedelta(days=months * 30)
        if token.endswith('y'):
            years = int(token[:-1])
            return base.replace(year=base.year - years)
    except Exception:
        return None
    return None


def _slice_regular_season_table(html: str) -> Optional[str]:
    m = re.search(r'\b(\d{4})\s+Regular\s+Season\s*\(', html)
    if not m:
        return None
    start = m.start()
    end_m = re.search(r'>\s*Regular\s+Season\s+Stats\s*<', html[m.end():])
    if end_m:
        end = m.end() + end_m.end()
    else:
        tb = re.search(r'</tbody>\s*</table>', html[m.end():])
        end = m.end() + (tb.end() if tb else 20000)
    return html[start:end]


def _map_slug_to_abbr(slug: str) -> Optional[str]:
    token = slug.strip().lower()
    return SLUG_TO_ABBR.get(token)


def extract_gamelog_transitions(html: str) -> List[Tuple[str, str]]:
    section = _slice_regular_season_table(html)
    if not section:
        return []
    y = re.search(r'\b(\d{4})\s+Regular\s+Season\s*\(', section)
    if not y:
        return []
    season_year = int(y.group(1))

    transitions: List[Tuple[str, str]] = []
    last_team: Optional[str] = None

    for m in re.finditer(r'>\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})/(\d{1,2})\s*<([\s\S]*?)data-testid="resultCellLink"\s+href="[^"]+/gameId/[^/]+/([A-Za-z0-9\-]+)"', section):
        month_num = int(m.group(1))
        day_num = int(m.group(2))
        row_chunk = m.group(3)
        slug = m.group(4)

        hm = re.search(r'>\s*(vs|@)\s*<', row_chunk)
        if not hm:
            continue
        marker = hm.group(1)

        parts = slug.split('-')
        if len(parts) != 2:
            continue
        away_slug, home_slug = parts[0], parts[1]
        away_abbr = _map_slug_to_abbr(away_slug)
        home_abbr = _map_slug_to_abbr(home_slug)
        if not away_abbr or not home_abbr:
            continue

        player_team = home_abbr if marker == 'vs' else away_abbr
        try:
            dt = datetime(year=season_year, month=month_num, day=day_num)
        except ValueError:
            continue
        iso = dt.strftime('%Y-%m-%d')

        if player_team != last_team:
            transitions.append((player_team, iso))
            last_team = player_team

    transitions.sort(key=lambda x: x[1])
    return transitions


def parse_team_history_from_html(html: str) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    page_ts = parse_page_timestamp(html) or datetime.utcnow()

    if is_gamelog_page(html):
        trans = extract_gamelog_transitions(html)
        for team_abbr, iso in trans:
            mapping[team_abbr] = iso
        return mapping

    current_team_abbr = extract_current_team_abbr_from_profile(html)
    if current_team_abbr:
        date_iso = None
        month_num = extract_release_or_trade_month_from_profile(html)
        if month_num:
            date_iso = f"{page_ts.year:04d}-{month_num:02d}-01"
        else:
            rels = extract_relative_time_mentions(html)
            long_name = next((name for name, ab in TEAM_NAME_TO_ABBR.items() if ab == current_team_abbr), None)
            picked_dt = None
            if rels:
                for headline, token in rels:
                    if long_name and long_name.split(' ')[-1] in headline or (long_name and long_name in headline):
                        dt = apply_relative_token(page_ts, token)
                        if dt:
                            picked_dt = dt
                            break
                if not picked_dt:
                    dt = apply_relative_token(page_ts, rels[0][1])
                    if dt:
                        picked_dt = dt
            if picked_dt:
                date_iso = picked_dt.strftime('%Y-%m-%d')
        if not date_iso:
            date_iso = f"{page_ts.year:04d}-{page_ts.month:02d}-01"
        mapping[current_team_abbr] = date_iso
    else:
        # Only mark FA if profile text explicitly indicates it
        if is_free_agent_from_profile(html):
            month_num = extract_release_or_trade_month_from_profile(html)
            if month_num:
                mapping['FA'] = f"{page_ts.year:04d}-{month_num:02d}-01"
            else:
                mapping['FA'] = f"{page_ts.year:04d}-{page_ts.month:02d}-01"

    return mapping


def parse_team_history_for_player(player_id: str, min_year: Optional[int] = None, max_year: Optional[int] = None, stop_gaps: int = 3) -> Dict[str, str]:
    now = datetime.utcnow()
    if max_year is None:
        max_year = now.year
    if min_year is None:
        min_year = max_year - 25

    yearly_transitions: List[Tuple[str, str]] = []
    found_any = False
    misses = 0

    for y in range(max_year, min_year - 1, -1):
        url = f"https://www.espn.com/nfl/player/gamelog/_/id/{player_id}/type/nfl/year/{y}"
        html = fetch_html(url)
        if not html or not is_gamelog_page(html):
            if found_any:
                misses += 1
                if misses >= stop_gaps:
                    break
            continue
        trans = extract_gamelog_transitions(html)
        if not trans:
            if found_any:
                misses += 1
                if misses >= stop_gaps:
                    break
            continue
        yearly_transitions.extend(trans)
        found_any = True
        misses = 0

    yearly_transitions.sort(key=lambda x: x[1])
    transitions_map: Dict[str, str] = {}
    last_team: Optional[str] = None
    for team, iso in yearly_transitions:
        if team != last_team:
            transitions_map[team] = iso
            last_team = team

    profile_url = f"https://www.espn.com/nfl/player/_/id/{player_id}/"
    profile_html = fetch_html(profile_url) or ''
    if profile_html:
        page_ts = parse_page_timestamp(profile_html) or now
        current_team = extract_current_team_abbr_from_profile(profile_html)
        if current_team and current_team != last_team:
            month_num = extract_release_or_trade_month_from_profile(profile_html)
            if month_num:
                date_iso = f"{page_ts.year:04d}-{month_num:02d}-01"
            else:
                rels = extract_relative_time_mentions(profile_html)
                picked_dt = None
                if rels:
                    dt = apply_relative_token(page_ts, rels[0][1])
                    if dt:
                        picked_dt = dt
                date_iso = picked_dt.strftime('%Y-%m-%d') if picked_dt else f"{page_ts.year:04d}-{page_ts.month:02d}-01"
            transitions_map[current_team] = date_iso
        elif not current_team and last_team:
            # Only add FA if explicitly indicated
            if is_free_agent_from_profile(profile_html):
                month_num = extract_release_or_trade_month_from_profile(profile_html)
                if month_num:
                    date_iso = f"{page_ts.year:04d}-{month_num:02d}-01"
                else:
                    date_iso = f"{page_ts.year:04d}-{page_ts.month:02d}-01"
                transitions_map['FA'] = date_iso

    return transitions_map


def main() -> None:
    parser = argparse.ArgumentParser(description='Parse ESPN player team history by player ID or from a single HTML blob (legacy).')
    parser.add_argument('--player-id', '-p', type=str, help='ESPN player ID (e.g., 3126486)')
    parser.add_argument('--min-year', type=int, help='Minimum season year to check (default: currentYear-25)')
    parser.add_argument('--max-year', type=int, help='Maximum season year to check (default: currentYear)')
    parser.add_argument('--stop-gaps', type=int, default=3, help='Consecutive missing years after first find before stopping (default: 3)')
    parser.add_argument('--pretty', action='store_true', help='Pretty-print JSON output')
    parser.add_argument('--input', '-i', type=str, default=None, help='(Legacy) Path to HTML file for single-page parse')
    args = parser.parse_args()

    if args.player_id:
        result = parse_team_history_for_player(args.player_id, args.min_year, args.max_year, args.stop_gaps)
    else:
        if not args.input:
            raise SystemExit('Provide --player-id or --input')
        with open(args.input, 'r', encoding='utf-8') as f:
            html = f.read()
        result = parse_team_history_from_html(html)

    if args.pretty:
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    main() 