/**
 * Current-season rank source for the Season Simulator.
 *
 * Historical outcome pools stay keyed by Hwang ADP. For the current season
 * only, the admin UI can optionally take the player's positional tag (RB5,
 * WR12, …) from the Redraft Dash custom board instead of Hwang ADP.
 *
 * This module is browser / admin-simulator only. HwangAI and MCP must keep
 * using hwangAdpLoader.js via site/lib/mcp/simData.mjs — do not import this
 * file from chat or MCP tool paths.
 */

import { getCurrentYear } from '../utils/DateHelper';
import { loadRedraftDashRankBoard } from '../redraftDash/redraftDashLoader';
import {
  loadCurrentHwangAdpRankMap,
  loadHwangPositionMaxRanks,
} from './hwangAdpLoader';

export const RANK_SOURCE_ADP = 'adp';
export const RANK_SOURCE_DASH = 'dash';
export const DEFAULT_RANK_SOURCE = RANK_SOURCE_ADP;

const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

export const RANK_SOURCES = {
  [RANK_SOURCE_ADP]: {
    id: RANK_SOURCE_ADP,
    label: 'Hwang ADP',
    shortLabel: 'ADP',
    description: 'Positional tag from Hwang Adjusted ADP (e.g. RB5).',
  },
  [RANK_SOURCE_DASH]: {
    id: RANK_SOURCE_DASH,
    label: 'Redraft Dash',
    shortLabel: 'Redraft Dash',
    description: 'Positional tag from your Redraft Dash board (e.g. RB5).',
  },
};

export function isCurrentSeasonRankDashAllowed(seasonYear) {
  return String(seasonYear) === String(getCurrentYear());
}

export function normalizeRankSource(value, seasonYear) {
  if (value === RANK_SOURCE_DASH && isCurrentSeasonRankDashAllowed(seasonYear)) {
    return RANK_SOURCE_DASH;
  }
  return RANK_SOURCE_ADP;
}

export function rankSourceShortLabel(source, seasonYear) {
  const id = normalizeRankSource(source, seasonYear);
  return RANK_SOURCES[id].shortLabel;
}

function rankEntryFromDashPlayer(player) {
  const position = (player.position || '').toUpperCase();
  const sleeperId = String(player.sleeperId || '').trim();
  const posRank = Number(player.posRank);
  if (!sleeperId || !SKILL_POSITIONS.has(position) || !Number.isFinite(posRank) || posRank < 1) {
    return null;
  }
  return {
    sleeperId,
    name: player.name,
    position,
    rank: posRank,
    posRank,
    effRank: posRank,
    adp: Number.isFinite(Number(player.rank)) ? Number(player.rank) : posRank,
  };
}

export function dashBoardToRankRows(board) {
  const rows = [];
  for (const player of board || []) {
    const entry = rankEntryFromDashPlayer(player);
    if (entry) rows.push(entry);
  }
  return rows;
}

function rankMapFromRows(rows) {
  const rankMap = {};
  for (const row of rows) {
    rankMap[row.sleeperId] = {
      rank: row.rank,
      position: row.position,
      posRank: row.posRank,
      effRank: row.effRank,
      adp: row.adp,
      name: row.name,
    };
  }
  return rankMap;
}

function maxRanksFromRows(rows) {
  const maxByPos = {};
  for (const row of rows) {
    const pos = row.position;
    if (!maxByPos[pos]) maxByPos[pos] = { maxPosRank: 0, maxEffRank: 0 };
    maxByPos[pos].maxPosRank = Math.max(maxByPos[pos].maxPosRank, row.posRank);
    maxByPos[pos].maxEffRank = Math.max(maxByPos[pos].maxEffRank, row.effRank);
  }
  return maxByPos;
}

export async function loadRedraftDashRankRows() {
  const board = await loadRedraftDashRankBoard();
  return dashBoardToRankRows(board);
}

/**
 * Same shape as loadCurrentHwangAdpRankMap. Falls back to Hwang ADP when the
 * dash board is missing or has no skill-position ranks.
 */
export async function loadSimulatorRankMap(year, source) {
  if (normalizeRankSource(source, year) === RANK_SOURCE_DASH) {
    const rows = await loadRedraftDashRankRows().catch(() => []);
    const map = rankMapFromRows(rows);
    if (Object.keys(map).length > 0) return map;
  }
  return loadCurrentHwangAdpRankMap(year);
}

export async function loadSimulatorPositionMaxRanks(year, source) {
  if (normalizeRankSource(source, year) === RANK_SOURCE_DASH) {
    const rows = await loadRedraftDashRankRows().catch(() => []);
    const maxRanks = maxRanksFromRows(rows);
    if (Object.keys(maxRanks).length > 0) return maxRanks;
  }
  return loadHwangPositionMaxRanks(year);
}
