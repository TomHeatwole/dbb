/**
 * Roster-context HVORP for the team HVORP Analytics tab.
 *
 * HVORP = optimal starter points with the player minus optimal starter points
 * without them (leave-one-out). Rate stats divide by games with a score so
 * missed weeks don't dilute the per-game number.
 */

import { computeOptimalWeek } from '../scenarios/computeScenarioEval';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';

export const PLAYOFF_START_WEEK = 15;
const MAX_WEEKS = 17;

function round1(n) {
  return Math.round((n || 0) * 10) / 10;
}

function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}

function starterSlotForPlayer(starters, pid) {
  const names = STARTER_POSITION_NAMES || [];
  const idx = (starters || []).findIndex((p) => p && String(p.id) === String(pid));
  if (idx < 0) return null;
  return names[idx] || `S${idx + 1}`;
}

/** The bench player who enters the optimal lineup when `pid` is removed. */
function findReplacement(pid, withOptimal, withoutOptimal) {
  const names = STARTER_POSITION_NAMES || [];
  const withS = withOptimal?.starters || [];
  const withoutS = withoutOptimal?.starters || [];
  const withIds = new Set(
    withS.map((p) => String(p?.id)).filter((id) => id && id !== '0'),
  );
  const entered = withoutS
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p?.id && String(p.id) !== '0' && !withIds.has(String(p.id)));
  if (entered.length === 0) return null;
  entered.sort((a, b) => (b.p.pts || 0) - (a.p.pts || 0));
  const best = entered[0];
  return {
    id: String(best.p.id),
    pts: round1(best.p.pts || 0),
    slot: names[best.idx] || null,
  };
}

export function buildPlayerWeeklyPointsFromMatchups(weeksParsedData) {
  return (weeksParsedData || []).map((weekEntries) => {
    const weekPts = {};
    (weekEntries || []).forEach((entry) => {
      for (const [pid, pts] of Object.entries(entry?.players_points || {})) {
        weekPts[pid] = pts;
      }
    });
    return weekPts;
  });
}

function weekHasScores(weekEntries) {
  return Array.isArray(weekEntries) && weekEntries.some((e) => e && e.players_points);
}

/**
 * @returns {Array<{
 *   playerId: string,
 *   totalScore: number,
 *   hvorp: number,
 *   hvorpPerGame: number|null,
 *   playoffHvorp: number,
 *   playoffHvorpPerGame: number|null,
 *   gamesPlayed: number,
 *   playoffGamesPlayed: number,
 *   weeksStarted: number,
 *   weeksBenched: number,
 *   ppg: number|null,
 *   weekly: Array<{
 *     week: number, pts: number, hvorp: number, started: boolean, played: boolean, isPlayoff: boolean,
 *     slot: string|null, replacementId: string|null, replacementPts: number|null, replacementSlot: string|null,
 *   }>,
 *   slotCounts: Object<string, number>,
 *   topReplacementId: string|null,
 *   topReplacementWeeks: number,
 * }>}
 */
export function computeTeamPlayerHvorpStats({
  rosterPlayerIds,
  weeksParsedData,
  playersData,
  playerIdMap,
  playerSeasonTotalsMap,
  weekCount,
}) {
  const playerList = (rosterPlayerIds || []).filter((pid) => pid && pid !== '0');
  const playerWeeklyPoints = buildPlayerWeeklyPointsFromMatchups(weeksParsedData);
  const completed = Number.isFinite(weekCount) ? weekCount : playerWeeklyPoints.length;
  const n = Math.max(0, Math.min(MAX_WEEKS, completed, playerWeeklyPoints.length));

  const statsByPlayer = {};
  for (const pid of playerList) {
    statsByPlayer[pid] = {
      playerId: pid,
      totalScore: 0,
      hvorp: 0,
      playoffHvorp: 0,
      gamesPlayed: 0,
      playoffGamesPlayed: 0,
      weeksStarted: 0,
      weeksBenched: 0,
      weekly: [],
    };
  }

  if (playerList.length === 0 || n === 0) {
    return playerList.map((pid) => finalizePlayerStats(statsByPlayer[pid]));
  }

  for (let wi = 0; wi < n; wi++) {
    const weekNum = wi + 1;
    if (!weekHasScores(weeksParsedData?.[wi])) {
      continue;
    }

    const weekPts = playerWeeklyPoints[wi] || {};
    const withOptimal = computeOptimalWeek(
      playerList,
      weekPts,
      playersData,
      playerIdMap,
      playerSeasonTotalsMap,
    );
    const withTotal = withOptimal?.starterTotal || 0;
    const starterIds = new Set(
      (withOptimal?.starters || []).map((p) => p.id).filter((id) => id && id !== '0'),
    );
    const isPlayoff = weekNum >= PLAYOFF_START_WEEK;

    for (const pid of playerList) {
      const pts = weekPts[pid] ?? 0;
      const played = Number(pts) !== 0;
      const started = starterIds.has(pid);

      const rosterWithout = playerList.filter((id) => id !== pid);
      const withoutOptimal = computeOptimalWeek(
        rosterWithout,
        weekPts,
        playersData,
        playerIdMap,
        playerSeasonTotalsMap,
      );
      const weekHvorp = withTotal - (withoutOptimal?.starterTotal || 0);

      const row = statsByPlayer[pid];
      row.totalScore += pts;
      row.hvorp += weekHvorp;
      if (isPlayoff) row.playoffHvorp += weekHvorp;
      if (played) {
        row.gamesPlayed += 1;
        if (isPlayoff) row.playoffGamesPlayed += 1;
      }
      if (started) row.weeksStarted += 1;
      else row.weeksBenched += 1;

      const slot = started ? starterSlotForPlayer(withOptimal?.starters, pid) : null;
      const replacement = started ? findReplacement(pid, withOptimal, withoutOptimal) : null;

      row.weekly.push({
        week: weekNum,
        pts: round1(pts),
        hvorp: round1(weekHvorp),
        started,
        played,
        isPlayoff,
        slot,
        replacementId: replacement?.id || null,
        replacementPts: replacement ? replacement.pts : null,
        replacementSlot: replacement?.slot || null,
      });
    }
  }

  return playerList
    .map((pid) => finalizePlayerStats(statsByPlayer[pid]))
    .sort((a, b) => (b.hvorp - a.hvorp) || (b.totalScore - a.totalScore));
}

function summarizeSlots(weekly) {
  const slotCounts = {};
  const replacementCounts = {};
  for (const w of weekly || []) {
    if (w.slot) slotCounts[w.slot] = (slotCounts[w.slot] || 0) + 1;
    if (w.replacementId) {
      const id = String(w.replacementId);
      replacementCounts[id] = (replacementCounts[id] || 0) + 1;
    }
  }
  let topReplacementId = null;
  let topReplacementWeeks = 0;
  for (const [id, n] of Object.entries(replacementCounts)) {
    if (n > topReplacementWeeks) {
      topReplacementId = id;
      topReplacementWeeks = n;
    }
  }
  return { slotCounts, topReplacementId, topReplacementWeeks };
}

function finalizePlayerStats(row) {
  const gamesPlayed = row.gamesPlayed || 0;
  const playoffGames = row.playoffGamesPlayed || 0;
  const slotSummary = summarizeSlots(row.weekly);
  return {
    ...row,
    ...slotSummary,
    totalScore: round1(row.totalScore),
    hvorp: round1(row.hvorp),
    playoffHvorp: round1(row.playoffHvorp),
    hvorpPerGame: gamesPlayed > 0 ? round2(row.hvorp / gamesPlayed) : null,
    playoffHvorpPerGame: playoffGames > 0 ? round2(row.playoffHvorp / playoffGames) : null,
    ppg: gamesPlayed > 0 ? round2(row.totalScore / gamesPlayed) : null,
  };
}

export function buildRosterIdMap(rosters) {
  const map = {};
  for (const r of rosters || []) {
    const rid = Number(r?.roster_id);
    if (!Number.isFinite(rid)) continue;
    map[rid] = (r.players || []).filter((pid) => pid && pid !== '0');
  }
  return map;
}

export function dropPlayerFromRosterMap(originalRosters, rosterId, playerId) {
  const rid = Number(rosterId);
  const next = {};
  for (const key of Object.keys(originalRosters || {})) {
    next[key] = [...(originalRosters[key] || [])];
  }
  next[rid] = (next[rid] || []).filter((pid) => String(pid) !== String(playerId));
  return next;
}

export function summarizeWithoutPlayerEval(evalResult, rosterId) {
  const rid = Number(rosterId);
  const orig = (evalResult?.originalStandings || []).find((r) => Number(r.rosterId) === rid);
  const scen = (evalResult?.scenarioStandings || []).find((r) => Number(r.rosterId) === rid);
  const delta = (evalResult?.teamDeltas || []).find((d) => Number(d.rosterId) === rid);
  if (!orig || !scen) return null;

  const ptsDelta = delta?.regSeasonDelta ?? round1((scen.regSeasonTotal || 0) - (orig.regSeasonTotal || 0));
  const yoffDelta = delta?.playoffDelta ?? round1((scen.playoffTotal || 0) - (orig.playoffTotal || 0));

  const origWeeks = (evalResult?.originalWeeklyScores || {})[rid] || [];
  const scenWeeks = (evalResult?.scenarioWeeklyScores || {})[rid] || [];
  const weekly = [];
  let worstWeek = null;
  for (let i = 0; i < 17; i++) {
    const original = round1(origWeeks[i]?.starterTotal || 0);
    const scenario = round1(scenWeeks[i]?.starterTotal || 0);
    const weekDelta = round1(scenario - original);
    const row = { week: i + 1, original, scenario, delta: weekDelta };
    weekly.push(row);
    if (original === 0 && scenario === 0) continue;
    if (!worstWeek || weekDelta < worstWeek.delta) worstWeek = row;
  }

  return {
    placeFrom: orig.place,
    placeTo: scen.place,
    placeDiff: (orig.place || 0) - (scen.place || 0),
    ptsFrom: orig.regSeasonTotal,
    ptsTo: scen.regSeasonTotal,
    ptsDelta,
    origPlayoff: Boolean(orig.isPlayoff),
    scenPlayoff: Boolean(scen.isPlayoff),
    yoffFrom: orig.playoffTotal,
    yoffTo: scen.playoffTotal,
    yoffDelta,
    weekly,
    worstWeek,
  };
}
