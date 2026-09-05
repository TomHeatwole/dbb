/**
 * Team-week HProj: draw each rostered player's residual, score Hwang
 * best-ball, then read P25 / P50 / P75 of the team total.
 */

import { computeOptimalWeekDetail } from '../scenarios/simulatorLineup';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';
import { lookupHprojVariance, sampleHprojResidual } from './hprojVarianceBuckets';

export const HPROJ_SKILL_POS = ['QB', 'RB', 'WR', 'TE'];
export const HPROJ_ITERATIONS = 4000;
export const HPROJ_LIST_ITERATIONS = 1600;
const WINDOW_HALF = 80;

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

function windowSlice(sorted, percentile01) {
  const n = sorted.length;
  if (n === 0) return [];
  const idx = Math.round(percentile01 * (n - 1));
  const lo = Math.max(0, idx - WINDOW_HALF);
  const hi = Math.min(n, idx + WINDOW_HALF + 1);
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
 * Typical lineup + position totals around a team-total percentile (0–99).
 */
export function hprojAtPercentile(sorted, percentile) {
  const pct = Math.max(0, Math.min(99, Math.round(Number(percentile) || 0)));
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
 * @param {object} opts
 * @param {string[]} opts.playerIds
 * @param {Record<string, number>} opts.projectedPtsById
 * @param {Record<string, string|null>} opts.playerPositions
 * @param {number} [opts.iterations]
 * @param {string|number} [opts.seed]
 */
export function simulateTeamHproj({
  playerIds,
  projectedPtsById,
  playerPositions,
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
    const proj = Number(projectedPtsById[id] ?? projectedPtsById[rawId]);
    if (!Number.isFinite(proj) || proj <= 0) continue;
    const band = lookupHprojVariance(pos, proj);
    if (!band?.resid) continue;
    players.push({ id, pos, proj, resid: band.resid });
  }

  const ids = players.map((p) => p.id);
  const positions = {};
  for (const p of players) positions[p.id] = p.pos;

  const naivePts = {};
  for (const p of players) naivePts[p.id] = p.proj;
  const naive = computeOptimalWeekDetail(ids, naivePts, positions, null);

  const rng = mulberry32(hashSeed(seed));
  const sims = [];
  for (let i = 0; i < iterations; i += 1) {
    const weekPts = {};
    for (const p of players) {
      weekPts[p.id] = p.proj + (sampleHprojResidual(p.resid, rng()) || 0);
    }
    const scored = computeOptimalWeekDetail(ids, weekPts, positions, null);
    const row = { total: scored.total, byPos: scored.byPos };
    if (keepLineups) {
      row.starters = scored.starters.map((s) => ({
        slot: s.slot,
        id: s.id,
        position: s.position,
        pts: s.pts,
      }));
    }
    sims.push(row);
  }
  sims.sort((a, b) => a.total - b.total);

  const p25 = windowBreakdown(sims, 0.25);
  const p50 = windowBreakdown(sims, 0.50);
  const p75 = windowBreakdown(sims, 0.75);

  return {
    players: players.length,
    iterations,
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
