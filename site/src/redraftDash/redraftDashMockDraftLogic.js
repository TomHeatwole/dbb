/**
 * Pure mock-draft helpers for Redraft Dash.
 *
 * 10-team snake, 19 rounds. Starting lineup:
 *   2 QB · 2 RB · 3 WR · 1 FLEX (RB/WR/TE) · 1 K · 1 P · 1 DST
 * Remaining 8 spots are bench (soft positional caps).
 *
 * CPU teams blend market ADP (exploitative) vs our custom-board rank (GTO) per
 * the slider, then inject 5–10% noise and apply roster-need heuristics so they
 * don't e.g. take a 3rd QB late after already filling two.
 */

import { DEFAULT_ADP_MODE, resolveMarketAdp } from './redraftDashJamlAdp';

export const TEAM_COUNT = 10;
export const ROSTER_SIZE = 19;
export const TOTAL_PICKS = TEAM_COUNT * ROSTER_SIZE;

export const STARTER_COUNTS = {
  QB: 2,
  RB: 2,
  WR: 3,
  FLEX: 1,
  K: 1,
  P: 1,
  DST: 1,
};

/** Soft max rostered at each position (including starters). */
export const SOFT_CAPS = {
  QB: 3,
  RB: 6,
  WR: 7,
  TE: 3,
  K: 1,
  P: 1,
  DST: 1,
};

export const FLEX_ELIGIBLE = new Set(['RB', 'WR', 'TE']);

export const PUNTER_RANKINGS = [
  { rank: 1, name: 'Corey Bojorquez', team: 'CLE', note: 'P2 historical (4.42 ppg), worst projected offense (5.5 wins), 5.4 punts/gm' },
  { rank: 2, name: 'Logan Cooke', team: 'JAX', note: 'P3 historical (4.32 ppg), 48.6 avg distance, elite in20 rate' },
  { rank: 3, name: 'Tommy Townsend', team: 'HOU', note: 'P4 historical (4.31 ppg), led league in inside-20s in 2024 (39)' },
  { rank: 4, name: 'Ryan Rehkow', team: 'CIN', note: 'P1 in 2025 (4.41 ppg), 49.5 avg distance, strong in20' },
  { rank: 5, name: 'Tory Taylor', team: 'CHI', note: 'Most consistent — lowest std dev (1.30), zero 0-pt weeks in 34 games' },
  { rank: 6, name: 'AJ Cole', team: 'LV', note: 'P8 historical (4.22 ppg), Raiders at 5.5 wins — massive volume ceiling' },
  { rank: 7, name: 'Michael Dickson', team: 'SEA', note: 'P7 historical (4.24 ppg), never scored zero, elite per-punt' },
  { rank: 8, name: 'Jordan Stout', team: 'NYG', note: 'Strong leg from BAL, inherits Giants volume (5.5 wins)' },
  { rank: 9, name: 'Austin McNamara', team: 'NYJ', note: 'Jets at 5.5 wins — terrible offense, tons of punting' },
  { rank: 10, name: 'Bradley Pinion', team: 'MIA', note: 'Led league in inside-20s in 2025 (34), Dolphins at 3.5 wins' },
];

/** Snake: round 1 → 1..10, round 2 → 10..1, … */
export function teamForPick(pickIndex) {
  const round = Math.floor(pickIndex / TEAM_COUNT); // 0-based
  const slot = pickIndex % TEAM_COUNT; // 0-based within round
  return round % 2 === 0 ? slot : TEAM_COUNT - 1 - slot;
}

export function pickLabel(pickIndex) {
  const round = Math.floor(pickIndex / TEAM_COUNT) + 1;
  const pickInRound = (pickIndex % TEAM_COUNT) + 1;
  return `${round}.${pickInRound}`;
}

export function roundOfPick(pickIndex) {
  return Math.floor(pickIndex / TEAM_COUNT) + 1;
}

function playerKey(player) {
  return player.id || `${player.position}:${player.name}:${player.team || ''}`;
}

/**
 * Build the draftable pool from custom board + punters + defenses.
 * Synthesizes late board ranks / ADP for P and DST so the blend still works.
 * `adp` on each player is the active market ADP (JAML or YAFSB).
 */
export function buildDraftPool(customBoard = [], defenses = [], adpMode = DEFAULT_ADP_MODE) {
  const pool = [];
  const seen = new Set();

  for (const p of customBoard) {
    if (!p?.name || !p.position) continue;
    const id = `board:${p.sleeperId || p.name}:${p.position}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const marketAdp = resolveMarketAdp(p, adpMode);
    pool.push({
      id,
      name: p.name,
      position: p.position,
      team: p.team || '',
      rank: p.rank,
      tier: p.tier,
      posRank: p.posRank,
      posTier: p.posTier,
      value: p.value,
      adp: marketAdp,
      rawAdp: p.adp,
      jamlAdp: p.jamlAdp ?? null,
      sourceRanks: p.sourceRanks || {},
      sleeperId: p.sleeperId || '',
    });
  }

  // Late-board anchors so K-like specialists have a place on the ADP/GTO scale.
  // Overall `tier` must sit after skill tiers — posTier stays 1…n for the P/DST filters.
  const boardMax = pool.reduce((m, p) => Math.max(m, p.rank || 0, p.adp || 0), 0);
  const maxSkillTier = pool.reduce((m, p) => Math.max(m, p.tier || 0), 0);
  const specialistBase = Math.max(boardMax + 5, 160);
  const specialistTierStart = maxSkillTier + 1;

  PUNTER_RANKINGS.forEach((p, i) => {
    const id = `P:${p.name}`;
    if (seen.has(id)) return;
    seen.add(id);
    const posTier = Math.ceil((i + 1) / 3);
    pool.push({
      id,
      name: p.name,
      position: 'P',
      team: p.team || '',
      rank: specialistBase + 20 + i,
      tier: specialistTierStart + posTier - 1,
      posRank: p.rank,
      posTier,
      value: null,
      adp: specialistBase + 25 + i * 1.5,
      sourceRanks: {},
      note: p.note,
    });
  });

  const dstList = (defenses || []).length
    ? defenses
    : []; // empty when private ETR sync is missing — mock still runs without DST depth

  dstList.forEach((d, i) => {
    const id = `DST:${d.team || d.name}`;
    if (seen.has(id)) return;
    seen.add(id);
    const posRank = d.posRank != null ? d.posRank : i + 1;
    const posTier = d.tier != null ? d.tier : Math.ceil(posRank / 5);
    // Prefer ETR overall tier when it's already late; otherwise park after skill tiers
    const overallTier = d.tier != null && d.tier >= specialistTierStart
      ? d.tier
      : specialistTierStart + Math.max(0, posTier - 1);
    pool.push({
      id,
      name: d.name,
      position: 'DST',
      team: d.team || '',
      rank: d.etrRank != null ? d.etrRank : specialistBase + posRank,
      tier: overallTier,
      posRank,
      posTier,
      value: null,
      adp: d.adp != null ? d.adp : specialistBase + 5 + posRank * 2,
      sourceRanks: {},
    });
  });

  return pool;
}

export function countPositions(roster) {
  const counts = {
    QB: 0, RB: 0, WR: 0, TE: 0, K: 0, P: 0, DST: 0,
  };
  for (const p of roster) {
    if (counts[p.position] != null) counts[p.position] += 1;
  }
  return counts;
}

/** How many starter holes remain (FLEX counted after RB/WR starters). */
export function starterHoles(counts) {
  const qb = Math.max(0, STARTER_COUNTS.QB - counts.QB);
  const rb = Math.max(0, STARTER_COUNTS.RB - counts.RB);
  const wr = Math.max(0, STARTER_COUNTS.WR - counts.WR);
  const k = Math.max(0, STARTER_COUNTS.K - counts.K);
  const punter = Math.max(0, STARTER_COUNTS.P - counts.P);
  const dst = Math.max(0, STARTER_COUNTS.DST - counts.DST);

  const rbExtra = Math.max(0, counts.RB - STARTER_COUNTS.RB);
  const wrExtra = Math.max(0, counts.WR - STARTER_COUNTS.WR);
  const flexFilled = Math.min(1, rbExtra + wrExtra + counts.TE);
  const flex = Math.max(0, STARTER_COUNTS.FLEX - flexFilled);

  return { QB: qb, RB: rb, WR: wr, FLEX: flex, K: k, P: punter, DST: dst };
}

function fillsStarterNeed(position, holes) {
  if (holes[position] > 0) return true;
  if (holes.FLEX > 0 && FLEX_ELIGIBLE.has(position)) return true;
  return false;
}

/** Hard eligibility: soft cap + never a 2nd K/P/DST. */
export function isEligible(position, counts) {
  const cap = SOFT_CAPS[position];
  if (cap == null) return true;
  return (counts[position] || 0) < cap;
}

/**
 * Blended board cost: lower is better.
 * adpLean 0 = pure GTO (our rank), 1 = pure ADP (exploitative).
 */
function blendedCost(player, adpLean) {
  const our = player.rank != null ? player.rank : 999;
  const market = player.adp != null ? player.adp : our;
  const lean = Math.max(0, Math.min(1, adpLean));
  return (1 - lean) * our + lean * market;
}

/**
 * Roster / round heuristics on top of blended cost. Positive = less attractive.
 */
function needAdjustment(player, counts, holes, pickIndex) {
  const pos = player.position;
  const round = roundOfPick(pickIndex);
  const rostered = counts[pos] || 0;
  let adj = 0;

  if (fillsStarterNeed(pos, holes)) {
    // Prefer plugging open starter slots, stronger late when holes remain
    adj -= round >= 10 ? 18 : 8;
    if (pos === 'QB' && holes.QB > 0 && round <= 8) adj -= 6;
  } else if (FLEX_ELIGIBLE.has(pos) && holes.FLEX > 0) {
    adj -= 5;
  }

  // Extra QB after two starters: only as rare late upside, never early
  if (pos === 'QB' && rostered >= STARTER_COUNTS.QB) {
    if (round < 11) adj += 55;
    else if (round < 15) adj += 28;
    else adj += 12;
  }

  // TE with no flex hole and already have one: cool off
  if (pos === 'TE' && holes.FLEX === 0 && rostered >= 1) {
    adj += round < 12 ? 20 : 8;
  }

  // Specialists belong at the end
  if (pos === 'K' || pos === 'P' || pos === 'DST') {
    if (holes[pos] <= 0) adj += 500;
    else if (round < 14) adj += 220;
    else if (round < 16) adj += 60;
    else if (round < 17) adj += 15;
    else adj -= 25; // actively seek when late + still needed
  }

  // If skill starters still open late, deprioritize pure bench depth
  const skillHoles = holes.QB + holes.RB + holes.WR + holes.FLEX;
  if (skillHoles > 0 && round >= 12 && !fillsStarterNeed(pos, holes)
    && pos !== 'K' && pos !== 'P' && pos !== 'DST') {
    adj += 15;
  }

  // Empty specialist slots late: bump skill bench so K/P/DST win the score race
  const specialistHoles = holes.K + holes.P + holes.DST;
  if (specialistHoles > 0 && round >= 16
    && pos !== 'K' && pos !== 'P' && pos !== 'DST') {
    adj += 35;
  }

  return adj;
}

/**
 * Pick one CPU player from the available pool.
 * @param {number} adpLean 0 = GTO tiers, 1 = ADP
 */
export function chooseCpuPick(available, roster, pickIndex, adpLean, rng = Math.random) {
  const counts = countPositions(roster);
  const holes = starterHoles(counts);
  const eligible = available.filter((p) => isEligible(p.position, counts));
  if (!eligible.length) return null;

  let best = null;
  let bestScore = Infinity;

  for (const player of eligible) {
    const base = blendedCost(player, adpLean);
    // 5–10% injected variance per evaluation
    const variance = 0.05 + rng() * 0.05;
    const noise = 1 + (rng() * 2 - 1) * variance;
    const score = base * noise + needAdjustment(player, counts, holes, pickIndex);
    if (score < bestScore) {
      bestScore = score;
      best = player;
    }
  }

  return best;
}

/**
 * Run CPU picks from `startPickIndex` until the user's seat is on the clock
 * or the draft is finished. Mutates nothing — returns new picks array slice.
 */
export function runCpuUntilUserTurn({
  pool,
  picks,
  startPickIndex,
  userTeamIndex,
  adpLean,
  rng = Math.random,
}) {
  const draftedIds = new Set(picks.map((p) => playerKey(p.player)));
  let available = pool.filter((p) => !draftedIds.has(playerKey(p)));
  const rosters = Array.from({ length: TEAM_COUNT }, () => []);
  for (const pick of picks) {
    rosters[pick.teamIndex].push(pick.player);
  }

  const newPicks = [];
  let pickIndex = startPickIndex;

  while (pickIndex < TOTAL_PICKS) {
    const teamIndex = teamForPick(pickIndex);
    if (teamIndex === userTeamIndex) break;

    const player = chooseCpuPick(available, rosters[teamIndex], pickIndex, adpLean, rng);
    if (!player) break;

    const entry = {
      pickIndex,
      teamIndex,
      player,
      byUser: false,
    };
    newPicks.push(entry);
    rosters[teamIndex].push(player);
    available = available.filter((p) => playerKey(p) !== playerKey(player));
    pickIndex += 1;
  }

  return { newPicks, nextPickIndex: pickIndex };
}

export function rostersFromPicks(picks) {
  const rosters = Array.from({ length: TEAM_COUNT }, () => []);
  for (const pick of picks) {
    rosters[pick.teamIndex].push(pick.player);
  }
  return rosters;
}

export function availableFromPool(pool, picks) {
  const drafted = new Set(picks.map((p) => playerKey(p.player)));
  return pool.filter((p) => !drafted.has(playerKey(p)));
}

export { playerKey };
