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
