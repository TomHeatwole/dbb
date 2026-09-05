/**
 * Current-drive points and opponent next-drive start, from ESPN 2023–25 snaps.
 *
 * Field buckets (yards-to-goal: 95 = own 5, 25 = opp 25):
 *   deep       inside own 15
 *   kickoff    own 15–30, or a kickoff start
 *   midfield   own 31 through opp 45
 *   favorable  already inside opp 45
 */
import tables from './driveSituationTables.json';

export const FP_BUCKETS = [
  { id: 'deep', label: 'Deep (inside own 15)', lo: 86, hi: 99 },
  { id: 'kickoff', label: 'Kickoff / own 15–30', lo: 70, hi: 85 },
  { id: 'midfield', label: 'Midfield (own 31–opp 45)', lo: 45, hi: 69 },
  { id: 'favorable', label: 'Favorable (inside opp 45)', lo: 1, hi: 44 },
];

export const DIST_BINS = [
  { id: 'short', label: '1–3', lo: 1, hi: 3 },
  { id: 'med', label: '4–6', lo: 4, hi: 6 },
  { id: 'long', label: '7–10', lo: 7, hi: 10 },
  { id: 'xlong', label: '11+', lo: 11, hi: 99 },
];

export const TIME_BINS = [
  { id: 'late', label: 'Under 3 min in half' },
  { id: 'mid', label: '3–8 min in half' },
  { id: 'early', label: '8+ min in half' },
];

export const POINT_VALUES = [0, 3, 6, 7, 8];

export function fpBucket(ytg) {
  const y = Number(ytg);
  if (!Number.isFinite(y)) return null;
  return FP_BUCKETS.find((b) => y >= b.lo && y <= b.hi) || null;
}

export function distBin(distance) {
  const d = Number(distance);
  return DIST_BINS.find((b) => d >= b.lo && d <= b.hi) || DIST_BINS[3];
}

export function timeBin(secLeftHalf) {
  const s = Number(secLeftHalf);
  if (s <= 180) return TIME_BINS[0];
  if (s <= 480) return TIME_BINS[1];
  return TIME_BINS[2];
}

export function halfBin(period) {
  const p = Number(period);
  if (p === 1 || p === 2) return 'h1';
  if (p === 3 || p === 4) return 'h2';
  return 'ot';
}

export function secondsLeftInHalf(period, clockSec) {
  const p = Number(period);
  const c = Number(clockSec);
  if (p === 1 || p === 3) return 900 + c;
  if (p === 2 || p === 4) return c;
  return c;
}

function unpack(cell) {
  if (!cell) return null;
  const points = POINT_VALUES.map((value, i) => ({
    value,
    p: (cell.p || [])[i] ?? 0,
  }));
  const nextStart = FP_BUCKETS.map((bucket, i) => ({
    id: bucket.id,
    label: bucket.label,
    p: (cell.z || [])[i] ?? 0,
  }));
  return {
    n: cell.n,
    nNext: cell.nn,
    points,
    nextStart,
    pGameOver: cell.go ?? 0,
    nextYtgMean: cell.y ?? null,
  };
}

function lookupRaw(down, distId, fpId, timeId, halfId) {
  const T = tables.tables || {};
  const attempts = [
    ['full', `${down}|${distId}|${fpId}|${timeId}|${halfId}`],
    ['noDist', `${down}|${fpId}|${timeId}|${halfId}`],
    ['noTime', `${down}|${distId}|${fpId}|${halfId}`],
    ['downFpHalf', `${down}|${fpId}|${halfId}`],
    ['fpHalf', `${fpId}|${halfId}`],
    ['fp', `${fpId}`],
  ];
  for (const [layer, key] of attempts) {
    const cell = T[layer] && T[layer][key];
    if (cell) return { layer, key, cell };
  }
  return { layer: 'global', key: 'global', cell: tables.global };
}

/**
 * @param {{
 *   down: number,
 *   distance: number,
 *   yardsToEndzone: number,
 *   period: number,
 *   clockSeconds: number,
 * }} sit
 */
export function predictDriveSituation(sit) {
  const down = Number(sit.down);
  const dist = distBin(sit.distance);
  const field = fpBucket(sit.yardsToEndzone);
  const period = Number(sit.period);
  const clockSeconds = Number(sit.clockSeconds);
  const secHalf = secondsLeftInHalf(period, clockSeconds);
  const time = timeBin(secHalf);
  const half = halfBin(period);
  const { layer, key, cell } = lookupRaw(
    down,
    dist.id,
    field?.id || 'kickoff',
    time.id,
    half,
  );
  const unpacked = unpack(cell);
  return {
    bins: {
      down,
      distance: dist,
      field,
      time,
      half,
      secLeftHalf: secHalf,
    },
    layer,
    key,
    ...unpacked,
    meta: tables.meta,
  };
}

export function getSituationMeta() {
  return tables.meta || {};
}
