/**
 * Sanity-check Hwang field progress calibration.
 * Run: node scripts/verify-hwang-field-calibration.mjs
 *
 * Key: goal line is at 11.3%, NOT 3.8% (end zone border).
 */

const YARD_MARKERS = [
  { yard: -10, imgPct: 1.0 },
  { yard: 0, imgPct: 11.3 },
  { yard: 10, imgPct: 19.0 },
  { yard: 20, imgPct: 26.8 },
  { yard: 30, imgPct: 34.5 },
  { yard: 40, imgPct: 42.2 },
  { yard: 50, imgPct: 49.9 },
  { yard: 60, imgPct: 57.6 },
  { yard: 70, imgPct: 65.3 },
  { yard: 80, imgPct: 73.0 },
  { yard: 90, imgPct: 80.8 },
  { yard: 100, imgPct: 88.5 },
  { yard: 105, imgPct: 100 },
];

function yardFromProgress(p) {
  return -10 + p * 115;
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

console.log('Field: goal line 11.3% → 88.5% (NOT 3.8% → 95.9%)\n');
for (const [label, p] of [
  ['start/EZ', 0],
  ['goal line', 10 / 115],
  ['own 10', 20 / 115],
  ['own 20', 30 / 115],
  ['50', 60 / 115],
  ['opp 20', 90 / 115],
  ['opp GL', 110 / 115],
  ['TD', 1],
]) {
  const y = yardFromProgress(p);
  console.log(
    `${label.padEnd(10)} yard=${y.toFixed(1).padStart(6)} → ${yardToImgPct(y).toFixed(2)}%`,
  );
}
