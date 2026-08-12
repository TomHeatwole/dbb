// American-odds money math for the FredDuel exchange.
//
// Conventions:
// - All money is in dollars, rounded to cents.
// - An offer's `line` is quoted from the TAKER's perspective, like a
//   sportsbook: the offerer is laying the bet. At +1000 a taker stakes $10
//   to win $100; at -200 a taker stakes $200 to win $100.
// - The offerer's "exposure" on a take equals the taker's potential win.

export function roundCents(x) {
  return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
}

export function floorCents(x) {
  return Math.floor((Number(x) + 1e-9) * 100) / 100;
}

/** Valid American line: integer, <= -100 or >= +100. */
export function isValidLine(line) {
  return Number.isInteger(line) && (line >= 100 || line <= -100);
}

/** What the taker wins (profit, on top of stake back) for `stake` at `line`. */
export function takerWinAmount(stake, line) {
  if (line > 0) return roundCents(stake * (line / 100));
  return roundCents(stake * (100 / -line));
}

/** Largest taker stake that `exposure` dollars of offerer risk can cover. */
export function maxStakeForExposure(exposure, line) {
  if (exposure <= 0) return 0;
  if (line > 0) return floorCents(exposure * (100 / line));
  return floorCents(exposure * (-line / 100));
}

/** Break-even probability implied by the line (taker side), 0..1. */
export function impliedProbability(line) {
  if (line > 0) return 100 / (line + 100);
  return -line / (-line + 100);
}

/**
 * Smallest taker stake an offer accepts: $1 universal floor, or the offer's
 * own higher minimum.
 */
export function minStakeForOffer(offer) {
  return Math.max(1, Number(offer.minTake) || 1);
}

/** Largest taker stake an offer accepts right now. */
export function maxStakeForOffer(offer) {
  return maxStakeForExposure(Number(offer.remainingExposure), Number(offer.line));
}

/**
 * True when the offer can no longer accept its minimum stake, i.e. leftover
 * exposure is too small to matter. Used to flip status open -> filled.
 */
export function isEffectivelyFilled(offer) {
  return maxStakeForOffer(offer) < minStakeForOffer(offer);
}

/**
 * Validate a proposed taker stake against an offer.
 * Returns { ok: true, stake, takerWin } or { ok: false, error }.
 */
export function validateTake(offer, stakeInput) {
  const stake = roundCents(stakeInput);
  if (!Number.isFinite(stake) || stake <= 0) {
    return { ok: false, error: 'Enter a stake amount.' };
  }
  const min = minStakeForOffer(offer);
  const max = maxStakeForOffer(offer);
  if (stake < min) {
    return { ok: false, error: `Minimum stake for this offer is ${formatMoney(min)}.` };
  }
  if (stake > max) {
    return { ok: false, error: `Maximum stake left on this offer is ${formatMoney(max)}.` };
  }
  const takerWin = takerWinAmount(stake, Number(offer.line));
  if (takerWin <= 0) {
    return { ok: false, error: 'Stake is too small for this line.' };
  }
  return { ok: true, stake, takerWin };
}

export function formatLine(line) {
  const n = Number(line);
  return n > 0 ? `+${n}` : `${n}`;
}

export function formatMoney(x) {
  const v = roundCents(x);
  const abs = Math.abs(v);
  const str = Number.isInteger(abs)
    ? abs.toLocaleString('en-US')
    : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}$${str}`;
}

export function formatPercent(p) {
  return `${(p * 100).toFixed(1)}%`;
}

/** Parse user input like "+150", "-200", "150" into an int line, or null. */
export function parseLineInput(text) {
  const trimmed = String(text ?? '').trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Inverse of impliedProbability: American line for a win probability (0..1).
 * Rounds to an integer line and clamps into the valid ±100 range.
 */
export function lineFromProbability(p) {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  let line;
  if (p >= 0.5) {
    line = -Math.round((100 * p) / (1 - p));
    if (line > -100) line = -100;
  } else {
    line = Math.round((100 * (1 - p)) / p);
    if (line < 100) line = 100;
  }
  return line;
}

/** Parse "40", "40%", "52.4" into a probability 0..1, or null. */
export function parsePercentInput(text) {
  const trimmed = String(text ?? '').trim().replace(/%$/, '');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const pct = parseFloat(trimmed);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return null;
  return pct / 100;
}
