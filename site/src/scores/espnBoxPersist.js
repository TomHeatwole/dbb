/**
 * Compact year-round store for ESPN box-score stat lines.
 * One Firebase api_cache blob per season/week, plus raw finals per event.
 */

export function weekBoxCacheKey(season, week) {
  return `espn_box_week_${Number(season)}_${Number(week)}`;
}

export function summaryCacheKey(eventId) {
  return `espn_site_v2_sports_football_nfl_summary_${String(eventId)}`;
}

export function slimCompletedRow(row) {
  if (!row || !row.statLine) return null;
  const pts = Number(row.pts);
  return {
    statLine: String(row.statLine),
    pts: Number.isFinite(pts) ? pts : 0,
    eventId: row.eventId != null ? String(row.eventId) : null,
    completed: true,
  };
}

export function emptyWeekBox(season, week) {
  return {
    season: Number(season) || null,
    week: Number(week) || null,
    eventIds: [],
    bySleeperId: {},
  };
}

export function pruneWeekBoxToEvents(box, eventIds) {
  const allowed = eventIds instanceof Set
    ? eventIds
    : new Set((eventIds || []).map(String));
  const prev = box || emptyWeekBox();
  if (!allowed.size) {
    return { ...prev, eventIds: [], bySleeperId: {} };
  }
  const bySleeperId = {};
  for (const [pid, row] of Object.entries(prev.bySleeperId || {})) {
    if (row && row.eventId != null && allowed.has(String(row.eventId))) {
      bySleeperId[pid] = row;
    }
  }
  return {
    ...prev,
    bySleeperId,
    eventIds: (prev.eventIds || []).filter((id) => allowed.has(String(id))),
  };
}

export function mergePersistedWeekBox(prev, espnBySleeper, season, week) {
  const next = {
    season: Number(season) || (prev && prev.season) || null,
    week: Number(week) || (prev && prev.week) || null,
    eventIds: Array.isArray(prev && prev.eventIds) ? prev.eventIds.map(String) : [],
    bySleeperId: { ...((prev && prev.bySleeperId) || {}) },
  };
  const seen = new Set(next.eventIds);
  for (const [pid, row] of Object.entries(espnBySleeper || {})) {
    if (!row || row.live || !row.completed) continue;
    const slim = slimCompletedRow(row);
    if (!slim) continue;
    next.bySleeperId[String(pid)] = slim;
    if (slim.eventId && !seen.has(slim.eventId)) {
      seen.add(slim.eventId);
      next.eventIds.push(slim.eventId);
    }
  }
  return next;
}

export function persistChanged(prev, next) {
  const a = prev || emptyWeekBox();
  const b = next || emptyWeekBox();
  if ((a.eventIds || []).join(',') !== (b.eventIds || []).join(',')) return true;
  return JSON.stringify(a.bySleeperId || {}) !== JSON.stringify(b.bySleeperId || {});
}

export function espnBySleeperFromPersisted(persisted) {
  const out = {};
  for (const [pid, row] of Object.entries((persisted && persisted.bySleeperId) || {})) {
    if (!row) continue;
    out[String(pid)] = {
      pts: Number(row.pts) || 0,
      statLine: row.statLine || '',
      live: false,
      completed: true,
      eventId: row.eventId || null,
      source: 'espn',
    };
  }
  return out;
}

export function slimSummaryForCache(summary, eventId) {
  if (!summary || typeof summary !== 'object') return null;
  const header = summary.header || {};
  const comps = Array.isArray(header.competitions) ? header.competitions : [];
  return {
    eventId: String(eventId),
    header: {
      id: header.id || eventId,
      status: header.status || null,
      competitions: comps.map((c) => ({
        id: c && c.id,
        date: c && c.date,
        status: c && c.status,
        competitors: Array.isArray(c && c.competitors)
          ? c.competitors.map((x) => ({
            homeAway: x && x.homeAway,
            score: x && x.score,
            winner: x && x.winner,
            team: x && x.team
              ? { abbreviation: x.team.abbreviation, displayName: x.team.displayName }
              : null,
          }))
          : [],
      })),
    },
    boxscore: summary.boxscore || null,
    scoringPlays: Array.isArray(summary.scoringPlays) ? summary.scoringPlays : [],
  };
}
