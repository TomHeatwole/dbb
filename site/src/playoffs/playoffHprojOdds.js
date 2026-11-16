/**
 * Playoff odds from HProj week distributions.
 *
 * Points already scored stay fixed. Each remaining week is an independent
 * draw from that team's simulated lineup totals. A season makes the
 * playoffs when the team finishes in the top `spots` through week 14.
 * Exact ties at the cut are broken at random.
 *
 * When playoff-week draws are provided, each replay also rolls weeks 15–17
 * and resolves a champion with the league's /yoffs rules.
 */

import { buildFinalStandings, normalizePlayoffFormat } from '../scenarios/playoffStandings';

export const PLAYOFF_SPOTS = 4;
export const PLAYOFF_LAST_WEEK = 17;
export const MIN_WEEK_PROJECTIONS = 40;

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
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

/** Nearest-rank quantile. `sorted` must be ascending. `p` is 0–1. */
export function sampleQuantile(sorted, p) {
  if (!sorted || sorted.length === 0) return 0;
  const t = Math.max(0, Math.min(1, Number(p) || 0));
  const idx = Math.round(t * (sorted.length - 1));
  return sorted[idx];
}

export function isByeSignal(label, opponent) {
  if (label && String(label.text || '').toUpperCase() === 'BYE') return true;
  if (opponent != null && String(opponent).trim().toUpperCase() === 'BYE') return true;
  return false;
}

/**
 * Drop bye players from a projected-points map.
 * @param {Record<string, number>} pointsMap
 * @param {{ labels?: Record<string, { text?: string }>, opponents?: Record<string, string> }} [ctx]
 */
export function maskByes(pointsMap, ctx = {}) {
  const labels = ctx.labels || {};
  const opponents = ctx.opponents || {};
  const out = {};
  for (const [id, raw] of Object.entries(pointsMap || {})) {
    const label = labels[id] || labels[String(id)];
    const opp = opponents[id] ?? opponents[String(id)];
    if (isByeSignal(label, opp)) continue;
    const pts = Number(raw);
    if (Number.isFinite(pts)) out[String(id)] = pts;
  }
  return out;
}

export function countProjectedRoster(pointsMap, rosterIds) {
  let n = 0;
  for (const rawId of rosterIds || []) {
    const pts = Number(pointsMap?.[rawId] ?? pointsMap?.[String(rawId)]);
    if (Number.isFinite(pts) && pts > 0) n += 1;
  }
  return n;
}

/**
 * Use this week's projections when enough rostered players have a number.
 * Otherwise reuse each player's latest projection, still removing this week's byes.
 * A bye does not erase the player's baseline for a later week.
 */
export function resolveWeekProjection({
  rawMap,
  baseline = {},
  labels,
  opponents,
  rosterIds,
  minUsable = MIN_WEEK_PROJECTIONS,
}) {
  const masked = maskByes(rawMap, { labels, opponents });
  const usable = countProjectedRoster(masked, rosterIds);
  if (usable >= minUsable) {
    const nextBaseline = { ...baseline };
    for (const [id, pts] of Object.entries(masked)) {
      if (pts > 0) nextBaseline[id] = pts;
    }
    return { map: masked, baseline: nextBaseline, source: 'projection', usable };
  }
  return {
    map: maskByes(baseline, { labels, opponents }),
    baseline,
    source: 'carried',
    usable,
  };
}

export function opponentsFromProjections(byPlayerId) {
  const out = {};
  if (!byPlayerId || typeof byPlayerId !== 'object') return out;
  for (const [id, rec] of Object.entries(byPlayerId)) {
    if (rec && rec.opponent != null && rec.opponent !== '') {
      out[String(id)] = rec.opponent;
    }
  }
  return out;
}

/** Best-ball points already on the board. `throughWeek` is inclusive, 1-based. */
export function sumBankedPoints(weeksData, rosterId, throughWeek) {
  const cap = Math.max(0, Number(throughWeek) || 0);
  if (!Array.isArray(weeksData) || cap === 0) return 0;
  let total = 0;
  const n = Math.min(cap, weeksData.length);
  for (let i = 0; i < n; i += 1) {
    const weekEntries = weeksData[i];
    if (!Array.isArray(weekEntries)) continue;
    const entry = weekEntries.find((e) => e && Number(e.roster_id) === Number(rosterId));
    if (entry && typeof entry.points === 'number' && Number.isFinite(entry.points)) {
      total += entry.points;
    }
  }
  return round1(total);
}

export function summarizeSamples(samples) {
  const sorted = (samples && samples.length ? samples : [0]).slice().sort((a, b) => a - b);
  return {
    p10: round1(sampleQuantile(sorted, 0.1)),
    p50: round1(sampleQuantile(sorted, 0.5)),
    p90: round1(sampleQuantile(sorted, 0.9)),
    draw: sorted,
  };
}

function drawFromWeek(week, rng) {
  const pool = week && week.draw;
  if (!pool || !pool.length) return 0;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * @param {Array<{
 *   id: string|number,
 *   pointsSoFar: number,
 *   weeks: Array<{ samples?: number[] }>,
 *   playoffWeeks?: Array<{ samples?: number[] }>,
 * }>} teams
 * @param {{
 *   iterations?: number,
 *   spots?: number,
 *   seed?: string|number,
 *   format?: string,
 *   lockedPlayoffIds?: Array<string|number>,
 * }} [options]
 */
export function simulatePlayoffField(teams, options = {}) {
  const list = Array.isArray(teams) ? teams : [];
  const iterations = Math.max(1, Number(options.iterations) || 1);
  const spots = Math.max(1, Number(options.spots) || PLAYOFF_SPOTS);
  const format = normalizePlayoffFormat(options.format);
  const rng = mulberry32(hashSeed(options.seed == null ? 'playoff-hproj' : options.seed));
  const lockedRaw = options.lockedPlayoffIds;
  const lockedSet = Array.isArray(lockedRaw) && lockedRaw.length === spots
    ? new Set(lockedRaw.map((id) => String(id)))
    : null;
  const filterToLockedField = Boolean(lockedSet);

  const prepared = list.map((team) => {
    const weeks = (team.weeks || []).map((week) => summarizeSamples(week.samples));
    const playoffWeeks = (team.playoffWeeks || []).map((week) => summarizeSamples(week.samples));
    const medianPath = round1(
      (Number(team.pointsSoFar) || 0) + weeks.reduce((sum, week) => sum + week.p50, 0),
    );
    return {
      id: team.id,
      pointsSoFar: round1(team.pointsSoFar),
      weeks,
      playoffWeeks,
      medianPath,
      finals: [],
    };
  });

  const resolveChampion = prepared.some((team) => team.playoffWeeks.length > 0);

  const made = new Array(prepared.length).fill(0);
  const won = new Array(prepared.length).fill(0);
  const wonWhenField = new Array(prepared.length).fill(0);
  let fieldMatches = 0;
  const cuts = [];
  const idToIndex = new Map(prepared.map((team, index) => [String(team.id), index]));

  function lockedFieldMatches(topFourIds) {
    if (!lockedSet) return true;
    if (topFourIds.length !== spots) return false;
    const have = new Set(topFourIds.map((id) => String(id)));
    if (have.size !== spots) return false;
    for (const id of lockedSet) {
      if (!have.has(id)) return false;
    }
    return true;
  }

  for (let sim = 0; sim < iterations; sim += 1) {
    const regTotals = {};
    const playoffTotals = {};
    const playoffWeekTotals = {};
    const ranked = prepared.map((team, index) => {
      let score = team.pointsSoFar;
      for (const week of team.weeks) score += drawFromWeek(week, rng);
      const regSeasonTotal = round1(score);
      regTotals[team.id] = regSeasonTotal;
      regTotals[String(team.id)] = regSeasonTotal;

      if (team.playoffWeeks.length) {
        let playoffTotal = 0;
        const weekScores = [];
        for (const week of team.playoffWeeks) {
          const pts = drawFromWeek(week, rng);
          weekScores.push(pts);
          playoffTotal += pts;
        }
        const pTotal = round1(playoffTotal);
        playoffTotals[team.id] = pTotal;
        playoffTotals[String(team.id)] = pTotal;
        playoffWeekTotals[team.id] = weekScores;
        playoffWeekTotals[String(team.id)] = weekScores;
      }

      return { index, score: regSeasonTotal, tie: rng() };
    });

    ranked.sort((a, b) => b.score - a.score || a.tie - b.tie);
    const cutAt = Math.min(spots, ranked.length) - 1;
    if (cutAt >= 0) cuts.push(ranked[cutAt].score);
    const topFour = ranked.slice(0, spots).map((row) => prepared[row.index].id);
    const fieldMatch = lockedFieldMatches(topFour);

    if (!filterToLockedField) {
      for (let place = 0; place < spots && place < ranked.length; place += 1) {
        made[ranked[place].index] += 1;
      }
      for (const row of ranked) {
        prepared[row.index].finals.push(row.score);
      }
    } else if (fieldMatch) {
      fieldMatches += 1;
    }

    if (resolveChampion) {
      let regForTitle = regTotals;
      let poForTitle = playoffTotals;
      let wkForTitle = playoffWeekTotals;
      if (filterToLockedField) {
        regForTitle = {};
        poForTitle = {};
        wkForTitle = {};
        for (const id of lockedSet) {
          const team = prepared.find((row) => String(row.id) === String(id));
          if (!team) continue;
          regForTitle[team.id] = regTotals[team.id];
          poForTitle[team.id] = playoffTotals[team.id];
          wkForTitle[team.id] = playoffWeekTotals[team.id];
        }
      }
      const standings = buildFinalStandings(regForTitle, poForTitle, {
        format,
        playoffWeekTotals: wkForTitle,
      });
      const champ = standings.find((row) => row.place === 1);
      if (champ) {
        const idx = idToIndex.get(String(champ.rosterId));
        if (idx == null) continue;
        if (!filterToLockedField) {
          won[idx] += 1;
        } else if (lockedSet.has(String(prepared[idx].id))) {
          wonWhenField[idx] += 1;
        }
      }
    }
  }

  const cutSorted = cuts.slice().sort((a, b) => a - b);
  const rows = prepared.map((team, index) => {
    const finals = team.finals.slice().sort((a, b) => a - b);
    const base = {
      id: team.id,
      pointsSoFar: team.pointsSoFar,
      playoffPct: filterToLockedField ? 0 : (made[index] / iterations) * 100,
      playoffMadeCount: filterToLockedField ? 0 : made[index],
      winPct: resolveChampion && !filterToLockedField ? (won[index] / iterations) * 100 : 0,
      winCount: filterToLockedField ? 0 : won[index],
      winPctIfMade: !filterToLockedField && made[index] > 0
        ? (won[index] / made[index]) * 100
        : 0,
      winPctGivenField: filterToLockedField && lockedSet.has(String(team.id))
        ? (wonWhenField[index] / iterations) * 100
        : 0,
      winWhenFieldCount: filterToLockedField && lockedSet.has(String(team.id))
        ? wonWhenField[index]
        : 0,
      p10: round1(sampleQuantile(finals, 0.1)),
      p50: round1(sampleQuantile(finals, 0.5)),
      p90: round1(sampleQuantile(finals, 0.9)),
      medianPath: team.medianPath,
      weeks: team.weeks.map(({ p10, p50, p90 }) => ({ p10, p50, p90 })),
    };
    return base;
  });

  rows.sort((a, b) => (
    b.playoffPct - a.playoffPct
    || b.winPct - a.winPct
    || b.p50 - a.p50
    || b.pointsSoFar - a.pointsSoFar
    || String(a.id).localeCompare(String(b.id))
  ));

  return {
    iterations,
    spots,
    format,
    cutP50: round1(sampleQuantile(cutSorted, 0.5)),
    fieldMatches: filterToLockedField ? fieldMatches : null,
    fieldMatchPct: filterToLockedField && iterations > 0
      ? (fieldMatches / iterations) * 100
      : null,
    lockedPlayoffIds: lockedSet ? [...lockedSet] : null,
    rows,
  };
}
