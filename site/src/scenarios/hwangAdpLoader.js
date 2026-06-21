/**
 * hwangAdpLoader.js
 *
 * Loads Hwang Adjusted Positional ADP from hwang_adjusted_positional_adp.csv.
 * Used by Future Scenarios v2 for rank display and outcome-pool centering.
 */

const HWANG_ADP_CSV = '/data/hwang_adjusted_positional_adp.csv';

let hwangAdpByYearCache = null;

function parseCsvRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; }
    else if (c === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += c; }
  }
  result.push(current);
  return result;
}

async function loadHwangAdpByYear() {
  if (hwangAdpByYearCache) return hwangAdpByYearCache;

  const res = await fetch(HWANG_ADP_CSV);
  if (!res.ok) throw new Error('Failed to fetch hwang_adjusted_positional_adp.csv');

  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const byYear = new Map();

  if (lines.length < 2) {
    hwangAdpByYearCache = byYear;
    return byYear;
  }

  const headers = parseCsvRow(lines[0]);
  const idx = (name) => headers.indexOf(name);

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const rowYear = parseInt((cols[idx('year')] || '').trim(), 10);
    const name = (cols[idx('name')] || '').trim();
    const position = (cols[idx('position')] || '').trim();
    const sleeperId = (cols[idx('sleeper_id')] || '').trim();
    if (!Number.isFinite(rowYear) || !name || !position || !sleeperId) continue;

    const hwangAdp = parseFloat((cols[idx('hwang_adjusted_adp')] || '').trim());
    if (!Number.isFinite(hwangAdp)) continue;

    const parseOptionalInt = (col) => {
      const raw = (cols[idx(col)] || '').trim();
      if (!raw) return null;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : null;
    };
    const parseOptionalFloat = (col) => {
      const raw = (cols[idx(col)] || '').trim();
      if (!raw) return null;
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : null;
    };

    const row = {
      year: rowYear,
      name,
      position,
      sleeperId,
      adp: hwangAdp,
      posRank: parseOptionalInt('hwang_pos_rank'),
      effRank: parseOptionalFloat('hwang_eff_rank'),
      overallRank: parseOptionalInt('overall_rank'),
    };

    if (!byYear.has(rowYear)) byYear.set(rowYear, []);
    byYear.get(rowYear).push(row);
  }

  hwangAdpByYearCache = byYear;
  return byYear;
}

/**
 * @param {number|string} year
 * @returns {Promise<Array>}
 */
export async function loadHwangAdpRowsForYear(year) {
  const byYear = await loadHwangAdpByYear();
  const yearNum = Number(year);
  return (byYear.get(yearNum) || []).slice();
}

/**
 * Build a Sleeper-ID lookup for the current season's Hwang ADP.
 *
 * @returns {Promise<Object>} { [sleeperId]: { rank, position, posRank, effRank, adp, name } }
 */
export async function loadCurrentHwangAdpRankMap(year) {
  const rows = await loadHwangAdpRowsForYear(year);
  const rankMap = {};

  for (const row of rows) {
    if (!row.posRank && !row.effRank) continue;
    rankMap[row.sleeperId] = {
      rank: row.posRank || Math.round(row.effRank || 999),
      position: row.position,
      posRank: row.posRank,
      effRank: row.effRank ?? row.posRank,
      adp: row.adp,
      name: row.name,
    };
  }

  return rankMap;
}

/**
 * Compute max positional ranks for bottom-bucket detection.
 *
 * @returns {Promise<Object>} { QB: { maxPosRank, maxEffRank }, ... }
 */
export async function loadHwangPositionMaxRanks(year) {
  const rows = await loadHwangAdpRowsForYear(year);
  const maxByPos = {};

  for (const row of rows) {
    const pos = row.position;
    if (!maxByPos[pos]) maxByPos[pos] = { maxPosRank: 0, maxEffRank: 0 };
    if (row.posRank != null) {
      maxByPos[pos].maxPosRank = Math.max(maxByPos[pos].maxPosRank, row.posRank);
    }
    const eff = row.effRank ?? row.posRank;
    if (eff != null) {
      maxByPos[pos].maxEffRank = Math.max(maxByPos[pos].maxEffRank, eff);
    }
  }

  return maxByPos;
}

/**
 * Build a search pool for the roster editor from Hwang ADP rows.
 */
export function buildTopPlayersFromHwangAdp(rows, playersData, playerIdMap, getPlayerInfo, limit = 15) {
  const sorted = (rows || [])
    .filter((r) => r.sleeperId && r.posRank)
    .sort((a, b) => (a.adp || 9999) - (b.adp || 9999))
    .slice(0, limit);

  return sorted.map((row) => {
    const info = getPlayerInfo(row.sleeperId, playersData, playerIdMap);
    return {
      ...(info || {}),
      player_id: row.sleeperId,
      name: info?.name || row.name,
      position: info?.position || row.position,
      team: info?.team || info?.team_abbr || '',
      espn_photo_url: info?.espn_photo_url || null,
    };
  });
}

export { loadHwangAdpByYear };
