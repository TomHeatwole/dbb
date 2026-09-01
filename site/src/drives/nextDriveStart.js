/**
 * Predict where the opponent's next drive starts, given the current snap.
 *
 * ESPN yards-to-goal: 95 = own 5, 75 = own 25, 25 = opponent 25.
 * Tables are empirical ESPN 2023–2025 FBS+FCS snaps → next opposing drive.
 */
import tables from './nextDriveStartTables.json';

export const FIELD_BINS = [
  { id: 'own_1_10', label: 'Own 1–10', lo: 90, hi: 99 },
  { id: 'own_11_20', label: 'Own 11–20', lo: 80, hi: 89 },
  { id: 'own_21_35', label: 'Own 21–35', lo: 65, hi: 79 },
  { id: 'own_36_50', label: 'Own 36–50', lo: 50, hi: 64 },
  { id: 'plus_35_49', label: 'Opp 49–35', lo: 35, hi: 49 },
  { id: 'fg_20_34', label: 'Opp 34–20', lo: 20, hi: 34 },
  { id: 'red_1_19', label: 'Red zone', lo: 1, hi: 19 },
];

export const DIST_BINS = [
  { id: 'short', label: '1–3', lo: 1, hi: 3 },
  { id: 'med', label: '4–6', lo: 4, hi: 6 },
  { id: 'long', label: '7–10', lo: 7, hi: 10 },
  { id: 'xlong', label: '11+', lo: 11, hi: 99 },
];

export const SCORE_BINS = [
  { id: 'trail2', label: 'Down 9+' },
  { id: 'trail', label: 'Down 1–8' },
  { id: 'tied', label: 'Tied' },
  { id: 'lead', label: 'Up 1–8' },
  { id: 'lead2', label: 'Up 9+' },
];

export const TIME_BINS = [
  { id: 'late', label: 'Under 3 min in half' },
  { id: 'mid', label: '3–8 min in half' },
  { id: 'early', label: '8+ min in half' },
];

const ZONE_LABELS = FIELD_BINS.map((b) => b.label);

export function fieldBin(ytg) {
  const y = Number(ytg);
  return FIELD_BINS.find((b) => y >= b.lo && y <= b.hi) || null;
}

export function distBin(distance) {
  const d = Number(distance);
  return DIST_BINS.find((b) => d >= b.lo && d <= b.hi) || DIST_BINS[3];
}

export function scoreBin(scoreDiff) {
  const d = Number(scoreDiff);
  if (d <= -9) return SCORE_BINS[0];
  if (d <= -1) return SCORE_BINS[1];
  if (d === 0) return SCORE_BINS[2];
  if (d <= 8) return SCORE_BINS[3];
  return SCORE_BINS[4];
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

export function secondsLeftInGame(period, clockSec) {
  const p = Number(period);
  const c = Number(clockSec);
  if (p <= 4) return (4 - p) * 900 + c;
  return c;
}

export function formatClock(totalSec) {
  const s = Math.max(0, Math.round(Number(totalSec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** Format yards-to-goal as OWN 25 / 50 / OPP 25. */
export function formatFieldPosition(ytg) {
  const y = Math.round(Number(ytg));
  if (!Number.isFinite(y)) return '—';
  const own = 100 - y;
  if (own < 50) return `OWN ${own}`;
  if (own === 50) return '50';
  return `OPP ${y}`;
}

export function clockFromGameSeconds(secLeftGame) {
  let sec = Math.round(Number(secLeftGame));
  if (!Number.isFinite(sec) || sec <= 0) {
    return { period: 4, clockSec: 0, display: 'Q4 0:00', halfSec: 0 };
  }
  let period = 4 - Math.floor((sec - 0.001) / 900);
  period = Math.min(4, Math.max(1, period));
  const clockSec = sec - (4 - period) * 900;
  const halfSec = secondsLeftInHalf(period, clockSec);
  return {
    period,
    clockSec,
    display: `Q${period} ${formatClock(clockSec)}`,
    halfSec,
  };
}

function unpack(cell) {
  if (!cell) return null;
  const [yP25, yP50, yP75, yMean] = cell.y || [];
  const [tP25, tP50, tP75, tMean] = cell.t || [];
  const [pSame, pNextHalf, pGameOver] = cell.k || [];
  const [pPunt, pTd, pFg, pOther] = cell.r || [];
  const zones = (cell.z || []).map((p, i) => ({
    id: FIELD_BINS[i]?.id,
    label: ZONE_LABELS[i],
    p,
  }));
  return {
    n: cell.n,
    nNext: cell.nn,
    nextYtg: { p25: yP25, p50: yP50, p75: yP75, mean: yMean },
    secondsConsumed: { p25: tP25, p50: tP50, p75: tP75, mean: tMean },
    pSameHalf: pSame,
    pNextHalf,
    pGameOver,
    thisDrive: { punt: pPunt, td: pTd, fg: pFg, other: pOther },
    startZones: zones,
  };
}

function lookupRaw(down, distId, fieldId, scoreId, timeId, halfId) {
  const T = tables.tables || {};
  const attempts = [
    ['full', `${down}|${distId}|${fieldId}|${scoreId}|${timeId}|${halfId}`],
    ['downFieldScoreTimeHalf', `${down}|${fieldId}|${scoreId}|${timeId}|${halfId}`],
    ['noScore', `${down}|${distId}|${fieldId}|${timeId}|${halfId}`],
    ['noTime', `${down}|${distId}|${fieldId}|${scoreId}|${halfId}`],
    ['downFieldTimeHalf', `${down}|${fieldId}|${timeId}|${halfId}`],
    ['downFieldScoreHalf', `${down}|${fieldId}|${scoreId}|${halfId}`],
    ['downFieldHalf', `${down}|${fieldId}|${halfId}`],
    ['fieldHalf', `${fieldId}|${halfId}`],
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
 *   scoreDiff: number,
 *   period: number,
 *   clockSeconds: number,
 * }} sit
 */
export function predictOpponentStart(sit) {
  const down = Number(sit.down);
  const dist = distBin(sit.distance);
  const field = fieldBin(sit.yardsToEndzone);
  const score = scoreBin(sit.scoreDiff);
  const period = Number(sit.period);
  const clockSeconds = Number(sit.clockSeconds);
  const secHalf = secondsLeftInHalf(period, clockSeconds);
  const secGame = secondsLeftInGame(period, clockSeconds);
  const time = timeBin(secHalf);
  const half = halfBin(period);

  const { layer, key, cell } = lookupRaw(
    down,
    dist.id,
    field?.id || 'own_21_35',
    score.id,
    time.id,
    half,
  );
  const unpacked = unpack(cell);
  const consumed = unpacked.secondsConsumed.mean;
  const expectedGameSec = Number.isFinite(consumed)
    ? Math.max(0, secGame - consumed)
    : null;
  const expectedClock = expectedGameSec == null
    ? null
    : clockFromGameSeconds(expectedGameSec);

  return {
    bins: {
      down,
      distance: dist,
      field,
      score,
      time,
      half,
      secLeftHalf: secHalf,
      secLeftGame: secGame,
    },
    layer,
    key,
    n: unpacked.n,
    nNext: unpacked.nNext,
    expectedYtg: unpacked.nextYtg.mean,
    expectedFp: formatFieldPosition(unpacked.nextYtg.mean),
    nextYtg: unpacked.nextYtg,
    fpP25: formatFieldPosition(unpacked.nextYtg.p25),
    fpP50: formatFieldPosition(unpacked.nextYtg.p50),
    fpP75: formatFieldPosition(unpacked.nextYtg.p75),
    secondsConsumed: unpacked.secondsConsumed,
    expectedClock,
    pSameHalf: unpacked.pSameHalf,
    pNextHalf: unpacked.pNextHalf,
    pGameOver: unpacked.pGameOver,
    thisDrive: unpacked.thisDrive,
    startZones: unpacked.startZones,
    meta: tables.meta,
  };
}

export function getFieldCurve() {
  return tables.fieldCurve || {};
}

export function getExampleCell() {
  return tables.example || null;
}

export function getTableMeta() {
  return tables.meta || {};
}
