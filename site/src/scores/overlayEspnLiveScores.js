import { shouldPreferEspn } from './espnBoxScore';

function cloneWeekEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  return {
    ...entry,
    players_points: { ...(entry.players_points || {}) },
    starters_points: Array.isArray(entry.starters_points) ? entry.starters_points.slice() : entry.starters_points,
  };
}

function sleeperPtsFor(pointsMap, pid) {
  const pts = pointsMap && (pointsMap[pid] ?? pointsMap[String(pid)]);
  const n = Number(pts);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Overlay ESPN-scored points onto one week's Sleeper matchup rows.
 * Never mutates the input. Does not write cache.
 */
export function overlayEspnOnWeek(weekEntries, espnBySleeperId) {
  if (!Array.isArray(weekEntries) || !espnBySleeperId) {
    return weekEntries;
  }
  return weekEntries.map((raw) => {
    const entry = cloneWeekEntry(raw);
    if (!entry) return raw;
    const originalPts = { ...(raw.players_points || {}) };
    const starters = Array.isArray(entry.starters) ? entry.starters : [];
    let any = false;
    const applyPid = (pid) => {
      if (pid == null || String(pid) === '0') return;
      const id = String(pid);
      const espn = espnBySleeperId[id] || espnBySleeperId[pid];
      if (!espn) return;
      if (!shouldPreferEspn(espn, sleeperPtsFor(originalPts, pid))) return;
      if (!entry.players_points) entry.players_points = {};
      entry.players_points[pid] = espn.pts;
      entry.players_points[id] = espn.pts;
      any = true;
    };
    for (const pid of Object.keys(originalPts)) applyPid(pid);
    for (const pid of starters) applyPid(pid);
    for (const pid of entry.players || []) applyPid(pid);

    if (any && Array.isArray(entry.starters_points)) {
      entry.starters_points = starters.map((pid, i) => {
        const espn = espnBySleeperId[String(pid)] || espnBySleeperId[pid];
        if (espn && shouldPreferEspn(espn, sleeperPtsFor(originalPts, pid))) {
          return espn.pts;
        }
        return entry.starters_points[i];
      });
    }

    if (any) {
      const starterTotal = starters.reduce((sum, pid) => {
        const pts = entry.players_points && (entry.players_points[pid] ?? entry.players_points[String(pid)]);
        return sum + (Number(pts) || 0);
      }, 0);
      entry.points = Math.round(starterTotal * 100) / 100;
    }
    return entry;
  });
}

export function overlayEspnOnWeeks(weeks, week, espnBySleeperId) {
  if (!Array.isArray(weeks) || !espnBySleeperId) return weeks;
  const idx = Number(week) - 1;
  if (idx < 0 || idx >= weeks.length) return weeks;
  const next = weeks.slice();
  next[idx] = overlayEspnOnWeek(weeks[idx], espnBySleeperId);
  return next;
}

export function statLinesFromEspn(espnBySleeperId) {
  const out = {};
  for (const [pid, row] of Object.entries(espnBySleeperId || {})) {
    if (!row || !row.statLine) continue;
    out[String(pid)] = {
      statLine: row.statLine,
      ptsFrom: row.live || (row.completed && shouldPreferEspn(row, 0)) ? 'espn' : 'espn',
    };
  }
  return out;
}
