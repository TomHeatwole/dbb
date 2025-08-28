#!/usr/bin/env python3

import argparse
import json
import re
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple, List, Any
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

TEAM_NAME_TO_ABBR: Dict[str, str] = {
    'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF',
    'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI', 'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE',
    'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
    'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC',
    'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC', 'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA',
    'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
    'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF',
    'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB', 'Tennessee Titans': 'TEN', 'Washington Commanders': 'WSH',
}

SLUG_TO_ABBR: Dict[str, str] = {
    'cardinals': 'ARI', 'falcons': 'ATL', 'ravens': 'BAL', 'bills': 'BUF', 'panthers': 'CAR', 'bears': 'CHI',
    'bengals': 'CIN', 'browns': 'CLE', 'cowboys': 'DAL', 'broncos': 'DEN', 'lions': 'DET', 'packers': 'GB',
    'texans': 'HOU', 'colts': 'IND', 'jaguars': 'JAX', 'chiefs': 'KC', 'raiders': 'LV', 'chargers': 'LAC',
    'rams': 'LAR', 'dolphins': 'MIA', 'vikings': 'MIN', 'patriots': 'NE', 'saints': 'NO', 'giants': 'NYG',
    'jets': 'NYJ', 'eagles': 'PHI', 'steelers': 'PIT', '49ers': 'SF', 'seahawks': 'SEA', 'buccaneers': 'TB',
    'titans': 'TEN', 'commanders': 'WSH',
}

MONTH_NAME_TO_NUM: Dict[str, int] = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
}

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


def extract_title_text(html: str) -> Optional[str]:
    m = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    if m:
        return re.sub(r'\s+', ' ', m.group(1)).strip()
    return None


def _slice_table_by_label(html: str, label_regex: str) -> Optional[str]:
    h = re.search(label_regex, html, re.IGNORECASE)
    if not h:
        return None
    start = h.start()
    end_m = re.search(r'</tbody>\s*</table>', html[h.end():], re.IGNORECASE)
    end = h.end() + (end_m.end() if end_m else 20000)
    return html[start:end]


def _parse_stat_headers(section_html: str) -> List[str]:
    # Find the sub-header row in this section
    m = re.search(r'<tr[^>]*class="[^"]*Table__sub-header[^"]*"[^>]*>([\s\S]*?)</tr>', section_html, re.IGNORECASE)
    if not m:
        return []
    ths = re.findall(r'<th[^>]*>(.*?)</th>', m.group(1), re.IGNORECASE | re.DOTALL)
    # First 3 are Date/OPP/Result; remainder are stat headers
    headers = [re.sub(r'<[^>]+>', '', t).strip() for t in ths]
    return headers[3:]


def _map_slug_to_abbr(slug: str) -> Optional[str]:
    return SLUG_TO_ABBR.get(slug.strip().lower())


def _clean_cell_text(html_fragment: str) -> str:
    text = re.sub(r'<[^>]+>', ' ', html_fragment)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _parse_rows(section_html: str, season_year: int, headers: List[str]) -> List[Dict[str, Any]]:
    games: List[Dict[str, Any]] = []
    week_num = 0

    # Iterate rows with a Date cell; capture the full row until </tr>
    for rm in re.finditer(r'<tr[^>]*class="[^"]*Table__TR[^>]*>([\s\S]*?)</tr>', section_html, re.IGNORECASE):
        row_html = rm.group(1)
        dm = re.search(r'>\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})/(\d{1,2})\s*<', row_html)
        if not dm:
            continue
        month_num = int(dm.group(1))
        day_num = int(dm.group(2))
        try:
            date_iso = datetime(year=season_year, month=month_num, day=day_num).strftime('%Y-%m-%d')
        except ValueError:
            continue

        # Extract vs/@ marker
        mm = re.search(r'>\s*(vs|@)\s*<', row_html)
        marker = mm.group(1) if mm else ''

        # Extract game URL slug to derive teams
        slugm = re.search(r'data-testid="resultCellLink"\s+href="[^"]+/gameId/[^/]+/([A-Za-z0-9\-]+)"', row_html)
        player_team = None
        opp_team = None
        if slugm and marker:
            parts = slugm.group(1).split('-')
            if len(parts) == 2:
                away_abbr = _map_slug_to_abbr(parts[0])
                home_abbr = _map_slug_to_abbr(parts[1])
                if away_abbr and home_abbr:
                    player_team = home_abbr if marker == 'vs' else away_abbr
                    opp_team = away_abbr if marker == 'vs' else home_abbr

        # Extract result cell text
        result_cell = re.search(r'data-testid="resultCellLink"[\s\S]*?</a>', row_html)
        result_text = _clean_cell_text(result_cell.group(0)) if result_cell else ''

        # Extract all TD cells and map stats according to headers
        td_htmls = re.findall(r'<td[^>]*class="[^"]*Table__TD[^"]*"[^>]*>([\s\S]*?)</td>', row_html, re.IGNORECASE)
        if len(td_htmls) < 3:
            continue
        stat_cells = td_htmls[3:3 + len(headers)]
        stats: Dict[str, Any] = {}
        for i, h in enumerate(headers):
            if i < len(stat_cells):
                stats[h] = _clean_cell_text(stat_cells[i])

        week_num += 1
        games.append({
            'week': week_num,
            'date': date_iso,
            'homeAway': marker or '',
            'team': player_team,
            'opponent': opp_team,
            'result': result_text,
            'stats': stats,
        })

    return games


def parse_season_games(html: str) -> Tuple[Optional[int], List[Dict[str, Any]]]:
    # Season year from either Regular or Postseason section
    y = re.search(r'\b(\d{4})\s+(?:Regular|Postseason)\s+Season', html)
    season_year = int(y.group(1)) if y else None

    all_games: List[Dict[str, Any]] = []

    # Regular Season
    reg = _slice_table_by_label(html, r'\b\d{4}\s+Regular\s+Season\s*\(')
    if reg:
        headers = _parse_stat_headers(reg)
        all_games.extend(_parse_rows(reg, season_year or 0, headers))

    # Postseason (append after regular weeks)
    post = _slice_table_by_label(html, r'\b\d{4}\s+Postseason\s*')
    if post:
        headers_post = _parse_stat_headers(post)
        # Continue week numbering after existing
        existing_weeks = len(all_games)
        post_games = _parse_rows(post, season_year or 0, headers_post)
        for g in post_games:
            g['week'] = existing_weeks + g['week']
        all_games.extend(post_games)

    return season_year, all_games


def parse_game_history_for_player(player_id: str, min_year: Optional[int] = None, max_year: Optional[int] = None, stop_gaps: int = 3) -> Dict[str, List[Dict[str, Any]]]:
    now = datetime.utcnow()
    if max_year is None:
        max_year = now.year
    if min_year is None:
        min_year = max_year - 25

    year_to_games: Dict[str, List[Dict[str, Any]]] = {}
    found_any = False
    misses = 0

    for y in range(max_year, min_year - 1, -1):
        url = f"https://www.espn.com/nfl/player/gamelog/_/id/{player_id}/type/nfl/year/{y}"
        html = fetch_html(url)
        if not html:
            if found_any:
                misses += 1
                if misses >= stop_gaps:
                    break
            continue
        title = extract_title_text(html) or ''
        if 'Stats per Game' not in title:
            if found_any:
                misses += 1
                if misses >= stop_gaps:
                    break
            continue
        season_year, games = parse_season_games(html)
        if season_year and games:
            year_to_games[str(season_year)] = games
            found_any = True
            misses = 0
        else:
            if found_any:
                misses += 1
                if misses >= stop_gaps:
                    break

    # Return years ascending
    return dict(sorted(year_to_games.items(), key=lambda kv: kv[0]))


def main() -> None:
    parser = argparse.ArgumentParser(description='Output full NFL game history for an ESPN player as {year: [games...]}')
    parser.add_argument('--player-id', '-p', type=str, required=True, help='ESPN player ID (e.g., 3126486)')
    parser.add_argument('--min-year', type=int, help='Minimum season year to check (default: currentYear-25)')
    parser.add_argument('--max-year', type=int, help='Maximum season year to check (default: currentYear)')
    parser.add_argument('--stop-gaps', type=int, default=3, help='Consecutive missing years after first find before stopping (default: 3)')
    parser.add_argument('--pretty', action='store_true', help='Pretty-print JSON output')
    args = parser.parse_args()

    result = parse_game_history_for_player(args.player_id, args.min_year, args.max_year, args.stop_gaps)

    if args.pretty:
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    main() 