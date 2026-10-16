/**
 * Rest-of-season rank order for the ROS Simulator.
 *
 * FantasyPros supplies the starting positional order. A drag reorder changes
 * posRank / effRank inside one position. fpRank stays the published rank.
 */

export const ROS_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

const SEARCH_POS_ORDER = ['RB', 'WR', 'QB', 'TE'];

export function normalizeRosOrder(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {};
  let any = false;
  for (const pos of ROS_POSITIONS) {
    const list = value[pos];
    if (!Array.isArray(list)) continue;
    const ids = [];
    const seen = new Set();
    for (const id of list) {
      const sleeperId = String(id || '').trim();
      if (!sleeperId || seen.has(sleeperId)) continue;
      seen.add(sleeperId);
      ids.push(sleeperId);
    }
    if (ids.length > 0) {
      out[pos] = ids;
      any = true;
    }
  }
  return any ? out : null;
}

export function stampFpRanks(rows) {
  return (rows || []).map((row) => ({
    ...row,
    fpRank: row.fpRank ?? row.posRank,
  }));
}

export function groupRosRows(rows) {
  const byPos = { QB: [], RB: [], WR: [], TE: [] };
  for (const row of rows || []) {
    if (!byPos[row.position]) continue;
    byPos[row.position].push({ ...row });
  }
  for (const pos of ROS_POSITIONS) {
    byPos[pos].sort((a, b) => (a.posRank || 0) - (b.posRank || 0));
  }
  return byPos;
}

export function flattenRosRows(byPos) {
  const lists = {};
  for (const pos of ROS_POSITIONS) {
    lists[pos] = (byPos[pos] || []).map((row, i) => ({
      ...row,
      position: pos,
      posRank: i + 1,
      effRank: i + 1,
      rank: i + 1,
    }));
  }
  const ordered = [];
  const maxLen = Math.max(0, ...SEARCH_POS_ORDER.map((pos) => lists[pos].length));
  for (let i = 0; i < maxLen; i++) {
    for (const pos of SEARCH_POS_ORDER) {
      if (lists[pos][i]) ordered.push(lists[pos][i]);
    }
  }
  ordered.forEach((row, i) => { row.adp = i + 1; });
  return ordered;
}

/**
 * Move one player within a position.
 * `toIndex` is the slot to insert before in the original list.
 * `toIndex === list.length` inserts at the end.
 * Inserting before yourself, or before the next player, leaves the list as-is.
 */
export function moveListItem(list, fromIndex, toIndex) {
  const next = (list || []).slice();
  if (fromIndex < 0 || fromIndex >= next.length) return list || [];
  if (toIndex < 0 || toIndex > next.length) return list || [];
  if (toIndex === fromIndex || toIndex === fromIndex + 1) return list || [];
  const [item] = next.splice(fromIndex, 1);
  const dest = fromIndex < toIndex ? toIndex - 1 : toIndex;
  next.splice(dest, 0, item);
  return next;
}

export function moveRosRow(rows, position, fromIndex, toIndex) {
  if (!ROS_POSITIONS.includes(position)) return rows || [];
  const byPos = groupRosRows(rows);
  const moved = moveListItem(byPos[position], fromIndex, toIndex);
  if (moved === byPos[position]) return rows || [];
  byPos[position] = moved;
  return flattenRosRows(byPos);
}

export function rosOrderByPosition(rows) {
  const byPos = groupRosRows(rows);
  const order = {};
  for (const pos of ROS_POSITIONS) {
    order[pos] = byPos[pos].map((row) => String(row.sleeperId));
  }
  return order;
}

export function rosOrdersEqual(a, b) {
  const left = normalizeRosOrder(a);
  const right = normalizeRosOrder(b);
  if (!left && !right) return true;
  if (!left || !right) return false;
  for (const pos of ROS_POSITIONS) {
    const la = left[pos] || [];
    const lb = right[pos] || [];
    if (la.length !== lb.length) return false;
    for (let i = 0; i < la.length; i++) {
      if (la[i] !== lb[i]) return false;
    }
  }
  return true;
}

/**
 * Reorder current rows to a saved positional id list.
 * Ids missing from the current board are skipped.
 * Current players missing from the saved list keep their relative order at the end.
 */
export function applyRosOrder(rows, orderByPos) {
  const order = normalizeRosOrder(orderByPos);
  if (!order) return stampFpRanks(rows);
  const byPos = groupRosRows(stampFpRanks(rows));
  for (const pos of ROS_POSITIONS) {
    const wanted = order[pos];
    if (!wanted) continue;
    const current = byPos[pos];
    const byId = new Map(current.map((row) => [String(row.sleeperId), row]));
    const next = [];
    const used = new Set();
    for (const id of wanted) {
      const row = byId.get(id);
      if (!row || used.has(id)) continue;
      next.push(row);
      used.add(id);
    }
    for (const row of current) {
      const id = String(row.sleeperId);
      if (!used.has(id)) next.push(row);
    }
    byPos[pos] = next;
  }
  return flattenRosRows(byPos);
}

export function resetRosPosition(rows, publishedRows, position) {
  if (!ROS_POSITIONS.includes(position)) return rows || [];
  const published = rosOrderByPosition(publishedRows);
  return applyRosOrder(rows, { [position]: published[position] || [] });
}

export function rankMapFromRosRows(rows) {
  const rankMap = {};
  for (const row of rows || []) {
    const sleeperId = String(row.sleeperId || '').trim();
    if (!sleeperId) continue;
    rankMap[sleeperId] = {
      rank: row.posRank,
      position: row.position,
      posRank: row.posRank,
      effRank: row.effRank ?? row.posRank,
      adp: row.adp ?? row.posRank,
      name: row.name,
    };
  }
  return rankMap;
}

export function maxRanksFromRosRows(rows) {
  const maxByPos = {};
  for (const row of rows || []) {
    const pos = row.position;
    if (!pos) continue;
    if (!maxByPos[pos]) maxByPos[pos] = { maxPosRank: 0, maxEffRank: 0 };
    const posRank = Number(row.posRank) || 0;
    const effRank = Number(row.effRank ?? row.posRank) || 0;
    maxByPos[pos].maxPosRank = Math.max(maxByPos[pos].maxPosRank, posRank);
    maxByPos[pos].maxEffRank = Math.max(maxByPos[pos].maxEffRank, effRank);
  }
  return maxByPos;
}
