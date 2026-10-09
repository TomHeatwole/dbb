/**
 * BetMGM (CDS) fixture → the same main-line shape FanDuel/DraftKings use.
 * Full-game moneyline, spread, and total only. Three-way match results are dropped.
 */

import { shouldSkipMarketName } from './extractMarkets.js';
import {
  marketKey,
  parsePeriod,
  parseStat,
  teamSubject,
  yesNoSubject,
} from './marketNormalize.js';
import { parseSignedAmerican } from './rawArbModel.js';
import { teamsMatch } from './teamMatch.js';

const ML_NAMES = new Set([
  'moneyline', 'money line', 'draw no bet', '2-way moneyline', '2 way moneyline', 'moneyline (2-way)',
  'match winner', 'fight result: 2-way',
]);
const SPREAD_NAMES = new Set([
  'spread', 'point spread', 'puck line', 'run line', 'game spread', 'handicap', 'asian handicap',
]);
const TOTAL_NAMES = new Set([
  'totals', 'total', 'total points', 'total goals', 'total runs', 'total games',
]);

const SPORT_BY_ID = {
  4: 'soccer',
  5: 'tennis',
  22: 'cricket',
  24: 'boxing',
  29: 'rugby',
  32: 'rugby',
  45: 'mma',
};

function labelOf(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  return String(node.value || node.short || '');
}

function marketTitle(market) {
  return labelOf(market?.name).trim();
}

function isPeriodMarket(name) {
  return /^(1st|2nd|3rd|4th|first|second|third|fourth)\b/i.test(name)
    || /\b(half|quarter|period|inning)\b/i.test(name);
}

function optionRows(market) {
  const raw = market?.options || market?.results || [];
  return raw.map((row) => ({
    name: labelOf(row?.name).trim(),
    american: parseSignedAmerican(row?.price?.americanOdds ?? row?.americanOdds),
    attr: row?.attr ?? null,
    totalsPrefix: row?.totalsPrefix ?? null,
    status: row?.status || row?.visibility || 'Visible',
  })).filter((row) => row.american != null && !/suspend|hidden/i.test(String(row.status)));
}

function signedLine(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function lineFromName(name) {
  const hit = String(name || '').match(/[+-]?\d+(?:\.\d+)?/);
  return hit ? Number(hit[0]) : null;
}

function pickMarket(markets, names) {
  const hits = (markets || []).filter((market) => {
    const title = marketTitle(market).toLowerCase();
    return names.has(title) && !isPeriodMarket(marketTitle(market));
  });
  hits.sort((a, b) => {
    const main = Number(Boolean(b.isMain)) - Number(Boolean(a.isMain));
    if (main) return main;
    const as = Math.abs(Number(a.spread) || 0);
    const bs = Math.abs(Number(b.spread) || 0);
    return as - bs;
  });
  return hits[0] || null;
}

function teamParticipants(fixture) {
  return (fixture?.participants || []).filter((row) => (row?.properties?.type || '') !== 'Player');
}

function splitTeams(name, participants) {
  const raw = String(name || '').trim();
  if (/\s+at\s+/i.test(raw) || /\s+@\s+/.test(raw)) {
    const [away, home] = raw.split(/\s+(?:at|@)\s+/i);
    return { away: away?.trim() || null, home: home?.trim() || null };
  }
  const dash = raw.split(/\s+[-–]\s+|\s+vs\.?\s+/i);
  if (dash.length === 2) {
    return { home: dash[0].trim(), away: dash[1].trim() };
  }
  const teams = teamParticipants(participants ? { participants } : null);
  if (teams.length >= 2) {
    return {
      home: labelOf(teams[0].name) || null,
      away: labelOf(teams[1].name) || null,
    };
  }
  return { home: null, away: null };
}

export function sportFromMgm(sportId, competitionName = '') {
  const comp = String(competitionName || '').toLowerCase();
  const id = Number(sportId);
  if (id === 11) {
    if (/\bnfl\b|super bowl/.test(comp)) return 'nfl';
    if (/\bcfl\b/.test(comp)) return 'cfl';
    return 'cfb';
  }
  if (id === 7) {
    if (/\bwnba\b/.test(comp)) return 'wnba';
    if (/\bnba\b/.test(comp)) return 'nba';
    if (/ncaa|college/.test(comp)) return 'ncaab';
    return 'hoop';
  }
  if (id === 23) return /\bmlb\b/.test(comp) ? 'mlb' : 'base';
  if (id === 12) return /\bnhl\b/.test(comp) ? 'nhl' : 'hockey';
  return SPORT_BY_ID[id] || null;
}

function quote(american, line, team) {
  if (american == null) return null;
  return {
    american,
    line: Number.isFinite(line) ? line : null,
    team: team || null,
  };
}

function sidesFromMarket(market, teams, kind) {
  const rows = optionRows(market);
  if (rows.length < 2) return null;
  if (kind === 'total') {
    const over = rows.find((row) => /^over\b/i.test(row.name) || row.totalsPrefix === 'Over');
    const under = rows.find((row) => /^under\b/i.test(row.name) || row.totalsPrefix === 'Under');
    if (!over || !under) return null;
    const line = signedLine(over.attr) ?? lineFromName(over.name);
    return {
      over: quote(over.american, line, 'Over'),
      under: quote(under.american, signedLine(under.attr) ?? lineFromName(under.name) ?? line, 'Under'),
    };
  }
  if (rows.some((row) => /^(tie|draw)$/i.test(row.name))) return null;
  const findSide = (team) => rows.find((row) => {
    const name = row.name.replace(/\s+[+-]?\d+(?:\.\d+)?$/, '').trim();
    return name.toLowerCase() === String(team || '').toLowerCase()
      || row.name.toLowerCase().startsWith(String(team || '').toLowerCase());
  });
  const away = findSide(teams.away);
  const home = findSide(teams.home);
  if (!away || !home || away === home) return null;
  const awayLine = signedLine(away.attr) ?? lineFromName(away.name);
  const homeLine = signedLine(home.attr) ?? lineFromName(home.name);
  return {
    away: quote(away.american, kind === 'spread' ? awayLine : null, teams.away),
    home: quote(home.american, kind === 'spread' ? homeLine : null, teams.home),
  };
}

function marketsOf(fixture) {
  const optionMarkets = fixture?.optionMarkets || [];
  if (optionMarkets.length) return optionMarkets;
  return fixture?.games || [];
}

export function extractMgmFixture(fixture) {
  const name = labelOf(fixture?.name);
  if (!name || /futures|outright|specials|awards/i.test(name)) return null;
  const competition = labelOf(fixture?.competition?.name);
  const sport = sportFromMgm(fixture?.sport?.id, competition);
  if (!sport) return null;
  const teams = splitTeams(name, fixture?.participants);
  if (!teams.home || !teams.away) return null;
  const markets = marketsOf(fixture);
  const moneyline = sidesFromMarket(pickMarket(markets, ML_NAMES), teams, 'moneyline');
  const spread = sidesFromMarket(pickMarket(markets, SPREAD_NAMES), teams, 'spread');
  const total = sidesFromMarket(pickMarket(markets, TOTAL_NAMES), teams, 'total');
  const hasPrice = [moneyline?.away, moneyline?.home, spread?.away, spread?.home, total?.over, total?.under]
    .some(Boolean);
  if (!hasPrice) return null;
  return {
    eventId: String(fixture.id),
    home: teams.home,
    away: teams.away,
    sport,
    league: competition || null,
    openDate: fixture.startDate || fixture.cutOffDate || null,
    inPlay: String(fixture.stage || '').toLowerCase() === 'live',
    moneyline,
    spread,
    total,
  };
}

export function extractMgmFixtures(payload) {
  return (payload?.fixtures || []).map(extractMgmFixture).filter(Boolean);
}

function optionType(row) {
  const types = row?.parameters?.optionTypes;
  if (Array.isArray(types) && types[0]) return String(types[0]).toLowerCase();
  const prefix = String(row?.totalsPrefix || '').toLowerCase();
  if (prefix) return prefix;
  const name = labelOf(row?.name).trim().toLowerCase();
  if (/^over\b/.test(name)) return 'over';
  if (/^under\b/.test(name)) return 'under';
  if (/^yes\b/.test(name)) return 'yes';
  if (/^no\b/.test(name)) return 'no';
  return '';
}

function deepRows(market) {
  return (market?.options || market?.results || []).map((row) => ({
    name: labelOf(row?.name).trim(),
    american: parseSignedAmerican(row?.price?.americanOdds ?? row?.americanOdds),
    type: optionType(row),
    line: signedLine(row?.attr) ?? lineFromName(labelOf(row?.name)),
    status: row?.status || row?.visibility || 'Visible',
  })).filter((row) => row.american != null && !/suspend|hidden/i.test(String(row.status)));
}

function addDeepSide(book, side, quote) {
  if (!quote || quote.american == null) return;
  const key = `${side}s`;
  if (!book[key]) book[key] = [];
  const line = Number.isFinite(quote.line) ? quote.line : null;
  if (book[key].some((row) => row.line === line && row.american === quote.american)) return;
  book[key].push({ ...quote, line });
  if (!book[side]) book[side] = { ...quote, line };
}

function sideForTeam(name, teams) {
  const bare = String(name || '').replace(/\s+[+-]?\d+(?:\.\d+)?$/, '').trim();
  if (teams.away && teamsMatch(bare, teams.away)) return 'away';
  if (teams.home && teamsMatch(bare, teams.home)) return 'home';
  return null;
}

/**
 * Two-sided markets from a fixture-view payload, keyed like FanDuel/DraftKings.
 * One-sided milestones and parlays are left out.
 */
export function extractMgmContracts(fixture, teams = {}) {
  const byKey = new Map();
  const upsert = (key, label, kind, mutate) => {
    if (!byKey.has(key)) byKey.set(key, { key, label, kind, mgm: {} });
    mutate(byKey.get(key).mgm);
  };
  for (const market of marketsOf(fixture)) {
    const title = marketTitle(market);
    if (!title || shouldSkipMarketName(title)) continue;
    if (/\s(?:&|and)\s/i.test(title)) continue;
    const rows = deepRows(market);
    if (rows.length !== 2) continue;
    if (rows.some((row) => /^(tie|draw)$/i.test(row.name))) continue;
    const period = parsePeriod(title);
    const stat = parseStat(title);
    const overs = rows.filter((row) => row.type === 'over');
    const unders = rows.filter((row) => row.type === 'under');
    if (overs.length && unders.length) {
      let kind = 'total';
      let subject = 'game';
      const player = title.split(/\s+-\s+/)[0]?.trim();
      if (player && player !== title && !/team total/i.test(title) && !/^total\b/i.test(player) && /yds|yards|reception|pass|rush|rec|td|sack|tackle|attempt|completion|points|assists|rebounds|threes|shots|saves|goals|hits|strikeouts|aces|walks|outs|doubles|triples|singles|home runs|stolen|rbi|earned|\bruns\b/i.test(title)) {
        kind = 'player_ou';
        subject = player;
      } else if (/:\s*/.test(title) || /team total|points scored/i.test(title)) {
        kind = 'team_total';
        const teamBit = title.split(':')[0].trim();
        subject = teamSubject(teamBit, teams) || teamBit;
      }
      const useStat = (kind === 'total' || kind === 'team_total') && stat === 'player_pts' ? 'points' : stat;
      const key = marketKey({ period, kind, stat: useStat, subject });
      upsert(key, title, kind, (book) => {
        for (const row of overs) addDeepSide(book, 'over', { american: row.american, line: row.line, label: 'Over' });
        for (const row of unders) addDeepSide(book, 'under', { american: row.american, line: row.line, label: 'Under' });
      });
      continue;
    }
    const yes = rows.find((row) => row.type === 'yes');
    const no = rows.find((row) => row.type === 'no');
    if (yes && no) {
      const key = marketKey({ period, kind: 'yesno', stat, subject: yesNoSubject(title, teams) });
      upsert(key, title, 'yesno', (book) => {
        book.yes = { american: yes.american, label: 'Yes' };
        book.no = { american: no.american, label: 'No' };
      });
      continue;
    }
    const away = rows.find((row) => sideForTeam(row.name, teams) === 'away');
    const home = rows.find((row) => sideForTeam(row.name, teams) === 'home');
    if (!away || !home || away === home) continue;
    const kind = [away, home].some((row) => Number.isFinite(row.line)) && /spread|handicap|puck|run line/i.test(title)
      ? 'spread'
      : 'moneyline';
    if (kind === 'moneyline' && /spread|handicap/i.test(title)) continue;
    const key = marketKey({
      period,
      kind,
      stat: kind === 'spread' ? 'points' : (stat.startsWith('race') || stat === 'dnb' ? stat : 'winner'),
      subject: 'game',
    });
    upsert(key, title, kind, (book) => {
      addDeepSide(book, 'away', {
        american: away.american,
        line: kind === 'spread' ? away.line : null,
        team: teams.away,
        label: teams.away,
      });
      addDeepSide(book, 'home', {
        american: home.american,
        line: kind === 'spread' ? home.line : null,
        team: teams.home,
        label: teams.home,
      });
    });
  }
  return [...byKey.values()];
}
