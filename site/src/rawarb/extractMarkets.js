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
} from './marketNormalize.js';
import { isBareTeamName, lastSignificantToken, teamsMatch } from './teamMatch.js';

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

const SKIP_NAME = /3-way|3 way|exact (game|team)?\s*winning|exact score|squares|drive \d|drive result|winning margin|anytime(?:\s+\w+)?\s+td scorer|last touchdown|first td scorer|1st touchdown scorer|to score \d\+ touchdowns|fan.?duel squares|correct score|octopus|td exactas|most \w+ yards|double winner|futures|first scoring play|score method|1st score method|special teams to score|to score a td|defensive td|to beat the|in overtime|\brace to\b/i;

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
  if (quote.outcome === side) {
    if (!quote.label || /^(away|home)$/i.test(quote.label)) return true;
    return !team || isBareTeamName(quote.label, team);
  }
  return isBareTeamName(quote.label, team);
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
    mutate(byKey.get(key).fd);
  };

  for (const market of Object.values(markets ?? {})) {
    const name = market?.marketName ?? '';
    if (!name || shouldSkipMarketName(name)) continue;
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
    const stat = resolveStat(name, market?._tab || market?.hint);
    const overUnder = quotes.filter((q) => /^(over|under)\b/i.test(stripLine(q.name)) || / over$| under$/i.test(q.name));
    const yesNo = quotes.filter((q) => /^(yes|no)\b/i.test(q.name));
    const oddEven = quotes.filter((q) => /^(odd|even)\b/i.test(q.name));

    if (/alternate total/i.test(name) || (overUnder.length >= 2 && /alternate/i.test(name))) {
      const kind = /team total|total points -/i.test(name) || nameMentionsTeam(name, teams)
        ? 'team_total' : 'total';
      let subject = 'game';
      if (kind === 'team_total') {
        subject = teamSubject(name.replace(/-.*/, '').replace(/alternate total.*/i, '').trim(), teams)
          || (teams.away && nameMentionsTeam(name, { away: teams.away }) ? teams.away : null)
          || (teams.home && nameMentionsTeam(name, { home: teams.home }) ? teams.home : null)
          || 'game';
      }
      const key = marketKey({ period, kind, stat: stat === 'points' ? 'points' : stat, subject });
      for (const q of quotes) {
        const side = /under/i.test(q.name) ? 'under' : /over/i.test(q.name) ? 'over' : null;
        const line = q.line ?? parseLineFromName(q.name);
        if (!side || !Number.isFinite(line)) continue;
        upsert(key, name, kind, (book) => addSide(book, side, { american: q.american, line, label: side }));
      }
      continue;
    }

    if (/alternate spread/i.test(name)) {
      const key = marketKey({ period, kind: 'spread', stat: 'points', subject: 'game' });
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
      const key = marketKey({ period, kind: 'yesno', stat: 'odd_even', subject: 'game' });
      upsert(key, name, 'yesno', (book) => {
        const odd = oddEven.find((q) => /^odd/i.test(q.name));
        const even = oddEven.find((q) => /^even/i.test(q.name));
        if (odd) book.odd = { american: odd.american, label: 'Odd' };
        if (even) book.even = { american: even.american, label: 'Even' };
      });
      continue;
    }

    if (yesNo.length >= 2) {
      const key = marketKey({ period, kind: 'yesno', stat, subject: 'game' });
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
      if (player && /yds|yards|reception|pass|rush|td|sack|tackle|fg|kick|punt|fantasy|attempt|completion/i.test(name + overUnder[0].name)) {
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
      if (kind === 'moneyline' && teamQuotes.some((q) => !plausibleMlOdds(q.american))) continue;
      const key = marketKey({
        period,
        kind,
        stat: kind === 'moneyline' ? (stat.startsWith('race') ? stat : 'winner') : 'points',
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
    mutate(byKey.get(key).dk);
  };

  for (const market of markets ?? []) {
    const name = market?.name ?? '';
    if (!name || shouldSkipMarketName(name)) continue;
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
    const stat = resolveStat(name, market?.hint);
    const overs = quotes.filter((q) => q.outcome === 'over' || /^over$/i.test(q.label));
    const unders = quotes.filter((q) => q.outcome === 'under' || /^under$/i.test(q.label));
    const yeses = quotes.filter((q) => q.outcome === 'yes' || /^yes$/i.test(q.label));
    const nos = quotes.filter((q) => q.outcome === 'no' || /^no$/i.test(q.label));
    const odds = quotes.filter((q) => q.outcome === 'odd' || /^odd$/i.test(q.label));
    const evens = quotes.filter((q) => q.outcome === 'even' || /^even$/i.test(q.label));

    if (odds.length && evens.length) {
      const key = marketKey({ period, kind: 'yesno', stat: 'odd_even', subject: 'game' });
      upsert(key, name, 'yesno', (book) => {
        book.odd = { american: odds[0].american, label: 'Odd' };
        book.even = { american: evens[0].american, label: 'Even' };
      });
      continue;
    }

    if (yeses.length && nos.length) {
      const key = marketKey({ period, kind: 'yesno', stat, subject: 'game' });
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
      if (player && /pass|rush|rec|yds|reception|td|sack|tackle|fg|kick|punt|fantasy|attempt|completion|int/i.test(name)) {
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
      if (kind === 'moneyline' && [...away, ...home].some((q) => !plausibleMlOdds(q.american))) continue;
      const key = marketKey({
        period,
        kind,
        stat: kind === 'moneyline' ? (stat.startsWith('race') ? stat : 'winner') : 'points',
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
