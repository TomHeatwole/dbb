/**
 * Cross-book two-way: take opposite sides of the same market on FanDuel
 * and DraftKings, pick the pairing whose implieds sum closest to (or under) 1.
 */

import { evaluateTwoWayArb } from '../corners/arbChecker.js';
import { americanToImpliedProb, formatAmericanOdds } from '../sop/sopModel.js';
import { peopleMatch } from './marketNormalize.js';
import { matchModeForSport } from './sportCatalog.js';
import { nycVisibleExtras } from './nycFilter.js';
import { matchQuality, namesMatch, teamsMatch } from './teamMatch.js';

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
  return {
    a,
    b,
    lineFit: lineFitFromCushion(cushion) || 'gap',
    lineDelta: cushion,
    legA,
    legB,
  };
}

function totalPair(over, under, overLeg, underLeg) {
  const cushion = Number.isFinite(over?.line) && Number.isFinite(under?.line)
    ? under.line - over.line
    : null;
  return {
    a: over,
    b: under,
    lineFit: lineFitFromCushion(cushion) || 'gap',
    lineDelta: cushion,
    legA: overLeg,
    legB: underLeg,
  };
}

function sameCompetitor(a, b) {
  const ta = a?.team;
  const tb = b?.team;
  if (!ta || !tb) return false;
  return namesMatch(ta, tb) || peopleMatch(ta, tb) || teamsMatch(ta, tb);
}

export function moneylineTwoWay(fd, dk, teams = {}) {
  const fdAway = sideQuote(fd, 'away', { team: teams.away });
  const fdHome = sideQuote(fd, 'home', { team: teams.home });
  const dkAway = sideQuote(dk, 'away', { team: teams.away });
  const dkHome = sideQuote(dk, 'home', { team: teams.home });
  if (sameCompetitor(fdAway, fdHome) || sameCompetitor(dkAway, dkHome)) return null;
  return pickBestTwoWay(
    sameCompetitor(fdAway, dkHome) ? null : {
      a: fdAway,
      b: dkHome,
      lineFit: 'lock',
      legA: leg('fd', 'away', fdAway, fdAway?.team || teams.away || 'Away'),
      legB: leg('dk', 'home', dkHome, dkHome?.team || teams.home || 'Home'),
    },
    sameCompetitor(fdHome, dkAway) ? null : {
      a: fdHome,
      b: dkAway,
      lineFit: 'lock',
      legA: leg('fd', 'home', fdHome, fdHome?.team || teams.home || 'Home'),
      legB: leg('dk', 'away', dkAway, dkAway?.team || teams.away || 'Away'),
    },
  );
}

export function spreadTwoWay(fd, dk, teams = {}) {
  const fdAway = sideQuote(fd, 'away', { team: teams.away });
  const fdHome = sideQuote(fd, 'home', { team: teams.home });
  const dkAway = sideQuote(dk, 'away', { team: teams.away });
  const dkHome = sideQuote(dk, 'home', { team: teams.home });
  return pickBestTwoWay(
    spreadPair(
      fdAway,
      dkHome,
      leg('fd', 'away', fdAway, teams.away || 'Away'),
      leg('dk', 'home', dkHome, teams.home || 'Home'),
    ),
    spreadPair(
      fdHome,
      dkAway,
      leg('fd', 'home', fdHome, teams.home || 'Home'),
      leg('dk', 'away', dkAway, teams.away || 'Away'),
    ),
  );
}

export function totalTwoWay(fd, dk) {
  const fdOver = sideQuote(fd, 'over');
  const fdUnder = sideQuote(fd, 'under');
  const dkOver = sideQuote(dk, 'over');
  const dkUnder = sideQuote(dk, 'under');
  return pickBestTwoWay(
    totalPair(
      fdOver,
      dkUnder,
      leg('fd', 'over', fdOver, 'Over'),
      leg('dk', 'under', dkUnder, 'Under'),
    ),
    totalPair(
      dkOver,
      fdUnder,
      leg('dk', 'over', dkOver, 'Over'),
      leg('fd', 'under', fdUnder, 'Under'),
    ),
  );
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
  const book = oddsFilter?.book === 'dk' || oddsFilter?.book === 'fd' ? oddsFilter.book : null;
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
  const book = oddsFilter?.book === 'dk' || oddsFilter?.book === 'fd' ? oddsFilter.book : null;
  if (book && Number.isFinite(oddsFilter?.minAmerican)) {
    return twoWayHasMinOdds(twoWay, book, oddsFilter.minAmerican);
  }
  return true;
}

export function filterGames(games, sport = 'all', timing = 'all', filterOpts = null) {
  const oddsFilter = filterOpts?.oddsFilter ?? filterOpts;
  const filterNyc = Boolean(filterOpts?.filterNyc);
  const book = oddsFilter?.book === 'dk' || oddsFilter?.book === 'fd' ? oddsFilter.book : null;
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
    const book = leg.book === 'fd' ? 'FD' : 'DK';
    let num = '';
    if (leg.side === 'over' || leg.side === 'under') {
      if (Number.isFinite(leg.line)) num = ` ${leg.line}`;
    } else if (Number.isFinite(leg.line) && leg.line !== 0) {
      num = ` ${formatLineNumber(leg.line)}`;
    }
    return `${book} ${leg.label}${num} ${formatAmericanOdds(leg.american)}`;
  }).join(' · ');
}

