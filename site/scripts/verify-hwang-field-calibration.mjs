/**
 * Sanity-check Hwang field progress calibration.
 * Run: node scripts/verify-hwang-field-calibration.mjs
 */

const YARD_MARKERS = [
  { yard: -10, imgPct: 3.0 },
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
  { yard: 105, imgPct: 100.0 },
];

const DRIVE_START_YARDS = -10;
const DRIVE_SPAN = 115;
const CELEBRATE_PROGRESS = 0.95;

function yardFromProgress(p) {
  return DRIVE_START_YARDS + p * DRIVE_SPAN;
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

console.log(`Celebrate threshold: ${(CELEBRATE_PROGRESS * 100).toFixed(0)}% progress\n`);
console.log('Anchor check (must match exactly):\n');
for (const { yard, imgPct } of YARD_MARKERS.slice(1)) {
  const got = yardToImgPct(yard);
  const ok = Math.abs(got - imgPct) < 0.001 ? 'ok' : 'FAIL';
  console.log(`  yard ${String(yard).padStart(3)} → ${got.toFixed(1)}% (want ${imgPct}%) ${ok}`);
}

console.log('\nProgress samples:\n');
for (const [label, p] of [
  ['start/EZ', 0],
  ['goal line', 10 / 115],
  ['own 25', 35 / 115],
  ['50', 60 / 115],
  ['opp 25', 85 / 115],
  ['celebrate', CELEBRATE_PROGRESS],
  ['done', 1],
]) {
  const y = yardFromProgress(p);
  console.log(
    `${label.padEnd(10)} p=${(p * 100).toFixed(1).padStart(5)}% yard=${y.toFixed(1).padStart(6)} → ${yardToImgPct(y).toFixed(2)}%`,
  );
}
