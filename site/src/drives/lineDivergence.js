/**
 * Compare live FanDuel main lines to the pregame snapshot for adverse-selection filtering.
 */

function nameMatchScore(runnerName, teamName) {
  const runner = String(runnerName ?? '').toLowerCase();
  const team = String(teamName ?? '').toLowerCase();
  if (!runner || !team) return 0;
  if (runner === team) return 100;
  if (runner.includes(team) || team.includes(runner)) return 80;
  const parts = team.split(/\s+/).filter(Boolean);
  return parts.filter((part) => runner.includes(part)).length * 10;
}

function readLiveSpread(game) {
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

function readLiveTotal(game) {
  const runners = game?.lines?.total?.runners ?? [];
  const over = runners.find((r) => /over/i.test(r.runnerName ?? '') && Number.isFinite(r.handicap));
  if (over) return over.handicap;
  const any = runners.find((r) => Number.isFinite(r.handicap));
  return any ? any.handicap : NaN;
}

export const DEFAULT_TOTAL_MOVE_FILTER_PTS = 7;
export const DEFAULT_SPREAD_MOVE_FILTER_PTS = 10;

export function pointsScored(game) {
  const home = Number(game?.score?.home);
  const away = Number(game?.score?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return home + away;
}

export function readPregameLines(game) {
  const snap = game?.pregameLines;
  if (!snap || typeof snap !== 'object') return null;
  const spread = Number(snap.spread);
  const total = Number(snap.total);
  if (!Number.isFinite(spread) && !Number.isFinite(total)) return null;
  return {
    spread: Number.isFinite(spread) ? spread : null,
    total: Number.isFinite(total) ? total : null,
    capturedAt: snap.capturedAt ?? null,
    source: snap.source ?? null,
  };
}

export function snapshotLinesFromGame(game, { source = 'fd' } = {}) {
  const spread = readLiveSpread(game);
  const total = readLiveTotal(game);
  if (!Number.isFinite(spread) && !Number.isFinite(total)) return null;
  return {
    spread: Number.isFinite(spread) ? spread : null,
    total: Number.isFinite(total) ? total : null,
    capturedAt: new Date().toISOString(),
    source,
  };
}

/**
 * @param {object} opts
 * @param {number|null} opts.liveTotal
 * @param {number|null} opts.pregameTotal
 * @param {number|null} opts.pointsScored
 * @param {number|null} opts.liveSpread
 * @param {number|null} opts.pregameSpread
 * @param {number} [opts.totalMoveFilterPts]
 * @param {number} [opts.spreadMoveFilterPts]
 * @param {boolean} [opts.inPlay]
 */
export function computeLineDivergence({
  liveTotal,
  pregameTotal,
  pointsScored: scored,
  liveSpread,
  pregameSpread,
  totalMoveFilterPts = DEFAULT_TOTAL_MOVE_FILTER_PTS,
  spreadMoveFilterPts = DEFAULT_SPREAD_MOVE_FILTER_PTS,
  inPlay = false,
} = {}) {
  const totalMove = Number.isFinite(liveTotal) && Number.isFinite(pregameTotal)
    ? liveTotal - pregameTotal
    : null;
  const spreadMove = Number.isFinite(liveSpread) && Number.isFinite(pregameSpread)
    ? liveSpread - pregameSpread
    : null;

  const impliedRemainingLive = Number.isFinite(liveTotal) && Number.isFinite(scored)
    ? liveTotal - scored
    : null;
  const impliedRemainingPregame = Number.isFinite(pregameTotal) && Number.isFinite(scored)
    ? pregameTotal - scored
    : null;
  const remainingGap = Number.isFinite(impliedRemainingLive) && Number.isFinite(impliedRemainingPregame)
    ? impliedRemainingLive - impliedRemainingPregame
    : (Number.isFinite(totalMove) ? totalMove : null);

  const totalFilter = Number.isFinite(totalMove)
    && Math.abs(totalMove) >= totalMoveFilterPts;
  const spreadFilter = Number.isFinite(spreadMove)
    && Math.abs(spreadMove) >= spreadMoveFilterPts;
  const filterActive = Boolean(inPlay && (totalFilter || spreadFilter));

  let filterReason = null;
  if (filterActive) {
    if (totalFilter && spreadFilter) {
      filterReason = 'total_and_spread';
    } else if (totalFilter) {
      filterReason = 'total';
    } else {
      filterReason = 'spread';
    }
  }

  return {
    liveTotal: Number.isFinite(liveTotal) ? liveTotal : null,
    pregameTotal: Number.isFinite(pregameTotal) ? pregameTotal : null,
    liveSpread: Number.isFinite(liveSpread) ? liveSpread : null,
    pregameSpread: Number.isFinite(pregameSpread) ? pregameSpread : null,
    pointsScored: Number.isFinite(scored) ? scored : null,
    totalMove,
    spreadMove,
    impliedRemainingLive,
    impliedRemainingPregame,
    remainingGap,
    totalMoveFilterPts,
    spreadMoveFilterPts,
    filterActive,
    filterReason,
    hasPregameSnapshot: Number.isFinite(pregameTotal) || Number.isFinite(pregameSpread),
  };
}

export function lineDivergenceForGame(game, opts = {}) {
  const pregame = readPregameLines(game);
  return computeLineDivergence({
    liveTotal: readLiveTotal(game),
    pregameTotal: pregame?.total ?? null,
    pointsScored: pointsScored(game),
    liveSpread: readLiveSpread(game),
    pregameSpread: pregame?.spread ?? null,
    inPlay: Boolean(game?.inPlay),
    ...opts,
  });
}

function signedPts(n, digits = 1) {
  if (!Number.isFinite(n)) return '—';
  const rounded = Number(n.toFixed(digits));
  if (rounded === 0) return '0';
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export function describeLineDivergence(div) {
  if (!div?.hasPregameSnapshot) {
    return 'No pregame main-line snapshot yet — line filter inactive.';
  }
  if (!div.filterActive) {
    const bits = [];
    if (Number.isFinite(div.totalMove)) bits.push(`total ${signedPts(div.totalMove)}`);
    if (Number.isFinite(div.spreadMove)) bits.push(`spread ${signedPts(div.spreadMove)}`);
    const tail = bits.length ? ` (${bits.join(', ')} from pregame close)` : '';
    return `Main line within filter band${tail}.`;
  }
  if (div.filterReason === 'total_and_spread') {
    return `Main total moved ${signedPts(div.totalMove)} and spread ${signedPts(div.spreadMove)} from pregame close — market may know something; +EV flagged off.`;
  }
  if (div.filterReason === 'total') {
    return `Main total moved ${signedPts(div.totalMove)} from pregame close (live ${div.liveTotal}, was ${div.pregameTotal}) — market may know something; +EV flagged off.`;
  }
  return `Main spread moved ${signedPts(div.spreadMove)} from pregame close — market may know something; +EV flagged off.`;
}

export function applyLineDivergenceFilter(model, divergence) {
  if (!divergence?.filterActive || !model) return model;
  const rows = (model.rows ?? []).map((row) => {
    if (!row.profitable) return row;
    return {
      ...row,
      profitable: false,
      lineFiltered: true,
      kellyStake: null,
      preFilterProfitable: true,
      preFilterEdgePoints: row.edgePoints,
    };
  });
  return {
    ...model,
    rows,
    evCount: rows.filter((row) => row.profitable).length,
    lineDivergence: divergence,
    lineFilterActive: true,
  };
}
