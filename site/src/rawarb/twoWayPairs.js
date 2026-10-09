/**
 * Build the cheapest lock/middle two-way from two books' side quotes.
 * Gaps (lose+push) are dropped — same rule as the main lines.
 */

import { evaluateTwoWayArb } from '../corners/arbChecker.js';
import { formatAmericanOdds } from '../sop/sopModel.js';
import { peopleMatch } from './marketNormalize.js';
import { isSplitLine, lineFitFromCushion, quoteFromAmerican } from './rawArbModel.js';
import { namesMatch, teamsMatch } from './teamMatch.js';

function sameCompetitor(a, b) {
  const la = a?.label || a?.team;
  const lb = b?.label || b?.team;
  if (!la || !lb) return false;
  return namesMatch(la, lb) || peopleMatch(la, lb) || teamsMatch(la, lb);
}

function asQuote(side) {
  if (!side) return null;
  const q = quoteFromAmerican(side.american);
  if (!q) return null;
  return { ...q, line: side.line, label: side.label, team: side.team };
}

function pack(ev, lineFit, lineDelta, legA, legB) {
  if (!ev || lineFit === 'gap') return null;
  return {
    pSum: ev.pSum,
    juice: ev.juice,
    roi: ev.roi,
    hasArb: ev.hasArb,
    lineFit,
    numberMatch: lineFit === 'lock',
    lineDelta: Number.isFinite(lineDelta) ? lineDelta : 0,
    legs: [legA, legB].filter(Boolean),
  };
}

function better(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.pSum !== b.pSum) return a.pSum < b.pSum ? a : b;
  if (a.lineFit !== b.lineFit) return a.lineFit === 'lock' ? a : b;
  return Math.abs(a.lineDelta) <= Math.abs(b.lineDelta) ? a : b;
}

export function pairMoneyline(fd, dk, bookA = 'fd', bookB = 'dk') {
  const options = [
    [bookA, 'away', fd?.away, bookB, 'home', dk?.home],
    [bookA, 'home', fd?.home, bookB, 'away', dk?.away],
  ];
  let best = null;
  for (const [b1, s1, q1, b2, s2, q2] of options) {
    const a = asQuote(q1);
    const b = asQuote(q2);
    if (!a || !b || sameCompetitor(q1, q2)) continue;
    const ev = evaluateTwoWayArb(a, b, 100);
    best = better(best, pack(ev, 'lock', 0, {
      book: b1, side: s1, label: q1.label || q1.team || s1, american: a.american, line: null,
    }, {
      book: b2, side: s2, label: q2.label || q2.team || s2, american: b.american, line: null,
    }));
  }
  return best;
}

function impliedOf(side) {
  const q = asQuote(side);
  return q?.implied ?? null;
}

/** Same-name Yes/No on two books still has to be the same contract. */
function yesNoSameMarket(fd, dk, yesKey, noKey) {
  const fdYes = impliedOf(fd?.[yesKey]);
  const dkYes = impliedOf(dk?.[yesKey]);
  if (fdYes != null && dkYes != null && Math.abs(fdYes - dkYes) > 0.2) return false;
  const fdNo = impliedOf(fd?.[noKey]);
  const dkNo = impliedOf(dk?.[noKey]);
  if (fdNo != null && dkNo != null && Math.abs(fdNo - dkNo) > 0.2) return false;
  return true;
}

export function pairYesNo(fd, dk, yesKey = 'yes', noKey = 'no', bookA = 'fd', bookB = 'dk') {
  if (!yesNoSameMarket(fd, dk, yesKey, noKey)) return null;
  const options = [
    [bookA, yesKey, fd?.[yesKey], bookB, noKey, dk?.[noKey]],
    [bookA, noKey, fd?.[noKey], bookB, yesKey, dk?.[yesKey]],
  ];
  let best = null;
  for (const [b1, s1, q1, b2, s2, q2] of options) {
    const a = asQuote(q1);
    const b = asQuote(q2);
    if (!a || !b) continue;
    const ev = evaluateTwoWayArb(a, b, 100);
    best = better(best, pack(ev, 'lock', 0, {
      book: b1, side: s1, label: q1.label || s1, american: a.american, line: null,
    }, {
      book: b2, side: s2, label: q2.label || s2, american: b.american, line: null,
    }));
  }
  return best;
}

function listSides(book, side) {
  if (!book) return [];
  if (Array.isArray(book[`${side}s`])) return book[`${side}s`];
  if (book[side]) return [book[side]];
  return [];
}

export function pairSpreads(fd, dk, bookA = 'fd', bookB = 'dk') {
  let best = null;
  const arbs = [];
  const consider = (q1, q2, b1, s1, b2, s2) => {
    const a = asQuote(q1);
    const b = asQuote(q2);
    if (!a || !b || !Number.isFinite(a.line) || !Number.isFinite(b.line)) return;
    if (isSplitLine(a.line) || isSplitLine(b.line)) return;
    const cushion = a.line + b.line;
    if (cushion > 0.5) return;
    const fit = lineFitFromCushion(cushion);
    const ev = evaluateTwoWayArb(a, b, 100);
    const row = pack(ev, fit, cushion, {
      book: b1, side: s1, label: q1.label || q1.team || s1, american: a.american, line: a.line,
    }, {
      book: b2, side: s2, label: q2.label || q2.team || s2, american: b.american, line: b.line,
    });
    if (!row) return;
    best = better(best, row);
    if (row.hasArb) arbs.push(row);
  };
  for (const away of listSides(fd, 'away')) {
    for (const home of listSides(dk, 'home')) consider(away, home, bookA, 'away', bookB, 'home');
  }
  for (const home of listSides(fd, 'home')) {
    for (const away of listSides(dk, 'away')) consider(home, away, bookA, 'home', bookB, 'away');
  }
  return { best, arbs };
}

export function pairTotals(fd, dk, bookA = 'fd', bookB = 'dk') {
  let best = null;
  const arbs = [];
  const consider = (over, under, overBook, underBook) => {
    const a = asQuote(over);
    const b = asQuote(under);
    if (!a || !b || !Number.isFinite(a.line) || !Number.isFinite(b.line)) return;
    if (isSplitLine(a.line) || isSplitLine(b.line)) return;
    const cushion = b.line - a.line;
    if (cushion > 0.5) return;
    const fit = lineFitFromCushion(cushion);
    const ev = evaluateTwoWayArb(a, b, 100);
    const row = pack(ev, fit, cushion, {
      book: overBook, side: 'over', label: over.label || 'Over', american: a.american, line: a.line,
    }, {
      book: underBook, side: 'under', label: under.label || 'Under', american: b.american, line: b.line,
    });
    if (!row) return;
    best = better(best, row);
    if (row.hasArb) arbs.push(row);
  };
  for (const over of listSides(fd, 'over')) {
    for (const under of listSides(dk, 'under')) consider(over, under, bookA, bookB);
  }
  for (const over of listSides(dk, 'over')) {
    for (const under of listSides(fd, 'under')) consider(over, under, bookB, bookA);
  }
  return { best, arbs };
}

/** Player O/U only at a line both books actually two-side. No longshot alt vs main. */
export function pairPlayerTotals(fd, dk, bookA = 'fd', bookB = 'dk') {
  const lines = new Set();
  for (const book of [fd, dk]) {
    for (const side of ['over', 'under']) {
      for (const row of listSides(book, side)) {
        if (Number.isFinite(row.line)) lines.add(row.line);
      }
    }
  }
  let best = null;
  const arbs = [];
  const atLine = (book, side, line) => (
    listSides(book, side).find((row) => row.line === line) || null
  );
  for (const line of lines) {
    const fdOver = atLine(fd, 'over', line);
    const fdUnder = atLine(fd, 'under', line);
    const dkOver = atLine(dk, 'over', line);
    const dkUnder = atLine(dk, 'under', line);
    if (!fdOver || !fdUnder || !dkOver || !dkUnder) continue;
    const { best: row, arbs: extra } = pairTotals(
      { over: fdOver, under: fdUnder },
      { over: dkOver, under: dkUnder },
      bookA,
      bookB,
    );
    if (row) best = better(best, row);
    for (const arb of extra) {
      if (arb !== row) arbs.push(arb);
    }
  }
  return { best, arbs };
}

export function pairContract(kind, fd, dk, bookA = 'fd', bookB = 'dk') {
  if (kind === 'moneyline') return { best: pairMoneyline(fd, dk, bookA, bookB), arbs: [] };
  if (kind === 'yesno') {
    if (fd?.odd || dk?.odd) return { best: pairYesNo(fd, dk, 'odd', 'even', bookA, bookB), arbs: [] };
    return { best: pairYesNo(fd, dk, 'yes', 'no', bookA, bookB), arbs: [] };
  }
  if (kind === 'spread') return pairSpreads(fd, dk, bookA, bookB);
  if (kind === 'player_ou') return pairPlayerTotals(fd, dk, bookA, bookB);
  return pairTotals(fd, dk, bookA, bookB);
}

/** Cheapest two-way among every pair of books that priced this contract. */
export function pairAmongBooks(kind, entries) {
  const rows = (entries || []).filter((row) => row?.id && row.quote);
  let best = null;
  const arbs = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const paired = pairContract(kind, rows[i].quote, rows[j].quote, rows[i].id, rows[j].id);
      if (paired.best) best = better(best, paired.best);
      if (paired.best?.hasArb) arbs.push(paired.best);
      for (const arb of paired.arbs || []) {
        if (arb?.hasArb && arb !== paired.best) arbs.push(arb);
      }
    }
  }
  return { best, arbs };
}

function formatLeg(leg, kind) {
  const odds = formatAmericanOdds(leg.american);
  if (kind === 'spread' && Number.isFinite(leg.line)) {
    const n = leg.line > 0 ? `+${leg.line}` : String(leg.line);
    return `${n} ${odds}`;
  }
  if ((kind === 'total' || kind === 'player_ou' || kind === 'team_total') && Number.isFinite(leg.line)) {
    const prefix = leg.side === 'under' ? 'U ' : 'O ';
    return `${prefix}${leg.line} ${odds}`;
  }
  return odds;
}

function formatBookAtLine(book, kind, line) {
  if (!book) return null;
  const leftSide = kind === 'spread' ? 'away' : 'over';
  const rightSide = kind === 'spread' ? 'home' : 'under';
  const at = (side) => {
    const rows = listSides(book, side);
    if (!Number.isFinite(line)) return rows[0] || null;
    return rows.find((row) => row.line === line) || null;
  };
  const left = at(leftSide);
  const right = at(rightSide);
  if (!left && !right) return null;
  return {
    left: left ? formatLeg({ ...left, side: leftSide }, kind) : '—',
    right: right ? formatLeg({ ...right, side: rightSide }, kind) : '—',
  };
}

export function formatSidesForRow(book, kind, twoWay, bookKey) {
  if (twoWay?.legs?.length) {
    const own = twoWay.legs.find((leg) => leg.book === bookKey);
    if (!own) {
      const line = twoWay.legs.find((leg) => Number.isFinite(leg.line))?.line;
      return formatBookAtLine(book, kind, line) || { left: '—', right: '—' };
    }
    const shown = formatLeg(own, kind);
    if (kind === 'spread') {
      return own.side === 'away' ? { left: shown, right: '—' } : { left: '—', right: shown };
    }
    if (kind === 'moneyline' || kind === 'yesno') {
      return own.side === 'away' || own.side === 'yes' || own.side === 'odd'
        ? { left: shown, right: '—' }
        : { left: '—', right: shown };
    }
    return own.side === 'over' ? { left: shown, right: '—' } : { left: '—', right: shown };
  }
  return formatExtraSides(book, kind);
}

export function formatExtraSides(book, kind) {
  if (!book) return { left: '—', right: '—' };
  const fmt = (side, prefix) => {
    const row = Array.isArray(book[`${side}s`]) ? book[`${side}s`][0] : book[side];
    if (!row) return '—';
    const odds = formatAmericanOdds(row.american);
    if (kind === 'spread' && Number.isFinite(row.line)) {
      const n = row.line > 0 ? `+${row.line}` : String(row.line);
      return `${n} ${odds}`;
    }
    if ((kind === 'total' || kind === 'player_ou' || kind === 'team_total') && Number.isFinite(row.line)) {
      return `${prefix}${row.line} ${odds}`;
    }
    return odds;
  };
  if (kind === 'yesno') {
    if (book.odd || book.even) return { left: book.odd ? `Odd ${formatAmericanOdds(book.odd.american)}` : '—', right: book.even ? `Even ${formatAmericanOdds(book.even.american)}` : '—' };
    return { left: book.yes ? `Yes ${formatAmericanOdds(book.yes.american)}` : '—', right: book.no ? `No ${formatAmericanOdds(book.no.american)}` : '—' };
  }
  if (kind === 'moneyline') return { left: fmt('away', ''), right: fmt('home', '') };
  if (kind === 'spread') return { left: fmt('away', ''), right: fmt('home', '') };
  return { left: fmt('over', 'O '), right: fmt('under', 'U ') };
}
