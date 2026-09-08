#!/usr/bin/env python3
"""Play-caller 4th-down aggression vs the joint drive-result model.

Joins the 2024–2026 play-caller sheet to the ESPN drive/snap scrape.
Writes example_data/ncaaf_drive_results/play_caller_fourth.json
"""
from __future__ import annotations

import csv
import json
import math
import os
import re
import sys
from collections import defaultdict
from datetime import date, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

from eval_current_next_drive_holdout import (  # noqa: E402
    CLASS_INDEX,
    load_layer_scorer,
    map_drive_label,
    snap_features,
    to_float,
)
from ncaaf_field_buckets import fp_bucket  # noqa: E402

CALLER_CSV = os.environ.get(
    'PLAY_CALLER_CSV',
    '/Users/tomh/Downloads/ncaaf_fbs_play_callers_2024_2026_hc_assumptions.csv',
)
DRIVE_CSV = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_drives.csv')
SNAP_CSV = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'espn_ncaaf_snaps_outcomes.csv')
MODEL_JSON = os.path.join(ROOT, 'site', 'src', 'drives', 'driveResultModel.json')
OUT_JSON = os.path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'play_caller_fourth.json')

PUNT_PLAYS = {
    'Punt', 'Punt Return', 'Blocked Punt', 'Punt Return Touchdown',
    'Blocked Punt Touchdown',
}
FG_PLAYS = {
    'Field Goal Good', 'Field Goal Missed', 'Blocked Field Goal',
    'Missed Field Goal Return', 'Blocked Field Goal Touchdown',
}
GO_PLAYS = {
    'Rush', 'Pass Incompletion', 'Pass Reception', 'Passing Touchdown',
    'Rushing Touchdown', 'Sack', 'Pass Completion',
    'Fumble Recovery (Opponent)', 'Pass Interception Return', 'Interception',
    'Interception Return Touchdown', 'Fumble Recovery (Own)', 'Fumble',
    'Fumble Return Touchdown', 'Safety',
}

CANONICAL_ESPN = {
    'Miami (FL)': 'Miami Hurricanes',
    'Miami (OH)': 'Miami (OH) RedHawks',
    'UMass': 'Massachusetts Minutemen',
    'UL Monroe': 'UL Monroe Warhawks',
    'NC State': 'NC State Wolfpack',
    'UConn': 'UConn Huskies',
    'Southern Miss': 'Southern Miss Golden Eagles',
    'Louisiana': "Louisiana Ragin' Cajuns",
    'FIU': 'Florida International Panthers',
    'Florida Atlantic': 'Florida Atlantic Owls',
    'Appalachian State': 'App State Mountaineers',
    'San Jose State': 'San José State Spartans',
    'Hawaii': "Hawai'i Rainbow Warriors",
    'Texas': 'Texas Longhorns',
    'Washington': 'Washington Huskies',
    'Georgia': 'Georgia Bulldogs',
    'Michigan': 'Michigan Wolverines',
    'Ohio': 'Ohio Bobcats',
    'North Carolina': 'North Carolina Tar Heels',
    'South Carolina': 'South Carolina Gamecocks',
    'Mississippi State': 'Mississippi State Bulldogs',
    'New Mexico': 'New Mexico Lobos',
    'New Mexico State': 'New Mexico State Aggies',
    'Colorado': 'Colorado Buffaloes',
    'Colorado State': 'Colorado State Rams',
    'Oregon': 'Oregon Ducks',
    'Oregon State': 'Oregon State Beavers',
    'Washington State': 'Washington State Cougars',
    'Arizona': 'Arizona Wildcats',
    'Arizona State': 'Arizona State Sun Devils',
    'Kansas': 'Kansas Jayhawks',
    'Kansas State': 'Kansas State Wildcats',
    'Iowa': 'Iowa Hawkeyes',
    'Iowa State': 'Iowa State Cyclones',
    'Michigan State': 'Michigan State Spartans',
    'Ohio State': 'Ohio State Buckeyes',
    'Penn State': 'Penn State Nittany Lions',
    'Florida': 'Florida Gators',
    'Florida State': 'Florida State Seminoles',
    'Georgia Tech': 'Georgia Tech Yellow Jackets',
    'Georgia Southern': 'Georgia Southern Eagles',
    'Georgia State': 'Georgia State Panthers',
    'Texas A&M': 'Texas A&M Aggies',
    'Texas Tech': 'Texas Tech Red Raiders',
    'Texas State': 'Texas State Bobcats',
    'Oklahoma': 'Oklahoma Sooners',
    'Oklahoma State': 'Oklahoma State Cowboys',
    'Ole Miss': 'Ole Miss Rebels',
    'USC': 'USC Trojans',
    'UCLA': 'UCLA Bruins',
    'UCF': 'UCF Knights',
    'UAB': 'UAB Blazers',
    'UNLV': 'UNLV Rebels',
    'UTEP': 'UTEP Miners',
    'UTSA': 'UTSA Roadrunners',
    'BYU': 'BYU Cougars',
    'LSU': 'LSU Tigers',
    'SMU': 'SMU Mustangs',
    'TCU': 'TCU Horned Frogs',
    'Army': 'Army Black Knights',
    'Navy': 'Navy Midshipmen',
    'Boston College': 'Boston College Eagles',
    'West Virginia': 'West Virginia Mountaineers',
    'Northwestern': 'Northwestern Wildcats',
    'Tennessee': 'Tennessee Volunteers',
    'Virginia': 'Virginia Cavaliers',
    'Illinois': 'Illinois Fighting Illini',
    'Arkansas': 'Arkansas Razorbacks',
    'Kentucky': 'Kentucky Wildcats',
    'Delaware': 'Delaware Blue Hens',
    'Indiana': 'Indiana Hoosiers',
    'Houston': 'Houston Cougars',
    'Alabama': 'Alabama Crimson Tide',
    'Utah': 'Utah Utes',
    'Middle Tennessee': 'Middle Tennessee Blue Raiders',
}


def parse_date(value):
    raw = str(value or '').strip()[:10]
    if len(raw) < 10:
        return None
    try:
        return datetime.strptime(raw, '%Y-%m-%d').date()
    except ValueError:
        return None


def classify_fourth(play_type):
    pt = str(play_type or '').strip()
    if pt in PUNT_PLAYS:
        return 'punt'
    if pt in FG_PLAYS:
        return 'fg'
    if pt in GO_PLAYS:
        return 'go'
    return None


def is_desperation(period, sec_left_half, score_diff, ytg):
    """Trailing late in a half — almost everyone goes. Not a style tell."""
    p = to_float(period)
    s = to_float(sec_left_half)
    diff = to_float(score_diff)
    y = to_float(ytg)
    if not all(math.isfinite(v) for v in (p, s, diff, y)):
        return False
    if p not in (2.0, 4.0):
        return False
    if s > 120:
        return False
    if diff >= 0:
        return False
    return True


def short_own_half(distance, ytg):
    d = to_float(distance)
    y = to_float(ytg)
    return math.isfinite(d) and math.isfinite(y) and d <= 2 and y >= 40


def mid_short(distance, ytg):
    d = to_float(distance)
    y = to_float(ytg)
    return math.isfinite(d) and math.isfinite(y) and d <= 3 and 35 <= y <= 55


def z_vs_p0(k, n, p0):
    if n <= 0 or p0 <= 0 or p0 >= 1:
        return None
    phat = k / n
    se = math.sqrt(p0 * (1 - p0) / n)
    if se <= 0:
        return None
    return (phat - p0) / se


def shrink(k, n, p0, k0=40):
    if n < 0:
        return None
    return (k + k0 * p0) / (n + k0)


def logloss_one(y, p):
    i = CLASS_INDEX[y]
    return -math.log(max(p[i], 1e-15))


class Acc:
    def __init__(self):
        self.n = 0
        self.punt = 0
        self.td = 0
        self.fg = 0
        self.other = 0
        self.go = 0
        self.fourth = 0
        self.punt_dec = 0
        self.fg_dec = 0
        self.go_dec = 0
        self.clean_n = 0
        self.clean_go = 0
        self.clean_punt = 0
        self.short_n = 0
        self.short_go = 0
        self.short_punt = 0
        self.mid_n = 0
        self.mid_go = 0
        self.ll = 0.0
        self.pred_punt = 0.0
        self.pred_td = 0.0
        self.pred_fg = 0.0
        self.pred_other = 0.0
        self.n_scored = 0
        self.fourth_ll = 0.0
        self.fourth_pred_punt = 0.0
        self.fourth_obs_punt = 0
        self.n_fourth_scored = 0
        self.teams = set()
        self.years = set()

    def add_drive(self, y, p=None, team=None, year=None):
        self.n += 1
        if y == 'punt':
            self.punt += 1
        elif y == 'td':
            self.td += 1
        elif y == 'fg':
            self.fg += 1
        else:
            self.other += 1
        if team:
            self.teams.add(team)
        if year:
            self.years.add(year)
        if p is not None:
            self.n_scored += 1
            self.ll += logloss_one(y, p)
            self.pred_punt += p[0]
            self.pred_td += p[1]
            self.pred_fg += p[2]
            self.pred_other += p[3]

    def add_fourth(self, decision, distance, ytg, desperate, p=None, drive_y=None):
        self.fourth += 1
        if decision == 'punt':
            self.punt_dec += 1
        elif decision == 'fg':
            self.fg_dec += 1
        elif decision == 'go':
            self.go_dec += 1
        if decision in ('punt', 'go') and not desperate:
            self.clean_n += 1
            if decision == 'go':
                self.clean_go += 1
            else:
                self.clean_punt += 1
            if short_own_half(distance, ytg):
                self.short_n += 1
                if decision == 'go':
                    self.short_go += 1
                else:
                    self.short_punt += 1
            if mid_short(distance, ytg):
                self.mid_n += 1
                if decision == 'go':
                    self.mid_go += 1
        if p is not None and drive_y is not None:
            self.n_fourth_scored += 1
            self.fourth_ll += logloss_one(drive_y, p)
            self.fourth_pred_punt += p[0]
            if drive_y == 'punt':
                self.fourth_obs_punt += 1

    def dump(self, league=None, min_drives=1):
        n = self.n
        if n < min_drives:
            return None
        out = {
            'nDrives': n,
            'nFourth': self.fourth,
            'obs': {
                'punt': round(self.punt / n, 4) if n else None,
                'td': round(self.td / n, 4) if n else None,
                'fg': round(self.fg / n, 4) if n else None,
                'other': round(self.other / n, 4) if n else None,
            },
            'teams': sorted(self.teams),
            'years': sorted(self.years),
        }
        if self.fourth:
            out['fourth'] = {
                'punt': round(self.punt_dec / self.fourth, 4),
                'go': round(self.go_dec / self.fourth, 4),
                'fg': round(self.fg_dec / self.fourth, 4),
                'n': self.fourth,
            }
        if self.clean_n:
            rate = self.clean_go / self.clean_n
            out['goVsPunt'] = {
                'n': self.clean_n,
                'goRate': round(rate, 4),
                'puntRate': round(self.clean_punt / self.clean_n, 4),
            }
        if self.short_n:
            out['fourthAndShortOwn'] = {
                'n': self.short_n,
                'goRate': round(self.short_go / self.short_n, 4),
            }
        if self.mid_n:
            out['fourthAndShortMidfield'] = {
                'n': self.mid_n,
                'goRate': round(self.mid_go / self.mid_n, 4),
            }
        if self.n_scored:
            out['model'] = {
                'n': self.n_scored,
                'logloss': round(self.ll / self.n_scored, 4),
                'pred': {
                    'punt': round(self.pred_punt / self.n_scored, 4),
                    'td': round(self.pred_td / self.n_scored, 4),
                    'fg': round(self.pred_fg / self.n_scored, 4),
                    'other': round(self.pred_other / self.n_scored, 4),
                },
                'puntResidual': round(
                    self.punt / n - self.pred_punt / self.n_scored, 4
                ),
                'otherResidual': round(
                    self.other / n - self.pred_other / self.n_scored, 4
                ),
            }
        if self.n_fourth_scored:
            out['fourthModel'] = {
                'n': self.n_fourth_scored,
                'logloss': round(self.fourth_ll / self.n_fourth_scored, 4),
                'predPunt': round(self.fourth_pred_punt / self.n_fourth_scored, 4),
                'obsPunt': round(self.fourth_obs_punt / self.n_fourth_scored, 4),
                'puntResidual': round(
                    self.fourth_obs_punt / self.n_fourth_scored
                    - self.fourth_pred_punt / self.n_fourth_scored,
                    4,
                ),
            }
        if league:
            p0 = league.get('goVsPunt', {}).get('goRate')
            if p0 is not None and self.clean_n >= 20:
                out['goVsPunt']['z'] = round(
                    z_vs_p0(self.clean_go, self.clean_n, p0) or 0.0, 2
                )
                out['goVsPunt']['shrunk'] = round(
                    shrink(self.clean_go, self.clean_n, p0), 4
                )
            p0s = league.get('fourthAndShortOwn', {}).get('goRate')
            if p0s is not None and self.short_n >= 12:
                out['fourthAndShortOwn']['z'] = round(
                    z_vs_p0(self.short_go, self.short_n, p0s) or 0.0, 2
                )
                out['fourthAndShortOwn']['shrunk'] = round(
                    shrink(self.short_go, self.short_n, p0s, k0=20), 4
                )
            if league.get('obs') and n >= 40:
                out['drivePuntZ'] = round(
                    z_vs_p0(self.punt, n, league['obs']['punt']) or 0.0, 2
                )
        return out


def load_callers():
    rows = []
    with open(CALLER_CSV, newline='', encoding='utf-8-sig') as fh:
        for row in csv.DictReader(fh):
            rows.append(row)
    return rows


def espn_name_counts():
    counts = defaultdict(int)
    with open(DRIVE_CSV, newline='') as fh:
        for row in csv.DictReader(fh):
            counts[row.get('offense') or ''] += 1
            counts[row.get('home') or ''] += 1
            counts[row.get('away') or ''] += 1
    return counts


def map_teams(caller_rows, name_counts):
    espn_names = set(name_counts)
    mapped = {}
    unmatched = []
    csv_names = [r['team'] for r in caller_rows]
    longer = {n: [o for o in csv_names if o != n and o.startswith(n)] for n in csv_names}

    for row in caller_rows:
        school = row['team']
        if school in CANONICAL_ESPN:
            target = CANONICAL_ESPN[school]
            if target in espn_names:
                mapped[school] = target
                continue
        hits = []
        for name in espn_names:
            if name == school or name.startswith(school + ' '):
                skip = False
                for other in longer.get(school, []):
                    if name == other or name.startswith(other + ' '):
                        skip = True
                        break
                if not skip:
                    hits.append(name)
        if not hits:
            unmatched.append(school)
            continue
        hits.sort(key=lambda n: (-name_counts.get(n, 0), n))
        mapped[school] = hits[0]
    reverse = {v: k for k, v in mapped.items()}
    return mapped, reverse, unmatched


def season_of_date(d):
    if d is None:
        return None
    return d.year if d.month >= 8 else d.year - 1


def parse_in_season_changes(history):
    """Dated handoffs during Aug–Jan. Returns list of (date, new_caller)."""
    out = []
    raw = str(history or '')
    for m in re.finditer(
        r'(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+?)\s*->\s*([^|]+?)\s*\|',
        raw,
    ):
        d = parse_date(m.group(1))
        new = m.group(3).strip()
        if d and new:
            out.append((d, new))
    out.sort()
    return out


def build_caller_lookup(caller_rows, school_to_espn):
    """(espn_team, game_date) → {caller, school, status}."""
    by_school = {}
    for row in caller_rows:
        school = row['team']
        espn = school_to_espn.get(school)
        if not espn:
            continue
        changes = parse_in_season_changes(row.get('confirmed_or_high_confidence_change_history'))
        by_school[espn] = {
            'school': school,
            '2024': (row.get('play_caller_2024') or '').strip(),
            '2025': (row.get('play_caller_2025') or '').strip(),
            '2026': (row.get('current_play_caller') or '').strip(),
            'status': (row.get('current_status') or '').strip(),
            'changes': changes,
            'notes': (row.get('notes') or '').strip(),
        }

    def lookup(espn_team, game_date, season):
        meta = by_school.get(espn_team)
        if not meta:
            return None
        season_s = str(int(season)) if season else None
        caller = meta.get(season_s) or ''
        if game_date and meta['changes']:
            # Start from previous year's caller, apply dated changes up to game_date.
            prev = meta.get(str((season or 0) - 1)) or caller
            cur = prev
            applied = False
            for d, new in meta['changes']:
                if d <= game_date:
                    cur = new
                    applied = True
            # If no dated change actually applies this season, keep the column.
            if applied:
                caller = cur
        if not caller:
            return None
        return {
            'caller': caller,
            'school': meta['school'],
            'espn': espn_team,
            'status': meta['status'],
        }

    return lookup, by_school


def mean_mix(accs):
    n = sum(a.n for a in accs)
    if not n:
        return None
    tot = Acc()
    for a in accs:
        tot.n += a.n
        tot.punt += a.punt
        tot.td += a.td
        tot.fg += a.fg
        tot.other += a.other
        tot.fourth += a.fourth
        tot.punt_dec += a.punt_dec
        tot.go_dec += a.go_dec
        tot.fg_dec += a.fg_dec
        tot.clean_n += a.clean_n
        tot.clean_go += a.clean_go
        tot.clean_punt += a.clean_punt
        tot.short_n += a.short_n
        tot.short_go += a.short_go
        tot.mid_n += a.mid_n
        tot.mid_go += a.mid_go
        tot.n_scored += a.n_scored
        tot.ll += a.ll
        tot.pred_punt += a.pred_punt
        tot.pred_td += a.pred_td
        tot.pred_fg += a.pred_fg
        tot.pred_other += a.pred_other
        tot.n_fourth_scored += a.n_fourth_scored
        tot.fourth_ll += a.fourth_ll
        tot.fourth_pred_punt += a.fourth_pred_punt
        tot.fourth_obs_punt += a.fourth_obs_punt
    return tot


def main():
    print('loading callers / model…', flush=True)
    caller_rows = load_callers()
    name_counts = espn_name_counts()
    school_to_espn, espn_to_school, unmatched = map_teams(caller_rows, name_counts)
    lookup, by_school = build_caller_lookup(caller_rows, school_to_espn)
    print(
        f'  mapped {len(school_to_espn)}/{len(caller_rows)} schools, '
        f'unmatched={unmatched}',
        flush=True,
    )

    with open(MODEL_JSON, encoding='utf-8') as fh:
        model = json.load(fh)
    score_start = load_layer_scorer(model, 'driveStart')
    score_snap = load_layer_scorer(model, 'snap')

    print('loading drives…', flush=True)
    drives = []
    drive_index = {}
    with open(DRIVE_CSV, newline='') as fh:
        for raw in csv.DictReader(fh):
            y = map_drive_label(raw.get('result_bucket'))
            season = to_float(raw.get('season'))
            if y is None or not math.isfinite(season):
                continue
            offense = raw.get('offense') or ''
            gd = parse_date(raw.get('date'))
            info = lookup(offense, gd, int(season))
            if not info:
                continue
            gid = str(raw.get('game_id') or '')
            dn = to_float(raw.get('drive_n'))
            ytg = to_float(raw.get('start_yard'))
            spread = to_float(raw.get('offense_spread'))
            ou = to_float(raw.get('cfbd_over_under'))
            if not math.isfinite(ou):
                ou = to_float(raw.get('over_under'))
            off_s = to_float(raw.get('start_offense_score'))
            def_s = to_float(raw.get('start_defense_score'))
            score_diff = (
                off_s - def_s
                if math.isfinite(off_s) and math.isfinite(def_s)
                else float('nan')
            )
            rec = {
                'season': int(season),
                'date': gd,
                'game_id': gid,
                'drive_n': int(dn) if math.isfinite(dn) else None,
                'y': y,
                'ytg': ytg,
                'sec_left': to_float(raw.get('start_seconds_left')),
                'period': to_float(raw.get('start_period')),
                'score_diff': score_diff,
                'offense_spread': spread,
                'over_under': ou,
                'is_home': 1.0 if raw.get('offense_side') == 'home' else 0.0,
                'so_far_td': to_float(raw.get('so_far_td')) or 0.0,
                'so_far_fg': to_float(raw.get('so_far_fg')) or 0.0,
                'so_far_punt': to_float(raw.get('so_far_punt')) or 0.0,
                'so_far_other': to_float(raw.get('so_far_other')) or 0.0,
                'caller': info['caller'],
                'school': info['school'],
                'espn': offense,
            }
            rec['p'] = None
            if rec['season'] == 2025 and math.isfinite(ytg) and 1 <= ytg <= 99:
                exp_off, exp_def = (None, None)
                if math.isfinite(spread) and math.isfinite(ou):
                    exp_off = (ou - spread) / 2.0
                    exp_def = (ou + spread) / 2.0
                feat = {
                    'ytg': ytg,
                    'sec_left': rec['sec_left'],
                    'period': rec['period'],
                    'score_diff': score_diff if math.isfinite(score_diff) else 0.0,
                    'offense_spread': spread,
                    'over_under': ou,
                    'exp_off': exp_off if exp_off is not None else float('nan'),
                    'exp_def': exp_def if exp_def is not None else float('nan'),
                    'drive_n': float(rec['drive_n'] or float('nan')),
                    'is_home': rec['is_home'],
                    'so_far_td': rec['so_far_td'],
                    'so_far_fg': rec['so_far_fg'],
                    'so_far_punt': rec['so_far_punt'],
                    'so_far_other': rec['so_far_other'],
                    'fp_code': float(
                        {'deep': 0, 'kickoff': 1, 'midfield': 2, 'favorable': 3}.get(
                            fp_bucket(ytg) or '', float('nan')
                        )
                    ) if fp_bucket(ytg) else float('nan'),
                    'half_code': (
                        0.0 if rec['period'] in (1, 2)
                        else 1.0 if rec['period'] in (3, 4)
                        else 2.0 if math.isfinite(rec['period']) and rec['period'] > 4
                        else float('nan')
                    ),
                }
                rec['p'] = score_start(feat)
            drives.append(rec)
            if gid and rec['drive_n'] is not None:
                drive_index[(gid, rec['drive_n'])] = rec
                drive_index[(gid, rec['drive_n'] - 1)] = rec

    print(f'  fbs drives attributed {len(drives):,}', flush=True)

    print('scanning 4th-down snaps…', flush=True)
    fourths = 0
    with open(SNAP_CSV, newline='') as fh:
        for raw in csv.DictReader(fh):
            if raw.get('down') != '4':
                continue
            decision = classify_fourth(raw.get('play_type'))
            if decision is None:
                continue
            gid = str(raw.get('game_id') or '')
            dn = to_float(raw.get('drive_n'))
            if not gid or not math.isfinite(dn):
                continue
            rec = drive_index.get((gid, int(dn)))
            if not rec:
                continue
            ytg = to_float(raw.get('ytg'))
            distance = to_float(raw.get('distance'))
            period = to_float(raw.get('period'))
            half = to_float(raw.get('sec_left_half'))
            score_diff = to_float(raw.get('score_diff'))
            desperate = is_desperation(period, half, score_diff, ytg)
            p = None
            drive_y = rec['y']
            if rec['season'] == 2025:
                p = score_snap(snap_features(raw, rec['offense_spread'], rec['over_under']))
            rec.setdefault('fourths', [])
            rec['fourths'].append(decision)
            # stash on a parallel list via caller acc below
            rec['_fourth_events'] = rec.get('_fourth_events', [])
            rec['_fourth_events'].append({
                'decision': decision,
                'distance': distance,
                'ytg': ytg,
                'desperate': desperate,
                'p': p,
                'y': drive_y,
            })
            fourths += 1
    print(f'  attributed 4th-down decisions {fourths:,}', flush=True)

    by_caller = defaultdict(Acc)
    by_caller_year = defaultdict(Acc)
    by_school_year = defaultdict(Acc)
    league = defaultdict(Acc)

    for rec in drives:
        if rec['season'] not in (2024, 2025, 2026):
            continue
        key = rec['caller']
        by_caller[key].add_drive(rec['y'], rec['p'] if rec['season'] == 2025 else None,
                                 team=rec['school'], year=rec['season'])
        by_caller_year[(key, rec['season'])].add_drive(
            rec['y'], rec['p'] if rec['season'] == 2025 else None,
            team=rec['school'], year=rec['season'],
        )
        by_school_year[(rec['school'], rec['season'])].add_drive(
            rec['y'], rec['p'] if rec['season'] == 2025 else None,
            team=rec['school'], year=rec['season'],
        )
        league[rec['season']].add_drive(
            rec['y'], rec['p'] if rec['season'] == 2025 else None, year=rec['season']
        )
        league['all'].add_drive(
            rec['y'], rec['p'] if rec['season'] == 2025 else None, year=rec['season']
        )
        for ev in rec.get('_fourth_events') or []:
            by_caller[key].add_fourth(
                ev['decision'], ev['distance'], ev['ytg'], ev['desperate'],
                ev['p'], ev['y'],
            )
            by_caller_year[(key, rec['season'])].add_fourth(
                ev['decision'], ev['distance'], ev['ytg'], ev['desperate'],
                ev['p'], ev['y'],
            )
            by_school_year[(rec['school'], rec['season'])].add_fourth(
                ev['decision'], ev['distance'], ev['ytg'], ev['desperate'],
                ev['p'], ev['y'],
            )
            league[rec['season']].add_fourth(
                ev['decision'], ev['distance'], ev['ytg'], ev['desperate'],
                ev['p'], ev['y'],
            )
            league['all'].add_fourth(
                ev['decision'], ev['distance'], ev['ytg'], ev['desperate'],
                ev['p'], ev['y'],
            )

    league_all = league['all'].dump()
    league_2025 = league[2025].dump()
    league_2024 = league[2024].dump()
    league_2026 = league[2026].dump() if 2026 in league else None

    caller_rows_out = []
    for name, acc in by_caller.items():
        dumped = acc.dump(league_all, min_drives=40)
        if dumped:
            dumped['caller'] = name
            caller_rows_out.append(dumped)
    caller_rows_out.sort(key=lambda r: (r.get('goVsPunt') or {}).get('goRate') or 0, reverse=True)

    year_rows = []
    for (name, year), acc in by_caller_year.items():
        dumped = acc.dump(league.get(year, league['all']).dump(), min_drives=25)
        if dumped:
            dumped['caller'] = name
            dumped['year'] = year
            year_rows.append(dumped)

    # 2026 current callers: attach 2024-25 history wherever that person called.
    current = []
    history_by_caller = {r['caller']: r for r in caller_rows_out}
    for row in caller_rows:
        school = row['team']
        cur = (row.get('current_play_caller') or '').strip()
        if not cur or school not in school_to_espn:
            continue
        hist = history_by_caller.get(cur)
        y2026 = by_school_year.get((school, 2026))
        y2026_d = y2026.dump(league_all, min_drives=1) if y2026 and y2026.n else None
        same_as_2025 = cur == (row.get('play_caller_2025') or '').strip()
        current.append({
            'school': school,
            'conference': row.get('conference_2026'),
            'caller': cur,
            'status': row.get('current_status'),
            'sameAs2025': same_as_2025,
            'caller2025': (row.get('play_caller_2025') or '').strip(),
            'history': hist,
            'early2026': y2026_d,
        })

    def strong_fourth(r):
        short = r.get('fourthAndShortOwn') or {}
        go = r.get('goVsPunt') or {}
        model = r.get('model') or {}
        fourth_m = r.get('fourthModel') or {}
        reasons = []
        if short.get('n', 0) >= 15 and short.get('goRate', 0) >= 0.70 and short.get('z', 0) >= 3:
            reasons.append('short-own go')
        if go.get('n', 0) >= 40 and go.get('goRate', 0) >= 0.55 and go.get('z', 0) >= 4:
            reasons.append('overall go vs punt')
        if (model.get('puntResidual') is not None and model['puntResidual'] <= -0.08
                and r['nDrives'] >= 80):
            reasons.append('drive-start punt residual')
        if (fourth_m.get('puntResidual') is not None and fourth_m['puntResidual'] <= -0.10
                and fourth_m.get('n', 0) >= 40):
            reasons.append('4th-down snap punt residual')
        return reasons

    strong = []
    for r in caller_rows_out:
        reasons = strong_fourth(r)
        if reasons:
            strong.append({**r, 'why': reasons})

    # Model misfit 2025: highest logloss / largest punt residual among n>=80
    misfit = []
    for r in caller_rows_out:
        m = r.get('model')
        if not m or m.get('n', 0) < 80:
            continue
        misfit.append(r)
    misfit_ll = sorted(misfit, key=lambda r: r['model']['logloss'], reverse=True)
    misfit_punt = sorted(misfit, key=lambda r: r['model']['puntResidual'])

    payload = {
        'note': (
            'FBS-only, play-caller sheet joined to ESPN drives/snaps. '
            '4th-down decision uses play_type (punt vs go vs FG). '
            'Clean go-vs-punt drops FG attempts and last-2-min trailing plays. '
            '4th-and-short own = 4th & ≤2, ytg≥40. Model scored on 2025 only '
            '(drive-start trees + snap trees on 4th downs).'
        ),
        'coverage': {
            'mappedSchools': len(school_to_espn),
            'unmatched': unmatched,
            'nDrives': league_all['nDrives'] if league_all else 0,
            'nFourth': league_all.get('nFourth') if league_all else 0,
        },
        'league': {
            'all': league_all,
            '2024': league_2024,
            '2025': league_2025,
            '2026': league_2026,
        },
        'strongCallers': strong,
        'callers': caller_rows_out,
        'byYear': year_rows,
        'misfitLogloss2025': misfit_ll[:20],
        'misfitPuntResidual2025': misfit_punt[:15] + list(reversed(misfit_punt[-10:])),
        'current2026': current,
        'schoolToEspn': school_to_espn,
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2)
    print(f'wrote {OUT_JSON}', flush=True)
    print('league go-vs-punt', (league_all or {}).get('goVsPunt'), flush=True)
    print('league 4th&short own', (league_all or {}).get('fourthAndShortOwn'), flush=True)
    print('strong', [(s['caller'], s['why'], (s.get('fourthAndShortOwn') or {}).get('goRate')) for s in strong], flush=True)
    print('worst 2025 logloss', [(r['caller'], r['model']['logloss'], r['model']['puntResidual']) for r in misfit_ll[:8]], flush=True)
    print('most negative punt residual', [(r['caller'], r['model']['puntResidual'], r['model']['logloss']) for r in misfit_punt[:8]], flush=True)


if __name__ == '__main__':
    main()
