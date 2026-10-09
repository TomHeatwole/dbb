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
  if (/\bfirst 5 innings\b|\b1st 5 innings\b|\bf5\b/.test(n)) return 'f5';
  if (/\bfirst 3 innings\b|\b1st 3 innings\b/.test(n)) return 'f3';
  if (/\bfirst 7 innings\b|\b1st 7 innings\b/.test(n)) return 'f7';
  const inningNo = n.match(/\b(\d+)(?:st|nd|rd|th)\s+inning\b/);
  if (inningNo) {
    const inning = Number(inningNo[1]);
    if (inning >= 1 && inning <= 9) return `${inning}i`;
  }
  const inningWord = n.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\s+inning\b/);
  if (inningWord) {
    const nIn = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9 }[inningWord[1]];
    return `${nIn}i`;
  }
  if (/\b1st period\b|\bfirst period\b|\bp1\b/.test(n)) return '1p';
  if (/\b2nd period\b|\bsecond period\b|\bp2\b/.test(n)) return '2p';
  if (/\b3rd period\b|\bthird period\b|\bp3\b/.test(n)) return '3p';
  if (
    /\b60\s*min(?:ute)?s?\b/.test(n)
    || /\bregulation\b/.test(n)
    || /\bexcl(?:uding|\.)?\s*ot\b/.test(n)
    || /\bexclud(?:es|ing)\s+overtime\b/.test(n)
  ) return 'reg';
  if (/\b1st set\b|\bfirst set\b|\bset 1\b/.test(n)) return '1s';
  if (/\b2nd set\b|\bsecond set\b|\bset 2\b/.test(n)) return '2s';
  if (/\b3rd set\b|\bthird set\b|\bset 3\b/.test(n)) return '3s';
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
  [/receptions?\s+(?:yds?|yards?)/i, 'rec_yds'],
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
  [/rush(?:ing)?\s+(?:td|touchdowns?)/i, 'rush_td'],
  [/rec(?:eiving)?\s+(?:td|touchdowns?)/i, 'rec_td'],
  [/total touchdowns|touchdowns scored|\btd props\b|touchdown props|\btotal tds\b/i, 'tds'],
  [/anytime\s+(?:td|touchdown)|to score a touchdown/i, 'anytime_td'],
  [/overtime|will there be overtime/i, 'overtime'],
  [/odd\s*\/\s*even|odd\/even/i, 'odd_even'],
  [/both teams to score\s*(\d+)\+/i, 'btts'],
  [/race to\s*(\d+)/i, 'race'],
  [/team to score first|1st score|first score/i, 'first_score'],
  [/team to score last|last score/i, 'last_score'],
  [/highest scoring half/i, 'highest_half'],
  // "1st half TDs" has no word "total", so it used to fall through and merge into the points O/U.
  [/\btd(?:s)?\b|\btouchdowns?\b/i, 'tds'],
  [/shots on (?:goal|target)|\bsog\b|\bsot\b/i, 'shots'],
  [/anytime goal|goal ?scorer|to score a goal|(?<!on )\bgoals?\b/i, 'goals'],
  [/player points|skater points|puck points|(?:^|[\s:-])points(?:\s|$)/i, 'player_pts'],
  [/pts?\s*\+\s*reb(?:ounds?)?\s*\+\s*ast(?:ists?)?|\bpra\b/i, 'pra'],
  [/pts?\s*\+\s*reb(?:ounds?)?/i, 'pts_reb'],
  [/pts?\s*\+\s*ast(?:ists?)?/i, 'pts_ast'],
  [/reb(?:ounds?)?\s*\+\s*ast(?:ists?)?/i, 'reb_ast'],
  [/double.?double/i, 'double_double'],
  [/three.?pointers?|\bthrees\b|3pt/i, 'threes'],
  [/assists?/i, 'assists'],
  [/rebounds?/i, 'rebounds'],
  [/steals?/i, 'steals'],
  [/blocks?/i, 'blocks'],
  [/shots on target|\bsot\b/i, 'sot'],
  [/\bshots\b/i, 'shots'],
  [/saves/i, 'saves'],
  [/strikeouts?|\bks\b/i, 'strikeouts'],
  [/earned runs/i, 'earned_runs'],
  [/hits?\s*\+\s*runs?\s*\+\s*rbis?/i, 'hrr'],
  [/runs?\s*\+\s*rbis?/i, 'runs_rbis'],
  [/\bruns\b/i, 'runs'],
  [/home runs?/i, 'home_runs'],
  [/stolen bases/i, 'stolen_bases'],
  [/\brbis?\b/i, 'rbis'],
  [/walks/i, 'walks'],
  [/\bouts\b/i, 'outs'],
  [/doubles/i, 'doubles'],
  [/triples/i, 'triples'],
  [/singles/i, 'singles'],
  [/hits?\b/i, 'hits'],
  [/total bases/i, 'total_bases'],
  [/\baces\b/i, 'aces'],
  [/corners/i, 'corners'],
  [/cards|bookings/i, 'cards'],
  [/significant strikes/i, 'sig_strikes'],
  [/takedowns/i, 'takedowns'],
];

export function parseStat(name) {
  const raw = String(name ?? '');
  if (/\b(?:total points|total goals|total runs|total games|total sets|total rounds)\b/i.test(raw)
    && !/pass|rush|rec|yards|assists|rebounds|threes|strikeouts|aces|shots|saves|player/i.test(raw)) {
    return 'points';
  }
  const btts = raw.match(/both teams to score\s*(\d+)\+/i);
  if (btts) return `btts_${btts[1]}`;
  if (/both teams to score/i.test(raw) && !/[&/]/.test(raw)) return 'btts';
  if (/draw no bet/i.test(raw)) return 'dnb';
  const race = raw.match(/race to\s*(\d+)/i);
  if (race) return `race_${race[1]}`;
  for (const [re, stat] of STAT_RULES) {
    if (re.test(raw)) return stat;
  }
  if (/\bspread\b|\bhandicap\b|\bpuck line\b|\brun line\b|\bwinner\b|\bmoneyline\b/i.test(raw)) {
    return 'points';
  }
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
  if (/\bspread\b|\bhandicap\b|alternate spread|puck line|run line|point spread|game spread/.test(n)) {
    return 'spread';
  }
  if (/\bmoneyline\b|\bwinner\b|\bto win\b|draw no bet/.test(n) && !/margin|3[\s-]?way/.test(n)) {
    return 'moneyline';
  }
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

/** Yes/no markets name the team in the title. Leaving the subject as "game" merges different questions. */
export function yesNoSubject(name, teams = {}) {
  const head = String(name ?? '')
    .split(/\s+-\s+/)[0]
    .replace(/\bhome runs?\b|\bruns? scored\b|\bto score\b.*$/i, '')
    .trim();
  return teamSubject(head, teams) || teamSubject(name, teams) || 'game';
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
    f3: 'F3 ',
    f5: 'F5 ',
    f7: 'F7 ',
    '1i': '1I ',
    '2i': '2I ',
    '3i': '3I ',
    '4i': '4I ',
    '5i': '5I ',
    '6i': '6I ',
    '7i': '7I ',
    '8i': '8I ',
    '9i': '9I ',
    '1p': '1P ',
    '2p': '2P ',
    '3p': '3P ',
    reg: '60m ',
    '1s': '1S ',
    '2s': '2S ',
    '3s': '3S ',
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
    rush_td: 'Rush TDs',
    rec_td: 'Rec TDs',
    anytime_td: 'Anytime TD',
    overtime: 'Overtime',
    odd_even: 'Odd/Even',
    first_score: 'First score',
    last_score: 'Last score',
    highest_half: 'Highest half',
    winner: 'ML',
    btts: 'Both teams to score',
    dnb: 'Draw no bet',
    pra: 'Pts+reb+ast',
    pts_reb: 'Pts+reb',
    pts_ast: 'Pts+ast',
    reb_ast: 'Reb+ast',
    double_double: 'Double-double',
    threes: 'Threes',
    assists: 'Assists',
    rebounds: 'Rebounds',
    steals: 'Steals',
    blocks: 'Blocks',
    sot: 'SOT',
    shots: 'Shots',
    saves: 'Saves',
    strikeouts: 'Ks',
    hits: 'Hits',
    home_runs: 'Home runs',
    doubles: 'Doubles',
    triples: 'Triples',
    singles: 'Singles',
    walks: 'Walks',
    outs: 'Outs',
    rbis: 'RBIs',
    stolen_bases: 'SB',
    earned_runs: 'Earned runs',
    runs: 'Runs',
    hrr: 'H+R+RBI',
    runs_rbis: 'R+RBI',
    total_bases: 'Total bases',
    aces: 'Aces',
    corners: 'Corners',
    cards: 'Cards',
    sig_strikes: 'Sig strikes',
    takedowns: 'Takedowns',
    goals: 'Goals',
    player_pts: 'Points',
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
  if (kind === 'total' && subject === 'game') {
    return `${p}${formatStat(stat) || 'O/U'}`.replace(/\s+/g, ' ').trim();
  }
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
