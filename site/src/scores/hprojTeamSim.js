/**
 * Team-week HProj: draw each rostered player's residual, score Hwang
 * best-ball, then read P25 / P50 / P75 of the team total.
 */

import { computeOptimalWeekDetail } from '../scenarios/simulatorLineup';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';
import { hprojPercentile, lookupHprojVariance, sampleHprojResidual } from './hprojVarianceBuckets';
import { displayActualPts, espnLiveProjection, liveTimeFrac, scaledLiveOutcome } from './liveOutlook';

export const HPROJ_SKILL_POS = ['QB', 'RB', 'WR', 'TE'];
export const HPROJ_ITERATIONS = 40000;
export const HPROJ_LIST_ITERATIONS = 1600;
export const HPROJ_TEAM_PCT_MAX = 99.9;
const WINDOW_HALF_MID = 80;
const WINDOW_HALF_TAIL = 20;

export function clampTeamPercentile(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.round(Math.max(0, Math.min(HPROJ_TEAM_PCT_MAX, n)) * 10) / 10;
}

export function formatTeamPercentile(raw) {
  const v = clampTeamPercentile(raw);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function skillPosition(raw) {
  if (raw === 'FB') return 'RB';
  if (HPROJ_SKILL_POS.includes(raw)) return raw;
  return null;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function emptyByPos() {
  return { QB: 0, RB: 0, WR: 0, TE: 0 };
}

function windowHalfFor(n, idx) {
  const distToEdge = Math.min(idx, n - 1 - idx);
  const taper = Math.max(1, Math.round(n * 0.01));
  if (distToEdge >= taper) return WINDOW_HALF_MID;
  return Math.max(
    WINDOW_HALF_TAIL,
    Math.round(WINDOW_HALF_TAIL + (WINDOW_HALF_MID - WINDOW_HALF_TAIL) * (distToEdge / taper)),
  );
}

function windowSlice(sorted, percentile01) {
  const n = sorted.length;
  if (n === 0) return [];
  const idx = Math.round(percentile01 * (n - 1));
  const half = windowHalfFor(n, idx);
  const lo = Math.max(0, idx - half);
  const hi = Math.min(n, idx + half + 1);
  return sorted.slice(lo, hi);
}

function windowBreakdown(sorted, percentile01) {
  const slice = windowSlice(sorted, percentile01);
  const byPos = emptyByPos();
  let total = 0;
  for (const row of slice) {
    total += row.total;
    for (const pos of HPROJ_SKILL_POS) byPos[pos] += row.byPos[pos];
  }
  const denom = slice.length || 1;
  const out = { total: round1(total / denom), byPos: emptyByPos() };
  for (const pos of HPROJ_SKILL_POS) out.byPos[pos] = round1(byPos[pos] / denom);
  return out;
}

const MIN_ALT_PCT = 0.12;

function eligibleForSlot(slot, pos) {
  const s = String(slot || '').toUpperCase();
  if (s.startsWith('QB')) return pos === 'QB';
  if (s.startsWith('RB')) return pos === 'RB';
  if (s.startsWith('WR')) return pos === 'WR';
  if (s.startsWith('TE')) return pos === 'TE';
  if (s.startsWith('FLEX')) return pos === 'RB' || pos === 'WR' || pos === 'TE';
  if (s.startsWith('SUPER')) return pos === 'QB' || pos === 'RB' || pos === 'WR' || pos === 'TE';
  return false;
}

function rankSlotPlayers(map, denom) {
  return [...map.entries()]
    .map(([id, v]) => ({
      id,
      position: v.position,
      startPct: v.count / denom,
      pts: round1(v.pts / (v.count || 1)),
    }))
    .sort((a, b) => b.startPct - a.startPct || b.pts - a.pts);
}

/**
 * Typical lineup + position totals around a team-total percentile (0–99.9).
 */
export function hprojAtPercentile(sorted, percentile) {
  const pct = clampTeamPercentile(percentile);
  const slice = windowSlice(sorted || [], pct / 100);
  const denom = slice.length || 1;
  const totals = windowBreakdown(sorted || [], pct / 100);
  const slotNames = STARTER_POSITION_NAMES || [];
  const slotMaps = slotNames.map(() => new Map());
  const posMaps = { QB: new Map(), RB: new Map(), WR: new Map(), TE: new Map() };

  for (const row of slice) {
    for (const s of row.starters || []) {
      const slotIdx = slotNames.indexOf(s.slot);
      if (slotIdx >= 0) {
        const prev = slotMaps[slotIdx].get(s.id) || { count: 0, pts: 0, position: s.position };
        prev.count += 1;
        prev.pts += s.pts;
        slotMaps[slotIdx].set(s.id, prev);
      }
      if (posMaps[s.position]) {
        const prev = posMaps[s.position].get(s.id) || { count: 0, pts: 0, position: s.position };
        prev.count += 1;
        prev.pts += s.pts;
        posMaps[s.position].set(s.id, prev);
      }
    }
  }

  const globalRanked = rankSlotPlayers((() => {
    const merged = new Map();
    for (const map of slotMaps) {
      for (const [id, v] of map.entries()) {
        const prev = merged.get(id) || { count: 0, pts: 0, position: v.position };
        prev.count += v.count;
        prev.pts += v.pts;
        merged.set(id, prev);
      }
    }
    return merged;
  })(), denom);

  const usedIds = new Set();
  const slots = slotNames.map((slot, i) => {
    const ranked = rankSlotPlayers(slotMaps[i], denom)
      .filter((p) => eligibleForSlot(slot, p.position));
    let primary = ranked.find((p) => !usedIds.has(p.id)) || null;
    if (!primary || primary.startPct < 0.18) {
      const fallback = globalRanked.find((p) => (
        !usedIds.has(p.id) && eligibleForSlot(slot, p.position)
      ));
      if (fallback && (!primary || fallback.startPct > primary.startPct)) {
        primary = fallback;
      }
    }
    if (primary) usedIds.add(primary.id);
    return {
      slot,
      primary,
      alts: ranked.filter((p) => p.id !== primary?.id && p.startPct >= MIN_ALT_PCT).slice(0, 2),
    };
  });

  const byPosPlayers = {};
  for (const pos of HPROJ_SKILL_POS) {
    byPosPlayers[pos] = rankSlotPlayers(posMaps[pos], denom).filter((p) => p.startPct >= MIN_ALT_PCT);
  }

  return {
    percentile: pct,
    total: totals.total,
    byPos: totals.byPos,
    slots,
    byPosPlayers,
    window: denom,
  };
}

/**
 * One simulated week from the band around a team-total percentile.
 * `salt` re-rolls which draw in that band is shown.
 */
export function hprojRandomOutcome(sorted, percentile, salt = 0) {
  const pct = clampTeamPercentile(percentile);
  const slice = windowSlice(sorted || [], pct / 100);
  if (slice.length === 0) return null;
  const rng = mulberry32(hashSeed(`hproj-draw:${pct.toFixed(1)}:${salt}`));
  const pick = slice[Math.floor(rng() * slice.length)];
  return {
    percentile: pct,
    total: round1(pick.total),
    byPos: {
      QB: round1(pick.byPos.QB),
      RB: round1(pick.byPos.RB),
      WR: round1(pick.byPos.WR),
      TE: round1(pick.byPos.TE),
    },
    starters: (pick.starters || []).map((s) => ({
      slot: s.slot,
      id: s.id,
      position: s.position,
      pts: round1(s.pts),
      playerPct: s.playerPct,
      locked: Boolean(s.locked),
      live: Boolean(s.live),
    })),
    weekPts: pick.weekPts || {},
    playerPctById: pick.playerPct || {},
    window: slice.length,
  };
}

function labelForPlayer(playerGameLabels, playerId) {
  if (!playerGameLabels || playerId == null) return null;
  return playerGameLabels[playerId] || playerGameLabels[String(playerId)] || null;
}

/** True once any NFL game this week is Final. */
export function weekHasCompletedGames(playerGameLabels) {
  if (!playerGameLabels || typeof playerGameLabels !== 'object') return false;
  return Object.values(playerGameLabels).some((label) => label && label.completed);
}

/** True once any game is Final or in progress (Live Proj should take over). */
export function weekHasStartedGames(playerGameLabels) {
  if (!playerGameLabels || typeof playerGameLabels !== 'object') return false;
  return Object.values(playerGameLabels).some((label) => label && (label.completed || label.live));
}

function scoreRows(teamScore) {
  return [...((teamScore && teamScore.starters) || []), ...((teamScore && teamScore.bench) || [])];
}

/**
 * Actual points for players whose game is Final, or who are Out.
 * Live games stay unlocked so their remaining band can still roll.
 */
export function lockedPtsFromCompletedGames(teamScore, playerGameLabels, opts = {}) {
  const out = {};
  if (!teamScore) return out;
  const projectedPtsById = opts.projectedPtsById || null;
  const outPlayerIds = opts.outPlayerIds || null;
  for (const player of scoreRows(teamScore)) {
    if (!player || player.id == null || String(player.id) === '0') continue;
    const id = String(player.id);
    const label = labelForPlayer(playerGameLabels, player.id);
    const ruledOut = outPlayerIds ? outPlayerIds.has(id) : false;
    if (!(label && label.completed) && !ruledOut) continue;
    const proj = projectedPtsById
      ? Number(projectedPtsById[id] ?? projectedPtsById[player.id])
      : null;
    out[id] = displayActualPts(player, label, proj);
  }
  return out;
}

/**
 * In-progress (not Out) players: current score + remaining-time scale for draws.
 */
export function liveScaleFromInProgressGames(teamScore, playerGameLabels, opts = {}) {
  const out = {};
  if (!teamScore) return out;
  const projectedPtsById = opts.projectedPtsById || null;
  const outPlayerIds = opts.outPlayerIds || null;
  for (const player of scoreRows(teamScore)) {
    if (!player || player.id == null || String(player.id) === '0') continue;
    const id = String(player.id);
    if (outPlayerIds && outPlayerIds.has(id)) continue;
    const label = labelForPlayer(playerGameLabels, player.id);
    if (!label || !label.live) continue;
    const proj = projectedPtsById
      ? Number(projectedPtsById[id] ?? projectedPtsById[player.id])
      : null;
    const actual = displayActualPts(player, label, proj);
    out[id] = { actual, timeFrac: liveTimeFrac(label) };
  }
  return out;
}

/**
 * @param {object} opts
 * @param {string[]} opts.playerIds
 * @param {Record<string, number>} opts.projectedPtsById
 * @param {Record<string, string|null>} opts.playerPositions
 * @param {Record<string, number>} [opts.lockedPtsById] completed / Out actuals
 * @param {Record<string, { actual: number, timeFrac: number }>} [opts.liveScaleById]
 * @param {number} [opts.iterations]
 * @param {string|number} [opts.seed]
 */
export function simulateTeamHproj({
  playerIds,
  projectedPtsById,
  playerPositions,
  lockedPtsById = null,
  liveScaleById = null,
  iterations = HPROJ_ITERATIONS,
  seed = 1,
  keepLineups = false,
}) {
  const players = [];
  for (const rawId of playerIds || []) {
    const id = String(rawId);
    if (!id || id === '0') continue;
    const pos = skillPosition(playerPositions[id] || playerPositions[rawId]);
    if (!pos) continue;
    const lockedRaw = lockedPtsById ? lockedPtsById[id] ?? lockedPtsById[rawId] : undefined;
    const lockedPts = Number.isFinite(Number(lockedRaw)) ? Number(lockedRaw) : null;
    const live = liveScaleById ? liveScaleById[id] || liveScaleById[rawId] : null;
    const proj = Number(projectedPtsById[id] ?? projectedPtsById[rawId]);
    if (lockedPts != null) {
      players.push({
        id,
        pos,
        proj: Number.isFinite(proj) && proj > 0 ? proj : 0,
        resid: null,
        lockedPts,
        liveScale: null,
      });
      continue;
    }
    if (!Number.isFinite(proj) || proj <= 0) continue;
    const band = lookupHprojVariance(pos, proj);
    if (!band?.resid) continue;
    const liveScale = live && Number.isFinite(Number(live.timeFrac))
      ? { actual: Number(live.actual) || 0, timeFrac: Math.max(0, Math.min(1, Number(live.timeFrac))) }
      : null;
    players.push({ id, pos, proj, resid: band.resid, lockedPts: null, liveScale });
  }

  const ids = players.map((p) => p.id);
  const positions = {};
  for (const p of players) positions[p.id] = p.pos;

  const naivePts = {};
  for (const p of players) {
    if (p.lockedPts != null) naivePts[p.id] = p.lockedPts;
    else if (p.liveScale) naivePts[p.id] = espnLiveProjection(p.liveScale.actual, p.proj, p.liveScale.timeFrac);
    else naivePts[p.id] = p.proj;
  }
  const naive = computeOptimalWeekDetail(ids, naivePts, positions, null);

  const rng = mulberry32(hashSeed(seed));
  const sims = [];
  for (let i = 0; i < iterations; i += 1) {
    const weekPts = {};
    const playerPct = {};
    for (const p of players) {
      if (p.lockedPts != null) {
        weekPts[p.id] = Math.max(0, p.lockedPts);
        const finishedPct = hprojPercentile(p.pos, p.proj, p.lockedPts);
        if (finishedPct != null) playerPct[p.id] = finishedPct;
        continue;
      }
      const u = rng();
      const rolled = Math.max(0, p.proj + (sampleHprojResidual(p.resid, u, p.pos, p.proj) || 0));
      weekPts[p.id] = p.liveScale
        ? scaledLiveOutcome(p.liveScale.actual, rolled, p.liveScale.timeFrac)
        : rolled;
      playerPct[p.id] = Math.max(0, Math.min(99, Math.round(u * 100)));
    }
    const scored = computeOptimalWeekDetail(ids, weekPts, positions, null);
    const row = { total: scored.total, byPos: scored.byPos };
    if (keepLineups) {
      row.playerPct = playerPct;
      row.weekPts = weekPts;
      row.starters = scored.starters.map((s) => ({
        slot: s.slot,
        id: s.id,
        position: s.position,
        pts: s.pts,
        playerPct: playerPct[s.id],
        locked: lockedPtsById != null
          && Number.isFinite(Number(lockedPtsById[s.id] ?? lockedPtsById[String(s.id)])),
        live: liveScaleById != null
          && liveScaleById[s.id] != null,
      }));
    }
    sims.push(row);
  }
  sims.sort((a, b) => a.total - b.total);
  const totals = sims.map((row) => row.total);

  const p25 = windowBreakdown(sims, 0.25);
  const p50 = windowBreakdown(sims, 0.50);
  const p75 = windowBreakdown(sims, 0.75);

  return {
    players: players.length,
    iterations,
    totals,
    naiveTotal: round1(naive.total),
    naiveByPos: {
      QB: round1(naive.byPos.QB),
      RB: round1(naive.byPos.RB),
      WR: round1(naive.byPos.WR),
      TE: round1(naive.byPos.TE),
    },
    naiveStarters: (naive.starters || []).map((s) => ({
      slot: s.slot,
      id: s.id,
      position: s.position,
      pts: round1(s.pts),
    })),
    p25,
    p50,
    p75,
    lockedPlayerIds: players.filter((p) => p.lockedPts != null).map((p) => p.id),
    sims: keepLineups ? sims : null,
  };
}

export function hprojPlayerPositions(playerIds, playersData) {
  const playerPositions = {};
  for (const rawId of playerIds || []) {
    const rec = playersData?.[rawId] || playersData?.[String(rawId)];
    const raw = rec?.position || rec?.fantasy_positions?.[0] || null;
    playerPositions[String(rawId)] = raw === 'FB' ? 'RB' : raw;
  }
  return playerPositions;
}

export function ownerFirstNameCounts(rosters, users) {
  const counts = {};
  if (!Array.isArray(rosters) || !Array.isArray(users)) return counts;
  for (const roster of rosters) {
    if (!roster) continue;
    const user = users.find((u) => u && String(u.user_id) === String(roster.owner_id));
    const first = String(user?.display_name || '').trim().split(/\s+/)[0] || '';
    if (!first) continue;
    const key = first.toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function hprojPageHref(week, { rosterId, ownerName } = {}, firstNameCounts = {}) {
  const first = String(ownerName || '').trim().split(/\s+/)[0] || '';
  const unique = first && firstNameCounts[first.toLowerCase()] === 1;
  const team = unique ? first : String(rosterId);
  return `/hproj?team=${encodeURIComponent(team)}&week=${Number(week)}`;
}

/**
 * P(left outscores right) from two independent sorted HPROJ totals.
 * Ties split 50/50. Display percents are integers that sum to 100.
 */
export function hprojMatchupWinProb(leftTotals, rightTotals) {
  const left = Array.isArray(leftTotals) ? leftTotals.slice().sort((a, b) => a - b) : [];
  const right = Array.isArray(rightTotals) ? rightTotals.slice().sort((a, b) => a - b) : [];
  if (!left.length || !right.length) return null;

  let wins = 0;
  let ties = 0;
  let j = 0;
  let k = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    while (j < right.length && right[j] < a) j += 1;
    while (k < right.length && right[k] <= a) k += 1;
    wins += j;
    ties += k - j;
  }
  const n = left.length * right.length;
  const losses = n - wins - ties;
  const leftShare = (wins + ties * 0.5) / n;
  const rightShare = (losses + ties * 0.5) / n;
  return formatMatchupWinPcts(leftShare, rightShare);
}

export function formatMatchupWinPcts(leftShare, rightShare) {
  const pL = Number(leftShare);
  const pR = Number(rightShare);
  if (!Number.isFinite(pL) || !Number.isFinite(pR)) return null;
  const denom = pL + pR;
  if (!(denom > 0)) return { leftPct: 50, rightPct: 50, leftShare: 0.5, rightShare: 0.5 };

  const shareL = pL / denom;
  const shareR = pR / denom;
  if (shareL <= 0) return { leftPct: 0, rightPct: 100, leftShare: shareL, rightShare: shareR };
  if (shareR <= 0) return { leftPct: 100, rightPct: 0, leftShare: shareL, rightShare: shareR };

  let leftPct = Math.round(shareL * 100);
  if (leftPct < 1) leftPct = 1;
  if (leftPct > 99) leftPct = 99;
  return {
    leftPct,
    rightPct: 100 - leftPct,
    leftShare: shareL,
    rightShare: shareR,
  };
}

export function resolveHprojTeam(teamMap, query) {
  const raw = String(query || '').trim();
  if (!raw || !teamMap) return null;
  const q = raw.toLowerCase();
  const entries = Object.entries(teamMap);
  const scored = [];
  for (const [rid, info] of entries) {
    const owner = String(info.ownerName || '');
    const team = String(info.teamName || '');
    const first = owner.split(/\s+/)[0] || '';
    if (String(rid) === raw) return { rid: Number(rid), ...info };
    if (owner.toLowerCase() === q || team.toLowerCase() === q || first.toLowerCase() === q) {
      return { rid: Number(rid), ...info };
    }
    if (
      owner.toLowerCase().includes(q)
      || team.toLowerCase().includes(q)
      || first.toLowerCase().startsWith(q)
    ) {
      scored.push({ rid: Number(rid), ...info });
    }
  }
  return scored.length === 1 ? scored[0] : null;
}
