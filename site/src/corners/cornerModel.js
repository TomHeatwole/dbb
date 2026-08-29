/**
 * Live PL corner book model.
 *
 * Scale is the 2023–26 ESPN mean (10.35 / match). Shape is the 5-minute
 * histogram from espn_pl_corner_histogram.md. The FanDuel O/U + odds invert
 * to a market-implied expected total; remaining time (including stoppage)
 * allocates that expectation into the next 5/10-minute window.
 */

import {
  americanToImpliedProb,
  analyzeAgainstBreakeven,
  formatAmericanOdds,
  probToAmerican,
} from '../sop/sopModel.js';

export const MEAN_CORNERS_PER_MATCH = 10.347673397717296; // 11786 / 1139
export const TYPICAL_HT_STOPPAGE_MIN = 3.3;
export const TYPICAL_FT_STOPPAGE_MIN = 4.8;
export const REGULAR_MINUTES = 90;

/** ESPN 2023–26 counts / 11,786. */
export const CORNER_BINS = [
  { id: '1-5', start: 0, end: 5, half: 1, kind: 'regular', n: 527 },
  { id: '6-10', start: 5, end: 10, half: 1, kind: 'regular', n: 602 },
  { id: '11-15', start: 10, end: 15, half: 1, kind: 'regular', n: 574 },
  { id: '16-20', start: 15, end: 20, half: 1, kind: 'regular', n: 556 },
  { id: '21-25', start: 20, end: 25, half: 1, kind: 'regular', n: 578 },
  { id: '26-30', start: 25, end: 30, half: 1, kind: 'regular', n: 529 },
  { id: '31-35', start: 30, end: 35, half: 1, kind: 'regular', n: 540 },
  { id: '36-40', start: 35, end: 40, half: 1, kind: 'regular', n: 584 },
  { id: '41-45', start: 40, end: 45, half: 1, kind: 'regular', n: 613 },
  { id: '45+', start: 45, end: 45, half: 1, kind: 'ht+', n: 421 },
  { id: '46-50', start: 45, end: 50, half: 2, kind: 'regular', n: 569 },
  { id: '51-55', start: 50, end: 55, half: 2, kind: 'regular', n: 681 },
  { id: '56-60', start: 55, end: 60, half: 2, kind: 'regular', n: 629 },
  { id: '61-65', start: 60, end: 65, half: 2, kind: 'regular', n: 641 },
  { id: '66-70', start: 65, end: 70, half: 2, kind: 'regular', n: 622 },
  { id: '71-75', start: 70, end: 75, half: 2, kind: 'regular', n: 573 },
  { id: '76-80', start: 75, end: 80, half: 2, kind: 'regular', n: 532 },
  { id: '81-85', start: 80, end: 85, half: 2, kind: 'regular', n: 568 },
  { id: '86-90', start: 85, end: 90, half: 2, kind: 'regular', n: 573 },
  { id: '90+', start: 90, end: 90, half: 2, kind: 'ft+', n: 874 },
];

const TOTAL_N = CORNER_BINS.reduce((s, b) => s + b.n, 0);

for (const bin of CORNER_BINS) {
  bin.share = bin.n / TOTAL_N;
  bin.typicalMinutes = bin.kind === 'ht+'
    ? TYPICAL_HT_STOPPAGE_MIN
    : bin.kind === 'ft+'
      ? TYPICAL_FT_STOPPAGE_MIN
      : bin.end - bin.start;
}

export const TYPICAL_MATCH_MINUTES =
  REGULAR_MINUTES + TYPICAL_HT_STOPPAGE_MIN + TYPICAL_FT_STOPPAGE_MIN;

export function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;
  let term = Math.exp(-lambda);
  for (let i = 1; i <= k; i += 1) term *= lambda / i;
  return term;
}

/** P(N <= k). */
export function poissonCdf(k, lambda) {
  if (lambda <= 0) return k >= 0 ? 1 : 0;
  if (k < 0) return 0;
  const cap = Math.floor(k);
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= cap; i += 1) {
    term *= lambda / i;
    sum += term;
    if (!Number.isFinite(sum)) return 1;
  }
  return Math.min(1, sum);
}

export function poissonSfGe(k, lambda) {
  if (k <= 0) return 1;
  return Math.max(0, 1 - poissonCdf(k - 1, lambda));
}

/**
 * Invert λ such that P(Poisson(λ) >= k) = p.
 * k is the smallest integer that counts as "over" (e.g. 11 for Over 10.5).
 */
export function invertPoissonLambda(k, p) {
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (p >= 1) return k + 20;
  if (!Number.isFinite(k) || k <= 0) {
    // P(N >= 1) = 1 - e^{-λ} = p  => λ = -ln(1-p)
    return p >= 1 ? 20 : -Math.log(1 - p);
  }
  let lo = 0;
  let hi = Math.max(k * 4, 8);
  while (poissonSfGe(k, hi) < p && hi < 80) hi *= 1.5;
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2;
    if (poissonSfGe(k, mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function pickClosestPlus(plus) {
  const rows = (plus ?? []).filter((row) => row?.american != null && Number.isFinite(row.n));
  if (!rows.length) return null;
  return [...rows].sort((a, b) => {
    const da = Math.abs((americanToImpliedProb(a.american) ?? 1) - 0.5);
    const db = Math.abs((americanToImpliedProb(b.american) ?? 1) - 0.5);
    return da - db;
  })[0];
}

/**
 * Expected remaining corners implied by an N+ contract (Kalshi-style),
 * given corners already taken. Yes = P(total >= n).
 */
export function impliedRemainingFromPlus(plusRow, cornersSoFar = 0) {
  if (!plusRow || !Number.isFinite(plusRow.n)) return null;
  const pOver = vigRemovedOverProb(plusRow.american, plusRow.noAmerican)
    ?? americanToImpliedProb(plusRow.american);
  if (pOver == null) return null;
  const c = Math.max(0, Number(cornersSoFar) || 0);
  const need = plusRow.n - c;
  if (need <= 0) {
    return {
      line: plusRow.n - 0.5,
      n: plusRow.n,
      kind: 'plus',
      pOver,
      cornersSoFar: c,
      remaining: 0,
      impliedTotal: c,
      alreadyOver: true,
    };
  }
  const remaining = invertPoissonLambda(need, pOver);
  return {
    line: plusRow.n - 0.5,
    n: plusRow.n,
    kind: 'plus',
    pOver,
    cornersSoFar: c,
    remaining,
    impliedTotal: c + remaining,
    alreadyOver: false,
  };
}

export function listCornerBaselines(game) {
  const c = Number.isFinite(game?.cornersSoFar) ? game.cornersSoFar : 0;
  const rows = [];
  if (game?.total && (game.total.over?.american != null || game.total.under?.american != null)) {
    rows.push({
      book: 'fd',
      kind: 'ou',
      line: game.total.line,
      over: game.total.over ?? null,
      under: game.total.under ?? null,
      implied: impliedRemainingFromLine(game.total, c),
    });
  }
  const dkTotal = game?.dk?.total
    ?? (game?.dk?.totals ?? []).find((row) => row?.over?.american != null || row?.under?.american != null)
    ?? null;
  if (dkTotal && (dkTotal.over?.american != null || dkTotal.under?.american != null)) {
    rows.push({
      book: 'dk',
      kind: 'ou',
      line: dkTotal.line,
      over: dkTotal.over ?? null,
      under: dkTotal.under ?? null,
      implied: impliedRemainingFromLine(dkTotal, c),
    });
  }
  const plus = pickClosestPlus(game?.klsh?.plus);
  if (plus) {
    rows.push({
      book: 'klsh',
      kind: 'plus',
      n: plus.n,
      line: plus.n - 0.5,
      american: plus.american,
      noAmerican: plus.noAmerican ?? null,
      implied: impliedRemainingFromPlus(plus, c),
    });
  }
  return rows;
}

export function resolveCornerBaseline(game, requestedBook = 'fd') {
  const rows = listCornerBaselines(game);
  if (!rows.length) return { book: null, row: null, baselines: rows };
  const row = rows.find((r) => r.book === requestedBook) ?? rows[0];
  return { book: row.book, row, baselines: rows };
}

export function baselineBookLabel(book) {
  if (book === 'dk') return 'DraftKings';
  if (book === 'klsh') return 'Kalshi';
  return 'FanDuel';
}

function lineKey(line) {
  const n = Number(line);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 2) / 2;
}

function bookTag(book) {
  if (book === 'dk') return 'DK';
  if (book === 'klsh') return 'KLSH';
  return 'FD';
}

function quoteKey(quote) {
  return `${quote.book}|${quote.line}|${quote.side}`;
}

function keepBetterQuote(map, quote) {
  const p = americanToImpliedProb(quote.american);
  if (p == null || p <= 0 || p >= 1) return;
  const full = { ...quote, implied: p };
  const key = quoteKey(full);
  const prev = map.get(key);
  if (!prev || full.implied < prev.implied) map.set(key, full);
}

function pushOuQuote(map, book, line, side, american, ticket) {
  const key = lineKey(line);
  if (key == null || !Number.isFinite(american)) return;
  keepBetterQuote(map, {
    book,
    line: key,
    side,
    american,
    ticket: ticket ?? `${bookTag(book)} ${side === 'over' ? 'O' : 'U'} ${key}`,
  });
}

function pushOuRow(map, book, row) {
  if (!row || !Number.isFinite(row.line)) return;
  const line = lineKey(row.line);
  if (line == null) return;
  const tag = bookTag(book);
  pushOuQuote(map, book, line, 'over', row.over?.american, `${tag} O ${line}`);
  pushOuQuote(map, book, line, 'under', row.under?.american, `${tag} U ${line}`);
}

function collectTotalOuQuotes(game) {
  const map = new Map();

  pushOuRow(map, 'fd', game?.total);
  for (const row of game?.totals ?? []) pushOuRow(map, 'fd', row);

  for (const row of game?.numberOfCorners?.unders ?? []) {
    if (!Number.isFinite(row?.n)) continue;
    // Under N ≡ total ≤ N−1 ≡ Under (N−0.5)
    pushOuQuote(map, 'fd', row.n - 0.5, 'under', row.american, `FD Under ${row.n}`);
  }
  for (const row of game?.numberOfCorners?.overs ?? []) {
    if (!Number.isFinite(row?.n)) continue;
    // Over N ≡ total ≥ N+1 ≡ Over (N+0.5)
    pushOuQuote(map, 'fd', row.n + 0.5, 'over', row.american, `FD Over ${row.n}`);
  }

  const dkRows = [];
  for (const row of game?.dk?.totals ?? []) dkRows.push(row);
  if (game?.dk?.total && !dkRows.some((row) => lineKey(row.line) === lineKey(game.dk.total.line))) {
    dkRows.push(game.dk.total);
  }
  for (const row of dkRows) pushOuRow(map, 'dk', row);

  for (const plus of game?.klsh?.plus ?? []) {
    if (!Number.isFinite(plus?.n)) continue;
    const n = plus.n;
    pushOuQuote(map, 'klsh', n - 0.5, 'over', plus.american, `KLSH ${n}+`);
    pushOuQuote(map, 'klsh', n - 0.5, 'under', plus.noAmerican, `KLSH No ${n}+`);
  }
  return [...map.values()];
}

function collectExactQuotes(game) {
  const map = new Map();
  for (const row of game?.numberOfCorners?.exact ?? []) {
    if (!Number.isFinite(row?.n) || !Number.isFinite(row.american)) continue;
    keepBetterQuote(map, {
      book: 'fd',
      line: row.n,
      side: 'exact',
      n: row.n,
      american: row.american,
      ticket: `FD Ex ${row.n}`,
    });
  }
  return [...map.values()];
}

function sideLabel(quote) {
  if (quote?.ticket) return quote.ticket;
  const tag = bookTag(quote.book);
  if (quote.book === 'klsh') {
    const n = Math.round(quote.line + 0.5);
    return quote.side === 'over' ? `${tag} ${n}+` : `${tag} No ${n}+`;
  }
  if (quote.side === 'exact') return `${tag} Ex ${quote.n ?? quote.line}`;
  return `${tag} ${quote.side === 'over' ? 'O' : 'U'} ${quote.line}`;
}

function pushCoverArb(arbs, legs, { kind, line }) {
  if (legs.length < 2) return;
  const books = new Set(legs.map((leg) => leg.book));
  if (books.size < 2) return;
  const pSum = legs.reduce((sum, leg) => sum + leg.implied, 0);
  if (!(pSum > 0) || pSum >= 0.999) return;
  const roi = (1 / pSum) - 1;
  if (roi < 0.001) return;
  const labeled = legs.map((leg) => ({
    ...leg,
    label: sideLabel(leg),
    share: leg.implied / pSum,
  }));
  const id = `total-arb:${kind}:${line}:${labeled.map((leg) => `${leg.book}-${leg.side}`).join(':')}`;
  arbs.push({
    id,
    kind,
    line,
    roi,
    pSum,
    legs: labeled,
    over: labeled.find((leg) => leg.side === 'over') ?? null,
    under: labeled.find((leg) => leg.side === 'under') ?? null,
    overLabel: labeled.find((leg) => leg.side === 'over')?.label ?? labeled[0].label,
    underLabel: labeled.find((leg) => leg.side === 'under')?.label ?? labeled[labeled.length - 1].label,
    overShare: labeled.find((leg) => leg.side === 'over')?.share ?? labeled[0].share,
    underShare: labeled.find((leg) => leg.side === 'under')?.share ?? labeled[labeled.length - 1].share,
  });
}

/**
 * Cross-book cover of the match total. 2-way: Over L vs Under L (same L.5).
 * FanDuel Under N ≡ Under (N−0.5); Over N ≡ Over (N+0.5); Kalshi n+ Yes ≡ Over (n−0.5).
 * 3-way: Under (n−0.5) + Exactly n + Over (n+0.5) when FD posts an exact.
 */
export function findTotalCornerArbs(game) {
  const quotes = collectTotalOuQuotes(game);
  const exacts = collectExactQuotes(game);
  const arbs = [];
  const byLine = new Map();
  for (const quote of quotes) {
    const list = byLine.get(quote.line) ?? [];
    list.push(quote);
    byLine.set(quote.line, list);
  }

  for (const [line, list] of byLine) {
    const overs = list.filter((q) => q.side === 'over');
    const unders = list.filter((q) => q.side === 'under');
    for (const over of overs) {
      for (const under of unders) {
        pushCoverArb(arbs, [over, under], { kind: '2way', line });
      }
    }
  }

  const ns = new Set(exacts.map((row) => row.n ?? row.line));
  for (const n of ns) {
    const unders = quotes.filter((q) => q.side === 'under' && q.line === n - 0.5);
    const overs = quotes.filter((q) => q.side === 'over' && q.line === n + 0.5);
    const exactRows = exacts.filter((q) => (q.n ?? q.line) === n);
    for (const under of unders) {
      for (const exact of exactRows) {
        for (const over of overs) {
          pushCoverArb(arbs, [under, exact, over], { kind: '3way', line: n });
        }
      }
    }
  }

  arbs.sort((a, b) => b.roi - a.roi);
  return arbs;
}

export function vigRemovedOverProb(overAmerican, underAmerican) {
  const over = americanToImpliedProb(overAmerican);
  const under = americanToImpliedProb(underAmerican);
  if (over == null && under == null) return null;
  if (over == null) return 1 - under;
  if (under == null) return over;
  const sum = over + under;
  if (sum <= 0) return null;
  return over / sum;
}

/**
 * Expected remaining corners implied by an O/U L.5 with Over/Under odds,
 * given corners already taken.
 */
export function impliedRemainingFromLine(total, cornersSoFar = 0) {
  if (!total || !Number.isFinite(total.line)) return null;
  const pOver = vigRemovedOverProb(total.over?.american, total.under?.american);
  if (pOver == null) return null;
  const c = Math.max(0, Number(cornersSoFar) || 0);
  const overAt = Math.floor(total.line) + 1; // 10.5 → 11
  const need = overAt - c;
  if (need <= 0) {
    return {
      line: total.line,
      pOver,
      cornersSoFar: c,
      remaining: 0,
      impliedTotal: c,
      alreadyOver: true,
    };
  }
  const remaining = invertPoissonLambda(need, pOver);
  return {
    line: total.line,
    pOver,
    cornersSoFar: c,
    remaining,
    impliedTotal: c + remaining,
    alreadyOver: false,
  };
}

export function parseClockState(stoppage) {
  if (!stoppage) {
    return {
      phase: 'pre',
      period: null,
      elapsed: 0,
      plus: 0,
      inStoppage: false,
      halftime: false,
      finished: false,
    };
  }
  const status = String(stoppage.status ?? '').toLowerCase();
  const matchStatus = String(stoppage.matchStatus ?? '');
  const finished = status === 'post'
    || /\bfull[\s-]?time\b/i.test(matchStatus)
    || /^(FT|STATUS_FULL_TIME)$/i.test(matchStatus.trim());
  const halftime = Boolean(stoppage.halfTime)
    || /HALF[\s_-]?TIME/i.test(matchStatus)
    || /STATUS_HALFTIME/i.test(matchStatus);
  const period = Number(stoppage.period) || (halftime ? 1 : null);
  const clock = String(stoppage.clock ?? '');
  const m = clock.match(/^(\d+)'(?:\+(\d+)')?$/);
  const elapsed = m ? Number(m[1]) : (stoppage.elapsed ?? 0);
  const plus = m ? Number(m[2] || 0) : (stoppage.plus ?? 0);
  const inStoppage = plus > 0 || Boolean(stoppage.inStoppage);
  if (finished) {
    return { phase: 'post', period: 2, elapsed: 90, plus, inStoppage: false, halftime: false, finished: true };
  }
  if (halftime) {
    return { phase: 'ht', period: 1, elapsed: 45, plus: 0, inStoppage: false, halftime: true, finished: false };
  }
  if (status !== 'in' && !clock) {
    return { phase: 'pre', period: null, elapsed: 0, plus: 0, inStoppage: false, halftime: false, finished: false };
  }
  return {
    phase: 'live',
    period: period || (elapsed <= 45 ? 1 : 2),
    elapsed,
    plus,
    inStoppage,
    halftime: false,
    finished: false,
  };
}

function minutesFromLabel(label) {
  if (!label) return null;
  const s = String(label).trim();
  const mmss = s.match(/^(\d+):(\d+)$/);
  if (mmss) return Number(mmss[1]) + Number(mmss[2]) / 60;
  const prime = s.match(/^(\d+)(?:'(\+(\d+)')?)?$/);
  if (prime) return Number(prime[1]) + Number(prime[3] || 0);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function stoppagePlan(clock, stoppage, { hasFirstHalfLine = false } = {}) {
  const liveExpected = Number(stoppage?.expectedMinutes);
  const played = minutesFromLabel(stoppage?.played) ?? (clock.inStoppage ? clock.plus : 0);
  const announced = minutesFromLabel(stoppage?.announced);

  const htExpected = clock.period === 1 && Number.isFinite(liveExpected)
    ? Math.max(liveExpected, announced ?? 0, played ?? 0)
    : TYPICAL_HT_STOPPAGE_MIN;
  const ftExpected = clock.period === 2 && Number.isFinite(liveExpected)
    ? Math.max(liveExpected, announced ?? 0, played ?? 0)
    : TYPICAL_FT_STOPPAGE_MIN;

  let htRemaining = 0;
  let ftRemaining = 0;
  let used = 'typical averages';

  if (clock.phase === 'pre') {
    htRemaining = TYPICAL_HT_STOPPAGE_MIN;
    ftRemaining = hasFirstHalfLine ? 0 : TYPICAL_FT_STOPPAGE_MIN;
    used = hasFirstHalfLine
      ? 'pre-match first-half line · typical HT 3.3′'
      : 'pre-match typical HT 3.3′ + FT 4.8′';
  } else if (clock.phase === 'ht') {
    htRemaining = 0;
    ftRemaining = TYPICAL_FT_STOPPAGE_MIN;
    used = 'half-time · average second-half stoppage 4.8′';
  } else if (clock.phase === 'post') {
    htRemaining = 0;
    ftRemaining = 0;
    used = 'full time';
  } else if (clock.period === 1) {
    const htPlayed = clock.inStoppage ? clock.plus : 0;
    htRemaining = Math.max(0, htExpected - htPlayed);
    if (hasFirstHalfLine) {
      ftRemaining = 0;
      used = `first-half line · HT stoppage ${htRemaining.toFixed(1)}′`;
    } else {
      ftRemaining = TYPICAL_FT_STOPPAGE_MIN;
      used = `full-game line in H1 · HT ${htRemaining.toFixed(1)}′ + avg FT 4.8′`;
    }
  } else {
    htRemaining = 0;
    const ftPlayed = clock.inStoppage ? clock.plus : 0;
    ftRemaining = Math.max(0, ftExpected - ftPlayed);
    used = `FT stoppage ${ftRemaining.toFixed(1)}′`;
  }

  return {
    htExpected,
    ftExpected,
    htRemaining,
    ftRemaining,
    used,
  };
}

function regularPlayedMinutes(clock) {
  if (clock.phase === 'pre') return 0;
  if (clock.phase === 'ht' || clock.finished) return clock.phase === 'ht' ? 45 : 90;
  if (clock.inStoppage) return clock.period === 1 ? 45 : 90;
  const e = Number(clock.elapsed) || 0;
  if (clock.period === 1) return Math.max(0, Math.min(45, e));
  return Math.max(45, Math.min(90, e));
}

function binRemainingMinutes(bin, clock, plan) {
  if (bin.kind === 'ht+') {
    return clock.period === 2 || clock.phase === 'ht' || clock.finished ? 0 : plan.htRemaining;
  }
  if (bin.kind === 'ft+') {
    if (clock.finished) return 0;
    if (clock.period === 1 || clock.phase === 'pre' || clock.phase === 'ht') return plan.ftRemaining;
    return plan.ftRemaining;
  }
  const played = regularPlayedMinutes(clock);
  if (played >= bin.end) return 0;
  if (played <= bin.start) return bin.end - bin.start;
  return bin.end - played;
}

function binShareForMinutes(bin, minutes, mode) {
  if (minutes <= 0) return 0;
  if (mode === 'uniform') {
    return minutes / TYPICAL_MATCH_MINUTES;
  }
  const typical = bin.typicalMinutes || 5;
  return bin.share * (minutes / typical);
}

export function remainingBreakdown(clock, plan, mode = 'bucketed') {
  const rows = CORNER_BINS.map((bin) => {
    const minutes = binRemainingMinutes(bin, clock, plan);
    const share = binShareForMinutes(bin, minutes, mode);
    const uniformShare = binShareForMinutes(bin, minutes, 'uniform');
    const expected = MEAN_CORNERS_PER_MATCH * share;
    return {
      id: bin.id,
      kind: bin.kind,
      half: bin.half,
      histShare: bin.share,
      uniformBinShare: (bin.typicalMinutes || 5) / TYPICAL_MATCH_MINUTES,
      minutes,
      remainingShare: share,
      uniformRemainingShare: uniformShare,
      expected,
      pAtLeastOne: expected > 0 ? 1 - Math.exp(-expected) : 0,
    };
  });
  const remainingShare = rows.reduce((s, r) => s + r.remainingShare, 0);
  const remainingMinutes = rows.reduce((s, r) => s + r.minutes, 0);
  return { rows, remainingShare, remainingMinutes, mode };
}

function windowRegularRange(windowMarket) {
  const start = windowMarket?.startSeconds;
  const end = windowMarket?.endSeconds;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return { startMin: start / 60, endMin: end / 60 };
  }
  const parsed = String(windowMarket?.window ?? '').match(
    /(\d{1,3}):(\d{2})\s*[-–]\s*(\d{1,3}):(\d{2})/,
  );
  if (parsed) {
    return {
      startMin: Number(parsed[1]) + Number(parsed[2]) / 60,
      endMin: Number(parsed[3]) + Number(parsed[4]) / 60,
    };
  }
  const minutes = Number(windowMarket?.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const played = 0;
  return { startMin: played, endMin: played + minutes };
}

/**
 * Remaining histogram share that still falls inside a FanDuel 5/10-min window.
 * End-of-half windows (…–45:00 / …–90:00) include remaining stoppage.
 */
export function windowRemainingShare(windowMarket, clock, plan, mode = 'bucketed') {
  const range = windowRegularRange(windowMarket);
  if (!range) return null;
  const { startMin, endMin } = range;
  const includeHt = endMin >= 44.9 && endMin <= 45.1 && clock.period !== 2 && clock.phase !== 'ht';
  const includeFt = endMin >= 89.9 && endMin <= 90.1;
  const inThisHalfStoppage = clock.inStoppage && (
    (clock.period === 1 && includeHt) || (clock.period === 2 && includeFt)
  );

  let share = 0;
  let uniformShare = 0;
  let minutes = 0;
  const bits = [];

  for (const bin of CORNER_BINS) {
    if (bin.kind === 'ht+') {
      if (includeHt || (inThisHalfStoppage && clock.period === 1)) {
        const mins = plan.htRemaining;
        const s = binShareForMinutes(bin, mins, mode);
        const u = binShareForMinutes(bin, mins, 'uniform');
        share += s;
        uniformShare += u;
        minutes += mins;
        if (mins > 0) {
          bits.push({
            id: bin.id,
            minutes: mins,
            share: s,
            histShare: bin.share,
            expected: MEAN_CORNERS_PER_MATCH * s,
            extra: true,
          });
        }
      }
      continue;
    }
    if (bin.kind === 'ft+') {
      if (includeFt || (inThisHalfStoppage && clock.period === 2)) {
        const mins = plan.ftRemaining;
        const s = binShareForMinutes(bin, mins, mode);
        const u = binShareForMinutes(bin, mins, 'uniform');
        share += s;
        uniformShare += u;
        minutes += mins;
        if (mins > 0) {
          bits.push({
            id: bin.id,
            minutes: mins,
            share: s,
            histShare: bin.share,
            expected: MEAN_CORNERS_PER_MATCH * s,
            extra: true,
          });
        }
      }
      continue;
    }
    const overlapStart = Math.max(bin.start, startMin);
    const overlapEnd = Math.min(bin.end, endMin);
    if (overlapEnd <= overlapStart) continue;
    const played = regularPlayedMinutes(clock);
    const remainingStart = Math.max(overlapStart, played);
    const rem = Math.max(0, overlapEnd - remainingStart);
    if (rem <= 0) continue;
    const s = binShareForMinutes(bin, rem, mode);
    const u = binShareForMinutes(bin, rem, 'uniform');
    share += s;
    uniformShare += u;
    minutes += rem;
    bits.push({
      id: bin.id,
      minutes: rem,
      share: s,
      histShare: bin.share,
      expected: MEAN_CORNERS_PER_MATCH * s,
      extra: false,
    });
  }

  let histWindowShare = CORNER_BINS
    .filter((b) => b.kind === 'regular' && b.end > startMin && b.start < endMin)
    .reduce((s, b) => {
      const overlap = Math.min(b.end, endMin) - Math.max(b.start, startMin);
      return s + b.share * (overlap / (b.end - b.start));
    }, 0);
  let extraTypical = 0;
  if (includeHt) {
    const ht = CORNER_BINS.find((b) => b.kind === 'ht+');
    histWindowShare += ht?.share ?? 0;
    extraTypical += TYPICAL_HT_STOPPAGE_MIN;
  }
  if (includeFt) {
    const ft = CORNER_BINS.find((b) => b.kind === 'ft+');
    histWindowShare += ft?.share ?? 0;
    extraTypical += TYPICAL_FT_STOPPAGE_MIN;
  }
  const uniformWindowShare = (endMin - startMin + extraTypical) / TYPICAL_MATCH_MINUTES;

  return {
    startMin,
    endMin,
    minutes,
    remainingShare: share,
    uniformRemainingShare: uniformShare,
    histWindowShare,
    uniformWindowShare,
    bits,
    includeHt,
    includeFt,
  };
}

export function formatExpected(n, digits = 2) {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

export function formatSharePct(share) {
  if (!Number.isFinite(share)) return '—';
  return `${(share * 100).toFixed(2)}%`;
}

export function formatEdgePct(edgePoints) {
  if (!Number.isFinite(edgePoints)) return '—';
  const sign = edgePoints > 0 ? '+' : '';
  return `${sign}${edgePoints.toFixed(1)}%`;
}

function americanToDecimal(american) {
  const p = americanToImpliedProb(american);
  if (p == null || p <= 0) return null;
  return 1 / p;
}

/**
 * Cover "either team 1+" by betting Yes on both team-interval lines,
 * sized so a single-team hit returns the same. Conservative EV ignores
 * the bonus if both teams take a corner.
 */
function buildDkBothYesPackages({
  intervals,
  clock,
  plan,
  mode,
  lineRemaining,
  remainingMass,
}) {
  const byWindow = new Map();
  for (const row of intervals ?? []) {
    if (!row?.window || row.yes?.american == null || !row.team) continue;
    const list = byWindow.get(row.window) ?? [];
    if (list.some((x) => x.team === row.team)) continue;
    list.push(row);
    byWindow.set(row.window, list);
  }

  const packages = [];
  for (const [window, rows] of byWindow) {
    if (rows.length < 2) continue;
    const legs = rows.slice(0, 2).map((row) => {
      const decimal = americanToDecimal(row.yes.american);
      const implied = americanToImpliedProb(row.yes.american);
      return {
        team: row.team,
        american: row.yes.american,
        decimal,
        implied,
      };
    });
    if (legs.some((leg) => leg.decimal == null || leg.implied == null)) continue;

    const combinedImplied = legs[0].implied + legs[1].implied;
    const shareSum = combinedImplied;
    const sized = legs.map((leg) => ({
      ...leg,
      share: shareSum > 0 ? leg.implied / shareSum : 0.5,
    }));

    const win = windowRemainingShare({ window }, clock, plan, mode);
    if (!win) continue;
    const fracOfRemaining = remainingMass > 0 ? win.remainingShare / remainingMass : 0;
    const lambda = lineRemaining * fracOfRemaining;
    const pModel = lambda > 0 ? 1 - Math.exp(-lambda) : 0;
    const coversOneTeam = combinedImplied > 0 && combinedImplied < 0.999;
    const packageAmerican = coversOneTeam ? probToAmerican(combinedImplied) : null;

    packages.push(evalSide({
      label: `Both 1+ ${window}`,
      american: packageAmerican,
      pModel,
      kind: 'dk-both-yes',
      meta: {
        book: 'dk',
        window,
        lambda,
        fracOfRemaining,
        lineRemaining,
        combinedImplied,
        coversOneTeam,
        bits: win.bits,
        legs: sized,
      },
    }));
  }
  return packages;
}

function evalSide({ label, american, pModel, kind, meta, baseline = false }) {
  if (baseline) {
    return {
      id: `${kind}:${label}`,
      label,
      kind,
      american: american ?? null,
      pModel: Number.isFinite(pModel) ? pModel : null,
      pMarket: americanToImpliedProb(american),
      fairAmerican: null,
      analysis: null,
      profitable: false,
      baseline: true,
      meta,
    };
  }
  if (!Number.isFinite(american) || !Number.isFinite(pModel)) {
    return {
      id: `${kind}:${label}`,
      label,
      kind,
      american: american ?? null,
      pModel: Number.isFinite(pModel) ? pModel : null,
      pMarket: americanToImpliedProb(american),
      fairAmerican: Number.isFinite(pModel) ? probToAmerican(Math.min(0.999, Math.max(0.001, pModel))) : null,
      analysis: null,
      profitable: false,
      baseline: false,
      meta,
    };
  }
  const clamped = Math.min(0.999, Math.max(0.001, pModel));
  const fairAmerican = probToAmerican(clamped);
  const analysis = analyzeAgainstBreakeven(american, fairAmerican);
  return {
    id: `${kind}:${label}`,
    label,
    kind,
    american,
    pModel: clamped,
    pMarket: americanToImpliedProb(american),
    fairAmerican,
    analysis,
    profitable: Boolean(analysis?.profitable),
    baseline: false,
    meta,
  };
}

export function evaluateGameCorners(game, { bucketed = true, baselineBook: requestedBook = 'fd' } = {}) {
  const mode = bucketed ? 'bucketed' : 'uniform';
  const clock = parseClockState(game.stoppage);
  const hasFirstHalfLine = Boolean(game.firstHalfTotal);
  // Full-game remaining always keeps typical/live FT stoppage in H1.
  // A first-half line uses HT stoppage only — never second-half extra.
  const plan = stoppagePlan(clock, game.stoppage, { hasFirstHalfLine: false });
  const h1Plan = stoppagePlan(clock, game.stoppage, { hasFirstHalfLine: true });
  const breakdown = remainingBreakdown(clock, plan, mode);
  const h1Breakdown = remainingBreakdown(clock, h1Plan, mode);
  const c = Number.isFinite(game.cornersSoFar) ? game.cornersSoFar : 0;

  const resolved = resolveCornerBaseline(game, requestedBook);
  const baselineBook = resolved.book;
  const baselineRow = resolved.row;
  const fullImplied = baselineRow?.implied ?? null;
  const halfImplied = hasFirstHalfLine
    ? impliedRemainingFromLine(game.firstHalfTotal, game.firstHalfCornersSoFar ?? c)
    : null;

  const ourRemaining = MEAN_CORNERS_PER_MATCH * breakdown.remainingShare;
  const h1Share = h1Breakdown.rows
    .filter((r) => r.half === 1)
    .reduce((s, r) => s + r.remainingShare, 0);
  const ourH1Remaining = MEAN_CORNERS_PER_MATCH * h1Share;
  const marketRemaining = fullImplied?.remaining ?? null;
  const marketImpliedTotal = fullImplied?.impliedTotal ?? null;

  const bets = [];

  if (game.firstHalfTotal && halfImplied && clock.period !== 2 && clock.phase !== 'ht') {
    const cH1 = Number.isFinite(game.firstHalfCornersSoFar) ? game.firstHalfCornersSoFar : c;
    const need = Math.floor(game.firstHalfTotal.line) + 1 - cH1;
    bets.push(evalSide({
      label: `H1 O ${game.firstHalfTotal.line}`,
      american: game.firstHalfTotal.over?.american,
      pModel: null,
      kind: 'h1-over',
      baseline: true,
      meta: { line: game.firstHalfTotal.line, scope: 'h1', lambda: halfImplied.remaining ?? ourH1Remaining, need },
    }));
    bets.push(evalSide({
      label: `H1 U ${game.firstHalfTotal.line}`,
      american: game.firstHalfTotal.under?.american,
      pModel: null,
      kind: 'h1-under',
      baseline: true,
      meta: { line: game.firstHalfTotal.line, scope: 'h1', lambda: halfImplied.remaining ?? ourH1Remaining, need },
    }));
  }

  const remainingMass = breakdown.remainingShare;
  const lineRemaining = fullImplied && !fullImplied.alreadyOver && Number.isFinite(fullImplied.remaining)
    ? fullImplied.remaining
    : ourRemaining;

  const windowBets = [];
  const attachWindow = (windowMarket, title) => {
    if (!windowMarket) return null;
    const win = windowRemainingShare(windowMarket, clock, plan, mode);
    if (!win) return { title, windowMarket, win: null, lambda: 0, bets: [] };
    const fracOfRemaining = remainingMass > 0 ? win.remainingShare / remainingMass : 0;
    const lambda = lineRemaining * fracOfRemaining;
    const local = [];
    for (const row of windowMarket.plus ?? []) {
      local.push(evalSide({
        label: `${row.n}+`,
        american: row.american,
        pModel: poissonSfGe(row.n, lambda),
        kind: `${title}-plus`,
        meta: { n: row.n, minutes: windowMarket.minutes, lambda, fracOfRemaining, lineRemaining },
      }));
    }
    for (const row of windowMarket.overUnder ?? []) {
      const overAt = Math.floor(row.line) + 1;
      const pOver = poissonSfGe(overAt, lambda);
      const pModel = row.side === 'over' ? pOver : 1 - pOver;
      local.push(evalSide({
        label: `${row.side === 'over' ? 'O' : 'U'} ${row.line}`,
        american: row.american,
        pModel,
        kind: `${title}-ou`,
        meta: { side: row.side, line: row.line, minutes: windowMarket.minutes, lambda, fracOfRemaining, lineRemaining },
      }));
    }
    windowBets.push(...local);
    return { title, windowMarket, win, lambda, fracOfRemaining, lineRemaining, bets: local };
  };

  const next5 = attachWindow(game.next5, 'next5');
  const next10 = attachWindow(game.next10, 'next10');
  bets.push(...windowBets);

  const dkPackages = buildDkBothYesPackages({
    intervals: game.dk?.intervals,
    clock,
    plan,
    mode,
    lineRemaining,
    remainingMass,
  });
  bets.push(...dkPackages);

  const evCount = bets.filter((b) => b.profitable).length;

  return {
    mode,
    clock,
    plan,
    h1Plan,
    breakdown,
    h1Breakdown,
    cornersSoFar: c,
    meanKickoff: MEAN_CORNERS_PER_MATCH,
    ourRemaining,
    ourH1Remaining,
    lineRemaining,
    marketRemaining,
    marketImpliedTotal,
    fullImplied,
    halfImplied,
    baselineBook,
    baselineRow,
    baselines: resolved.baselines,
    next5,
    next10,
    bets,
    evCount,
    totalArbs: findTotalCornerArbs(game),
  };
}

export { formatAmericanOdds };
