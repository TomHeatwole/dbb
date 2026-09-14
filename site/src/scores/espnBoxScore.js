/**
 * Parse ESPN NFL game summaries into league-scored fantasy points + stat lines.
 *
 * Boxscore keys come from site.api.espn.com .../summary?event={id}
 * (completions/passingAttempts, rushingYards, fieldGoalsMade/fieldGoalAttempts, …).
 */

import { calculateFantasyPoints } from '../data_parse/fantasyCalculator';

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

export function normalizeTeamAbbr(raw) {
  if (!raw) return null;
  const upper = String(raw).replace(/[^A-Za-z]/g, '').toUpperCase();
  return TEAM_ABBR_ALIASES[upper] || upper;
}

function extractEvents(scoreboardJson) {
  if (!scoreboardJson || typeof scoreboardJson !== 'object') return [];
  if (Array.isArray(scoreboardJson.events)) return scoreboardJson.events;
  return [];
}

const ESPN_TO_SLEEPER_DEF = {
  WSH: 'WAS',
  WAS: 'WAS',
  JAC: 'JAX',
  JAX: 'JAX',
  LA: 'LAR',
  LAR: 'LAR',
};

const RECENT_FINAL_MS = 36 * 60 * 60 * 1000;

export function sleeperDefIdFromEspnAbbr(abbr) {
  const norm = normalizeTeamAbbr(abbr);
  if (!norm) return null;
  return ESPN_TO_SLEEPER_DEF[norm] || ESPN_TO_SLEEPER_DEF[String(abbr || '').toUpperCase()] || norm;
}

export function parseSlash(value) {
  if (value == null) return { made: 0, att: 0 };
  const m = String(value).trim().match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return { made: 0, att: 0 };
  return { made: Number(m[1]), att: Number(m[2]) };
}

export function parseNum(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const m = String(value).trim().match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function zipStatRow(keys, values) {
  const out = {};
  const ks = Array.isArray(keys) ? keys : [];
  const vs = Array.isArray(values) ? values : [];
  const n = Math.min(ks.length, vs.length);
  for (let i = 0; i < n; i += 1) {
    if (ks[i]) out[ks[i]] = vs[i];
  }
  return out;
}

function teamAbbrFromGroup(group) {
  return normalizeTeamAbbr(group && group.team && group.team.abbreviation);
}

export function collectAthletesFromBoxscore(summary) {
  const players = summary && summary.boxscore && Array.isArray(summary.boxscore.players)
    ? summary.boxscore.players
    : [];
  const byEspnId = {};
  for (const group of players) {
    const teamAbbr = teamAbbrFromGroup(group);
    for (const cat of group.statistics || []) {
      const keys = cat.keys || cat.labels || [];
      const catName = String(cat.name || '');
      for (const row of cat.athletes || []) {
        const athlete = row && row.athlete;
        const espnId = athlete && athlete.id != null ? String(athlete.id) : '';
        if (!espnId) continue;
        if (!byEspnId[espnId]) {
          byEspnId[espnId] = {
            espnId,
            name: athlete.displayName || '',
            lastName: athlete.lastName || '',
            teamAbbr,
            bags: {},
          };
        }
        byEspnId[espnId].bags[catName] = zipStatRow(keys, row.stats);
      }
    }
  }
  return byEspnId;
}

function teamStatMap(teamBlock) {
  const out = {};
  for (const s of (teamBlock && teamBlock.statistics) || []) {
    if (s && s.name) out[s.name] = s.displayValue;
  }
  return out;
}

export function mapEspnBagsToScoringStats(bags, extras = {}) {
  const passing = bags.passing || {};
  const rushing = bags.rushing || {};
  const receiving = bags.receiving || {};
  const fumbles = bags.fumbles || {};
  const kicking = bags.kicking || {};
  const kickRet = bags.kickReturns || {};
  const puntRet = bags.puntReturns || {};

  const fg = parseSlash(kicking['fieldGoalsMade/fieldGoalAttempts']);
  const xp = parseSlash(kicking['extraPointsMade/extraPointAttempts']);

  const stats = {
    passing_yards: parseNum(passing.passingYards),
    passing_tds: parseNum(passing.passingTouchdowns),
    passing_interceptions: parseNum(passing.interceptions),
    passing_2pt_conversions: extras.pass2pt || 0,
    rushing_yards: parseNum(rushing.rushingYards),
    rushing_tds: parseNum(rushing.rushingTouchdowns),
    rushing_2pt_conversions: extras.rush2pt || 0,
    rushing_fumbles_lost: parseNum(fumbles.fumblesLost),
    receiving_yards: parseNum(receiving.receivingYards),
    receiving_tds: parseNum(receiving.receivingTouchdowns),
    receptions: parseNum(receiving.receptions),
    receiving_2pt_conversions: extras.rec2pt || 0,
    special_teams_tds:
      parseNum(kickRet.kickReturnTouchdowns) + parseNum(puntRet.puntReturnTouchdowns),
    fg_made: fg.made,
    fg_missed: Math.max(0, fg.att - fg.made),
    fg_made_50_59: extras.fg50 || 0,
    fg_made_60_: extras.fg60 || 0,
    pat_made: xp.made,
    pat_missed: Math.max(0, xp.att - xp.made),
  };
  return stats;
}

export function formatPlayerStatLine(bags, extras = {}) {
  const parts = [];
  const passing = bags.passing || {};
  const rushing = bags.rushing || {};
  const receiving = bags.receiving || {};
  const kicking = bags.kicking || {};
  const fumbles = bags.fumbles || {};

  if (passing.passingYards != null || passing['completions/passingAttempts']) {
    const cmp = passing['completions/passingAttempts'];
    const yds = parseNum(passing.passingYards);
    const td = parseNum(passing.passingTouchdowns);
    const ints = parseNum(passing.interceptions);
    const bit = [];
    if (cmp) bit.push(String(cmp));
    bit.push(`${yds} yd`);
    if (td) bit.push(`${td} TD`);
    if (ints) bit.push(`${ints} INT`);
    parts.push(bit.join(', '));
  }
  if (rushing.rushingYards != null || rushing.rushingAttempts != null) {
    const att = parseNum(rushing.rushingAttempts);
    const yds = parseNum(rushing.rushingYards);
    const td = parseNum(rushing.rushingTouchdowns);
    const bit = [];
    if (att) bit.push(`${att} car`);
    bit.push(`${yds} yd`);
    if (td) bit.push(`${td} TD`);
    parts.push(bit.join(', '));
  }
  if (receiving.receptions != null || receiving.receivingYards != null) {
    const rec = parseNum(receiving.receptions);
    const yds = parseNum(receiving.receivingYards);
    const td = parseNum(receiving.receivingTouchdowns);
    const bit = [`${rec} rec`, `${yds} yd`];
    if (td) bit.push(`${td} TD`);
    parts.push(bit.join(', '));
  }
  if (kicking['fieldGoalsMade/fieldGoalAttempts'] || kicking['extraPointsMade/extraPointAttempts']) {
    const fg = kicking['fieldGoalsMade/fieldGoalAttempts'];
    const xp = kicking['extraPointsMade/extraPointAttempts'];
    const bit = [];
    if (fg) bit.push(`${fg} FG`);
    if (xp) bit.push(`${xp} XP`);
    if (extras.fg50 || extras.fg60) {
      const long = (extras.fg60 || 0) + (extras.fg50 || 0);
      if (long) bit.push(`${long} from 50+`);
    }
    parts.push(bit.join(', '));
  }
  const fum = parseNum(fumbles.fumblesLost);
  if (fum) parts.push(`${fum} fum lost`);
  const st = parseNum((bags.kickReturns || {}).kickReturnTouchdowns)
    + parseNum((bags.puntReturns || {}).puntReturnTouchdowns);
  if (st) parts.push(`${st} ST TD`);
  return parts.join(' · ');
}

function scoringPlays(summary) {
  return Array.isArray(summary && summary.scoringPlays) ? summary.scoringPlays : [];
}

export function kickerDistanceBonuses(summary, teamAbbr, lastName) {
  const extras = { fg50: 0, fg60: 0 };
  const team = normalizeTeamAbbr(teamAbbr);
  const last = String(lastName || '').trim().toLowerCase();
  for (const play of scoringPlays(summary)) {
    const playTeam = normalizeTeamAbbr(play && play.team && play.team.abbreviation);
    if (team && playTeam && playTeam !== team) continue;
    const text = String((play && play.text) || '');
    const type = String((play && play.type && play.type.text) || '');
    if (!/field goal/i.test(text) && !/field goal/i.test(type)) continue;
    if (/missed|no good|blocked/i.test(text)) continue;
    if (last && !text.toLowerCase().includes(last)) continue;
    const yd = text.match(/(\d+)\s*yd/i);
    const dist = yd ? Number(yd[1]) : NaN;
    if (!Number.isFinite(dist)) continue;
    if (dist >= 60) extras.fg60 += 1;
    else if (dist >= 50) extras.fg50 += 1;
  }
  return extras;
}

function safetyCount(summary, teamAbbr) {
  const team = normalizeTeamAbbr(teamAbbr);
  let n = 0;
  for (const play of scoringPlays(summary)) {
    const type = String((play && play.type && play.type.text) || '');
    const text = String((play && play.text) || '');
    if (!/^safety$/i.test(type) && !/\bsafety\b/i.test(text)) continue;
    const playTeam = normalizeTeamAbbr(play && play.team && play.team.abbreviation);
    if (team && playTeam && playTeam !== team) continue;
    n += 1;
  }
  return n;
}

export function formatDstStatLine(stats) {
  const bits = [];
  if (stats.def_sacks) bits.push(`${stats.def_sacks} sack`);
  if (stats.def_interceptions) bits.push(`${stats.def_interceptions} INT`);
  if (stats.def_fumbles) bits.push(`${stats.def_fumbles} FR`);
  if (stats.def_tds) bits.push(`${stats.def_tds} TD`);
  if (stats.def_safeties) bits.push(`${stats.def_safeties} safety`);
  if (stats.special_teams_tds) bits.push(`${stats.special_teams_tds} ST TD`);
  return bits.join(', ');
}

export function dstStatsFromSummary(summary) {
  const teams = summary && summary.boxscore && Array.isArray(summary.boxscore.teams)
    ? summary.boxscore.teams
    : [];
  const parsed = teams.map((block) => ({
    abbr: normalizeTeamAbbr(block && block.team && block.team.abbreviation),
    stats: teamStatMap(block),
  })).filter((t) => t.abbr);

  const out = {};
  for (let i = 0; i < parsed.length; i += 1) {
    const self = parsed[i];
    const opp = parsed[1 - i] || { stats: {} };
    const sacksTaken = parseNum(opp.stats.sacksYardsLost);
    const intsThrown = parseNum(opp.stats.interceptions);
    const fumLost = parseNum(opp.stats.fumblesLost);
    const defTd = parseNum(self.stats.defensiveTouchdowns);
    const safeties = safetyCount(summary, self.abbr);
    const stats = {
      def_sacks: sacksTaken,
      def_interceptions: intsThrown,
      def_fumbles: fumLost,
      def_tds: defTd,
      def_safeties: safeties,
      special_teams_tds: 0,
    };
    out[self.abbr] = {
      stats,
      statLine: formatDstStatLine(stats),
      sleeperId: sleeperDefIdFromEspnAbbr(self.abbr),
    };
  }
  return out;
}

export function eventState(event) {
  const comps = event && Array.isArray(event.competitions) ? event.competitions : [];
  const comp = comps.length ? comps[0] : null;
  const type = (comp && comp.status && comp.status.type)
    || (event && event.status && event.status.type)
    || {};
  let state = type.state ? String(type.state).toLowerCase() : '';
  if (!state && type.completed) state = 'post';
  if (!state && /final/i.test(String(type.name || ''))) state = 'post';
  return state;
}

export function teamStatesFromScoreboard(scoreboard) {
  const out = {};
  for (const ev of extractEvents(scoreboard)) {
    const state = eventState(ev);
    const comps = ev && Array.isArray(ev.competitions) ? ev.competitions : [];
    const competitors = comps[0] && Array.isArray(comps[0].competitors) ? comps[0].competitors : [];
    for (const c of competitors) {
      const abbr = normalizeTeamAbbr(c && c.team && c.team.abbreviation);
      if (!abbr) continue;
      out[abbr] = {
        state,
        live: state === 'in',
        completed: state === 'post',
        eventId: ev && ev.id != null ? String(ev.id) : null,
        dateMs: ev && ev.date ? Date.parse(ev.date) : NaN,
      };
    }
  }
  return out;
}

export function eventIdsForBoxScores(scoreboard, nowMs = Date.now()) {
  const ids = [];
  const seen = new Set();
  for (const ev of extractEvents(scoreboard)) {
    const id = ev && ev.id != null ? String(ev.id) : '';
    if (!id || seen.has(id)) continue;
    const state = eventState(ev);
    if (state === 'in') {
      seen.add(id);
      ids.push(id);
      continue;
    }
    if (state === 'post') {
      const kick = ev && ev.date ? Date.parse(ev.date) : NaN;
      if (!Number.isFinite(kick) || (nowMs - kick) <= RECENT_FINAL_MS) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

export function invertEspnIdMap(playerIdMap, playersData) {
  const out = {};
  for (const [sid, eid] of Object.entries(playerIdMap || {})) {
    if (eid) out[String(eid)] = String(sid);
  }
  if (playersData && typeof playersData === 'object') {
    for (const [sid, p] of Object.entries(playersData)) {
      const eid = p && p.espn_id;
      if (eid && !out[String(eid)]) out[String(eid)] = String(sid);
    }
  }
  return out;
}

export function playerPosition(pid, playersData) {
  const p = playersData && (playersData[pid] || playersData[String(pid)]);
  if (!p) return '';
  return p.position || (Array.isArray(p.fantasy_positions) && p.fantasy_positions[0]) || '';
}

export function playerTeamAbbr(pid, playersData) {
  const id = String(pid);
  if (/^[A-Z]{2,3}$/.test(id) && playerPosition(id, playersData) === 'DEF') {
    return normalizeTeamAbbr(id);
  }
  const p = playersData && (playersData[pid] || playersData[id]);
  return normalizeTeamAbbr(p && (p.team || p.team_abbr));
}

/**
 * @returns {Record<string, { pts: number, statLine: string, stats: object, live: boolean, completed: boolean }>}
 */
export function buildEspnLiveBySleeper({
  summaries,
  playerIdMap,
  playersData,
  scoringConfig,
  teamStates = {},
}) {
  const espnToSleeper = invertEspnIdMap(playerIdMap, playersData);
  const bySleeper = {};

  for (const summary of summaries || []) {
    if (!summary) continue;
    const athletes = collectAthletesFromBoxscore(summary);
    for (const row of Object.values(athletes)) {
      const sid = espnToSleeper[row.espnId];
      if (!sid) continue;
      const extras = kickerDistanceBonuses(summary, row.teamAbbr, row.lastName);
      const stats = mapEspnBagsToScoringStats(row.bags, extras);
      const pos = playerPosition(sid, playersData);
      const pts = scoringConfig ? calculateFantasyPoints({ ...stats, position: pos }, scoringConfig) : 0;
      const team = row.teamAbbr || playerTeamAbbr(sid, playersData);
      const st = team && teamStates[team] ? teamStates[team] : null;
      bySleeper[sid] = {
        pts,
        statLine: formatPlayerStatLine(row.bags, extras),
        stats,
        live: Boolean(st && st.live),
        completed: Boolean(st && st.completed),
        source: 'espn',
      };
    }

    const dst = dstStatsFromSummary(summary);
    for (const [espnAbbr, row] of Object.entries(dst)) {
      const sid = row.sleeperId;
      if (!sid) continue;
      const pts = scoringConfig
        ? calculateFantasyPoints({ ...row.stats, position: 'DEF' }, scoringConfig)
        : 0;
      const state = teamStates[normalizeTeamAbbr(espnAbbr)] || teamStates[normalizeTeamAbbr(sid)] || null;
      bySleeper[sid] = {
        pts,
        statLine: row.statLine,
        stats: row.stats,
        live: Boolean(state && state.live),
        completed: Boolean(state && state.completed),
        source: 'espn',
      };
    }
  }
  return bySleeper;
}

/** Prefer ESPN while the game is live, or after Final while Sleeper is still behind. */
export function shouldPreferEspn(espnRow, sleeperPts) {
  if (!espnRow || typeof espnRow.pts !== 'number' || !Number.isFinite(espnRow.pts)) {
    return false;
  }
  if (espnRow.live) return true;
  if (!espnRow.completed) return false;
  const s = Number(sleeperPts);
  const sleeper = Number.isFinite(s) ? s : 0;
  return espnRow.pts > sleeper + 0.45;
}
