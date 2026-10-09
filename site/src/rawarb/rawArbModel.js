/**
 * Cross-book two-way: take opposite sides of the same market on FanDuel
 * and DraftKings, pick the pairing whose implieds sum closest to (or under) 1.
 */

import { evaluateTwoWayArb } from '../corners/arbChecker.js';
import { americanToImpliedProb, formatAmericanOdds } from '../sop/sopModel.js';
import { peopleMatch } from './marketNormalize.js';
import { matchModeForSport } from './sportCatalog.js';
import { RAW_BOOK_IDS, bookShort, isRawBookId } from './bookCatalog.js';
import { nycVisibleExtras } from './nycFilter.js';
import { dateDeltaHours, matchQuality, namesMatch, teamsMatch } from './teamMatch.js';

export function parseSignedAmerican(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw !== 0) return raw;
  const n = Number(
    String(raw).trim().replace(/[\u2212\u2013\u2014]/g, '-').replace(/^\+/, ''),
  );
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export function quoteFromAmerican(american) {
  const parsed = parseSignedAmerican(american);
  const implied = americanToImpliedProb(parsed);
  if (implied == null) return null;
  return { american: parsed, implied };
}

export function formatLineNumber(n) {
  if (!Number.isFinite(n)) return '';
  return n > 0 ? `+${n}` : String(n);
}

export function formatCombinedPct(pSum) {
  if (!Number.isFinite(pSum)) return '—';
  return `${(pSum * 100).toFixed(2)}%`;
}

export function formatJuicePct(pSum) {
  if (!Number.isFinite(pSum)) return '—';
  const juice = (pSum - 1) * 100;
  const abs = Math.abs(juice).toFixed(2);
  if (juice < 0) return `${abs}% arb`;
  if (Math.abs(juice) < 0.005) return 'even';
  return `+${abs}%`;
}

const LINE_EPS = 1e-9;

/**
 * 2.25, 0.75, and +0.25 are quarter lines. The stake splits across the two
 * neighboring numbers, so they are not one total you can two-way against 2.5.
 */
export function isSplitLine(line) {
  if (!Number.isFinite(line)) return false;
  const doubled = line * 2;
  return Math.abs(doubled - Math.round(doubled)) > 1e-6;
}

/** Spread: sA + sB. Total: under − over. lock=0, middle>0, gap<0. */
export function lineFitFromCushion(cushion) {
  if (!Number.isFinite(cushion)) return null;
  if (Math.abs(cushion) < LINE_EPS) return 'lock';
  return cushion > 0 ? 'middle' : 'gap';
}

/**
 * Two candidate opposite-side pairs. Gaps (lose+push) are dropped.
 * Middles (win+push / 3/4 pot) stay and can rank at the top.
 */
export function pickBestTwoWay(optionA, optionB) {
  const scored = [optionA, optionB]
    .filter((row) => row?.a && row?.b)
    .map((row) => {
      const ev = evaluateTwoWayArb(row.a, row.b, 100);
      if (!ev) return null;
      const lineFit = row.lineFit || (row.numberMatch === false ? 'gap' : 'lock');
      if (lineFit === 'gap') return null;
      return {
        pSum: ev.pSum,
        juice: ev.juice,
        roi: ev.roi,
        hasArb: ev.hasArb,
        lineFit,
        numberMatch: lineFit === 'lock',
        lineDelta: Number.isFinite(row.lineDelta) ? row.lineDelta : 0,
        legs: [row.legA, row.legB],
      };
    })
    .filter(Boolean);
  if (!scored.length) return null;
  scored.sort((x, y) => {
    if (x.pSum !== y.pSum) return x.pSum - y.pSum;
    if (x.lineFit !== y.lineFit) return x.lineFit === 'lock' ? -1 : 1;
    return Math.abs(x.lineDelta) - Math.abs(y.lineDelta);
  });
  return scored[0];
}

function sideQuote(book, side, extra = {}) {
  const raw = book?.[side];
  if (!raw) return null;
  const quote = quoteFromAmerican(raw.american);
  if (!quote) return null;
  return { ...quote, ...extra, line: raw.line, team: raw.team ?? extra.team ?? null };
}

function leg(bookKey, side, quote, label) {
  if (!quote) return null;
  return {
    book: bookKey,
    side,
    label,
    team: quote.team ?? null,
    american: quote.american,
    line: Number.isFinite(quote.line) ? quote.line : null,
  };
}

function spreadPair(a, b, legA, legB) {
  const cushion = Number.isFinite(a?.line) && Number.isFinite(b?.line) ? a.line + b.line : null;
  let lineFit = lineFitFromCushion(cushion) || 'gap';
  // Half-point middles stay. A multi-goal middle is two different numbers, not one bet.
  if (lineFit === 'middle' && cushion > 0.5) lineFit = 'gap';
  return {
    a,
    b,
    lineFit,
    lineDelta: cushion,
    legA,
    legB,
  };
}

function totalPair(over, under, overLeg, underLeg) {
  const cushion = Number.isFinite(over?.line) && Number.isFinite(under?.line)
    ? under.line - over.line
    : null;
  let lineFit = lineFitFromCushion(cushion) || 'gap';
  if (lineFit === 'middle' && cushion > 0.5) lineFit = 'gap';
  return {
    a: over,
    b: under,
    lineFit,
    lineDelta: cushion,
    legA: overLeg,
    legB: underLeg,
  };
}

function evenDistance(american) {
  const quote = quoteFromAmerican(american);
  if (!quote) return Number.POSITIVE_INFINITY;
  return Math.abs(quote.implied - 0.5);
}

function finiteRows(rows) {
  return (rows || []).filter((row) => Number.isFinite(row?.line) && row?.american != null && !isSplitLine(row.line));
}

function closestPair(leftRows, rightRows, matches) {
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const left of finiteRows(leftRows)) {
    for (const right of finiteRows(rightRows)) {
      if (!matches(left, right)) continue;
      const dist = evenDistance(left.american) + evenDistance(right.american);
      if (dist < bestDist) {
        bestDist = dist;
        best = [left, right];
      }
    }
  }
  return best;
}

function closestSingle(rows) {
  const finite = finiteRows(rows);
  if (!finite.length) return null;
  return [...finite].sort((a, b) => evenDistance(a.american) - evenDistance(b.american))[0];
}

/**
 * The headline quote is one number: the over/under (or +line/−line) pair
 * closest to even. Picking each side on its own puts a longshot alt opposite the main.
 */
export function pinClosestQuotes(book) {
  if (!book || typeof book !== 'object') return book;
  const next = { ...book };
  const total = closestPair(next.overs, next.unders, (over, under) => Math.abs(over.line - under.line) < 1e-6);
  if (total) {
    [next.over, next.under] = total;
  } else {
    const over = closestSingle(next.overs);
    const under = closestSingle(next.unders);
    if (over) next.over = over;
    if (under) next.under = under;
  }
  const spread = closestPair(next.aways, next.homes, (away, home) => Math.abs(away.line + home.line) < 1e-6);
  if (spread) {
    [next.away, next.home] = spread;
  } else {
    const away = closestSingle(next.aways);
    const home = closestSingle(next.homes);
    if (away) next.away = away;
    if (home) next.home = home;
  }
  return next;
}

function sameCompetitor(a, b) {
  const ta = a?.team;
  const tb = b?.team;
  if (!ta || !tb) return false;
  return namesMatch(ta, tb) || peopleMatch(ta, tb) || teamsMatch(ta, tb);
}

export function moneylineTwoWay(left, right, teams = {}, bookA = 'fd', bookB = 'dk') {
  const leftAway = sideQuote(left, 'away', { team: teams.away });
  const leftHome = sideQuote(left, 'home', { team: teams.home });
  const rightAway = sideQuote(right, 'away', { team: teams.away });
  const rightHome = sideQuote(right, 'home', { team: teams.home });
  if (sameCompetitor(leftAway, leftHome) || sameCompetitor(rightAway, rightHome)) return null;
  return pickBestTwoWay(
    sameCompetitor(leftAway, rightHome) ? null : {
      a: leftAway,
      b: rightHome,
      lineFit: 'lock',
      legA: leg(bookA, 'away', leftAway, leftAway?.team || teams.away || 'Away'),
      legB: leg(bookB, 'home', rightHome, rightHome?.team || teams.home || 'Home'),
    },
    sameCompetitor(leftHome, rightAway) ? null : {
      a: leftHome,
      b: rightAway,
      lineFit: 'lock',
      legA: leg(bookA, 'home', leftHome, leftHome?.team || teams.home || 'Home'),
      legB: leg(bookB, 'away', rightAway, rightAway?.team || teams.away || 'Away'),
    },
  );
}

export function spreadTwoWay(left, right, teams = {}, bookA = 'fd', bookB = 'dk') {
  const leftAway = sideQuote(left, 'away', { team: teams.away });
  const leftHome = sideQuote(left, 'home', { team: teams.home });
  const rightAway = sideQuote(right, 'away', { team: teams.away });
  const rightHome = sideQuote(right, 'home', { team: teams.home });
  return pickBestTwoWay(
    spreadPair(
      leftAway,
      rightHome,
      leg(bookA, 'away', leftAway, teams.away || 'Away'),
      leg(bookB, 'home', rightHome, teams.home || 'Home'),
    ),
    spreadPair(
      leftHome,
      rightAway,
      leg(bookA, 'home', leftHome, teams.home || 'Home'),
      leg(bookB, 'away', rightAway, teams.away || 'Away'),
    ),
  );
}

export function totalTwoWay(left, right, bookA = 'fd', bookB = 'dk') {
  const leftOver = sideQuote(left, 'over');
  const leftUnder = sideQuote(left, 'under');
  const rightOver = sideQuote(right, 'over');
  const rightUnder = sideQuote(right, 'under');
  return pickBestTwoWay(
    totalPair(
      leftOver,
      rightUnder,
      leg(bookA, 'over', leftOver, 'Over'),
      leg(bookB, 'under', rightUnder, 'Under'),
    ),
    totalPair(
      rightOver,
      leftUnder,
      leg(bookB, 'over', rightOver, 'Over'),
      leg(bookA, 'under', leftUnder, 'Under'),
    ),
  );
}

export function crossBookTwoWay(kind, market, teams, bookIds = RAW_BOOK_IDS) {
  const ids = (bookIds || []).filter((id) => market?.[id]);
  let best = null;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      const twoWay = kind === 'total'
        ? totalTwoWay(market[a], market[b], a, b)
        : kind === 'spread'
          ? spreadTwoWay(market[a], market[b], teams, a, b)
          : moneylineTwoWay(market[a], market[b], teams, a, b);
      if (!twoWay) continue;
      if (!best || twoWay.pSum < best.pSum) best = twoWay;
    }
  }
  return best;
}

const ATTACH_MAX_HOURS = 36;

function flipBookQuote(book) {
  if (!book) return null;
  return { away: book.home ?? null, home: book.away ?? null };
}

/** Hang another book's mains on games already paired from FanDuel + DraftKings. */
export function attachBookGames(games, bookGames, bookKey) {
  const pool = bookGames || [];
  const used = new Set();
  return (games || []).map((game) => {
    let best = null;
    pool.forEach((other, idx) => {
      if (used.has(idx) || other?.sport !== game.sport) return;
      const quality = matchQuality(game, other, matchModeForSport(game.sport));
      if (!quality) return;
      const delta = dateDeltaHours(game, other);
      if (delta != null && delta > ATTACH_MAX_HOURS) return;
      if (!best || quality.score > best.quality.score) best = { other, idx, quality };
    });
    if (!best) return game;
    used.add(best.idx);
    const flipped = best.quality.how === 'swap';
    const src = best.other;
    const moneyline = flipped ? flipBookQuote(src.moneyline) : src.moneyline;
    const spread = flipped ? flipBookQuote(src.spread) : src.spread;
    return {
      ...game,
      [`${bookKey}EventId`]: src.eventId,
      moneyline: { ...(game.moneyline || {}), [bookKey]: moneyline || null },
      spread: { ...(game.spread || {}), [bookKey]: spread || null },
      total: { ...(game.total || {}), [bookKey]: src.total || null },
    };
  });
}

/** Recompute main-line two-ways from the books the user left on. */
export function applyEnabledBooks(game, bookIds = RAW_BOOK_IDS) {
  const allow = new Set((bookIds || []).filter(isRawBookId));
  const teams = { home: game.home, away: game.away };
  const next = { ...game };
  const sums = [];
  for (const kind of ['moneyline', 'spread', 'total']) {
    const market = { ...(game[kind] || {}) };
    for (const id of RAW_BOOK_IDS) {
      if (!allow.has(id)) market[id] = null;
    }
    market.twoWay = crossBookTwoWay(kind, market, teams, [...allow]);
    next[kind] = market;
    if (Number.isFinite(market.twoWay?.pSum)) sums.push(market.twoWay.pSum);
  }
  next.bestPSum = sums.length ? Math.min(...sums) : null;
  return next;
}

function attachTwoWay(market, kind, teams) {
  if (!market) return null;
  let twoWay = null;
  if (kind === 'moneyline') twoWay = moneylineTwoWay(market.fd, market.dk, teams);
  else if (kind === 'spread') twoWay = spreadTwoWay(market.fd, market.dk, teams);
  else if (kind === 'total') twoWay = totalTwoWay(market.fd, market.dk);
  return { ...market, twoWay };
}

export function buildGameMarkets(game) {
  const teams = { home: game.home, away: game.away };
  const moneyline = attachTwoWay(game.moneyline, 'moneyline', teams);
  const spread = attachTwoWay(game.spread, 'spread', teams);
  const total = attachTwoWay(game.total, 'total', teams);
  const twoWays = [moneyline?.twoWay, spread?.twoWay, total?.twoWay].filter(Boolean);
  const bestPSum = twoWays.length ? Math.min(...twoWays.map((row) => row.pSum)) : null;
  return {
    ...game,
    moneyline,
    spread,
    total,
    bestPSum,
  };
}

function flipSides(book) {
  if (!book) return null;
  return {
    away: book.home ?? null,
    home: book.away ?? null,
  };
}

function orientDkToFd(dk, orientation) {
  if (!dk || orientation !== 'swap') return dk;
  return {
    ...dk,
    home: dk.away,
    away: dk.home,
    moneyline: flipSides(dk.moneyline),
    spread: flipSides(dk.spread),
  };
}

export function matchFdToDk(fdGames, dkGames, mode = 'loose') {
  const used = new Set();
  return fdGames.map((fd) => {
    let best = null;
    dkGames.forEach((dk, idx) => {
      if (used.has(idx)) return;
      const quality = matchQuality(fd, dk, mode);
      if (!quality) return;
      if (!best || quality.score > best.quality.score) best = { dk, idx, quality };
    });
    if (best) used.add(best.idx);
    const orientation = best?.quality.how ?? null;
    return {
      fd,
      dk: orientDkToFd(best?.dk, orientation),
      dkFlipped: orientation === 'swap',
    };
  });
}

export function mergeBookGames(fdGames, dkGames, sport) {
  const pairs = matchFdToDk(fdGames, dkGames, matchModeForSport(sport));
  return pairs.filter((row) => row.dk).map(({ fd, dk, dkFlipped }) => buildGameMarkets({
    sport,
    home: fd.home,
    away: fd.away,
    league: fd.league || dk?.league || null,
    openDate: fd.openDate || dk?.openDate || null,
    inPlay: Boolean(fd.inPlay || dk?.inPlay),
    fdEventId: fd.eventId ?? null,
    dkEventId: dk?.eventId ?? null,
    dkLeagueId: dk?.leagueId ?? null,
    dkFlipped: Boolean(dkFlipped),
    moneyline: { fd: fd.moneyline || null, dk: dk?.moneyline || null },
    spread: { fd: fd.spread || null, dk: dk?.spread || null },
    total: { fd: fd.total || null, dk: dk?.total || null },
  }));
}

export function sortGames(games, mode = 'best', sortOpts = null) {
  const copy = [...(games ?? [])];
  if (mode === 'kickoff') {
    copy.sort((a, b) => {
      const ta = Date.parse(a.openDate);
      const tb = Date.parse(b.openDate);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      if (Number.isFinite(ta) !== Number.isFinite(tb)) return Number.isFinite(ta) ? -1 : 1;
      return String(a.away).localeCompare(String(b.away));
    });
    return copy;
  }
  copy.sort((a, b) => {
    const pa = sortPSum(a, sortOpts);
    const pb = sortPSum(b, sortOpts);
    if (pa == null && pb == null) return String(a.away).localeCompare(String(b.away));
    if (pa == null) return 1;
    if (pb == null) return -1;
    if (pa !== pb) return pa - pb;
    return String(a.away).localeCompare(String(b.away));
  });
  return copy;
}

export function bookQuoteAmericans(book) {
  if (!book || typeof book !== 'object') return [];
  return Object.values(book).flatMap((side) => {
    const n = parseSignedAmerican(side?.american);
    return n == null ? [] : [n];
  });
}

export function marketHasMinOdds(market, book, minAmerican) {
  if (!book || !Number.isFinite(minAmerican)) return true;
  return bookQuoteAmericans(market?.[book]).some((n) => n >= minAmerican);
}

function scorableMarkets(game, filterNyc = false) {
  return [game?.moneyline, game?.spread, game?.total, ...nycVisibleExtras(game, filterNyc)];
}

export function gameHasMinOdds(game, book, minAmerican, filterNyc = false) {
  if (!book || !Number.isFinite(minAmerican)) return true;
  return scorableMarkets(game, filterNyc)
    .some((market) => marketHasMinOdds(market, book, minAmerican));
}

export function twoWayHasMinOdds(twoWay, book, minAmerican) {
  if (!book || !Number.isFinite(minAmerican) || !twoWay?.legs?.length) return false;
  return twoWay.legs.some((leg) => (
    leg.book === book && parseSignedAmerican(leg.american) >= minAmerican
  ));
}

export function bestPSumForMinOdds(game, book, minAmerican, filterNyc = false) {
  if (!book || !Number.isFinite(minAmerican)) return visibleBestPSum(game, filterNyc);
  const sums = scorableMarkets(game, filterNyc)
    .map((market) => market?.twoWay)
    .filter((twoWay) => twoWayHasMinOdds(twoWay, book, minAmerican))
    .map((twoWay) => twoWay.pSum)
    .filter((n) => Number.isFinite(n));
  return sums.length ? Math.min(...sums) : null;
}

/** Main ML / spread / O-U only — deep extras stay out of default sort. */
export function visibleBestPSum(game, _filterNyc = false) {
  const sums = [game?.moneyline, game?.spread, game?.total]
    .map((market) => market?.twoWay?.pSum)
    .filter((n) => Number.isFinite(n));
  return sums.length ? Math.min(...sums) : null;
}

export function sortPSum(game, sortOpts = null) {
  const oddsFilter = sortOpts?.oddsFilter ?? sortOpts;
  const filterNyc = Boolean(sortOpts?.filterNyc);
  const book = isRawBookId(oddsFilter?.book) ? oddsFilter.book : null;
  const minAmerican = oddsFilter?.minAmerican;
  if (book && Number.isFinite(minAmerican)) {
    return bestPSumForMinOdds(game, book, minAmerican, filterNyc);
  }
  return visibleBestPSum(game, filterNyc);
}

export function isBestTwoWay(market, game, sortOpts = null) {
  const twoWay = market?.twoWay;
  if (!twoWay || !Number.isFinite(twoWay.pSum)) return false;
  const target = sortPSum(game, sortOpts);
  if (!Number.isFinite(target) || twoWay.pSum !== target) return false;
  const oddsFilter = sortOpts?.oddsFilter ?? sortOpts;
  const book = isRawBookId(oddsFilter?.book) ? oddsFilter.book : null;
  if (book && Number.isFinite(oddsFilter?.minAmerican)) {
    return twoWayHasMinOdds(twoWay, book, oddsFilter.minAmerican);
  }
  return true;
}

export function filterGames(games, sport = 'all', timing = 'all', filterOpts = null) {
  const oddsFilter = filterOpts?.oddsFilter ?? filterOpts;
  const filterNyc = Boolean(filterOpts?.filterNyc);
  const book = isRawBookId(oddsFilter?.book) ? oddsFilter.book : null;
  const minAmerican = oddsFilter?.minAmerican;
  return (games ?? []).filter((game) => {
    if (sport && sport !== 'all' && game.sport !== sport) return false;
    if (timing === 'live' && !game.inPlay) return false;
    if (timing === 'upcoming' && game.inPlay) return false;
    if (book && Number.isFinite(minAmerican) && !gameHasMinOdds(game, book, minAmerican, filterNyc)) return false;
    return true;
  });
}

export function formatBookSides(book, kind) {
  if (!book) return { left: '—', right: '—' };
  if (kind === 'total') {
    const over = book.over;
    const under = book.under;
    return {
      left: over ? `O ${over.line} ${formatAmericanOdds(over.american)}` : '—',
      right: under ? `U ${under.line} ${formatAmericanOdds(under.american)}` : '—',
    };
  }
  const away = book.away;
  const home = book.home;
  if (kind === 'spread') {
    return {
      left: away ? `${formatLineNumber(away.line)} ${formatAmericanOdds(away.american)}` : '—',
      right: home ? `${formatLineNumber(home.line)} ${formatAmericanOdds(home.american)}` : '—',
    };
  }
  return {
    left: away ? formatAmericanOdds(away.american) : '—',
    right: home ? formatAmericanOdds(home.american) : '—',
  };
}

export function formatTwoWayLegs(twoWay) {
  if (!twoWay?.legs?.length) return '—';
  return twoWay.legs.map((leg) => {
    const book = bookShort(leg.book);
    let num = '';
    if (leg.side === 'over' || leg.side === 'under') {
      if (Number.isFinite(leg.line)) num = ` ${leg.line}`;
    } else if (Number.isFinite(leg.line) && leg.line !== 0) {
      num = ` ${formatLineNumber(leg.line)}`;
    }
    return `${book} ${leg.label}${num} ${formatAmericanOdds(leg.american)}`;
  }).join(' · ');
}

