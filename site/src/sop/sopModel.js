/**
 * SOP model — breakeven goal-type odds from NO GOAL American odds.
 * Rates from SOP-Model spreadsheet (35 league-seasons, adjusted).
 */

/** Historical goal-type rates given at least one goal (row 54 Inputs). */
export const GOAL_TYPE_RATES = {
  header: 0.1540361025,
  pk: 0.07435497205,
  fk: 0.01443198281,
  og: 0.02742413645,
  sop: 0.7297528062,
};

export const DEFAULT_NO_GOAL_AMERICAN = 1150;

/** Implied probability from American odds. */
export function americanToImpliedProb(american) {
  if (!Number.isFinite(american) || american === 0) return null;
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

/** Breakeven American odds for a probability (spreadsheet convention: no + prefix). */
export function probToAmerican(prob) {
  if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return null;
  if (prob >= 0.5) return -(100 * prob) / (1 - prob);
  return (100 * (1 - prob)) / prob;
}

export function formatAmericanOdds(american) {
  if (!Number.isFinite(american)) return '—';
  const rounded = Math.round(american * 10) / 10;
  if (rounded > 0) return `+${rounded}`;
  return String(rounded);
}

/**
 * Parse NO GOAL American odds from user input.
 * Include "-" for favorites; omit "+" for underdogs (per spreadsheet).
 */
export function parseNoGoalAmericanOdds(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('+')) return null;

  if (trimmed.startsWith('-')) {
    const n = Number(trimmed.slice(1));
    if (!Number.isFinite(n) || n <= 0) return null;
    return -n;
  }

  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (String(trimmed).includes('.')) return null;
  return n;
}

/**
 * Compute breakeven American odds for each goal type.
 * @param {number} noGoalAmerican — American odds for NO GOAL
 * @returns {{ sop, header, pk, fk, og, goalProb, noGoalProb } | null}
 */
export function computeBreakevenOdds(noGoalAmerican) {
  const noGoalProb = americanToImpliedProb(noGoalAmerican);
  if (noGoalProb == null) return null;

  const goalProb = 1 - noGoalProb;

  const toOutcome = (rate) => {
    const prob = goalProb * rate;
    return {
      american: probToAmerican(prob),
      implied: prob * 100,
    };
  };

  return {
    noGoalProb,
    goalProb,
    sop: toOutcome(GOAL_TYPE_RATES.sop),
    header: toOutcome(GOAL_TYPE_RATES.header),
    pk: toOutcome(GOAL_TYPE_RATES.pk),
    fk: toOutcome(GOAL_TYPE_RATES.fk),
    og: toOutcome(GOAL_TYPE_RATES.og),
  };
}

/** Higher American odds = better price for the bettor. */
export function isBetterAmericanOdds(offered, breakeven) {
  if (!Number.isFinite(offered) || !Number.isFinite(breakeven)) return false;
  return offered > breakeven;
}

/** Implied-probability edge in percentage points (positive = +EV). */
export function impliedEdgePoints(offered, breakeven) {
  const offeredProb = americanToImpliedProb(offered);
  const fairProb = americanToImpliedProb(breakeven);
  if (offeredProb == null || fairProb == null) return null;
  return (fairProb - offeredProb) * 100;
}

export function analyzeAgainstBreakeven(fdAmerican, breakevenAmerican) {
  if (breakevenAmerican == null) return null;
  const profitable = isBetterAmericanOdds(fdAmerican, breakevenAmerican);
  const edgePoints = impliedEdgePoints(fdAmerican, breakevenAmerican);
  return {
    profitable: Number.isFinite(fdAmerican) ? profitable : false,
    edgePoints,
    breakevenAmerican,
  };
}

export const GOAL_TYPE_META = [
  { key: 'sop', label: 'SOP', fdRunner: 'Shot Open Play' },
  { key: 'header', label: 'HEADER', fdRunner: 'Header' },
  { key: 'pk', label: 'PK', fdRunner: 'Penalty' },
  { key: 'fk', label: 'FK', fdRunner: 'Free Kick' },
  { key: 'og', label: 'OG', fdRunner: 'Own Goal' },
];

export const NO_GOAL_SOURCE_KEYS = {
  nextGoalMethod: 'nextGoalMethod',
  correctScore: 'correctScore',
  totalGoalsUnder: 'totalGoalsUnder',
  nthGoalNeither: 'nthGoalNeither',
  nextGoalscorer: 'nextGoalscorer',
};

export const DEFAULT_NO_GOAL_SOURCE = NO_GOAL_SOURCE_KEYS.totalGoalsUnder;
