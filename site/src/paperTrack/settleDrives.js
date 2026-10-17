import {
  destakeFourWay,
  finiteNum,
  impliedProb,
  multiLogLoss,
} from './settleMath.js';

const BUCKETS = ['td', 'fg', 'punt', 'other'];

export function driveBucketFromResult(result) {
  const display = String(result ?? '').toLowerCase().trim();
  if (!display) return null;
  if (display === 'fg' || /field goal|missed fg/.test(display)) return 'fg';
  if (display === 'punt' || display === 'blocked punt' || /^punt\b/.test(display)) return 'punt';
  if (/touchdown|\btd\b/.test(display)) {
    if (/interception|fumble return|punt return|kickoff return|kick return|blocked punt|blocked field goal/i.test(display)) {
      return 'other';
    }
    return 'td';
  }
  return 'other';
}

function isSettled(row) {
  return Boolean(row?.settledAt || row?.payload?.settled_at);
}

function fourWayPatch(payload, drive) {
  const bucket = drive.bucket;
  const modelP = finiteNum(payload?.[`model_p_${bucket}`]);
  const market = destakeFourWay({
    td: impliedProb(payload?.dk_td) ?? finiteNum(payload?.live_p_td),
    fg: impliedProb(payload?.dk_fg) ?? finiteNum(payload?.live_p_fg),
    punt: impliedProb(payload?.dk_punt) ?? finiteNum(payload?.live_p_punt),
    other: impliedProb(payload?.dk_other) ?? finiteNum(payload?.live_p_other),
  });
  const marketP = market?.[bucket] ?? null;
  return {
    result: bucket,
    result_label: drive.result || bucket,
    model_p_result: modelP,
    live_p_result: marketP,
    model_logloss: multiLogLoss(modelP),
    market_logloss: marketP != null ? multiLogLoss(marketP) : null,
  };
}

export function liveLinesResultPatch(payload, finalScore) {
  const spread = finiteNum(payload?.home_spread);
  const total = finiteNum(payload?.total);
  const home = finiteNum(finalScore?.home);
  const away = finiteNum(finalScore?.away);
  if (home == null || away == null) return null;
  const margin = home - away;
  const points = home + away;
  let resultSpread = null;
  if (spread != null) {
    const adj = margin + spread;
    resultSpread = adj > 0 ? 'home' : adj < 0 ? 'away' : 'push';
  }
  let resultTotal = null;
  if (total != null) {
    resultTotal = points > total ? 'over' : points < total ? 'under' : 'push';
  }
  return {
    result: [resultSpread, resultTotal].filter(Boolean).join('/') || null,
    result_spread: resultSpread,
    result_total: resultTotal,
    score_final_home: home,
    score_final_away: away,
  };
}

/**
 * Pregame first-drive rows settle on that team's first completed ESPN series.
 * Halftime next-drive settles on the first 2H series for that offense.
 * Live spread/total rows settle when the game is over.
 */
export function driveSettlementPatches(rows, {
  drives = [],
  finalScore = null,
  finished = false,
} = {}) {
  const firstBySide = { home: null, away: null };
  for (const drive of drives) {
    if (!drive?.side || !BUCKETS.includes(drive.bucket)) continue;
    if (!firstBySide[drive.side]) firstBySide[drive.side] = drive;
  }
  const firstSecondHalf = drives.find((drive) => (
    (finiteNum(drive.period) ?? 0) >= 3
    && drive.side
    && BUCKETS.includes(drive.bucket)
  ));

  const patches = [];
  for (const row of rows ?? []) {
    if (isSettled(row)) continue;
    const payload = row.payload || {};
    const phase = row.phase || payload.phase;
    const side = row.offenseSide || payload.offense_side;
    if (phase === 'pregame_first') {
      const drive = firstBySide[side];
      if (drive) patches.push({ id: row.id, patch: fourWayPatch(payload, drive) });
    } else if (phase === 'halftime_next') {
      if (firstSecondHalf && firstSecondHalf.side === side) {
        patches.push({ id: row.id, patch: fourWayPatch(payload, firstSecondHalf) });
      }
    } else if (phase === 'live_lines' && finished) {
      const patch = liveLinesResultPatch(payload, finalScore);
      if (patch) patches.push({ id: row.id, patch });
    }
  }
  return patches;
}
