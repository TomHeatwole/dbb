/**
 * Pregame 1st-drive field position for DK/FD "1st [Team] Drive Result".
 *
 * Receive: empirical kickoff-return start mix (mostly own 25).
 * Go second: opening-drive result from the drive-start LightGBM, then
 * empirical P(start bin | that result, spread). Output probabilities are
 * mixed — we never collapse going-second to a single mean yard line.
 *
 * Unknown coin toss → 50/50 over receive vs go-second mixtures.
 */
import tables from './pregameFirstDriveStartTables.json';

export const KICKOFF_RECEIVE_YTG = 74.5;
export const COIN_TOSS_WEIGHT = 0.5;
export const SHRINKAGE = Number(tables.meta?.shrinkage) || 40;
export const OPENING_RESULTS = ['td', 'fg', 'punt', 'other'];

/** Scoreboard after the opening drive, from the team about to possess. */
export const SCORE_AFTER_OPENING = {
  td: -7,
  fg: -3,
  punt: 0,
  other: 0,
};

export const SPREAD_BINS = [
  { id: 'fav_le_21', lo: -99, hi: -21 },
  { id: 'fav_21_14', lo: -21, hi: -14 },
  { id: 'fav_14_7', lo: -14, hi: -7 },
  { id: 'fav_7_3', lo: -7, hi: -3 },
  { id: 'pick', lo: -3, hi: 3 },
  { id: 'dog_3_7', lo: 3, hi: 7 },
  { id: 'dog_7_14', lo: 7, hi: 14 },
  { id: 'dog_14_21', lo: 14, hi: 21 },
  { id: 'dog_ge_21', lo: 21, hi: 99 },
];

export const PREGAME_FIRST_DRIVE_ROLES = ['receive', 'afterOpponent'];
export const START_BINS = tables.startBins || [];

/** Set only when coin toss / kickoff order is known. */
export function knownOpeningReceiveSide(game) {
  const side = game?.openingReceiveSide ?? game?.live?.openingReceiveSide;
  return side === 'home' || side === 'away' ? side : null;
}

export function spreadBin(offenseSpread) {
  const s = Number(offenseSpread);
  if (!Number.isFinite(s)) return null;
  return SPREAD_BINS.find((b) => s >= b.lo && s < b.hi) || null;
}

export function periodFromSecLeft(secLeft) {
  const s = Number(secLeft);
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.min(4, Math.max(1, 4 - Math.floor((s - 0.001) / 900)));
}

export function clockSecFromSecLeft(secLeft) {
  const s = Number(secLeft);
  const period = periodFromSecLeft(s);
  if (!Number.isFinite(s)) return 900;
  return s - (4 - period) * 900;
}

function emptyHist() {
  return { n: 0, bins: {} };
}

function shrinkHist(spreadPack, globalPack) {
  const global = globalPack || emptyHist();
  const local = spreadPack || emptyHist();
  const n = Number(local.n) || 0;
  const gN = Number(global.n) || 0;
  const w = gN <= 0 ? 0 : n / (n + SHRINKAGE);
  const ids = START_BINS.map((b) => b.id);
  const rows = [];
  for (const id of ids) {
    const g = global.bins?.[id];
    const s = local.bins?.[id];
    const gp = gN > 0 ? (Number(g?.n) || 0) / gN : 0;
    const sp = n > 0 ? (Number(s?.n) || 0) / n : 0;
    const p = w * sp + (1 - w) * gp;
    if (p <= 1e-6) continue;
    const gYtg = Number(g?.ytg);
    const sYtg = Number(s?.ytg);
    const ytg = Number.isFinite(sYtg) && Number.isFinite(gYtg)
      ? w * sYtg + (1 - w) * gYtg
      : (Number.isFinite(sYtg) ? sYtg : gYtg);
    const gSec = Number(g?.secLeft);
    const sSec = Number(s?.secLeft);
    const secLeft = Number.isFinite(sSec) && Number.isFinite(gSec)
      ? w * sSec + (1 - w) * gSec
      : (Number.isFinite(sSec) ? sSec : gSec);
    if (!Number.isFinite(ytg)) continue;
    const bin = START_BINS.find((b) => b.id === id);
    rows.push({
      id,
      label: bin?.label || id,
      p,
      ytg,
      secLeft: Number.isFinite(secLeft) ? secLeft : null,
    });
  }
  const z = rows.reduce((a, r) => a + r.p, 0);
  if (z > 0) {
    for (const r of rows) r.p /= z;
  }
  return rows;
}

function mixRoot(root, offenseSpread) {
  const bin = spreadBin(offenseSpread);
  const local = bin ? root?.bySpread?.[bin.id] : null;
  return shrinkHist(local, root?.global);
}

export function receiveStartMix(offenseSpread) {
  return mixRoot(tables.receiveMix, offenseSpread);
}

export function afterOpponentStartMix(priorResult, offenseSpread) {
  return mixRoot(tables.afterOpponentMix?.[priorResult], offenseSpread);
}

export function empiricalOpeningResultWeights() {
  const out = {};
  let tot = 0;
  for (const key of OPENING_RESULTS) {
    const n = Number(tables.afterOpponentMix?.[key]?.global?.n) || 0;
    out[key] = n;
    tot += n;
  }
  if (tot <= 0) {
    for (const key of OPENING_RESULTS) out[key] = 0.25;
    return out;
  }
  for (const key of OPENING_RESULTS) out[key] /= tot;
  return out;
}

export function expectedYtgFromMix(bins) {
  let s = 0;
  let w = 0;
  for (const b of bins || []) {
    if (!Number.isFinite(b?.ytg) || !Number.isFinite(b?.p)) continue;
    s += b.p * b.ytg;
    w += b.p;
  }
  return w > 0 ? s / w : NaN;
}

function lookupMeanStart(role, offenseSpread) {
  const layer = role === 'receive' ? tables.receive : tables.afterOpponent;
  const global = tables.global?.[role] || tables.global?.afterOpponent;
  const bin = spreadBin(offenseSpread);
  const cell = (bin && layer?.[bin.id]) || global;
  return {
    ...cell,
    spreadBin: bin?.id ?? null,
  };
}

/**
 * Point-estimate start for a role (display / tests). Going-second serving
 * should use afterOpponentStartMix + opening-drive result weights instead.
 */
export function predictPregameFirstDriveStartForRole(role, offenseSpread = NaN) {
  if (role === 'afterOpponent') {
    const priorW = empiricalOpeningResultWeights();
    let ytg = 0;
    let secLeft = 0;
    let w = 0;
    for (const prior of OPENING_RESULTS) {
      const bins = afterOpponentStartMix(prior, offenseSpread);
      for (const b of bins) {
        const ww = priorW[prior] * b.p;
        ytg += ww * b.ytg;
        secLeft += ww * (Number(b.secLeft) || 3300);
        w += ww;
      }
    }
    if (w > 0) {
      ytg /= w;
      secLeft /= w;
    } else {
      const cell = lookupMeanStart(role, offenseSpread);
      ytg = Number(cell.ytg);
      secLeft = Number(cell.secLeft) || 3300;
    }
    const clockSec = clockSecFromSecLeft(secLeft);
    const period = periodFromSecLeft(secLeft);
    return {
      role,
      expectedYtg: ytg,
      expectedPeriod: period,
      expectedClockSec: clockSec,
      expectedSecLeft: secLeft,
      spreadBin: spreadBin(offenseSpread)?.id ?? null,
      source: 'after_opening_drive_mix',
    };
  }

  const bins = receiveStartMix(offenseSpread);
  const ytg = expectedYtgFromMix(bins);
  const secLeft = bins.reduce((s, b) => s + b.p * (Number(b.secLeft) || 3600), 0);
  const cell = lookupMeanStart('receive', offenseSpread);
  const useYtg = Number.isFinite(ytg) ? ytg : Number(cell.ytg);
  const useSec = secLeft || Number(cell.secLeft) || 3600;
  return {
    role,
    expectedYtg: useYtg,
    expectedPeriod: periodFromSecLeft(useSec),
    expectedClockSec: clockSecFromSecLeft(useSec),
    expectedSecLeft: useSec,
    spreadBin: spreadBin(offenseSpread)?.id ?? null,
    source: 'kickoff_receive_mix',
  };
}

export function soFarAfterOpening(result) {
  return {
    so_far_td: result === 'td' ? 1 : 0,
    so_far_fg: result === 'fg' ? 1 : 0,
    so_far_punt: result === 'punt' ? 1 : 0,
    so_far_other: result === 'other' ? 1 : 0,
  };
}

/** Blend drive-result probabilities across weighted scenarios. */
export function mixDriveResultProbs(parts) {
  const out = {};
  let wsum = 0;
  for (const part of parts || []) {
    const w = Number(part?.weight);
    if (!part?.p || !Number.isFinite(w) || w <= 0) continue;
    wsum += w;
    for (const [key, val] of Object.entries(part.p)) {
      const n = Number(val);
      if (!Number.isFinite(n)) continue;
      out[key] = (out[key] || 0) + w * n;
    }
  }
  if (wsum > 0 && Math.abs(wsum - 1) > 1e-9) {
    for (const key of Object.keys(out)) out[key] /= wsum;
  }
  return out;
}

export function blendDriveResultProbs(scenarios, weight = COIN_TOSS_WEIGHT) {
  return mixDriveResultProbs((scenarios || []).map((sc) => ({ p: sc.p, weight })));
}
