/**
 * Yard-line progress display + histogram axis formatting.
 *
 * Field position (% of loading_hwang_background.png width) is piecewise-linear
 * between measured yard-line anchors (see YARD_MARKERS).
 */

const YARD_MARKERS = [
  { yard: -10, imgPct: 3.0 }, // extrapolated from goal line
  { yard: 0, imgPct: 11.0 },
  { yard: 5, imgPct: 15.0 },
  { yard: 10, imgPct: 19.0 },
  { yard: 15, imgPct: 23.0 },
  { yard: 20, imgPct: 26.0 },
  { yard: 25, imgPct: 30.0 },
  { yard: 30, imgPct: 35.0 },
  { yard: 35, imgPct: 38.0 },
  { yard: 40, imgPct: 42.0 },
  { yard: 45, imgPct: 46.0 },
  { yard: 50, imgPct: 50.0 },
  { yard: 55, imgPct: 54.0 },
  { yard: 60, imgPct: 58.0 },
  { yard: 65, imgPct: 61.0 },
  { yard: 70, imgPct: 65.0 },
  { yard: 75, imgPct: 69.0 },
  { yard: 80, imgPct: 72.0 },
  { yard: 85, imgPct: 76.0 },
  { yard: 90, imgPct: 80.0 },
  { yard: 95, imgPct: 83.0 },
  { yard: 100, imgPct: 88.0 },
  { yard: 105, imgPct: 100.0 }, // end zone — extrapolated through goal line
];

const DRIVE_START_YARDS = -10;
const DRIVE_END_YARDS = 105;
const DRIVE_SPAN = DRIVE_END_YARDS - DRIVE_START_YARDS;

/** Sim progress at which Hwang starts jumping and "Touchdown!" shows; keeps moving through EZ to 100%. */
export const CELEBRATE_PROGRESS = 0.95;
export const TOUCHDOWN_PROGRESS = CELEBRATE_PROGRESS;
export const TOUCHDOWN_JUMP_DURATION_MS = 550;
export const TOUCHDOWN_JUMP_COUNT = 2;
export const TOUCHDOWN_CELEBRATION_MS =
  TOUCHDOWN_JUMP_DURATION_MS * TOUCHDOWN_JUMP_COUNT + 80;

export const RUNNER_BALL_X_FRAC = 0.68;
/** Shift runner left (px) so more of the sprite trails in the lit zone. */
export const RUNNER_OFFSET_PX = 20;

function yardPositionFromProgress(p) {
  const clamped = Math.max(0, Math.min(1, p || 0));
  return DRIVE_START_YARDS + clamped * DRIVE_SPAN;
}

/** Progress fraction (0–1) → field position (%). Single source of truth for runner/fill. */
function progressToFieldPct(p) {
  const progress = Math.max(0, Math.min(1, p || 0));
  const yard = yardPositionFromProgress(progress);
  return yardToImgPct(yard);
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

/** Lit fill edge on the field image (%). Same curve as runner. */
export function simProgressToFillPct(p) {
  return progressToFieldPct(p);
}

/** Runner anchor on the field (%). */
export function simProgressToRunnerPct(p) {
  return progressToFieldPct(p);
}

export function simProgressToImagePct(p) {
  return simProgressToFillPct(p);
}

export function simFractionToYardLine(p) {
  const progress = Math.max(0, Math.min(1, p || 0));

  if (progress >= CELEBRATE_PROGRESS) return 'Touchdown!';

  const yard = yardPositionFromProgress(progress);

  if (yard <= 0) return 'Own end zone';

  const marker = Math.round(yard / 5) * 5;
  if (marker === 50) return 'On the 50';
  if (marker < 50) return `Own ${marker}`;
  if (marker >= 100) return `On the ${Math.max(1, 100 - Math.round(yard))}`;
  return `On the ${100 - marker}`;
}

export function isTouchdownProgress(p) {
  return (p || 0) >= CELEBRATE_PROGRESS;
}

export function isCelebrateProgress(p) {
  return isTouchdownProgress(p);
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
