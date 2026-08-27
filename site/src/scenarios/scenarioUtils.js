/**
 * Shared helpers for scenario roster player IDs.
 */

export function isValidPlayerId(pid) {
  if (pid == null) return false;
  const s = String(pid).trim();
  return s !== '' && s !== 'undefined' && s !== 'null';
}

export function sanitizeRoster(playerIds) {
  return (playerIds || []).filter(isValidPlayerId);
}

export function sanitizeRosters(rosters) {
  const result = {};
  for (const rid in rosters || {}) {
    result[rid] = sanitizeRoster(rosters[rid]);
  }
  return result;
}

/**
 * Apply HwangAI scenario-editor edits onto the current scenario rosters.
 * Adds and drops are applied exactly as returned — a player may end up on
 * more than one team when the user asked to copy them.
 */
export function applyRosterEdits(rosters, edits) {
  const next = {};
  for (const rid in rosters || {}) {
    next[rid] = [...(rosters[rid] || [])].map(String);
  }

  for (const edit of edits || []) {
    const rid = String(edit.rosterId);
    if (!next[rid]) next[rid] = [];
    const dropSet = new Set((edit.drop || []).filter(isValidPlayerId).map(String));
    if (dropSet.size > 0) {
      next[rid] = next[rid].filter((pid) => !dropSet.has(String(pid)));
    }
    for (const pid of edit.add || []) {
      const id = String(pid);
      if (!isValidPlayerId(id) || next[rid].includes(id)) continue;
      next[rid].push(id);
    }
  }

  return sanitizeRosters(next);
}
