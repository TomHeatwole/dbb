/**
 * Yard-line progress display + histogram axis formatting.
 *
 * loading_hwang_background.png (2172×724) layout:
 *
 *   [left EZ art] | GOAL |←—— 100 yd playing field ——→| GOAL | [right EZ art]
 *   ~0–3.7%       11.3%                              88.5%  ~96%
 *
 * x≈82 (3.8%) is the end-zone border, NOT the goal line. The goal line (0 yd)
 * is at ~11.3% (x≈248). Yard lines are evenly spaced 11.3%→88.5%.
 */

const LEFT_GOAL_PCT = 11.3;
const RIGHT_GOAL_PCT = 88.5;
const FIELD_SPAN_PCT = RIGHT_GOAL_PCT - LEFT_GOAL_PCT;

const YARD_MARKERS = [
  { yard: -10, imgPct: 1.0 },
  { yard: 0, imgPct: LEFT_GOAL_PCT },
  { yard: 10, imgPct: 19.0 },
  { yard: 20, imgPct: 26.8 },
  { yard: 30, imgPct: 34.5 },
  { yard: 40, imgPct: 42.2 },
  { yard: 50, imgPct: 49.9 },
  { yard: 60, imgPct: 57.6 },
  { yard: 70, imgPct: 65.3 },
  { yard: 80, imgPct: 73.0 },
  { yard: 90, imgPct: 80.8 },
  { yard: 100, imgPct: RIGHT_GOAL_PCT },
  { yard: 105, imgPct: 100 },
];

const DRIVE_START_YARDS = -10;
const DRIVE_END_YARDS = 105;
const DRIVE_SPAN = DRIVE_END_YARDS - DRIVE_START_YARDS;

export const TOUCHDOWN_PROGRESS = 0.99;
export const TOUCHDOWN_JUMP_DURATION_MS = 550;
export const TOUCHDOWN_JUMP_COUNT = 2;
export const TOUCHDOWN_CELEBRATION_MS =
  TOUCHDOWN_JUMP_DURATION_MS * TOUCHDOWN_JUMP_COUNT + 80;

export const RUNNER_BALL_X_FRAC = 0.68;

function yardPositionFromProgress(p) {
  const clamped = Math.max(0, Math.min(1, p || 0));
  return DRIVE_START_YARDS + clamped * DRIVE_SPAN;
}

function yardToImgPct(yard) {
  if (yard <= YARD_MARKERS[0].yard) return YARD_MARKERS[0].imgPct;
  if (yard >= YARD_MARKERS[YARD_MARKERS.length - 1].yard) {
    return YARD_MARKERS[YARD_MARKERS.length - 1].imgPct;
  }

  for (let i = 0; i < YARD_MARKERS.length - 1; i++) {
    const a = YARD_MARKERS[i];
    const b = YARD_MARKERS[i + 1];
    if (yard >= a.yard && yard <= b.yard) {
      const t = (yard - a.yard) / (b.yard - a.yard);
      return a.imgPct + t * (b.imgPct - a.imgPct);
    }
  }
  return YARD_MARKERS[0].imgPct;
}

/** Lit fill edge on the field image (%). Full width at touchdown. */
export function simProgressToFillPct(p) {
  const progress = Math.max(0, Math.min(1, p || 0));
  if (progress >= TOUCHDOWN_PROGRESS) return 100;
  return yardToImgPct(yardPositionFromProgress(progress));
}

/** Runner anchor on the field (%), independent of fill width at TD. */
export function simProgressToRunnerPct(p) {
  return yardToImgPct(yardPositionFromProgress(p));
}

export function simProgressToImagePct(p) {
  return simProgressToFillPct(p);
}

export function simFractionToYardLine(p) {
  const progress = Math.max(0, Math.min(1, p || 0));

  if (progress >= TOUCHDOWN_PROGRESS) return 'Touchdown!';

  const yard = yardPositionFromProgress(progress);

  if (yard >= 100) return 'Touchdown!';
  if (yard <= 0) return 'Own end zone';

  const marker = Math.round(yard / 5) * 5;
  if (marker === 50) return 'On the 50';
  if (marker < 50) return `Own ${marker}`;
  if (marker >= 100) return `On the ${Math.max(1, 100 - Math.round(yard))}`;
  return `On the ${100 - marker}`;
}

export function isTouchdownProgress(p) {
  return (p || 0) >= TOUCHDOWN_PROGRESS;
}

export function formatHistogramAxisCount(n) {
  const v = Math.round(Number(n) || 0);
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

export function histogramYAxisWidth(maxCount) {
  const magnitude = maxCount <= 0 ? 10 : maxCount;
  const sample = formatHistogramAxisCount(magnitude);
  return Math.max(40, sample.length * 7 + 14);
}
