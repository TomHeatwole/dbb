/**
 * Turn FanDuel / DraftKings raw markets into canonical two-way contracts.
 */

import { parseSignedAmerican } from './rawArbModel.js';
import {
  marketKey,
  parseKind,
  peopleMatch,
  resolvePeriod,
  resolveStat,
  teamSubject,
  yesNoSubject,
} from './marketNormalize.js';
import { isNonMatchWinnerMarket, isThreeWayMoneyline, isTwoWayWinnerName } from './sportCatalog.js';
import { isBareTeamName, lastSignificantToken, teamsMatch } from './teamMatch.js';
import {
  driveResultSubject,
  isDriveResultMarket,
  quotesToDriveOutcomes,
} from './driveResultBuckets.js';

function isThreeWayQuotes(name, runnerNames) {
  return isThreeWayMoneyline(name, runnerNames);
}

const THREE_WAY_TITLE = /3[\s-]?way|\b1x2\b|match result|\bwinner\b|moneyline|\bresult\b|\bto win\b/i;
const THREE_WAY_NOISE = /correct score|winning margin|double chance|both teams|half-time|full-time|ht\/ft|score method|exact score|to score|scorer|\bmargin\b|bands|either half|both halves|double winner|\bwdw\b|no draw|spread|handicap|\basian\b|early payout|2[\s-]?up|result after|after \d{1,2}:\d{2}|up to \d+(?:st|nd|rd|th)?\s*(?:minute|min\b)|(?:&|\/)| and /i;

export function isDrawQuote(quote) {
  const label = String(quote?.label || quote?.name || '').trim();
  const outcome = String(quote?.outcome || quote?.type || '').toLowerCase();
  return /^(?:the\s+)?(?:draw|tie|x)$/i.test(label) || outcome === 'tie' || outcome === 'draw' || outcome === 'x';
}

export function isPlainThreeWayTitle(name) {
  const title = String(name || '');
  if (!title || isTwoWayWinnerName(title)) return false;
  if (THREE_WAY_NOISE.test(title)) return false;
  return THREE_WAY_TITLE.test(title);
}

/** Prefer full-match and half results over interval “result after …” on the same key. */
export function threeMlTitleRank(name) {
  const n = String(name || '').trim().toLowerCase();
  if (n === 'match result') return 100;
  if (/^\d+(?:st|nd|rd|th)\s+half\s+result$/.test(n)) return 90;
  if (/^2nd half result$/.test(n)) return 90;
  if (/^1st half result$/.test(n)) return 90;
  if (/result after|after \d{1,2}:\d{2}/.test(n)) return 0;
  return 50;
}

/**
 * A regulation result is two teams plus a draw. Store the team prices only.
 * Returns true when this market was a plain 3-way and should not be paired as a 2-way.
 */
export function storePlainThreeWay(upsert, name, period, quotes, teams, sideOf) {
  if (!isPlainThreeWayTitle(name)) return false;
  if (period === 'fg' && /inning/i.test(name)) return false;
  const list = (quotes || []).filter((q) => q && q.american != null);
  if (list.some((q) => /\(\s*[+-]?\d/.test(String(q.label || q.name || '')))) return false;
  if (list.some((q) => Number.isFinite(q.line) && Math.abs(Number(q.line)) > 0)) return false;
  if (list.length !== 3) return false;
  if (list.some((q) => /[&/]/.test(String(q.label || q.name || '')))) return false;
  if (list.filter((q) => isDrawQuote(q)).length !== 1) return false;
  const away = list.find((q) => !isDrawQuote(q) && sideOf(q) === 'away');
  const home = list.find((q) => !isDrawQuote(q) && sideOf(q) === 'home');
  const draw = list.find((q) => isDrawQuote(q));
  if (!away || !home) return false;
  if (list.some((q) => q !== away && q !== home && q !== draw && !isDrawQuote(q))) return false;
  const key = marketKey({ period, kind: 'three_ml', stat: 'winner', subject: 'game' });
  const rank = threeMlTitleRank(name);
  upsert(key, name, 'three_ml', (book, row) => {
    const prevRank = row?._threeMlRank ?? -1;
    if (book.away && rank <= prevRank) return;
    if (row) {
      row._threeMlRank = rank;
      row.label = name;
    }
    book.away = {
      american: away.american,
      line: null,
      team: teams.away || away.label || away.name,
      label: away.label || away.name || teams.away,
    };
    book.home = {
      american: home.american,
      line: null,
      team: teams.home || home.label || home.name,
      label: home.label || home.name || teams.home,
    };
    if (draw) {
      book.draw = {
        american: draw.american,
        line: null,
        label: draw.label || draw.name || 'Draw',
      };
    }
  });
  return true;
}

function storeDriveResultMultiway(upsert, name, period, quotes, teams) {
  if (!isDriveResultMarket(name)) return false;
  const outcomes = quotesToDriveOutcomes(quotes);
  if (Object.keys(outcomes).length < 3) return false;
  const subject = driveResultSubject(name, teams);
  const key = marketKey({ period, kind: 'multiway', stat: 'drive_result', subject });
  upsert(key, name, 'multiway', (book) => {
    for (const [outKey, val] of Object.entries(outcomes)) {
      if (!val?.american) continue;
      book[outKey] = { american: val.american, label: val.label || outKey };
    }
  });
  return true;
}

function nameMentionsTeam(name, teams = {}) {
  if (!name) return false;
  if (teams.away && teamsMatch(name, teams.away)) return true;
  if (teams.home && teamsMatch(name, teams.home)) return true;
  const n = String(name).toLowerCase();
  return [teams.away, teams.home].filter(Boolean).some((team) => {
    const full = String(team).toLowerCase();
    const token = lastSignificantToken(team);
    return (full && n.includes(full)) || (token && n.includes(token));
  });
}

/** The one team named in a title. "Total Runs Odd/Even" is the game; "Dodgers Total Runs Odd/Even" is not. */
function teamMentioned(name, teams = {}) {
  const named = teamSubject(name, teams);
  if (named) return named;
  const n = String(name || '').toLowerCase();
  const hits = [teams.away, teams.home].filter(Boolean).filter((team) => {
    const full = String(team).toLowerCase();
    const token = lastSignificantToken(team);
    return (full && n.includes(full)) || (token.length >= 3 && n.includes(token));
  });
  return hits.length === 1 ? hits[0] : null;
}

function oddEvenSide(quote) {
  const text = String(quote?.outcome || quote?.label || quote?.name || '');
  if (/^odd\b/i.test(text)) return 'odd';
  if (/^even\b/i.test(text)) return 'even';
  return null;
}

/**
 * A book can post the game total and each team's runs in one tab.
 * Quotes that name a team stay on that team. The rest is the game total.
 */
function oddEvenGroups(quotes, name, teams, teamOf) {
  const tagged = (quotes || []).map((quote) => ({
    quote,
    side: oddEvenSide(quote),
    team: teamOf ? teamOf(quote) : null,
  })).filter((row) => row.side);
  if (tagged.some((row) => row.team)) {
    const groups = new Map();
    for (const row of tagged) {
      if (!row.team) continue;
      if (!groups.has(row.team)) groups.set(row.team, {});
      if (!groups.get(row.team)[row.side]) groups.get(row.team)[row.side] = row.quote;
    }
    return [...groups.entries()].map(([subject, pair]) => ({
      subject,
      odd: pair.odd,
      even: pair.even,
    }));
  }
  const odd = tagged.find((row) => row.side === 'odd')?.quote;
  const even = tagged.find((row) => row.side === 'even')?.quote;
  return [{ subject: teamMentioned(name, teams) || 'game', odd, even }];
}

function writeOddEven(upsert, name, period, subject, odd, even) {
  if (!odd || !even) return;
  const key = marketKey({ period, kind: 'yesno', stat: 'odd_even', subject: subject || 'game' });
  upsert(key, name, 'yesno', (book) => {
    if (!book.odd) book.odd = { american: odd.american, label: 'Odd' };
    if (!book.even) book.even = { american: even.american, label: 'Even' };
  });
}

const SKIP_NAME = /3-way|3 way|exact (game|team)?\s*winning|exact score|squares|drive \d|drive result|winning margin|anytime(?:\s+\w+)?\s+td scorer|anytime goal|goal ?scorer|last touchdown|first td scorer|1st touchdown scorer|to score \d\+ touchdowns|to score a goal|fan.?duel squares|correct score|octopus|td exactas|most \w+ yards|double winner|futures|first scoring play|score method|1st score method|special teams to score|to score a td|defensive td|to beat the|in overtime|\brace to\b|\bwdw\b|half-time\/full-time|ht\/ft|goals bands|total goals bands|2 way spread (?:away|home)|lead at \d|point by point|to record \d+\+|to win (?:either|both) half|win in both halves|both teams to score - both|both halves|both teams to score.+(?:&|\/)|btts.+(?:&|\/)|no draw|\b1x2\b|double chance|both win set|listed set|win a set|both players to win|\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}|up to \d+(?:st|nd|rd|th)?\s*(?:minute|min\b)|between .*(?:minute|min\b)|goal scored\s*-|listed time|\btotal goals,\s*\d/i;

function isScoreMethodLabel(name) {
  return /touchdown|\btds?\b|field goal|safety|punt|kickoff|interception|fumble|method|special teams|to beat|in overtime|and (?:win|lose)|\bdefense\b|\boffense\b/i.test(String(name ?? ''));
}

function isCleanTeamLabel(name, teams = {}) {
  const n = stripLine(name);
  if (!n || isScoreMethodLabel(n)) return false;
  return (teams.away && isBareTeamName(n, teams.away)) || (teams.home && isBareTeamName(n, teams.home));
}

function plausibleMlOdds(american) {
  return Number.isFinite(american) && Math.abs(american) < 2500;
}

function addSide(target, side, quote) {
  if (!quote || quote.american == null) return;
  const key = `${side}s`;
  if (!target[key]) target[key] = [];
  const line = Number.isFinite(quote.line) ? quote.line : null;
  const sameLine = target[key].find((row) => row.line === line);
  if (sameLine) return;
  target[key].push(quote);
  if (!target[side]) target[side] = quote;
}

function parseLineFromName(name) {
  const m = String(name ?? '').match(/\(([-+]?\d+(?:\.\d+)?)\)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function stripLine(name) {
  return String(name ?? '').replace(/\s*\(([-+]?\d+(?:\.\d+)?)\)\s*$/, '').trim();
}

function milestoneLine(label) {
  const m = String(label ?? '').match(/(\d+(?:\.\d+)?)\s*\+/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n - 0.5 : null;
}

export function shouldSkipMarketName(name) {
  return SKIP_NAME.test(String(name ?? ''));
}

function dkTeamSide(quote, side, team) {
  if (!quote || isScoreMethodLabel(quote.label)) return false;
  if (quote.label && !/^(away|home)$/i.test(quote.label)) {
    return isBareTeamName(quote.label, team);
  }
  return quote.outcome === side;
}

function playerFromText(text, extra = '') {
  const raw = `${text} ${extra}`;
  const m = String(raw).match(/^(.+?)\s+-\s+/);
  if (m) return m[1].trim();
  const over = String(text).match(/^(.+?)\s+(over|under)\b/i);
  if (over) return over[1].trim();
  return null;
}

export function extractFdContracts(markets, teams = {}) {
  const byKey = new Map();
  const upsert = (key, label, kind, mutate) => {
    if (!byKey.has(key)) byKey.set(key, { key, label, kind, fd: {} });
    const row = byKey.get(key);
    mutate(row.fd, row);
  };

  for (const market of Object.values(markets ?? {})) {
    const name = market?.marketName ?? '';
    if (!name) continue;
    if (isNonMatchWinnerMarket(name, market?._tab || market?.hint)) continue;
    const runners = Array.isArray(market.runners) ? market.runners : Object.values(market.runners ?? {});
    const quotes = runners.map((runner) => {
      const american = parseSignedAmerican(runner?.winRunnerOdds?.americanDisplayOdds?.americanOdds);
      if (american == null) return null;
      const handicap = Number(runner.handicap);
      return {
        name: runner.runnerName ?? '',
        american,
        line: Number.isFinite(handicap) && handicap !== 0 ? handicap : parseLineFromName(runner.runnerName),
      };
    }).filter(Boolean);
    if (quotes.length < 2 && !/alternate|alt /i.test(name)) continue;
    const period = resolvePeriod(name, market?._tab || market?.hint);
    if (storePlainThreeWay(upsert, name, period, quotes, teams, (q) => {
      if (isDrawQuote(q)) return 'draw';
      const label = stripLine(q.name);
      if (teams.away && (isBareTeamName(label, teams.away) || teamsMatch(label, teams.away))) return 'away';
      if (teams.home && (isBareTeamName(label, teams.home) || teamsMatch(label, teams.home))) return 'home';
      return null;
    })) continue;
    if (storeDriveResultMultiway(upsert, name, period, quotes, teams)) continue;
    if (shouldSkipMarketName(name)) continue;
    if (isThreeWayQuotes(name, runners.map((runner) => runner.runnerName))) continue;

    const stat = resolveStat(name, market?._tab || market?.hint);
    const overUnder = quotes.filter((q) => /^(over|under)\b/i.test(stripLine(q.name)) || / over$| under$/i.test(q.name));
    const yesNo = quotes.filter((q) => /^(yes|no)$/i.test(stripLine(q.name)));
    const oddEven = quotes.filter((q) => /^(odd|even)\b/i.test(q.name));

    if (/alternate total/i.test(name) || (overUnder.length >= 2 && /alternate/i.test(name))) {
      const kind = /team total|total points -/i.test(name) || nameMentionsTeam(name, teams)
        ? 'team_total' : 'total';
      // FanDuel alt team totals share a subject with the main "X Total Points" market and
      // poison display/pairing — game-level alternates stay, team alts use the main market only.
      if (kind === 'team_total') continue;
      let subject = 'game';
      const key = marketKey({ period, kind: stat === 'points' ? 'points' : stat, subject });
      for (const q of quotes) {
        const side = /under/i.test(q.name) ? 'under' : /over/i.test(q.name) ? 'over' : null;
        const line = q.line ?? parseLineFromName(q.name);
        if (!side || !Number.isFinite(line)) continue;
        upsert(key, name, kind, (book) => addSide(book, side, { american: q.american, line, label: side }));
      }
      continue;
    }

    if (/alternate spread/i.test(name)) {
      const key = marketKey({ period, kind: 'spread', stat, subject: 'game' });
      for (const q of quotes) {
        const teamName = stripLine(q.name);
        const line = q.line ?? parseLineFromName(q.name);
        if (!Number.isFinite(line)) continue;
        const side = teams.away && teamsMatch(teamName, teams.away) ? 'away'
          : teams.home && teamsMatch(teamName, teams.home) ? 'home' : null;
        if (!side) continue;
        upsert(key, name, 'spread', (book) => addSide(book, side, {
          american: q.american, line, team: teamName, label: teamName,
        }));
      }
      continue;
    }

    if (oddEven.length >= 2) {
      for (const group of oddEvenGroups(oddEven, name, teams)) {
        writeOddEven(upsert, name, period, group.subject, group.odd, group.even);
      }
      continue;
    }

    if (yesNo.length >= 2) {
      const key = marketKey({ period, kind: 'yesno', stat, subject: yesNoSubject(name, teams) });
      upsert(key, name, 'yesno', (book) => {
        const yes = yesNo.find((q) => /^yes/i.test(q.name));
        const no = yesNo.find((q) => /^no/i.test(q.name));
        if (yes) book.yes = { american: yes.american, label: 'Yes' };
        if (no) book.no = { american: no.american, label: 'No' };
      });
      continue;
    }

    if (overUnder.length >= 2) {
      let subject = 'game';
      let kind = parseKind(name, { overunder: true });
      const player = playerFromText(name) || playerFromText(overUnder[0].name);
      const teamTotalName = /team total/i.test(name);
      if (player && !teamTotalName && !/^total\b/i.test(player) && /yds|yards|reception|pass|rush|td|sack|tackle|fg|kick|punt|fantasy|attempt|completion|points|assists|rebounds|threes|steals|blocks|pra|shots|saves|goals|hits|strikeouts|aces|corners|cards|double.?double|walks|outs|doubles|triples|singles|home runs|stolen|rbi|earned|\bruns\b/i.test(name + overUnder[0].name)) {
        kind = 'player_ou';
        subject = player;
      } else if (
        kind === 'team_total'
        || /team total|total points\s*-|total touchdowns\s*-/i.test(name)
        || (nameMentionsTeam(name, teams) && /total/i.test(name))
      ) {
        kind = 'team_total';
        const teamBit = name.replace(/:.*/, '').replace(/-.*/, '').replace(/total.*/i, '').trim();
        subject = teamSubject(teamBit, teams) || teamSubject(name, teams) || 'game';
        if (subject === 'game') {
          for (const q of overUnder) {
            const maybe = teamSubject(stripLine(q.name).replace(/over|under/ig, '').trim(), teams);
            if (maybe && maybe !== 'game') subject = maybe;
          }
        }
      } else {
        kind = 'total';
        subject = 'game';
      }
      const key = marketKey({ period, kind, stat, subject });
      upsert(key, name, kind, (book) => {
        for (const q of overUnder) {
          const side = /under/i.test(q.name) ? 'under' : 'over';
          addSide(book, side, { american: q.american, line: q.line, label: side });
        }
      });
      continue;
    }

    if (/^\d+\+$/.test(quotes[0]?.name || '') || quotes.some((q) => milestoneLine(q.name) != null)) {
      const player = playerFromText(name) || name.replace(/-.*/, '').trim();
      if (!player) continue;
      const kind = 'player_ou';
      const key = marketKey({ period, kind, stat, subject: player });
      upsert(key, name, kind, (book) => {
        for (const q of quotes) {
          const line = milestoneLine(q.name);
          if (!Number.isFinite(line)) continue;
          addSide(book, 'over', { american: q.american, line, label: 'Over' });
        }
      });
      continue;
    }

    const teamQuotes = quotes.filter((q) => isCleanTeamLabel(q.name, teams));
    if (teamQuotes.length >= 2) {
      const hasLine = teamQuotes.some((q) => Number.isFinite(q.line));
      const kind = hasLine ? 'spread' : 'moneyline';
      if (kind === 'moneyline' && isThreeWayQuotes(name, quotes.map((q) => q.name))) continue;
      if (kind === 'moneyline' && teamQuotes.every((q) => q.american > 0) && !isTwoWayWinnerName(name)) continue;
      if (kind === 'moneyline' && teamQuotes.some((q) => !plausibleMlOdds(q.american))) continue;
      const key = marketKey({
        period,
        kind,
        stat: kind === 'moneyline'
          ? (stat.startsWith('race') || stat === 'dnb' ? stat : 'winner')
          : stat,
        subject: 'game',
      });
      upsert(key, name, kind, (book) => {
        for (const q of teamQuotes) {
          const n = stripLine(q.name);
          const side = teamsMatch(n, teams.away) ? 'away' : 'home';
          addSide(book, side, {
            american: q.american,
            line: kind === 'spread' ? q.line : null,
            team: n,
            label: n,
          });
        }
      });
    }
  }
  return [...byKey.values()];
}

export function extractDkContracts(markets, selections, teams = {}) {
  const byMarket = new Map();
  for (const sel of selections ?? []) {
    const id = String(sel.marketId ?? '');
    if (!id) continue;
    if (!byMarket.has(id)) byMarket.set(id, []);
    byMarket.get(id).push(sel);
  }
  const byKey = new Map();
  const upsert = (key, label, kind, mutate) => {
    if (!byKey.has(key)) byKey.set(key, { key, label, kind, dk: {} });
    const row = byKey.get(key);
    mutate(row.dk, row);
  };

  for (const market of markets ?? []) {
    const name = market?.name ?? '';
    if (!name) continue;
    if (isNonMatchWinnerMarket(name, market?.hint)) continue;
    const sels = byMarket.get(String(market.id)) ?? [];
    const quotes = sels.map((sel) => {
      const american = parseSignedAmerican(sel.displayOdds?.american);
      if (american == null) return null;
      const line = Number(sel.points);
      return {
        label: sel.label ?? '',
        outcome: String(sel.outcomeType ?? '').toLowerCase(),
        american,
        line: Number.isFinite(line) ? line : null,
        participant: sel.participants?.[0]?.name ?? null,
      };
    }).filter(Boolean);
    if (!quotes.length) continue;
    const period = resolvePeriod(name, market?.hint);
    if (storePlainThreeWay(upsert, name, period, quotes, teams, (q) => {
      if (isDrawQuote(q)) return 'draw';
      if (dkTeamSide(q, 'away', teams.away)) return 'away';
      if (dkTeamSide(q, 'home', teams.home)) return 'home';
      return null;
    })) continue;
    if (storeDriveResultMultiway(upsert, name, period, quotes, teams)) continue;
    if (shouldSkipMarketName(name)) continue;
    if (isThreeWayQuotes(name, sels.map((sel) => sel.label || sel.outcomeType))) continue;

    const stat = resolveStat(name, market?.hint);
    const overs = quotes.filter((q) => q.outcome === 'over' || /^over$/i.test(q.label));
    const unders = quotes.filter((q) => q.outcome === 'under' || /^under$/i.test(q.label));
    const yeses = quotes.filter((q) => q.outcome === 'yes' || /^yes$/i.test(String(q.label).trim()));
    const nos = quotes.filter((q) => q.outcome === 'no' || /^no$/i.test(String(q.label).trim()));
    const odds = quotes.filter((q) => q.outcome === 'odd' || /^odd$/i.test(q.label));
    const evens = quotes.filter((q) => q.outcome === 'even' || /^even$/i.test(q.label));

    if (odds.length && evens.length) {
      const teamOf = (quote) => teamSubject(quote.participant, teams) || teamMentioned(quote.participant, teams);
      for (const group of oddEvenGroups([...odds, ...evens], name, teams, teamOf)) {
        writeOddEven(upsert, name, period, group.subject, group.odd, group.even);
      }
      continue;
    }

    if (yeses.length && nos.length) {
      const key = marketKey({ period, kind: 'yesno', stat, subject: yesNoSubject(name, teams) });
      upsert(key, name, 'yesno', (book) => {
        book.yes = { american: yeses[0].american, label: 'Yes' };
        book.no = { american: nos[0].american, label: 'No' };
      });
      continue;
    }

    if (overs.length && unders.length) {
      let kind = 'total';
      let subject = 'game';
      const player = quotes[0].participant || playerFromText(name);
      const teamTotalName = /team total/i.test(name) || /team totals/i.test(market.hint || '');
      if (player && !teamTotalName && !/^total\b/i.test(player) && /pass|rush|rec|yds|reception|td|sack|tackle|fg|kick|punt|fantasy|attempt|completion|int|points|assists|rebounds|threes|steals|blocks|pra|shots|saves|goals|hits|strikeouts|aces|corners|cards|walks|outs|doubles|triples|singles|home runs|stolen|rbi|earned|\bruns\b/i.test(name)) {
        kind = 'player_ou';
        subject = player;
      } else if (/team total|:\s*team total/i.test(name) || /team totals/i.test(market.hint || '')) {
        kind = 'team_total';
        subject = teamSubject(name.split(':')[0], teams) || teamSubject(quotes[0].participant, teams) || 'game';
      }
      const key = marketKey({ period, kind, stat, subject });
      upsert(key, name, kind, (book) => {
        for (const q of overs) addSide(book, 'over', { american: q.american, line: q.line, label: 'Over' });
        for (const q of unders) addSide(book, 'under', { american: q.american, line: q.line, label: 'Under' });
      });
      continue;
    }

    if (quotes.every((q) => milestoneLine(q.label) != null) && quotes[0].participant) {
      const key = marketKey({ period, kind: 'player_ou', stat, subject: quotes[0].participant });
      upsert(key, name, 'player_ou', (book) => {
        for (const q of quotes) {
          const line = milestoneLine(q.label);
          if (Number.isFinite(line)) addSide(book, 'over', { american: q.american, line, label: 'Over' });
        }
      });
      continue;
    }

    const away = quotes.filter((q) => dkTeamSide(q, 'away', teams.away));
    const home = quotes.filter((q) => dkTeamSide(q, 'home', teams.home));
    if (away.length && home.length) {
      const hasLine = [...away, ...home].some((q) => Number.isFinite(q.line));
      const kind = hasLine ? 'spread' : 'moneyline';
      if (kind === 'moneyline' && isThreeWayQuotes(name, quotes.map((q) => q.label))) continue;
      if (kind === 'moneyline' && [...away, ...home].every((q) => q.american > 0) && !isTwoWayWinnerName(name)) continue;
      if (kind === 'moneyline' && [...away, ...home].some((q) => !plausibleMlOdds(q.american))) continue;
      const key = marketKey({
        period,
        kind,
        stat: kind === 'moneyline'
          ? (stat.startsWith('race') || stat === 'dnb' ? stat : 'winner')
          : stat,
        subject: 'game',
      });
      upsert(key, name, kind, (book) => {
        for (const q of away) {
          addSide(book, 'away', { american: q.american, line: kind === 'spread' ? q.line : null, team: q.label, label: q.label });
        }
        for (const q of home) {
          addSide(book, 'home', { american: q.american, line: kind === 'spread' ? q.line : null, team: q.label, label: q.label });
        }
      });
    }
  }
  return [...byKey.values()];
}

export function mergeContracts(fdList, dkList) {
  const dkByKey = new Map();
  const dkUnused = new Set(dkList.map((row) => row.key));
  for (const row of dkList) dkByKey.set(row.key, row);

  const findDk = (fd) => {
    if (dkByKey.has(fd.key)) return dkByKey.get(fd.key);
    const [period, kind, stat, ...rest] = fd.key.split('|');
    const subject = rest.join('|');
    for (const row of dkList) {
      const parts = row.key.split('|');
      if (parts[0] !== period || parts[1] !== kind || parts[2] !== stat) continue;
      const other = parts.slice(3).join('|');
      if (subjectMatchLoose(subject, other)) return row;
    }
    return null;
  };

  const out = [];
  const usedDk = new Set();
  for (const fd of fdList) {
    const dk = findDk(fd);
    if (dk) {
      usedDk.add(dk.key);
      dkUnused.delete(dk.key);
    }
    out.push({
      key: fd.key,
      label: fd.label,
      kind: fd.kind,
      fd: fd.fd || null,
      dk: dk?.dk || null,
    });
  }
  for (const dk of dkList) {
    if (usedDk.has(dk.key)) continue;
    out.push({
      key: dk.key,
      label: dk.label,
      kind: dk.kind,
      fd: null,
      dk: dk.dk || null,
    });
  }
  return out;
}

function subjectMatchLoose(a, b) {
  if (a === b) return true;
  return teamsMatch(a, b) || peopleMatch(a, b);
}

/** Hang one more book's contracts onto an FD/DK merge, matching keys loosely. */
export function mergeBookContracts(base, incoming, bookId) {
  const rows = (base || []).map((row) => ({ ...row }));
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const findRow = (item) => {
    if (byKey.has(item.key)) return byKey.get(item.key);
    const [period, kind, stat, ...rest] = String(item.key || '').split('|');
    const subject = rest.join('|');
    for (const row of rows) {
      const parts = String(row.key || '').split('|');
      if (parts[0] !== period || parts[1] !== kind || parts[2] !== stat) continue;
      if (subjectMatchLoose(subject, parts.slice(3).join('|'))) return row;
    }
    return null;
  };
  for (const item of incoming || []) {
    const quote = item?.[bookId];
    if (!quote) continue;
    const hit = findRow(item);
    if (hit) {
      hit[bookId] = quote;
      continue;
    }
    const row = {
      key: item.key,
      label: item.label,
      kind: item.kind,
      [bookId]: quote,
    };
    rows.push(row);
    byKey.set(item.key, row);
  }
  return rows;
}
