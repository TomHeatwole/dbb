import { getPlayerInfo } from '../lookups/PlayerLookup';
import { fetchHistoriesByEspnIds, getTeamAtDate } from '../players/PlayerGameHistory';
import { SIMULATE_MIDWEEK } from '../utils/global_constants';
import { CURRENT_YEAR } from '../utils/DateHelper';

const TEAM_ABBR_ALIASES = {
  WAS: 'WSH',
  WASH: 'WSH',
  WSH: 'WSH',
  JAX: 'JAC',
  ARZ: 'ARI',
  NOR: 'NO',
  NOS: 'NO',
  OAK: 'LV',
  SD: 'LAC',
  STL: 'LAR',
  LA: 'LAR',
};

function normalizeTeamAbbr(raw) {
  if (!raw) { return null; }
  const upper = String(raw).replace(/[^A-Za-z]/g, '').toUpperCase();
  return TEAM_ABBR_ALIASES[upper] || upper;
}

function extractEvents(scoreboardJson) {
  if (!scoreboardJson || typeof scoreboardJson !== 'object') { return []; }
  if (Array.isArray(scoreboardJson.events)) { return scoreboardJson.events; }
  if (Array.isArray(scoreboardJson.leagues) && scoreboardJson.leagues.length && Array.isArray(scoreboardJson.leagues[0].events)) {
    return scoreboardJson.leagues[0].events;
  }
  return [];
}

function eventStartMs(event) {
  const comps = event && Array.isArray(event.competitions) ? event.competitions : [];
  const comp = comps.length ? comps[0] : null;
  const iso = (event && event.date) || (comp && comp.date);
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function writeEventStatus(event, phase, index) {
  if (!event || typeof event !== 'object') {
    return;
  }
  if (!Array.isArray(event.competitions) || !event.competitions.length) {
    event.competitions = [{}];
  }
  const comp = event.competitions[0] || {};
  event.competitions[0] = comp;
  if (!Array.isArray(comp.competitors)) {
    comp.competitors = [];
  }
  if (phase === 'post') {
    const type = { state: 'post', completed: true, name: 'STATUS_FINAL' };
    event.status = { ...(event.status || {}), type };
    comp.status = { type, period: 4, displayClock: '0:00' };
    comp.competitors.forEach((c, i) => {
      if (!c) return;
      c.score = String(17 + ((index + i) % 3) * 7);
      c.winner = i === 1;
    });
    return;
  }
  if (phase === 'in') {
    const type = { state: 'in', completed: false, name: 'STATUS_IN_PROGRESS' };
    event.status = { ...(event.status || {}), type };
    comp.status = { type, period: 2, displayClock: '8:21' };
    comp.period = 2;
    comp.displayClock = '8:21';
    comp.competitors.forEach((c, i) => {
      if (!c) return;
      c.score = String(10 + ((index + i) % 2) * 4);
      delete c.winner;
    });
    return;
  }
  const type = { state: 'pre', completed: false, name: 'STATUS_SCHEDULED' };
  event.status = { ...(event.status || {}), type };
  comp.status = { type };
}

/**
 * Local testing: rewrite the current-season scoreboard so a handful of games
 * are final, a handful are live, and the rest have not started — enough for
 * a typical roster to show ~3 finished and ~3 in-play.
 */
export function applyMidweekSimulation(scoreboardJson, season) {
  if (!SIMULATE_MIDWEEK || !scoreboardJson) {
    return scoreboardJson;
  }
  if (season != null && String(season) !== String(CURRENT_YEAR)) {
    return scoreboardJson;
  }
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(scoreboardJson));
  } catch (_) {
    return scoreboardJson;
  }
  const events = extractEvents(copy);
  if (!events.length) {
    return copy;
  }
  const ordered = events
    .map((event, i) => ({ event, i, t: eventStartMs(event) }))
    .sort((a, b) => (a.t - b.t) || String(a.event && a.event.id).localeCompare(String(b.event && b.event.id)));
  const n = ordered.length;
  const finalCount = Math.min(2, n);
  const liveCount = Math.min(2, Math.max(0, n - finalCount));
  ordered.forEach((row, idx) => {
    const phase = idx < finalCount ? 'post' : (idx < finalCount + liveCount ? 'in' : 'pre');
    writeEventStatus(row.event, phase, idx);
  });
  copy._dbbSimulateMidweek = true;
  return copy;
}

export function isScoreboardWeekComplete(scoreboardJson) {
  const events = extractEvents(scoreboardJson);
  if (!events.length) {
    return false;
  }

  for (const ev of events) {
    const comps = ev && ev.competitions;
    const comp = Array.isArray(comps) && comps.length ? comps[0] : null;
    const stType = (comp && comp.status && comp.status.type) || (ev && ev.status && ev.status.type) || {};
    let state = stType && stType.state ? stType.state : null;
    if (!state && stType && stType.completed === true) {
      state = 'post';
    }
    if (!state && typeof stType.name === 'string' && /FINAL|STATUS_FINAL|END|FULL/i.test(stType.name)) {
      state = 'post';
    }
    const s = String(state || '').toLowerCase();
    const isFinal =
      s === 'final' ||
      s === 'post' ||
      s === 'postgame' ||
      s === 'status_final' ||
      s === 'complete' ||
      s === 'end' ||
      s === 'canceled' ||
      s === 'cancelled';

    if (!isFinal) {
      return false;
    }
  }
  return true;
}

function isWeekFuture(scoreboardJson) {
  const events = extractEvents(scoreboardJson);
  if (!events.length) { return false; }
  for (const ev of events) {
    const comp = Array.isArray(ev.competitions) && ev.competitions.length ? ev.competitions[0] : {};
    const st = (comp.status && comp.status.type) || (ev.status && ev.status.type) || {};
    const state = st.state || (st.completed === true ? 'post' : null);
    if (state === 'in' || state === 'post') {
      return false;
    }
  }
  return true;
}

function getEventTeamAbbreviations(event) {
  const result = [];
  if (!event) { return result; }
  const comps = Array.isArray(event.competitions) ? event.competitions : [];
  const comp = comps.length ? comps[0] : null;
  const competitors = comp && Array.isArray(comp.competitors) ? comp.competitors : [];
  for (const c of competitors) {
    const abbr = normalizeTeamAbbr(c && c.team && (c.team.abbreviation || c.team.shortDisplayName || c.team.displayName));
    if (abbr) { result.push(abbr); }
  }
  // Fallback: parse from shortName like "SF @ LAR"
  if (result.length === 0 && typeof event.shortName === 'string') {
    const parts = event.shortName.split(/\s+@\s+|\s+vs\s+/i);
    for (const p of parts) {
      const token = normalizeTeamAbbr(p);
      if (token) { result.push(token); }
    }
  }
  return result;
}

export function getEventShortLabel(event) {
  if (!event) { return null; }
  if (typeof event.shortName === 'string' && event.shortName.trim()) {
    return event.shortName.trim();
  }
  const comps = Array.isArray(event.competitions) ? event.competitions : [];
  const comp = comps.length ? comps[0] : null;
  const competitors = comp && Array.isArray(comp.competitors) ? comp.competitors : [];
  let away = null, home = null;
  for (const c of competitors) {
    const abbr = normalizeTeamAbbr(c && c.team && c.team.abbreviation);
    if (!abbr) { continue; }
    if (c.homeAway === 'home') { home = abbr; }
    if (c.homeAway === 'away') { away = abbr; }
  }
  if (away && home) { return `${away} @ ${home}`; }
  const abbrs = getEventTeamAbbreviations(event);
  if (abbrs.length >= 2) { return `${abbrs[0]} @ ${abbrs[1]}`; }
  return null;
}

export function getEventLabelForTeam(event, teamAbbr) {
  if (!event || !teamAbbr) { return null; }
  const team = normalizeTeamAbbr(teamAbbr);
  const comps = Array.isArray(event.competitions) ? event.competitions : [];
  const comp = comps.length ? comps[0] : null;
  const competitors = comp && Array.isArray(comp.competitors) ? comp.competitors : [];
  let away = null, home = null;
  for (const c of competitors) {
    const abbr = normalizeTeamAbbr(c && c.team && c.team.abbreviation);
    if (!abbr) { continue; }
    if (c.homeAway === 'home') { home = abbr; }
    if (c.homeAway === 'away') { away = abbr; }
  }
  if (team && away && home) {
    if (team === away) { return `@ ${home}`; }
    if (team === home) { return `vs ${away}`; }
  }
  // Fallback
  return getEventShortLabel(event);
}

function formatLocalDateTime(iso) {
  if (!iso) { return null; }
  const d = new Date(iso);
  const dow = d.toLocaleDateString(undefined, { weekday: 'short' });
  const md = d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  const tm = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${dow} ${md} ${tm}`;
}

export function getGameDisplayForTeam(event, teamAbbr) {
  if (!event) { return { text: 'BYE', live: false, completed: false }; }
  const comps = Array.isArray(event.competitions) ? event.competitions : [];
  const comp = comps.length ? comps[0] : {};
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];

  let home = null, away = null, self = null, opp = null;
  for (const c of competitors) {
    const abbr = normalizeTeamAbbr(c && c.team && c.team.abbreviation);
    if (c.homeAway === 'home') { home = c; }
    if (c.homeAway === 'away') { away = c; }
    if (abbr && normalizeTeamAbbr(teamAbbr) === abbr) { self = c; }
  }
  opp = self && home && away ? (self.homeAway === 'home' ? away : home) : null;
  const oppAbbr = opp && opp.team && normalizeTeamAbbr(opp.team.abbreviation);
  const perspective = self && self.homeAway === 'home' ? `vs ${oppAbbr || ''}` : `@ ${oppAbbr || ''}`;

  // Determine state from competition-level status first, then event-level, then infer
  const stType = (comp.status && comp.status.type) || (event.status && event.status.type) || {};
  let state = stType.state || null;
  if (!state && (stType.completed === true)) { state = 'post'; }
  if (!state && typeof stType.name === 'string' && /FINAL|STATUS_FINAL|END|FULL/i.test(stType.name)) { state = 'post'; }

  const sSelf = Number(self && self.score);
  const sOpp = Number(opp && opp.score);
  if (!state && (self && self.winner !== undefined)) { state = 'post'; }
  if (!state && isFinite(sSelf) && isFinite(sOpp)) { state = 'post'; }
  if (!state) {
    state = 'pre';
  }

  if (state === 'post') {
    const scoreStr = isFinite(sSelf) && isFinite(sOpp) ? `${sSelf}-${sOpp}` : '';
    const finalLabel = 'Final';
    // New format: "@ BUF 40-41, Final" (perspective first, score, Final)
    return { text: `${finalLabel} ${scoreStr} ${perspective}  `.trim(), live: false, completed: true };
  }
  if (state === 'in') {
    const scoreStr = isFinite(sSelf) && isFinite(sOpp) ? `${sSelf}-${sOpp}` : '';
    const clock = (comp.status && (comp.status.displayClock || comp.status.clock)) || (event.status && (event.status.displayClock || event.status.clock)) || '';
    const period = (comp.status && comp.status.period) || (event.status && event.status.period);
    const q = period > 4 ? 'OT' : `Q${period || ''}`;
    return { text: `${q} ${clock} ${perspective} ${scoreStr}`.trim(), live: true, completed: false };
  }
  // Future (pre)
  const when = formatLocalDateTime(event.date || comp.date);
  return { text: `${when} ${perspective}`.trim(), live: false, completed: false };
}

export function buildTeamToEventMap(scoreboardJson) {
  const map = {};
  const events = extractEvents(scoreboardJson);
  for (const ev of events) {
    const abbrs = getEventTeamAbbreviations(ev);
    for (const abbr of abbrs) {
      if (abbr && !map[abbr]) { map[abbr] = ev; }
    }
  }
  return map;
}

/**
 * Map player IDs to their game event for the week, using history for past games to choose the correct team.
 * Returns: { [playerId]: { event, team } }
 */
export async function mapPlayersToGames(playerIds, playersData, playerIdMap, scoreboardJson, overrideTeamMap = null) {
  const teamToEvent = buildTeamToEventMap(scoreboardJson);
  const result = {};
  const ids = Array.isArray(playerIds) ? playerIds : [];

  // Determine event date anchor and whether this week is entirely future
  const evs = extractEvents(scoreboardJson);
  const anchorIso = evs && evs.length ? (evs[0].date || (evs[0].competitions && evs[0].competitions[0] && evs[0].competitions[0].date)) : null;
  const weekFuture = isWeekFuture(scoreboardJson) || Boolean(scoreboardJson && scoreboardJson._dbbSimulateMidweek);

  // Collect infos and ESPN IDs
  const pidToInfo = {};
  const espnIds = [];
  for (const pid of ids) {
    const info = getPlayerInfo(pid, playersData, playerIdMap);
    pidToInfo[pid] = info || null;
    const espnId = info && info.espn_id ? String(info.espn_id) : null;
    if (espnId) { espnIds.push(espnId); }
  }

  // Prefetch all histories in parallel (only needed if not future)
  let historiesByEspn = {};
  if (!weekFuture && anchorIso && espnIds.length) {
    try {
      historiesByEspn = await fetchHistoriesByEspnIds(espnIds);
    } catch (_) {
      historiesByEspn = {};
    }
  }

  for (const pid of ids) {
    const info = pidToInfo[pid];
    const currentTeam = normalizeTeamAbbr(info && (info.team || info.team_abbr));
    const espnId = info && info.espn_id ? String(info.espn_id) : null;

    const forcedTeam = overrideTeamMap && overrideTeamMap[String(pid)] ? normalizeTeamAbbr(overrideTeamMap[String(pid)]) : null;
    let teamForWeek = forcedTeam || currentTeam || null;
    if (weekFuture) {
      // Future weeks: stick to current data only; if no team, mark FA
      teamForWeek = teamForWeek || 'FA';
    } else {
      // Past or in-progress: use history to resolve team at date if available
      if (!forcedTeam && espnId && anchorIso) {
        const history = historiesByEspn[espnId];
        const histTeam = getTeamAtDate(history, anchorIso);
        teamForWeek = normalizeTeamAbbr(histTeam) || teamForWeek || 'FA';
      } else {
        teamForWeek = teamForWeek || 'FA';
      }
    }

    const event = (teamForWeek && teamForWeek !== 'FA' && teamToEvent[teamForWeek]) ? teamToEvent[teamForWeek] : null;
    result[pid] = { event, team: teamForWeek };
  }
  return result;
} 