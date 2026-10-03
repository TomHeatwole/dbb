/**
 * Cross-book two-way: take opposite sides of the same market on FanDuel
 * and DraftKings, pick the pairing whose implieds sum closest to (or under) 1.
 */

import { evaluateTwoWayArb } from '../corners/arbChecker.js';
import { americanToImpliedProb, formatAmericanOdds } from '../sop/sopModel.js';
import { gameOrientation } from './teamMatch.js';

export function parseSignedAmerican(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw !== 0) return raw;
  const n = Number(String(raw).trim().replace(/\u2212/g, '-').replace(/^\+/, ''));
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

export function moneylineTwoWay(fd, dk, teams = {}) {
  const fdAway = sideQuote(fd, 'away', { team: teams.away });
  const fdHome = sideQuote(fd, 'home', { team: teams.home });
  const dkAway = sideQuote(dk, 'away', { team: teams.away });
  const dkHome = sideQuote(dk, 'home', { team: teams.home });
  return pickBestTwoWay(
    {
      a: fdAway,
      b: dkHome,
      lineFit: 'lock',
      legA: leg('fd', 'away', fdAway, teams.away || 'Away'),
      legB: leg('dk', 'home', dkHome, teams.home || 'Home'),
    },
    {
      a: fdHome,
      b: dkAway,
      lineFit: 'lock',
      legA: leg('fd', 'home', fdHome, teams.home || 'Home'),
      legB: leg('dk', 'away', dkAway, teams.away || 'Away'),
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

export function matchFdToDk(fdGames, dkGames) {
  const used = new Set();
  return fdGames.map((fd) => {
    let orientation = null;
    const hit = dkGames.find((dk, idx) => {
      if (used.has(idx)) return false;
      const how = gameOrientation(fd, dk);
      if (!how) return false;
      orientation = how;
      return true;
    });
    if (hit) used.add(dkGames.indexOf(hit));
    return { fd, dk: orientDkToFd(hit, orientation) };
  });
}

export function mergeBookGames(fdGames, dkGames, sport) {
  const pairs = matchFdToDk(fdGames, dkGames);
  const matchedDk = new Set(pairs.filter((row) => row.dk).map((row) => row.dk.eventId));
  const merged = pairs.map(({ fd, dk }) => buildGameMarkets({
    sport,
    home: fd.home,
    away: fd.away,
    openDate: fd.openDate || dk?.openDate || null,
    inPlay: Boolean(fd.inPlay || dk?.inPlay),
    fdEventId: fd.eventId ?? null,
    dkEventId: dk?.eventId ?? null,
    moneyline: { fd: fd.moneyline || null, dk: dk?.moneyline || null },
    spread: { fd: fd.spread || null, dk: dk?.spread || null },
    total: { fd: fd.total || null, dk: dk?.total || null },
  }));
  for (const dk of dkGames) {
    if (matchedDk.has(dk.eventId)) continue;
    merged.push(buildGameMarkets({
      sport,
      home: dk.home,
      away: dk.away,
      openDate: dk.openDate || null,
      inPlay: Boolean(dk.inPlay),
      fdEventId: null,
      dkEventId: dk.eventId ?? null,
      moneyline: { fd: null, dk: dk.moneyline || null },
      spread: { fd: null, dk: dk.spread || null },
      total: { fd: null, dk: dk.total || null },
    }));
  }
  return merged;
}

export function sortGames(games, mode = 'best') {
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
    const pa = a.bestPSum;
    const pb = b.bestPSum;
    if (pa == null && pb == null) return String(a.away).localeCompare(String(b.away));
    if (pa == null) return 1;
    if (pb == null) return -1;
    if (pa !== pb) return pa - pb;
    return String(a.away).localeCompare(String(b.away));
  });
  return copy;
}

export function filterGames(games, sport = 'all') {
  if (sport === 'cfb' || sport === 'nfl') {
    return (games ?? []).filter((game) => game.sport === sport);
  }
  return [...(games ?? [])];
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

