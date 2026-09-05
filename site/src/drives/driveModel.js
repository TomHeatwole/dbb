/**
 * NCAAF next-drive model — LightGBM joint probabilities vs FanDuel/DK
 * four-way settlement (Punt / Offensive TD / FG Attempt / Other).
 *
 * Drive-start trees for pregame 1st-drive; snap trees when ESPN has
 * down / distance / yards-to-goal. Trained 2023–24, held out 2025.
 */

import {
  americanToImpliedProb,
  analyzeAgainstBreakeven,
  computeKellyStake,
  formatAmericanOdds,
  probToAmerican,
} from '../sop/sopModel.js';
import { DRIVE_RESULT_MODEL, scoreLgbmLayer } from './driveResultLgbm.js';

/** ESPN scrape: example_data/ncaaf_drive_results/espn_ncaaf_drives.csv */
export const RAW_DRIVE_N = 113712;

export const DRIVE_BUCKETS = [
  {
    key: 'punt',
    label: 'Punt',
    n: 41261,
    runnerHints: ['punt'],
  },
  {
    key: 'td',
    label: 'OTD',
    n: 29888,
    runnerHints: ['offensive touchdown', 'offensive td', 'touchdown', 'td'],
  },
  {
    key: 'other',
    label: 'Other',
    n: 28865,
    runnerHints: ['other', 'any other'],
  },
  {
    key: 'fg',
    label: 'FGA',
    n: 13698,
    runnerHints: ['field goal attempt', 'fg attempt', 'field goal'],
  },
];

for (const bucket of DRIVE_BUCKETS) {
  bucket.p = bucket.n / RAW_DRIVE_N;
  bucket.fairAmerican = probToAmerican(bucket.p);
}

export const RAW_MODEL_META = {
  id: 'raw-ratio',
  label: 'Raw ratio',
  sample: RAW_DRIVE_N,
  seasons: '2023–25',
  note: 'Unconditional ESPN drive frequencies. Fallback when the joint model cannot score.',
};

export const LGBM_HOLDOUT = {
  driveStart: { logloss: 1.1564, raw: 1.3235, acc: 0.499, n: 38784 },
  snap: { logloss: 1.0389, raw: 1.3597, acc: 0.552, n: 258190 },
};

export const LGBM_MODEL_META = {
  id: 'lgbm-joint',
  label: 'Joint LightGBM',
  trainSeasons: DRIVE_RESULT_MODEL.meta?.trainSeasons ?? [2023, 2024],
  testSeason: DRIVE_RESULT_MODEL.meta?.testSeason ?? 2025,
  note: DRIVE_RESULT_MODEL.meta?.note
    ?? 'Joint P(result | clock, field, score, spread, total).',
};

const FP_CODES = DRIVE_RESULT_MODEL.meta?.fpCodes ?? {
  deep: 0, kickoff: 1, midfield: 2, favorable: 3,
};
const HALF_CODES = DRIVE_RESULT_MODEL.meta?.halfCodes ?? { h1: 0, h2: 1, ot: 2 };
const DIST_CODES = DRIVE_RESULT_MODEL.meta?.distCodes ?? {
  short: 0, med: 1, long: 2, xlong: 3,
};
const TIME_CODES = DRIVE_RESULT_MODEL.meta?.timeCodes ?? { late: 0, mid: 1, early: 2 };

export function formatSharePct(p) {
  if (!Number.isFinite(p)) return '—';
  return `${(p * 100).toFixed(1)}%`;
}

export function formatEdgePoints(points) {
  if (!Number.isFinite(points)) return '—';
  const abs = Math.abs(points);
  const body = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
  const sign = points > 0 ? '+' : points < 0 ? '−' : '';
  return `${sign}${body}%`;
}

function normalizeName(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’`]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\bst\b/g, 'state')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameWords(s) {
  return normalizeName(s).split(' ').filter(Boolean);
}

/**
 * How strongly `needle` (a team name) appears as a phrase in `hay`
 * (runner, market, or possession). Longer phrases beat shorter ones so
 * "Texas State" outranks "Texas" inside "1st Texas State Drive Result".
 */
export function nameMatchScore(hay, needle) {
  const h = normalizeName(hay);
  const n = normalizeName(needle);
  if (!h || !n) return 0;
  if (h === n) return 1000 + n.length;
  const hWords = nameWords(h);
  const nWords = nameWords(n);
  if (!nWords.length || nWords.length > hWords.length) return 0;
  for (let i = 0; i <= hWords.length - nWords.length; i += 1) {
    if (nWords.every((w, j) => hWords[i + j] === w)) {
      return 100 + nWords.length * 20 + n.length;
    }
  }
  return 0;
}

function pickNamedSide(named, home, away) {
  const homeScore = nameMatchScore(named, home);
  const awayScore = nameMatchScore(named, away);
  if (homeScore > awayScore && homeScore > 0) return 'home';
  if (awayScore > homeScore && awayScore > 0) return 'away';
  return null;
}

function fpCode(ytg) {
  const y = Number(ytg);
  if (!Number.isFinite(y)) return NaN;
  if (y >= 86) return FP_CODES.deep;
  if (y >= 70) return FP_CODES.kickoff;
  if (y >= 45) return FP_CODES.midfield;
  if (y >= 1) return FP_CODES.favorable;
  return NaN;
}

function halfCode(period) {
  const p = Number(period);
  if (p === 1 || p === 2) return HALF_CODES.h1;
  if (p === 3 || p === 4) return HALF_CODES.h2;
  if (p > 4) return HALF_CODES.ot;
  return NaN;
}

function distCode(distance) {
  const d = Number(distance);
  if (!Number.isFinite(d)) return NaN;
  if (d <= 3) return DIST_CODES.short;
  if (d <= 6) return DIST_CODES.med;
  if (d <= 10) return DIST_CODES.long;
  return DIST_CODES.xlong;
}

function timeCode(secLeftHalf) {
  const s = Number(secLeftHalf);
  if (!Number.isFinite(s)) return NaN;
  if (s <= 180) return TIME_CODES.late;
  if (s <= 480) return TIME_CODES.mid;
  return TIME_CODES.early;
}

export function secondsLeftInGame(period, clockSec) {
  const p = Number(period);
  const c = Number(clockSec);
  if (!Number.isFinite(p) || p <= 0) return Number.isFinite(c) ? c : NaN;
  if (!Number.isFinite(c)) return NaN;
  if (p <= 4) return (4 - p) * 900 + c;
  return c;
}

export function secondsLeftInHalf(period, clockSec) {
  const p = Number(period);
  const c = Number(clockSec);
  if (!Number.isFinite(c)) return NaN;
  if (p === 1 || p === 3) return 900 + c;
  if (p === 2 || p === 4) return c;
  return c;
}

export function extractHomeSpread(game) {
  const runners = game?.lines?.spread?.runners ?? [];
  const home = game?.teams?.home;
  const away = game?.teams?.away;
  let bestHome = null;
  let bestHomeScore = 0;
  let bestAway = null;
  let bestAwayScore = 0;
  for (const runner of runners) {
    if (!Number.isFinite(runner.handicap)) continue;
    const homeScore = nameMatchScore(runner.runnerName, home);
    const awayScore = nameMatchScore(runner.runnerName, away);
    if (homeScore > awayScore && homeScore > bestHomeScore) {
      bestHomeScore = homeScore;
      bestHome = runner;
    }
    if (awayScore > homeScore && awayScore > bestAwayScore) {
      bestAwayScore = awayScore;
      bestAway = runner;
    }
  }
  if (bestHome) return bestHome.handicap;
  if (bestAway) return -bestAway.handicap;
  const finite = runners.filter((r) => Number.isFinite(r.handicap));
  if (finite.length === 1) return finite[0].handicap;
  return NaN;
}

export function extractOverUnder(game) {
  const runners = game?.lines?.total?.runners ?? [];
  const over = runners.find((r) => /over/i.test(r.runnerName ?? '') && Number.isFinite(r.handicap));
  if (over) return over.handicap;
  const any = runners.find((r) => Number.isFinite(r.handicap));
  return any ? any.handicap : NaN;
}

export function inferOffenseSide(game, market = null) {
  const row = market || game?.nextDrive;
  const home = game?.teams?.home;
  const away = game?.teams?.away;
  // Market title first: DK "1st Texas Drive Result" vs a stale offenseSide
  // that confused Texas with Texas State.
  const fromMarketName = pickNamedSide(row?.marketName || '', home, away);
  if (fromMarketName) return fromMarketName;
  const fromOffenseName = pickNamedSide(row?.offenseName || '', home, away);
  if (fromOffenseName) return fromOffenseName;
  if (row?.offenseSide === 'home' || row?.offenseSide === 'away') {
    return row.offenseSide;
  }
  const live = game?.live;
  if (live?.possession === 'home' || live?.possession === 'away') return live.possession;
  return pickNamedSide(live?.possessionName || '', home, away);
}

export function resolveOffenseTeam(game, market = null) {
  const side = inferOffenseSide(game, market);
  const row = market || game?.nextDrive;
  const liveName = game?.live?.possessionName || null;
  const name = side === 'away'
    ? (game?.teams?.away || row?.offenseName || liveName || null)
    : side === 'home'
      ? (game?.teams?.home || row?.offenseName || liveName || null)
      : (row?.offenseName || liveName || null);
  return { side, name };
}

export function possessiveTeam(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  return /s$/i.test(raw) ? `${raw}'` : `${raw}'s`;
}

export function listDriveMarkets(game, { granular = false } = {}) {
  const raw = Array.isArray(game?.driveMarkets) && game.driveMarkets.length
    ? game.driveMarkets
    : (game?.nextDrive ? [game.nextDrive] : []);
  if (!raw.length) return [];
  const hasFlag = raw.some((market) => typeof market?.granular === 'boolean');
  if (!hasFlag) return raw;
  const match = raw.filter((market) => Boolean(market.granular) === Boolean(granular));
  if (match.length) return match;
  const fallback = raw.filter((market) => Boolean(market.granular) !== Boolean(granular));
  return fallback.length ? fallback : raw;
}

export function hasDriveLine(game) {
  return listDriveMarkets(game).length > 0;
}

function scoreDiffForOffense(game, side) {
  const home = Number(game?.score?.home);
  const away = Number(game?.score?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return NaN;
  if (side === 'away') return away - home;
  if (side === 'home') return home - away;
  return NaN;
}

/**
 * Build the feature map the trees expect. `layer` is driveStart | snap.
 */
export function featuresFromGame(game) {
  const live = game?.live ?? {};
  const inPlay = Boolean(game?.inPlay) && live.state !== 'pre';
  const period = Number(live.period);
  const clockSec = Number(live.clockSeconds);
  const ytgLive = Number(live.yardsToEndzone);
  const down = Number(live.down);
  const distance = Number(live.distance);
  const canSnap = inPlay
    && Number.isFinite(down)
    && down > 0
    && Number.isFinite(ytgLive)
    && ytgLive >= 1
    && ytgLive <= 99;

  const side = inferOffenseSide(game, game?.nextDrive);
  const homeSpread = extractHomeSpread(game);
  const ou = extractOverUnder(game);
  const offenseSpread = !side
    ? NaN
    : side === 'away'
      ? (Number.isFinite(homeSpread) ? -homeSpread : NaN)
      : (Number.isFinite(homeSpread) ? homeSpread : NaN);
  const expOff = Number.isFinite(ou) && Number.isFinite(offenseSpread)
    ? (ou - offenseSpread) / 2
    : NaN;
  const expDef = Number.isFinite(ou) && Number.isFinite(offenseSpread)
    ? (ou + offenseSpread) / 2
    : NaN;
  const scoreDiff = scoreDiffForOffense(game, side || 'home');

  if (canSnap) {
    const secLeft = secondsLeftInGame(period, clockSec);
    return {
      layer: 'snap',
      assumed: false,
      side,
      features: {
        down,
        distance: Number.isFinite(distance) ? distance : 10,
        ytg: ytgLive,
        sec_left: secLeft,
        period: Number.isFinite(period) ? period : NaN,
        score_diff: scoreDiff,
        offense_spread: offenseSpread,
        over_under: ou,
        exp_off: expOff,
        exp_def: expDef,
        fp_code: fpCode(ytgLive),
        dist_code: distCode(Number.isFinite(distance) ? distance : 10),
        half_code: halfCode(period),
        time_code: timeCode(secondsLeftInHalf(period, clockSec)),
      },
    };
  }

  const assumedKickoff = !inPlay || !Number.isFinite(ytgLive);
  const ytg = assumedKickoff ? 75 : ytgLive;
  const secLeft = !inPlay
    ? 3600
    : (Number.isFinite(period) && Number.isFinite(clockSec)
      ? secondsLeftInGame(period, clockSec)
      : NaN);
  const startPeriod = !inPlay ? 1 : (Number.isFinite(period) ? period : 1);
  return {
    layer: 'driveStart',
    assumed: assumedKickoff && !inPlay,
    side,
    features: {
      ytg,
      sec_left: secLeft,
      period: startPeriod,
      score_diff: Number.isFinite(scoreDiff) ? scoreDiff : 0,
      offense_spread: offenseSpread,
      over_under: ou,
      exp_off: expOff,
      exp_def: expDef,
      drive_n: inPlay ? NaN : 1,
      is_home: side === 'away' ? 0 : side === 'home' ? 1 : NaN,
      so_far_td: inPlay ? NaN : 0,
      so_far_fg: inPlay ? NaN : 0,
      so_far_punt: inPlay ? NaN : 0,
      so_far_other: inPlay ? NaN : 0,
      fp_code: fpCode(ytg),
      half_code: halfCode(startPeriod),
    },
  };
}

export function predictDriveResult(game) {
  const built = featuresFromGame(game);
  const scored = scoreLgbmLayer(built.layer, built.features);
  if (!scored) return null;
  return {
    ...built,
    p: scored.p,
    model: {
      ...LGBM_MODEL_META,
      layer: built.layer,
      layerLabel: built.layer === 'snap' ? 'Live snap' : 'Drive start',
    },
  };
}

export function evaluateDriveGame(game, {
  kellyEnabled = false,
  kellyBudget = 0,
  kellyFraction = 1,
  market = null,
} = {}) {
  const nextDrive = market ?? game?.nextDrive ?? null;
  const view = nextDrive && nextDrive !== game?.nextDrive
    ? { ...game, nextDrive }
    : game;
  const pred = predictDriveResult(view);
  const offense = resolveOffenseTeam(view, nextDrive);
  const outcomes = nextDrive?.outcomes ?? {};
  const rows = DRIVE_BUCKETS.map((bucket) => {
    const modelP = pred?.p?.[bucket.key];
    const p = Number.isFinite(modelP) ? modelP : bucket.p;
    const fairAmerican = probToAmerican(p);
    const quote = outcomes[bucket.key] ?? null;
    const source = nextDrive?.source;
    const fdAmerican = Number.isFinite(quote?.fd?.american)
      ? quote.fd.american
      : (source !== 'dk' && Number.isFinite(quote?.american) ? quote.american : null);
    const dkAmerican = Number.isFinite(quote?.dk?.american)
      ? quote.dk.american
      : (source === 'dk' && Number.isFinite(quote?.american) ? quote.american : null);
    const american = fdAmerican ?? dkAmerican ?? (Number.isFinite(quote?.american) ? quote.american : null);
    const fdAnalysis = analyzeAgainstBreakeven(fdAmerican, fairAmerican);
    const dkAnalysis = analyzeAgainstBreakeven(dkAmerican, fairAmerican);
    const analysis = (dkAnalysis?.edgePoints ?? -Infinity) > (fdAnalysis?.edgePoints ?? -Infinity)
      ? dkAnalysis
      : fdAnalysis;
    const offeredForKelly = (analysis === dkAnalysis ? dkAmerican : fdAmerican) ?? american;
    const profitable = Boolean(analysis?.profitable && offeredForKelly != null);
    const kellyStake = kellyEnabled && profitable
      ? computeKellyStake({
        winProb: p,
        offeredAmerican: offeredForKelly,
        bankroll: kellyBudget,
        kellyFraction,
      })
      : null;
    return {
      key: bucket.key,
      label: bucket.label,
      n: bucket.n,
      rawP: bucket.p,
      p,
      fairAmerican,
      rawFairAmerican: bucket.fairAmerican,
      american,
      fdAmerican,
      dkAmerican,
      dualBooks: fdAmerican != null && dkAmerican != null,
      runnerName: quote?.runnerName ?? null,
      legs: Array.isArray(quote?.legs) ? quote.legs : null,
      analysis,
      fdAnalysis,
      dkAnalysis,
      profitable,
      edgePoints: analysis?.edgePoints ?? null,
      kellyStake,
    };
  });

  const implied = rows.map((row) => americanToImpliedProb(row.american));
  const vigSum = implied.every((p) => Number.isFinite(p))
    ? implied.reduce((a, b) => a + b, 0)
    : null;
  if (Number.isFinite(vigSum) && vigSum > 0) {
    rows.forEach((row, i) => {
      row.marketP = implied[i] / vigSum;
      row.modelVsMarket = row.p - row.marketP;
    });
  }

  return {
    model: pred?.model ?? RAW_MODEL_META,
    pred,
    rows,
    evCount: rows.filter((row) => row.profitable).length,
    hasBook: rows.some((row) => row.american != null),
    vigPct: Number.isFinite(vigSum) ? (vigSum - 1) * 100 : null,
    marketName: nextDrive?.marketName ?? null,
    market: nextDrive,
    offenseName: offense.name,
    offenseSide: offense.side,
  };
}

export { formatAmericanOdds };
