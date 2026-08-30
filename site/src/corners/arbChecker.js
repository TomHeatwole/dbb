/**
 * Two-way arb checker: parse a price and its inverse in American,
 * percent, or decimal (1.83x) and size a lock if the implieds sum under 100%.
 */

import { americanToImpliedProb, formatAmericanOdds, probToAmerican } from '../sop/sopModel.js';

export function impliedToDecimal(implied) {
  if (!Number.isFinite(implied) || implied <= 0) return null;
  return 1 / implied;
}

export function formatDecimalOdds(decimal) {
  if (!Number.isFinite(decimal) || decimal <= 0) return '—';
  return `${decimal.toFixed(decimal >= 10 ? 2 : 3).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

function fromAmerican(american, raw) {
  const implied = americanToImpliedProb(american);
  if (implied == null) return null;
  return {
    kind: 'american',
    american,
    implied,
    decimal: impliedToDecimal(implied),
    raw,
  };
}

function fromImplied(implied, kind, raw) {
  if (!Number.isFinite(implied) || implied <= 0 || implied >= 1) return null;
  return {
    kind,
    american: probToAmerican(implied),
    implied,
    decimal: impliedToDecimal(implied),
    raw,
  };
}

/**
 * Accept +150, -110, 150, 55%, 0.55, 1.83, 1.83x.
 * Bare 1 is rejected (ambiguous). Bare numbers ≥ 100 are American.
 */
export function parseOddsInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const compact = s.replace(/,/g, '').replace(/\s+/g, '');

  const pct = compact.match(/^(\d+(?:\.\d+)?)%$/);
  if (pct) return fromImplied(Number(pct[1]) / 100, 'percent', s);

  const decX = compact.match(/^(\d+(?:\.\d+)?)x$/i);
  if (decX) {
    const decimal = Number(decX[1]);
    if (!Number.isFinite(decimal) || decimal <= 1) return null;
    return fromImplied(1 / decimal, 'decimal', s);
  }

  if (compact.startsWith('+')) {
    const n = Number(compact.slice(1));
    if (!Number.isFinite(n) || n < 100) return null;
    return fromAmerican(n, s);
  }

  if (compact.startsWith('-')) {
    const n = Number(compact);
    if (!Number.isFinite(n) || n > -100) return null;
    return fromAmerican(n, s);
  }

  const n = Number(compact);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 100) return fromAmerican(n, s);
  if (n > 1) return fromImplied(1 / n, 'decimal', s);
  if (n < 1) return fromImplied(n, 'prob', s);
  return null;
}

export function formatParsedOdds(parsed) {
  if (!parsed) return '—';
  return `${formatAmericanOdds(parsed.american)} · ${formatDecimalOdds(parsed.decimal)} · ${(parsed.implied * 100).toFixed(2)}%`;
}

function splitCents(shares, total) {
  if (!Number.isFinite(total) || total <= 0 || !shares?.length) return null;
  const sum = shares.reduce((acc, share) => acc + share, 0);
  if (!(sum > 0)) return null;
  const rounded = shares.map((share) => Math.round((share / sum) * total * 100));
  const target = Math.round(total * 100);
  rounded[rounded.length - 1] += target - rounded.reduce((acc, cents) => acc + cents, 0);
  return rounded.map((cents) => cents / 100);
}

export function evaluateTwoWayArb(line, inverse, totalStake) {
  if (!line || !inverse) return null;
  const pSum = line.implied + inverse.implied;
  if (!(pSum > 0)) return null;
  const roi = (1 / pSum) - 1;
  const hasArb = pSum < 0.999 && roi > 0;
  const needInverseImplied = Math.max(0.001, 1 - line.implied);
  const needLineImplied = Math.max(0.001, 1 - inverse.implied);
  const stakes = hasArb ? splitCents([line.implied, inverse.implied], totalStake) : null;
  const rows = stakes
    ? [
      {
        key: 'line',
        label: 'Line',
        amount: stakes[0],
        implied: line.implied,
        payout: line.implied > 0 ? stakes[0] / line.implied : 0,
      },
      {
        key: 'inverse',
        label: 'Inverse',
        amount: stakes[1],
        implied: inverse.implied,
        payout: inverse.implied > 0 ? stakes[1] / inverse.implied : 0,
      },
    ]
    : null;
  const lockPayout = rows ? Math.min(...rows.map((row) => row.payout)) : null;

  return {
    pSum,
    roi,
    hasArb,
    juice: pSum - 1,
    needInverse: {
      implied: needInverseImplied,
      american: probToAmerican(needInverseImplied),
      decimal: impliedToDecimal(needInverseImplied),
    },
    needLine: {
      implied: needLineImplied,
      american: probToAmerican(needLineImplied),
      decimal: impliedToDecimal(needLineImplied),
    },
    rows,
    total: Number.isFinite(totalStake) && totalStake > 0 ? totalStake : null,
    lockPayout,
    lockProfit: lockPayout != null && Number.isFinite(totalStake) ? lockPayout - totalStake : null,
  };
}
