/**
 * Canonical keys so FanDuel "1st Half Total" and DraftKings "Total 1st Half"
 * (and player O/U / team totals / yes-no) land on the same two-way.
 */

import { lastSignificantToken, teamsMatch } from './teamMatch.js';

export const MAIN_KEYS = new Set([
  'fg|moneyline|winner|game',
  'fg|spread|points|game',
  'fg|total|points|game',
]);

export function normalizePerson(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/['’`]/g, '')
    .replace(/[.]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function peopleMatch(a, b) {
  const na = normalizePerson(a);
  const nb = normalizePerson(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = na.split(' ').filter(Boolean);
  const pb = nb.split(' ').filter(Boolean);
  if (pa.length < 2 || pb.length < 2) return false;
  if (pa[pa.length - 1] !== pb[pb.length - 1]) return false;
  return pa[0][0] === pb[0][0];
}

export function subjectMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a === 'game' || b === 'game') return a === b;
  return teamsMatch(a, b) || peopleMatch(a, b);
}

export function parsePeriod(name) {
  const n = String(name ?? '').toLowerCase().replace(/-/g, ' ');
  if (/\b1st half\b|\b1h\b|\bfirst half\b/.test(n)) return '1h';
  if (/\b2nd half\b|\b2h\b|\bsecond half\b/.test(n)) return '2h';
  if (/\b1st (?:quarter|qtr)\b|\b1q\b|\bfirst quarter\b|\bq1\b/.test(n)) return '1q';
  if (/\b2nd (?:quarter|qtr)\b|\b2q\b|\bsecond quarter\b|\bq2\b/.test(n)) return '2q';
  if (/\b3rd (?:quarter|qtr)\b|\b3q\b|\bthird quarter\b|\bq3\b/.test(n)) return '3q';
  if (/\b4th (?:quarter|qtr)\b|\b4q\b|\bfourth quarter\b|\bq4\b/.test(n)) return '4q';
  return 'fg';
}

export function resolvePeriod(name, hint) {
  const fromName = parsePeriod(name);
  if (fromName !== 'fg') return fromName;
  return hint ? parsePeriod(hint) : 'fg';
}

export function resolveStat(name, hint) {
  const fromName = parseStat(name);
  if (fromName !== 'points') return fromName;
  return hint ? parseStat(hint) : 'points';
}

const STAT_RULES = [
  [/pass(?:ing)?\s*\+\s*rush(?:ing)?|pass(?:ing)?\s+and\s+rush/i, 'pass_rush_yds'],
  [/rush(?:ing)?\s*\+\s*rec(?:eiving)?|rush(?:ing)?\s+and\s+rec/i, 'rush_rec_yds'],
  [/pass(?:ing)?\s+(?:td|touchdowns?)/i, 'pass_td'],
  [/pass(?:ing)?\s+(?:yds?|yards?)/i, 'pass_yds'],
  [/pass(?:ing)?\s+attempts?/i, 'pass_att'],
  [/completions?/i, 'completions'],
  [/interceptions?/i, 'interceptions'],
  [/longest\s+completion|longest\s+pass/i, 'longest_pass'],
  [/rec(?:eiving)?\s+(?:yds?|yards?)/i, 'rec_yds'],
  [/receptions?/i, 'receptions'],
  [/longest\s+reception/i, 'longest_rec'],
  [/rush(?:ing)?\s+(?:yds?|yards?)/i, 'rush_yds'],
  [/rush(?:ing)?\s+attempts?/i, 'rush_att'],
  [/longest\s+rush/i, 'longest_rush'],
  [/field goals?\s+made|fg made|fg total/i, 'fg_made'],
  [/field goal\s+(?:yds?|yards?)|fg yards/i, 'fg_yds'],
  [/kicking\s+(?:pts?|points?)/i, 'kick_pts'],
  [/extra points?|pat made/i, 'pat_made'],
  [/punt total|punts?\b/i, 'punts'],
  [/tackles?\s*\+\s*assists?|tackles?\s+and\s+assists?/i, 'tackles_ast'],
  [/\bsacks?\b/i, 'sacks'],
  [/\btackles?\b/i, 'tackles'],
  [/fantasy/i, 'fantasy_pts'],
  [/total touchdowns|touchdowns scored|\btd props\b|touchdown props|\btotal tds\b/i, 'tds'],
  [/anytime\s+(?:td|touchdown)|to score a touchdown/i, 'anytime_td'],
  [/overtime|will there be overtime/i, 'overtime'],
  [/odd\s*\/\s*even|odd\/even/i, 'odd_even'],
  [/both teams to score\s*(\d+)\+/i, 'btts'],
  [/race to\s*(\d+)/i, 'race'],
  [/team to score first|1st score|first score/i, 'first_score'],
  [/team to score last|last score/i, 'last_score'],
  [/highest scoring half/i, 'highest_half'],
];

export function parseStat(name) {
  const raw = String(name ?? '');
  const btts = raw.match(/both teams to score\s*(\d+)\+/i);
  if (btts) return `btts_${btts[1]}`;
  const race = raw.match(/race to\s*(\d+)/i);
  if (race) return `race_${race[1]}`;
  for (const [re, stat] of STAT_RULES) {
    if (re.test(raw)) return stat;
  }
  if (/\btotal points\b|\btotal\b|\bo\/u\b/i.test(raw)) return 'points';
  if (/\bspread\b|\bhandicap\b|\bwinner\b|\bmoneyline\b/i.test(raw)) return 'points';
  return 'points';
}

export function parseKind(name, runnerHints = {}) {
  const n = String(name ?? '').toLowerCase();
  if (runnerHints.yesno || /\bovertime\b|both teams to score|will there be/.test(n)) return 'yesno';
  if (runnerHints.oddeven || /odd\s*\/\s*even|odd\/even/.test(n)) return 'yesno';
  if (runnerHints.overunder || /\btotal\b|\bo\/u\b|over\/under/.test(n)) {
    if (isPlayerMarket(n) || runnerHints.player) return 'player_ou';
    if (isTeamTotalName(n) || runnerHints.team) return 'team_total';
    return 'total';
  }
  if (/\bspread\b|\bhandicap\b|alternate spread/.test(n)) return 'spread';
  if (/\bmoneyline\b|\bwinner\b|\bto win\b/.test(n) && !/margin/.test(n)) return 'moneyline';
  if (/\brace to\b|team to score|highest scoring/.test(n)) return 'moneyline';
  return runnerHints.kind || null;
}

export function isPlayerMarket(name) {
  const n = String(name ?? '');
  if (/\b(colts|commanders|bills|packers|chiefs|eagles|cowboys|steelers|ravens|bengals|browns|titans|jaguars|texans|colts|dolphins|jets|patriots|raiders|chargers|rams|49ers|seahawks|cardinals|falcons|panthers|saints|buccaneers|bears|lions|vikings|giants)\b/i.test(n)
    && !/\b(passing|rushing|receiving|receptions|rush|pass)\b/i.test(n)) {
    return false;
  }
  return / - |\bover\b|\bunder\b/.test(n) && /yds|yards|receptions|pass|rush|rec|td|sack|tackle|fg |field goal|kicking|punt|fantasy|attempts|completions/i.test(n);
}

function isTeamTotalName(name) {
  return /team total|total points\s*-|total touchdowns\s*-/i.test(name);
}

export function marketKey({ period, kind, stat, subject }) {
  return `${period || 'fg'}|${kind}|${stat || 'points'}|${subject || 'game'}`;
}

export function parseMarketKey(key) {
  const [period, kind, stat, ...rest] = String(key).split('|');
  return { period, kind, stat, subject: rest.join('|') };
}

export function formatPeriod(period) {
  return {
    fg: '',
    '1h': '1H ',
    '2h': '2H ',
    '1q': '1Q ',
    '2q': '2Q ',
    '3q': '3Q ',
    '4q': '4Q ',
  }[period] || '';
}

export function formatStat(stat) {
  if (!stat || stat === 'points') return '';
  if (stat.startsWith('btts_')) return `Both teams ${stat.slice(5)}+`;
  if (stat.startsWith('race_')) return `Race to ${stat.slice(5)}`;
  const labels = {
    pass_yds: 'Pass yds',
    pass_td: 'Pass TDs',
    pass_att: 'Pass att',
    completions: 'Completions',
    interceptions: 'INTs',
    longest_pass: 'Longest pass',
    rec_yds: 'Rec yds',
    receptions: 'Receptions',
    longest_rec: 'Longest rec',
    rush_yds: 'Rush yds',
    rush_att: 'Rush att',
    longest_rush: 'Longest rush',
    rush_rec_yds: 'Rush+rec yds',
    pass_rush_yds: 'Pass+rush yds',
    fg_made: 'FGs',
    fg_yds: 'FG yds',
    kick_pts: 'Kicking pts',
    pat_made: 'PATs',
    punts: 'Punts',
    sacks: 'Sacks',
    tackles: 'Tackles',
    tackles_ast: 'Tackles+ast',
    fantasy_pts: 'Fantasy',
    tds: 'TDs',
    anytime_td: 'Anytime TD',
    overtime: 'Overtime',
    odd_even: 'Odd/Even',
    first_score: 'First score',
    last_score: 'Last score',
    highest_half: 'Highest half',
    winner: 'ML',
  };
  return labels[stat] || stat;
}

export function formatMarketLabel(key, fallback) {
  const { period, kind, stat, subject } = parseMarketKey(key);
  const p = formatPeriod(period);
  if (kind === 'moneyline' && subject === 'game' && (stat === 'points' || stat === 'winner')) {
    return `${p}ML`.trim();
  }
  if (kind === 'spread' && subject === 'game') return `${p}Spread`.trim();
  if (kind === 'total' && subject === 'game' && stat === 'points') return `${p}O/U`.trim();
  if (kind === 'team_total') {
    return `${p}${subject} ${formatStat(stat) || 'total'}`.replace(/\s+/g, ' ').trim();
  }
  if (kind === 'player_ou') {
    return `${p}${subject} ${formatStat(stat) || 'O/U'}`.replace(/\s+/g, ' ').trim();
  }
  if (kind === 'yesno') {
    return `${p}${formatStat(stat) || fallback || 'Yes/No'}`.trim();
  }
  if (subject && subject !== 'game') {
    return `${p}${subject} ${formatStat(stat)}`.replace(/\s+/g, ' ').trim();
  }
  return `${p}${fallback || formatStat(stat) || kind}`.trim();
}

export function displaySubject(subject, teams = {}) {
  if (!subject || subject === 'game') return 'game';
  if (teams.away && teamsMatch(subject, teams.away)) return teams.away;
  if (teams.home && teamsMatch(subject, teams.home)) return teams.home;
  return subject;
}

export function teamSubject(name, teams = {}) {
  if (!name) return null;
  if (teams.away && teamsMatch(name, teams.away)) return teams.away;
  if (teams.home && teamsMatch(name, teams.home)) return teams.home;
  return null;
}

export function lastTokenTeam(name) {
  return lastSignificantToken(name);
}
