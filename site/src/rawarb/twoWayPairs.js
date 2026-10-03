/**
 * Build the cheapest lock/middle two-way from two books' side quotes.
 * Gaps (lose+push) are dropped — same rule as the main lines.
 */

import { evaluateTwoWayArb } from '../corners/arbChecker.js';
import { formatAmericanOdds } from '../sop/sopModel.js';
import { lineFitFromCushion, quoteFromAmerican } from './rawArbModel.js';

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

export function pairMoneyline(fd, dk) {
  const options = [
    ['fd', 'away', fd?.away, 'dk', 'home', dk?.home],
    ['fd', 'home', fd?.home, 'dk', 'away', dk?.away],
  ];
  let best = null;
  for (const [b1, s1, q1, b2, s2, q2] of options) {
    const a = asQuote(q1);
    const b = asQuote(q2);
    if (!a || !b) continue;
    const ev = evaluateTwoWayArb(a, b, 100);
    best = better(best, pack(ev, 'lock', 0, {
      book: b1, side: s1, label: q1.label || q1.team || s1, american: a.american, line: null,
    }, {
      book: b2, side: s2, label: q2.label || q2.team || s2, american: b.american, line: null,
    }));
  }
  return best;
}

export function pairYesNo(fd, dk, yesKey = 'yes', noKey = 'no') {
  const options = [
    ['fd', yesKey, fd?.[yesKey], 'dk', noKey, dk?.[noKey]],
    ['fd', noKey, fd?.[noKey], 'dk', yesKey, dk?.[yesKey]],
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

export function pairSpreads(fd, dk) {
  let best = null;
  const arbs = [];
  const consider = (q1, q2, b1, s1, b2, s2) => {
    const a = asQuote(q1);
    const b = asQuote(q2);
    if (!a || !b || !Number.isFinite(a.line) || !Number.isFinite(b.line)) return;
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
    for (const home of listSides(dk, 'home')) consider(away, home, 'fd', 'away', 'dk', 'home');
  }
  for (const home of listSides(fd, 'home')) {
    for (const away of listSides(dk, 'away')) consider(home, away, 'fd', 'home', 'dk', 'away');
  }
  return { best, arbs };
}

export function pairTotals(fd, dk) {
  let best = null;
  const arbs = [];
  const consider = (over, under, overBook, underBook) => {
    const a = asQuote(over);
    const b = asQuote(under);
    if (!a || !b || !Number.isFinite(a.line) || !Number.isFinite(b.line)) return;
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
    for (const under of listSides(dk, 'under')) consider(over, under, 'fd', 'dk');
  }
  for (const over of listSides(dk, 'over')) {
    for (const under of listSides(fd, 'under')) consider(over, under, 'dk', 'fd');
  }
  return { best, arbs };
}

export function pairContract(kind, fd, dk) {
  if (kind === 'moneyline') return { best: pairMoneyline(fd, dk), arbs: [] };
  if (kind === 'yesno') {
    if (fd?.odd || dk?.odd) return { best: pairYesNo(fd, dk, 'odd', 'even'), arbs: [] };
    return { best: pairYesNo(fd, dk, 'yes', 'no'), arbs: [] };
  }
  if (kind === 'spread') return pairSpreads(fd, dk);
  return pairTotals(fd, dk);
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

export function formatSidesForRow(book, kind, twoWay, bookKey) {
  if (twoWay?.legs?.length) {
    const own = twoWay.legs.find((leg) => leg.book === bookKey);
    if (!own) return { left: '—', right: '—' };
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
