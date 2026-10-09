/**
 * Caesars v4 home payload → main-line games.
 * Competition tabs sit behind a bot check; the homepage feed includes
 * full-game moneyline, spread, and total for the marquee leagues.
 */

import { shouldSkipMarketName } from './extractMarkets.js';
import { marketKey, parsePeriod, parseStat, teamSubject, yesNoSubject } from './marketNormalize.js';
import { parseSignedAmerican } from './rawArbModel.js';
import { teamsMatch } from './teamMatch.js';

function stripPipes(value) {
  return String(value || '').replace(/\|/g, '').replace(/\s+/g, ' ').trim();
}

function americanOf(selection) {
  return parseSignedAmerican(selection?.price?.a ?? selection?.price?.american);
}

function sportFromCaesars(sportId, competitionName = '') {
  const comp = String(competitionName || '').toLowerCase();
  const sport = String(sportId || '').toLowerCase();
  if (sport === 'americanfootball') {
    if (/\bnfl\b/.test(comp)) return 'nfl';
    if (/\bcfl\b/.test(comp)) return 'cfl';
    if (/ncaa|college|ncaaf/.test(comp)) return 'cfb';
    return 'cfb';
  }
  if (sport === 'basketball') {
    if (/\bwnba\b/.test(comp)) return 'wnba';
    if (/\bnba\b/.test(comp)) return 'nba';
    if (/ncaa|ncaam|college/.test(comp)) return 'ncaab';
    return 'hoop';
  }
  if (sport === 'baseball') return /\bmlb\b/.test(comp) ? 'mlb' : 'base';
  if (sport === 'icehockey') return /\bnhl\b/.test(comp) ? 'nhl' : 'hockey';
  if (sport === 'football') return 'soccer';
  if (sport === 'tennis') return 'tennis';
  if (sport === 'ufcmma' || sport === 'mma') return 'mma';
  if (sport === 'boxing') return 'boxing';
  if (sport === 'cricket') return 'cricket';
  if (sport === 'rugbyleague' || sport === 'rugbyunion') return 'rugby';
  return null;
}

function splitName(name, teams) {
  const raw = stripPipes(name);
  if (/\s+at\s+/i.test(raw)) {
    const [away, home] = raw.split(/\s+at\s+/i);
    return { away: away.trim(), home: home.trim() };
  }
  if (Array.isArray(teams) && teams.length >= 2) {
    const a = stripPipes(teams[0]);
    const b = stripPipes(teams[1]);
    if (/\bvs\.?\b/i.test(raw)) return { home: a, away: b };
    return { away: a, home: b };
  }
  const vs = raw.split(/\s+vs\.?\s+/i);
  if (vs.length === 2) return { home: vs[0].trim(), away: vs[1].trim() };
  return { home: null, away: null };
}

function marketsOf(event) {
  const rows = [];
  for (const group of event?.keyMarketGroups || []) {
    for (const market of group?.markets || []) rows.push(market);
  }
  return rows;
}

function isFullGame(market) {
  const period = String(market?.metadata?.period || '');
  if (period && !/MATCH/i.test(period)) return false;
  const name = stripPipes(market?.displayName || market?.name);
  return !/^(1st|2nd|3rd|4th|first|second)\b/i.test(name);
}

function isThreeWay(market) {
  const sels = market?.selections || [];
  return sels.length > 2 || sels.some((sel) => /draw|tie/i.test(String(sel.type || sel.name || '')));
}

function quote(american, line, team) {
  if (american == null) return null;
  return { american, line: Number.isFinite(line) ? line : null, team: team || null };
}

function selectionByType(market, type) {
  return (market?.selections || []).find((sel) => String(sel.type || '').toLowerCase() === type && sel.active !== false);
}

function packEvent(event) {
  if (!event?.id || String(event.type || 'MATCH').toUpperCase() !== 'MATCH') return null;
  const markets = marketsOf(event).filter(isFullGame);
  const teams = splitName(event.name, event?.eventDisplay?.teams || event?.keyMarketGroups?.[0]?.teams);
  const sport = sportFromCaesars(event.sportId, event.competitionName);
  if (!sport || !teams.home || !teams.away) return null;

  const mlMarket = markets.find((market) => (
    /money/i.test(stripPipes(market.displayName || market.templateName || market.name))
    && !isThreeWay(market)
  ));
  const spread = markets.find((market) => (
    (market.type === 'two-way-handicap' || /spread|puck line|run line/i.test(stripPipes(market.displayName || '')))
    && !isThreeWay(market)
  ));
  const total = markets.find((market) => (
    (market.type === 'over-under' || /total/i.test(stripPipes(market.displayName || market.name || '')))
    && !isThreeWay(market)
  ));

  const line = Number(spread?.line);
  const totalLine = Number(total?.line);
  const mlAway = selectionByType(mlMarket, 'away');
  const mlHome = selectionByType(mlMarket, 'home');
  const spAway = selectionByType(spread, 'away');
  const spHome = selectionByType(spread, 'home');
  const over = selectionByType(total, 'over');
  const under = selectionByType(total, 'under');

  const moneyline = (mlAway || mlHome) ? {
    away: quote(americanOf(mlAway), null, teams.away),
    home: quote(americanOf(mlHome), null, teams.home),
  } : null;
  const spreadSides = (spAway || spHome) ? {
    away: quote(americanOf(spAway), Number.isFinite(line) ? -line : null, teams.away),
    home: quote(americanOf(spHome), Number.isFinite(line) ? line : null, teams.home),
  } : null;
  const totalSides = (over || under) ? {
    over: quote(americanOf(over), Number.isFinite(totalLine) ? totalLine : null, 'Over'),
    under: quote(americanOf(under), Number.isFinite(totalLine) ? totalLine : null, 'Under'),
  } : null;
  const hasPrice = [moneyline?.away, moneyline?.home, spreadSides?.away, spreadSides?.home, totalSides?.over, totalSides?.under]
    .some(Boolean);
  if (!hasPrice) return null;
  return {
    eventId: String(event.id),
    home: teams.home,
    away: teams.away,
    sport,
    league: event.competitionName || null,
    openDate: event.startTime || null,
    inPlay: Boolean(event.started),
    moneyline,
    spread: spreadSides,
    total: totalSides,
  };
}

function eventsIn(payload) {
  const events = [];
  for (const group of payload?.eventDisplayGroups || []) {
    for (const event of group?.events || []) events.push(event);
  }
  for (const comp of payload?.competitions || []) {
    for (const event of comp?.events || []) events.push(event);
  }
  if (payload?.event?.id) events.push(payload.event);
  if (payload?.id && payload?.keyMarketGroups) events.push(payload);
  return events;
}

export function extractCaesarsPayload(payload) {
  const seen = new Set();
  const games = [];
  for (const event of eventsIn(payload)) {
    if (!event?.id || seen.has(event.id)) continue;
    const game = packEvent(event);
    if (!game) continue;
    seen.add(event.id);
    games.push(game);
  }
  return games;
}

export function extractCaesarsHome(payload) {
  return extractCaesarsPayload(payload);
}

function caesarsMarkets(event) {
  const rows = [];
  for (const group of event?.keyMarketGroups || []) {
    for (const market of group?.markets || []) rows.push(market);
  }
  return rows;
}

function addCzSide(book, side, quote) {
  if (!quote || quote.american == null) return;
  const key = `${side}s`;
  if (!book[key]) book[key] = [];
  const line = Number.isFinite(quote.line) ? quote.line : null;
  if (book[key].some((row) => row.line === line && row.american === quote.american)) return;
  book[key].push({ ...quote, line });
  if (!book[side]) book[side] = { ...quote, line };
}

function selectionSide(selection, teams) {
  const name = stripPipes(selection?.name);
  if (teams.away && teamsMatch(name, teams.away)) return 'away';
  if (teams.home && teamsMatch(name, teams.home)) return 'home';
  const type = String(selection?.type || '').toLowerCase();
  if (type === 'away' || type === 'home') return type;
  return null;
}

/** Two-sided Caesars markets on one event, keyed like the other books. */
export function extractCaesarsContracts(event, teams = {}) {
  const byKey = new Map();
  const upsert = (key, label, kind, mutate) => {
    if (!byKey.has(key)) byKey.set(key, { key, label, kind, czr: {} });
    mutate(byKey.get(key).czr);
  };
  for (const market of caesarsMarkets(event)) {
    if (market?.active === false) continue;
    const title = stripPipes(market.displayName || market.name || market.templateName);
    const rawName = stripPipes(market.name);
    const template = stripPipes(market.templateName);
    const label = title || rawName || template;
    if (!label || shouldSkipMarketName(`${label} ${rawName} ${template}`)) continue;
    const sels = (market.selections || []).filter((sel) => sel && sel.active !== false && americanOf(sel) != null);
    if (sels.length !== 2) continue;
    if (isThreeWay(market)) continue;
    const period = parsePeriod(`${label} ${rawName} ${template}`);
    const stat = parseStat(`${label} ${rawName} ${template}`);
    const types = sels.map((sel) => String(sel.type || '').toLowerCase());
    if (types.includes('over') && types.includes('under')) {
      const line = Number(market.line);
      const player = stripPipes(market?.metadata?.player) || (rawName.includes(' - ') ? rawName.split(' - ')[0] : '');
      let kind = 'total';
      let subject = 'game';
      if (player && /yds|yards|reception|pass|rush|rec|attempt|completion|points|assists|rebounds|threes|shots|saves|goals/i.test(`${rawName} ${template}`)) {
        kind = 'player_ou';
        subject = player;
      } else if (market?.metadata?.teamName || /team total/i.test(`${label} ${template}`)) {
        kind = 'team_total';
        subject = teamSubject(market?.metadata?.teamName || rawName, teams) || stripPipes(market?.metadata?.teamName) || 'game';
      }
      const key = marketKey({ period, kind, stat, subject });
      upsert(key, label || rawName, kind, (book) => {
        for (const sel of sels) {
          const side = String(sel.type).toLowerCase() === 'under' ? 'under' : 'over';
          addCzSide(book, side, { american: americanOf(sel), line: Number.isFinite(line) ? line : null, label: side === 'under' ? 'Under' : 'Over' });
        }
      });
      continue;
    }
    if (types.includes('yes') && types.includes('no')) {
      const key = marketKey({ period, kind: 'yesno', stat, subject: yesNoSubject(title, teams) });
      upsert(key, label, 'yesno', (book) => {
        for (const sel of sels) {
          const side = String(sel.type).toLowerCase() === 'no' ? 'no' : 'yes';
          book[side] = { american: americanOf(sel), label: side === 'no' ? 'No' : 'Yes' };
        }
      });
      continue;
    }
    const awaySel = sels.find((sel) => selectionSide(sel, teams) === 'away');
    const homeSel = sels.find((sel) => selectionSide(sel, teams) === 'home');
    if (!awaySel || !homeSel) continue;
    const homeLine = Number(market.line);
    const isSpread = market.type === 'two-way-handicap' || /spread|puck line|run line|handicap/i.test(`${label} ${template}`);
    const key = marketKey({
      period,
      kind: isSpread ? 'spread' : 'moneyline',
      stat: isSpread ? 'points' : (stat === 'dnb' ? 'dnb' : 'winner'),
      subject: 'game',
    });
    upsert(key, label, isSpread ? 'spread' : 'moneyline', (book) => {
      const awayIsHomeSide = String(awaySel.type || '').toLowerCase() === 'home';
      const awayLine = !isSpread || !Number.isFinite(homeLine) ? null : (awayIsHomeSide ? homeLine : -homeLine);
      const homeIsHomeSide = String(homeSel.type || '').toLowerCase() === 'home';
      const homeLineSigned = !isSpread || !Number.isFinite(homeLine) ? null : (homeIsHomeSide ? homeLine : -homeLine);
      addCzSide(book, 'away', { american: americanOf(awaySel), line: awayLine, team: teams.away, label: teams.away });
      addCzSide(book, 'home', { american: americanOf(homeSel), line: homeLineSigned, team: teams.home, label: teams.home });
    });
  }
  return [...byKey.values()];
}
