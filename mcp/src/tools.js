import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { CURRENT_YEAR, SITE_BASE_URL, PREVIOUS_YEARS, getLeagueIdForSeason } from './config.js';
import {
  fetchRosters, fetchUsers, fetchMatchups, fetchTransactions,
  fetchTrendingPlayers, fetchAllWeekScores,
} from './sleeperApi.js';
import {
  loadPlayersData, loadKtcData, loadFantasyCalcData, loadFfbData,
  findPlayerByName, loadOwnerNames,
} from './dataLoader.js';
import {
  getCurrentNFLWeek, getCompletedWeeksCount, normalisePlayerName,
  buildTeamMap, getPlayerDisplayName, lookupKtc, fmt, fmtDate, findTeam,
} from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Standings ────────────────────────────────────────────────────────────────

export async function getStandings() {
  const completedWeeks = getCompletedWeeksCount();
  if (completedWeeks === 0) {
    return `The ${CURRENT_YEAR} season hasn't started yet — no completed weeks.`;
  }

  const [rosters, users, weeksData] = await Promise.all([
    fetchRosters(),
    fetchUsers(),
    fetchAllWeekScores(completedWeeks),
  ]);
  const teamMap = buildTeamMap(rosters, users);

  // Accumulate points per roster
  const pointsMap = {};
  for (const week of weeksData) {
    if (!week) continue;
    for (const entry of week) {
      if (!entry || entry.roster_id == null) continue;
      pointsMap[entry.roster_id] = (pointsMap[entry.roster_id] || 0) + (entry.points || 0);
    }
  }

  const standings = Object.entries(pointsMap)
    .map(([rid, pts]) => {
      const info = teamMap[Number(rid)] || {};
      return {
        teamName:  info.teamName  || `Team ${rid}`,
        ownerName: info.ownerName || `Owner ${rid}`,
        points:    Math.round(pts * 10) / 10,
        roster_id: Number(rid),
      };
    })
    .sort((a, b) => b.points - a.points)
    .map((s, i) => ({ ...s, place: i + 1 }));

  const lines = [
    `**Hwang Dynasty Standings — ${CURRENT_YEAR} Season (through Week ${completedWeeks})**\n`,
  ];
  for (const s of standings) {
    lines.push(`${s.place}. ${s.teamName} (${s.ownerName}) — ${s.points} pts`);
  }
  lines.push(`\n🔗 ${SITE_BASE_URL}/standings`);
  return lines.join('\n');
}

// ─── Weekly Scores ────────────────────────────────────────────────────────────

export async function getWeeklyScores(week) {
  const [rosters, users, weekData] = await Promise.all([
    fetchRosters(),
    fetchUsers(),
    fetchMatchups(week).catch(() => null),
  ]);
  const teamMap = buildTeamMap(rosters, users);

  if (!weekData || weekData.length === 0) {
    return `No score data found for Week ${week}. The week may not have started yet.`;
  }

  // Group entries by matchup_id to pair opponents
  const matchups = {};
  for (const entry of weekData) {
    if (!entry || entry.roster_id == null) continue;
    const mid = entry.matchup_id || 0;
    if (!matchups[mid]) matchups[mid] = [];
    matchups[mid].push(entry);
  }

  const lines = [`**Hwang Dynasty — Week ${week} Scores**\n`];
  for (const [, teams] of Object.entries(matchups).sort()) {
    if (teams.length < 2) continue;
    const [a, b] = teams.sort((x, y) => (y.points || 0) - (x.points || 0));
    const aInfo  = teamMap[Number(a.roster_id)] || {};
    const bInfo  = teamMap[Number(b.roster_id)] || {};
    const aName  = aInfo.teamName || `Team ${a.roster_id}`;
    const bName  = bInfo.teamName || `Team ${b.roster_id}`;
    lines.push(`🏆 ${aName}: **${a.points ?? '—'}**  vs  ${bName}: ${b.points ?? '—'}`);
  }

  lines.push(`\n🔗 ${SITE_BASE_URL}/Scores/Week?week=${week}`);
  return lines.join('\n');
}

// ─── Team Roster ──────────────────────────────────────────────────────────────

export async function getRoster(teamQuery) {
  const [rosters, users] = await Promise.all([fetchRosters(), fetchUsers()]);
  const teamMap = buildTeamMap(rosters, users);

  const teamInfo = findTeam(teamMap, teamQuery, loadOwnerNames());
  if (!teamInfo) {
    const allTeams = Object.values(teamMap)
      .map((t) => `"${t.teamName}" (${t.ownerName})`)
      .join(', ');
    return `Team not found for "${teamQuery}". Available: ${allTeams}`;
  }

  const playersData                       = loadPlayersData();
  const { map: ktcMap }                   = loadKtcData();
  const { bySleeperId: fcById }           = loadFantasyCalcData();
  const { bySleeperId: ffbById, byName: ffbByName } = loadFfbData();

  const rosterPlayers = teamInfo.roster.players || [];
  const starterSet    = new Set(teamInfo.roster.starters || []);

  const posOrder = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };

  const playerRows = rosterPlayers
    .map((pid) => {
      const p          = playersData[pid];
      const name       = p ? getPlayerDisplayName(p) : `Player ${pid}`;
      const pos        = p?.position || '?';
      const nflTeam    = p?.team || 'FA';
      const ktc        = lookupKtc(name, ktcMap, { position: pos, team: nflTeam });
      const fc         = fcById.get(pid);
      const ffb        = ffbById.get(pid) || ffbByName.get(normalisePlayerName(name));
      return {
        name,
        position:  pos,
        nflTeam,
        isStarter: starterSet.has(pid),
        ktcValue:  ktc?.ktcValue_tep || null,
        ktcRank:   ktc?.rank_tep     || null,
        fcValue:   fc?.value         || null,
        fcRank:    fc?.overallRank   || null,
        fcTrend:   fc?.trend30day    || null,
        ffbRank:   ffb?.rank         || null,
        age:       fc?.age           || null,
      };
    })
    .sort((a, b) => {
      if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1;
      const ao = posOrder[a.position] ?? 9;
      const bo = posOrder[b.position] ?? 9;
      if (ao !== bo) return ao - bo;
      return (b.ktcValue || 0) - (a.ktcValue || 0);
    });

  const lines = [`**${teamInfo.teamName}** (${teamInfo.ownerName}) — Roster\n`];
  let lastSection = null;

  for (const p of playerRows) {
    const section = p.isStarter ? 'Starters' : 'Bench';
    if (section !== lastSection) {
      lines.push(`\n*${section}:*`);
      lastSection = section;
    }
    const parts = [];
    if (p.ktcValue) parts.push(`KTC: ${fmt(p.ktcValue)}${p.ktcRank ? ` (#${p.ktcRank})` : ''}`);
    if (p.fcValue)  parts.push(`FC: ${fmt(p.fcValue)}${p.fcRank ? ` (#${p.fcRank})` : ''}${p.fcTrend ? ` ${p.fcTrend > 0 ? '+' : ''}${p.fcTrend}` : ''}`);
    if (p.ffbRank)  parts.push(`FFB: #${p.ffbRank}`);
    const valStr = parts.length ? ` — ${parts.join(' | ')}` : '';
    lines.push(`  ${p.position.padEnd(3)} ${p.name} (${p.nflTeam})${p.age ? ` age ${p.age}` : ''}${valStr}`);
  }

  lines.push(`\n🔗 ${SITE_BASE_URL}/team/${teamInfo.roster.roster_id}`);
  return lines.join('\n');
}

// ─── All Teams ────────────────────────────────────────────────────────────────

export async function getAllTeams() {
  const [rosters, users] = await Promise.all([fetchRosters(), fetchUsers()]);
  const teamMap = buildTeamMap(rosters, users);

  const lines = [`**Hwang Dynasty ${CURRENT_YEAR} — All Teams**\n`];
  for (const [rid, info] of Object.entries(teamMap).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const playerCount = info.roster.players?.length || 0;
    lines.push(`Roster #${rid}: **${info.teamName}** (${info.ownerName}) — ${playerCount} players`);
    lines.push(`  🔗 ${SITE_BASE_URL}/team/${rid}`);
  }
  return lines.join('\n');
}

// ─── Player Search ────────────────────────────────────────────────────────────

export async function searchPlayer(name) {
  const result = findPlayerByName(name);
  if (!result) {
    return `Player "${name}" not found. Try a full name like "Justin Jefferson" or "Lamar Jackson".`;
  }

  const { playerId, player }              = result;
  const displayName                       = getPlayerDisplayName(player);
  const pos                               = player.position || '?';
  const nflTeam                           = player.team || 'FA';

  const { map: ktcMap, asOf: ktcAsOf }    = loadKtcData();
  const { bySleeperId: fcById, byName: fcByName } = loadFantasyCalcData();
  const { bySleeperId: ffbById, byName: ffbByName } = loadFfbData();

  const ktc = lookupKtc(displayName, ktcMap, { position: pos, team: nflTeam });
  const fc  = fcById.get(playerId) || fcByName.get(normalisePlayerName(displayName));
  const ffb = ffbById.get(playerId) || ffbByName.get(normalisePlayerName(displayName));

  // Find current owner
  const rosters = await fetchRosters();
  let ownerRoster = null;
  for (const r of rosters) {
    if (Array.isArray(r.players) && r.players.includes(playerId)) {
      ownerRoster = r;
      break;
    }
  }

  let ownerStr = 'Free Agent';
  if (ownerRoster) {
    const users   = await fetchUsers();
    const user    = users.find((u) => String(u.user_id) === String(ownerRoster.owner_id));
    const tName   = user?.metadata?.team_name || user?.display_name || `Roster #${ownerRoster.roster_id}`;
    ownerStr      = `${tName} — 🔗 ${SITE_BASE_URL}/team/${ownerRoster.roster_id}`;
  }

  const lines = [
    `**${displayName}** | ${pos} | ${nflTeam}${fc?.age ? ` | Age ${fc.age}` : ''}`,
    `Owner: ${ownerStr}`,
    '',
    '**Dynasty Values:**',
  ];

  if (ktc) {
    lines.push(`  KTC SF TE+: ${fmt(ktc.ktcValue_tep)} (Overall #${ktc.rank_tep || '?'})${ktcAsOf ? `  *(as of ${ktcAsOf})*` : ''}`);
    lines.push(`  KTC SF:     ${fmt(ktc.ktcValue_sf)}  (Overall #${ktc.rank_sf  || '?'})`);
  } else {
    lines.push(`  KTC: not found`);
  }

  if (fc) {
    const trendStr = fc.trend30day ? ` *(${fc.trend30day > 0 ? '+' : ''}${fc.trend30day} 30-day)*` : '';
    lines.push(`  FantasyCalc: ${fmt(fc.value)} — #${fc.overallRank || '?'} overall, #${fc.posRank || '?'} ${fc.position}${trendStr}`);
  } else {
    lines.push(`  FantasyCalc: not found`);
  }

  if (ffb) {
    lines.push(`  FFB Rank: #${ffb.rank}`);
  }

  return lines.join('\n');
}

// ─── Compare Players ──────────────────────────────────────────────────────────

export async function comparePlayers(names) {
  const { map: ktcMap }                   = loadKtcData();
  const { bySleeperId: fcById, byName: fcByName } = loadFantasyCalcData();
  const { bySleeperId: ffbById, byName: ffbByName } = loadFfbData();

  const rows = names.map((name) => {
    // Check for pick first
    const pick = resolvePick(name, ktcMap);
    if (pick) {
      return {
        name:     pick.label,
        position: 'PICK',
        nflTeam:  'N/A',
        found:    true,
        age:      null,
        ktcValue: pick.value || null,
        ktcRank:  ktcMap.get(normalisePlayerName(pick.label))?.rank_tep || null,
        fcValue:  null,
        fcRank:   null,
        fcTrend:  null,
        ffbRank:  null,
      };
    }

    const result = findPlayerByName(name);
    if (!result) return { name, found: false };

    const { playerId, player }  = result;
    const displayName           = getPlayerDisplayName(player);
    const pos                   = player.position || '?';
    const nflTeam               = player.team || 'FA';

    const ktc  = lookupKtc(displayName, ktcMap, { position: pos, team: nflTeam });
    const fc   = fcById.get(playerId) || fcByName.get(normalisePlayerName(displayName));
    const ffb  = ffbById.get(playerId) || ffbByName.get(normalisePlayerName(displayName));

    return {
      name:     displayName,
      position: pos,
      nflTeam,
      found:    true,
      age:      fc?.age       || null,
      ktcValue: ktc?.ktcValue_tep || null,
      ktcRank:  ktc?.rank_tep     || null,
      fcValue:  fc?.value         || null,
      fcRank:   fc?.overallRank   || null,
      fcTrend:  fc?.trend30day    || null,
      ffbRank:  ffb?.rank         || null,
    };
  });

  // Sort found players by KTC value descending
  const found    = rows.filter((r) => r.found).sort((a, b) => (b.ktcValue || 0) - (a.ktcValue || 0));
  const notFound = rows.filter((r) => !r.found);

  const lines = ['**Player Comparison (SF TE+)**\n'];

  const COL = { name: 24, pos: 4, team: 5, ktc: 7, ktcRk: 8, fc: 7, fcRk: 7, ffb: 8, age: 4 };
  const pad = (s, n) => String(s ?? '—').padEnd(n).slice(0, n);

  lines.push(
    `${pad('Player', COL.name)} ${pad('Pos', COL.pos)} ${pad('Team', COL.team)} ` +
    `${pad('KTC', COL.ktc)} ${pad('KTC Rank', COL.ktcRk)} ` +
    `${pad('FC', COL.fc)} ${pad('FC Rank', COL.fcRk)} ` +
    `${pad('FFB', COL.ffb)} ${pad('Age', COL.age)}`
  );
  lines.push('─'.repeat(85));

  for (const p of found) {
    const trendStr = p.fcTrend ? ` (${p.fcTrend > 0 ? '+' : ''}${p.fcTrend})` : '';
    lines.push(
      `${pad(p.name, COL.name)} ${pad(p.position, COL.pos)} ${pad(p.nflTeam, COL.team)} ` +
      `${pad(fmt(p.ktcValue), COL.ktc)} ${pad(p.ktcRank ? `#${p.ktcRank}` : '—', COL.ktcRk)} ` +
      `${pad(fmt(p.fcValue) + trendStr, COL.fc + 8)} ${pad(p.fcRank ? `#${p.fcRank}` : '—', COL.fcRk)} ` +
      `${pad(p.ffbRank ? `#${p.ffbRank}` : '—', COL.ffb)} ${pad(p.age || '—', COL.age)}`
    );
  }

  for (const p of notFound) {
    lines.push(`❓ "${p.name}" — not found`);
  }

  return lines.join('\n');
}

// ─── Draft pick resolution ────────────────────────────────────────────────────
// Parses pick-like strings (e.g. "2027 1st", "2027 early first round pick")
// and maps them to KTC pick names like "2027 Early 1st".
// Returns { label, value, found } or null if input doesn't look like a pick.

const PICK_ROUND_MAP = {
  '1st': '1st', 'first':  '1st',
  '2nd': '2nd', 'second': '2nd',
  '3rd': '3rd', 'third':  '3rd',
  '4th': '4th', 'fourth': '4th',
};

const PICK_TIER_MAP = {
  early:  'Early',
  mid:    'Mid',
  middle: 'Mid',
  late:   'Late',
};

export function resolvePick(name, ktcMap) {
  const n = (name || '').toLowerCase().trim();

  const yearMatch  = n.match(/\b(202[6-9]|203\d)\b/);
  const roundMatch = n.match(/\b(1st|2nd|3rd|4th|first|second|third|fourth)\b/);
  if (!yearMatch || !roundMatch) return null;

  const year  = yearMatch[1];
  const round = PICK_ROUND_MAP[roundMatch[1]];

  const tierKey = Object.keys(PICK_TIER_MAP).find((t) => n.includes(t));
  const tier    = tierKey ? PICK_TIER_MAP[tierKey] : 'Mid';

  const ktcName = `${year} ${tier} ${round}`;
  const entry   = ktcMap.get(normalisePlayerName(ktcName));
  if (!entry) return null;
  return { label: entry.name, value: entry.ktcValue_tep || 0, found: true };
}

// ─── Evaluate Trade ───────────────────────────────────────────────────────────

export async function evaluateTrade(giving, receiving) {
  const { map: ktcMap } = loadKtcData();

  function resolvePlayer(name) {
    const pick = resolvePick(name, ktcMap);
    if (pick) return pick;

    const result = findPlayerByName(name);
    if (!result) return { label: name, value: 0, found: false };
    const displayName = getPlayerDisplayName(result.player);
    const pos         = result.player.position || '';
    const nflTeam     = result.player.team || '';
    const ktc         = lookupKtc(displayName, ktcMap, { position: pos, team: nflTeam });
    return { label: displayName, value: ktc?.ktcValue_tep || 0, found: true };
  }

  const givingSide    = giving.map(resolvePlayer);
  const receivingSide = receiving.map(resolvePlayer);

  const givingTotal    = givingSide.reduce((s, p) => s + p.value, 0);
  const receivingTotal = receivingSide.reduce((s, p) => s + p.value, 0);
  const diff           = receivingTotal - givingTotal;
  const pct            = givingTotal > 0 ? Math.round((diff / givingTotal) * 100) : 0;

  let verdict;
  if (Math.abs(pct) <= 5) {
    verdict = '⚖️  Roughly even trade';
  } else if (diff > 0) {
    verdict = `✅ You WIN this trade (+${fmt(Math.abs(diff))} KTC, +${pct}%)`;
  } else {
    verdict = `❌ You LOSE this trade (−${fmt(Math.abs(diff))} KTC, ${pct}%)`;
  }

  const lines = ['**Trade Evaluator — KTC SF TE+ Values**\n'];

  lines.push('**You give:**');
  for (const p of givingSide) {
    lines.push(`  ${p.found ? `${p.label} — ${fmt(p.value)}` : `❓ ${p.label} (player not found)`}`);
  }
  lines.push(`  Total: **${fmt(givingTotal)}**\n`);

  lines.push('**You receive:**');
  for (const p of receivingSide) {
    lines.push(`  ${p.found ? `${p.label} — ${fmt(p.value)}` : `❓ ${p.label} (player not found)`}`);
  }
  lines.push(`  Total: **${fmt(receivingTotal)}**\n`);

  lines.push(verdict);
  if (Math.abs(pct) > 5) {
    const absDiff = Math.abs(diff).toLocaleString();
    lines.push(`  Value difference: ${diff > 0 ? '+' : '−'}${absDiff} KTC points`);
  }

  return lines.join('\n');
}

// ─── Draft Pick Lookup ────────────────────────────────────────────────────────

export function lookupDraftPick(name) {
  const { map: ktcMap, asOf } = loadKtcData();

  // If no tier specified, return all three tiers for that year+round
  const n = (name || '').toLowerCase().trim();
  const yearMatch  = n.match(/\b(202[6-9]|203\d)\b/);
  const roundMatch = n.match(/\b(1st|2nd|3rd|4th|first|second|third|fourth)\b/);

  if (!yearMatch || !roundMatch) {
    return `Couldn't parse "${name}" as a draft pick. Try something like "2027 1st", "2027 early first", or "2028 2nd".`;
  }

  const year  = yearMatch[1];
  const round = PICK_ROUND_MAP[roundMatch[1]];

  const tierKey = Object.keys(PICK_TIER_MAP).find((t) => n.includes(t));

  const currentYear = new Date().getFullYear();
  const yearsAway   = Number(year) - currentYear;
  const proximity   =
    yearsAway <= 0  ? 'current year\'s draft (imminent)'
    : yearsAway === 1 ? 'next year\'s draft (~1 year away)'
    : `${yearsAway} years away`;

  const lines = [`**${year} ${round} Draft Pick — KTC SF TE+ Values** *(as of ${asOf || 'recent'})*`,
                 `*${year} draft = ${proximity}*`, ''];

  if (tierKey) {
    const tier  = PICK_TIER_MAP[tierKey];
    const entry = ktcMap.get(normalisePlayerName(`${year} ${tier} ${round}`));
    if (!entry) {
      return `No KTC data found for "${year} ${tier} ${round}". The pick may be beyond available data.`;
    }
    lines.push(`  **${entry.name}** — KTC: ${fmt(entry.ktcValue_tep)} (Overall #${entry.rank_tep || '?'})`);
  } else {
    // Show all tiers
    for (const tier of ['Early', 'Mid', 'Late']) {
      const entry = ktcMap.get(normalisePlayerName(`${year} ${tier} ${round}`));
      if (entry) {
        lines.push(`  **${entry.name}** — KTC: ${fmt(entry.ktcValue_tep)} (Overall #${entry.rank_tep || '?'})`);
      }
    }
  }

  lines.push('');
  lines.push('*Tier (Early/Mid/Late) reflects projected draft slot. Use the appropriate tier based on the originating team\'s expected finish.*');
  return lines.join('\n');
}

// ─── KTC Rankings ─────────────────────────────────────────────────────────────

export function getKtcRankings(position, topN) {
  const { map, asOf } = loadKtcData();
  const n = Math.min(Math.max(topN || 25, 1), 100);

  let entries = Array.from(map.values());
  if (position) {
    entries = entries.filter((e) => e.position?.toUpperCase() === position.toUpperCase());
  }
  entries.sort((a, b) => (b.ktcValue_tep || 0) - (a.ktcValue_tep || 0));
  entries = entries.slice(0, n);

  const posLabel = position ? `${position.toUpperCase()} ` : '';
  const lines = [
    `**KTC ${posLabel}Dynasty Rankings (SF TE+)${asOf ? ` — as of ${asOf}` : ''}**\n`,
  ];
  entries.forEach((e, i) => {
    lines.push(`${String(i + 1).padStart(3)}. ${e.name} (${e.position}, ${e.nflTeam}) — ${fmt(e.ktcValue_tep)}`);
  });

  return lines.join('\n');
}

// ─── FantasyCalc Rankings ─────────────────────────────────────────────────────

export function getFantasyCalcRankings(position, topN) {
  const { byName } = loadFantasyCalcData();
  const n = Math.min(Math.max(topN || 25, 1), 100);

  let entries = Array.from(byName.values());
  if (position) {
    entries = entries.filter((e) => e.position?.toUpperCase() === position.toUpperCase());
  }
  entries.sort((a, b) => (b.value || 0) - (a.value || 0));
  entries = entries.slice(0, n);

  const posLabel = position ? `${position.toUpperCase()} ` : '';
  const lines = [`**FantasyCalc ${posLabel}Dynasty Rankings (SF)**\n`];
  entries.forEach((e, i) => {
    const trendStr = e.trend30day ? ` (${e.trend30day > 0 ? '+' : ''}${e.trend30day})` : '';
    lines.push(
      `${String(i + 1).padStart(3)}. ${e.name} (${e.position}, ${e.team}) — ${fmt(e.value)}${trendStr}${e.age ? ` | age ${e.age}` : ''}`
    );
  });

  return lines.join('\n');
}

// ─── Trending Players ─────────────────────────────────────────────────────────

export async function getTrendingPlayers() {
  const [trending, playersData] = await Promise.all([
    fetchTrendingPlayers(),
    Promise.resolve(loadPlayersData()),
  ]);

  const lines = ['**Trending Players on Sleeper (last 24 hours)**\n'];
  const top = Array.isArray(trending) ? trending.slice(0, 20) : [];

  for (let i = 0; i < top.length; i++) {
    const t   = top[i];
    const p   = playersData[t.player_id];
    const name = p ? getPlayerDisplayName(p) : `ID ${t.player_id}`;
    const pos  = p?.position || '?';
    const team = p?.team || '?';
    lines.push(`${String(i + 1).padStart(2)}. ${name} (${pos}, ${team}) — +${t.count.toLocaleString()} adds`);
  }

  return lines.join('\n');
}

// ─── Recent Trades ────────────────────────────────────────────────────────────

export async function getRecentTrades(weeksBack, season) {
  const lookback = Math.min(Math.max(weeksBack || 4, 1), 17);
  const yr = season ? String(season) : CURRENT_YEAR;
  const completedWeeks = getCompletedWeeksCount(yr);

  // Offseason: the current year's league exists but no weeks have completed yet.
  // Sleeper stores offseason trades under legs 0 and 1 of the upcoming season's league.
  const isOffseason = !season && completedWeeks === 0;

  const [rosters, users] = await Promise.all([fetchRosters(yr), fetchUsers(yr)]);
  const teamMap           = buildTeamMap(rosters, users);
  const playersData       = loadPlayersData();

  let weekNums;
  if (isOffseason) {
    weekNums = [0, 1];
  } else {
    const isPastSeason = yr !== CURRENT_YEAR;
    const currentWeek  = getCurrentNFLWeek(yr);
    const startWeek    = isPastSeason ? 1 : Math.max(1, currentWeek - lookback + 1);
    const endWeek      = isPastSeason ? completedWeeks : currentWeek;
    weekNums = Array.from({ length: endWeek - startWeek + 1 }, (_, i) => startWeek + i);
  }

  const seen = new Set();
  const allTransactions = (
    await Promise.all(weekNums.map((w) => fetchTransactions(w, yr).catch(() => [])))
  ).flat().filter((t) => {
    if (!t?.transaction_id || seen.has(t.transaction_id)) return false;
    seen.add(t.transaction_id);
    return true;
  });

  const trades = allTransactions
    .filter((t) => t?.type === 'trade' && t?.status === 'complete')
    .sort((a, b) => (b.created || 0) - (a.created || 0));

  const isPastSeason = yr !== CURRENT_YEAR;
  if (trades.length === 0) {
    if (isOffseason) return `No offseason trades yet for ${yr}.`;
    return isPastSeason
      ? `No completed trades found for the ${yr} season.`
      : `No completed trades found in the last ${lookback} week(s).`;
  }

  let seasonLabel;
  if (isOffseason)      seasonLabel = `${yr} Offseason`;
  else if (isPastSeason) seasonLabel = yr;
  else                   seasonLabel = `${yr} (last ${lookback} week(s))`;
  const lines = [`**Recent Trades — Hwang Dynasty ${seasonLabel}**\n`];

  for (const trade of trades.slice(0, 12)) {
    // Build per-team sides
    const sides = {};
    const ensureTeam = (rid) => {
      const k = Number(rid);
      if (!sides[k]) sides[k] = { players: [], picks: [], faab: 0 };
      return k;
    };

    for (const rid of trade.roster_ids || []) ensureTeam(rid);

    for (const [pid, rid] of Object.entries(trade.adds || {})) {
      const k = ensureTeam(rid);
      const p = playersData[pid];
      sides[k].players.push(p ? getPlayerDisplayName(p) : `Player ${pid}`);
    }

    for (const pick of trade.draft_picks || []) {
      if (pick?.owner_id) {
        const k = ensureTeam(pick.owner_id);
        sides[k].picks.push(`${pick.season} Rd ${pick.round}`);
      }
    }

    for (const wb of trade.waiver_budget || []) {
      if (wb?.receiver && wb.amount) {
        const k = ensureTeam(wb.receiver);
        sides[k].faab += Number(wb.amount) || 0;
      }
    }

    lines.push(`📅 ${fmtDate(trade.created)}`);
    for (const [rid, side] of Object.entries(sides)) {
      const info     = teamMap[Number(rid)] || {};
      const teamName = info.teamName || `Team ${rid}`;
      const received = [
        ...side.players,
        ...side.picks,
        side.faab ? `$${side.faab} FAAB` : null,
      ].filter(Boolean);
      lines.push(`  **${teamName}** receives: ${received.length ? received.join(', ') : '—'}`);
    }
    lines.push('');
  }

  lines.push(`🔗 ${SITE_BASE_URL}/trades`);
  return lines.join('\n');
}

// ─── Team Season Scores ───────────────────────────────────────────────────────

export async function getTeamScores(teamQuery) {
  const [rosters, users] = await Promise.all([fetchRosters(), fetchUsers()]);
  const teamMap           = buildTeamMap(rosters, users);
  const teamInfo          = findTeam(teamMap, teamQuery, loadOwnerNames());

  if (!teamInfo) {
    const all = Object.values(teamMap).map((t) => `"${t.teamName}"`).join(', ');
    return `Team not found for "${teamQuery}". Available: ${all}`;
  }

  const completedWeeks = getCompletedWeeksCount();
  if (completedWeeks === 0) {
    return `The ${CURRENT_YEAR} season hasn't started yet.`;
  }

  const weeksData = await fetchAllWeekScores(completedWeeks);
  const rid       = teamInfo.roster.roster_id;

  const rows = [];
  let totalPts = 0;
  let wins     = 0;
  let losses   = 0;

  for (let w = 0; w < completedWeeks; w++) {
    const weekArr = weeksData[w];
    if (!weekArr) continue;

    const myEntry  = weekArr.find((e) => Number(e.roster_id) === Number(rid));
    if (!myEntry) continue;

    // Find opponent (same matchup_id, different roster)
    const oppEntry = weekArr.find(
      (e) => e.matchup_id === myEntry.matchup_id && Number(e.roster_id) !== Number(rid)
    );

    const myPts  = myEntry.points  || 0;
    const oppPts = oppEntry?.points || 0;
    const won    = myPts > oppPts;

    if (won) wins++; else losses++;
    totalPts += myPts;

    const oppInfo = oppEntry ? (teamMap[Number(oppEntry.roster_id)] || {}) : {};
    rows.push({
      week: w + 1,
      pts: Math.round(myPts * 10) / 10,
      oppPts: Math.round(oppPts * 10) / 10,
      oppName: oppInfo.teamName || (oppEntry ? `Team ${oppEntry.roster_id}` : '—'),
      won,
    });
  }

  const avg = completedWeeks > 0 ? Math.round((totalPts / completedWeeks) * 10) / 10 : 0;
  const maxWk = rows.reduce((best, r) => (!best || r.pts > best.pts ? r : best), null);
  const minWk = rows.reduce((low,  r) => (!low  || r.pts < low.pts  ? r : low),  null);

  const lines = [
    `**${teamInfo.teamName}** (${teamInfo.ownerName}) — ${CURRENT_YEAR} Season Scores\n`,
    `Record: **${wins}-${losses}** | Total: **${Math.round(totalPts * 10) / 10} pts** | Avg: **${avg} pts/wk**`,
    maxWk ? `High:  Week ${maxWk.week} vs ${maxWk.oppName} — **${maxWk.pts}** pts` : '',
    minWk ? `Low:   Week ${minWk.week} vs ${minWk.oppName} — **${minWk.pts}** pts` : '',
    '',
  ];

  for (const r of rows) {
    const result = r.won ? '✅ W' : '❌ L';
    lines.push(`  Wk ${String(r.week).padStart(2)}: ${result} ${String(r.pts).padStart(6)} pts  vs  ${r.oppName} (${r.oppPts})`);
  }

  lines.push(`\n🔗 ${SITE_BASE_URL}/team/${rid}`);
  return lines.join('\n');
}

// ─── Free Agents ──────────────────────────────────────────────────────────────

export async function getFreeAgents(position) {
  const [rosters, playersData] = await Promise.all([
    fetchRosters(),
    Promise.resolve(loadPlayersData()),
  ]);

  // Build set of all rostered player IDs
  const rostered = new Set();
  for (const r of rosters) {
    for (const pid of r.players || []) rostered.add(pid);
  }

  const { map: ktcMap }       = loadKtcData();
  const { bySleeperId: fcById } = loadFantasyCalcData();

  // Collect all players with meaningful KTC values who are not rostered
  const freeAgents = [];
  const { map: ktcFull } = loadKtcData();

  for (const [normName, ktcEntry] of ktcFull) {
    if ((ktcEntry.ktcValue_tep || 0) < 1000) continue; // skip low-value players
    if (position && ktcEntry.position?.toUpperCase() !== position.toUpperCase()) continue;

    // Find the sleeper ID for this player
    let sleeperId = null;
    for (const [pid, p] of Object.entries(playersData)) {
      if (normalisePlayerName(getPlayerDisplayName(p)) === normName) {
        sleeperId = pid;
        break;
      }
    }

    if (sleeperId && !rostered.has(sleeperId)) {
      const fc = fcById.get(sleeperId);
      freeAgents.push({
        name:     ktcEntry.name,
        position: ktcEntry.position,
        nflTeam:  ktcEntry.nflTeam,
        ktcValue: ktcEntry.ktcValue_tep,
        ktcRank:  ktcEntry.rank_tep,
        fcValue:  fc?.value || null,
        age:      fc?.age   || null,
      });
    }
  }

  freeAgents.sort((a, b) => (b.ktcValue || 0) - (a.ktcValue || 0));
  const top = freeAgents.slice(0, 30);

  const posLabel = position ? `${position.toUpperCase()} ` : '';
  const lines = [`**Available ${posLabel}Free Agents — Hwang Dynasty ${CURRENT_YEAR}** (by KTC SF TE+)\n`];

  if (top.length === 0) {
    lines.push('No notable free agents found.');
  } else {
    for (let i = 0; i < top.length; i++) {
      const p = top[i];
      lines.push(
        `${String(i + 1).padStart(2)}. ${p.name} (${p.position}, ${p.nflTeam}) — KTC: ${fmt(p.ktcValue)}${p.fcValue ? ` | FC: ${fmt(p.fcValue)}` : ''}${p.age ? ` | age ${p.age}` : ''}`
      );
    }
  }

  return lines.join('\n');
}

// ─── Site Links ───────────────────────────────────────────────────────────────

export async function getSiteLink(page, params = {}) {
  const staticRoutes = {
    home:       '/home/',
    standings:  '/standings',
    playoffs:   '/yoffs',
    trades:     '/trades',
    h2h:        '/h2h',
    scenarios:  '/scenarios',
    notes:      '/notes',
  };

  const p = page.toLowerCase();

  if (p === 'scores') {
    const week = params.week || getCurrentNFLWeek();
    return `Week ${week} scores — 🔗 ${SITE_BASE_URL}/Scores/Week?week=${week}`;
  }

  if (p === 'team') {
    const [rosters, users] = await Promise.all([fetchRosters(), fetchUsers()]);
    const teamMap           = buildTeamMap(rosters, users);

    if (!params.team) {
      const lines = ['**Team Pages:**'];
      for (const [rid, info] of Object.entries(teamMap).sort((a, b) => Number(a[0]) - Number(b[0]))) {
        lines.push(`${info.teamName} (${info.ownerName}): 🔗 ${SITE_BASE_URL}/team/${rid}`);
      }
      return lines.join('\n');
    }

    const found = findTeam(teamMap, params.team, loadOwnerNames());
    if (!found) return `Team "${params.team}" not found.`;
    return `${found.teamName} (${found.ownerName}): 🔗 ${SITE_BASE_URL}/team/${found.roster.roster_id}`;
  }

  const path = staticRoutes[p];
  if (!path) {
    const available = [...Object.keys(staticRoutes), 'scores', 'team'].join(', ');
    return `Unknown page "${page}". Available pages: ${available}`;
  }

  return `🔗 ${SITE_BASE_URL}${path}`;
}

// ─── Scenario helpers ─────────────────────────────────────────────────────────

import { runScenario } from './scenarioEngine.js';

/**
 * Resolve a list of player name strings to Sleeper player IDs.
 * Returns { resolved: [{name, playerId}], unresolved: string[] }
 */
function resolvePlayerNames(names) {
  const resolved = [];
  const unresolved = [];
  for (const name of names) {
    const result = findPlayerByName(name);
    if (result) {
      resolved.push({ name: getPlayerDisplayName(result.player), playerId: result.playerId });
    } else {
      unresolved.push(name);
    }
  }
  return { resolved, unresolved };
}

/**
 * Fetch all data needed to run a scenario for a given season.
 * Returns { rosters, teamMap, weeksData, playersData } or throws.
 */
async function fetchScenarioData(season) {
  const [rosters, users, weeksData] = await Promise.all([
    fetchRosters(season),
    fetchUsers(season),
    fetchAllWeekScores(17, season),
  ]);
  const teamMap    = buildTeamMap(rosters, users);
  const playersData = loadPlayersData();

  // Build originalRosters map: { rosterId: string[] }
  const originalRosters = {};
  for (const r of rosters) {
    if (r && r.roster_id != null) {
      originalRosters[String(r.roster_id)] = Array.isArray(r.players) ? [...r.players] : [];
    }
  }

  return { rosters, teamMap, weeksData, playersData, originalRosters };
}

/** Format the standings comparison table for display. */
function formatScenarioResult(
  { originalStandings, scenarioStandings, origRegTotals, scenRegTotals },
  teamMap,
  season
) {
  const scenPlaceByRid = {};
  for (const r of scenarioStandings) scenPlaceByRid[r.rosterId] = r;

  const rows = originalStandings
    .slice()
    .sort((a, b) => a.place - b.place)
    .map((orig) => {
      const scen     = scenPlaceByRid[orig.rosterId] || {};
      const info     = teamMap[orig.rosterId] || {};
      const placeDiff = orig.place - (scen.place ?? orig.place);
      const ptsDiff   = Math.round(((scenRegTotals[orig.rosterId] || 0) - (origRegTotals[orig.rosterId] || 0)) * 10) / 10;
      return {
        origPlace:  orig.place,
        scenPlace:  scen.place ?? orig.place,
        teamName:   info.teamName  || `Team ${orig.rosterId}`,
        origPts:    origRegTotals[orig.rosterId] || 0,
        scenPts:    scenRegTotals[orig.rosterId] || 0,
        ptsDiff,
        placeDiff,
        isPlayoff:  orig.isPlayoff,
      };
    });

  const lines = [
    `**Scenario Standings — ${season} Season (Optimal Lineups)**\n`,
    `${'Place'.padEnd(6)} ${'Team'.padEnd(28)} ${'Orig Pts'.padEnd(10)} ${'Scen Pts'.padEnd(10)} ${'Δ Pts'.padEnd(8)} Δ Place`,
    '─'.repeat(72),
  ];

  for (const r of rows) {
    const arrow = r.placeDiff > 0 ? `▲${r.placeDiff}` : r.placeDiff < 0 ? `▼${Math.abs(r.placeDiff)}` : '—';
    const ptStr = r.ptsDiff === 0 ? '—' : `${r.ptsDiff > 0 ? '+' : ''}${r.ptsDiff}`;
    const playoff = r.origPlace <= 4 ? '🏆' : '  ';
    lines.push(
      `${playoff}${String(r.origPlace).padEnd(4)}  ${r.teamName.padEnd(28)} ` +
      `${String(r.origPts).padEnd(10)} ${String(r.scenPts).padEnd(10)} ${ptStr.padEnd(8)} ${arrow}`
    );
  }

  lines.push('');
  lines.push('*Pts = reg-season total (Wks 1–14), optimal starts. Playoff seeding reflects Wks 15–17.*');
  lines.push('*Free agents who were never rostered score 0 pts regardless of actual performance.*');
  lines.push(`\n🔗 ${SITE_BASE_URL}/scenarios`);
  return lines.join('\n');
}

// ─── Simulate trade reversal ──────────────────────────────────────────────────

export async function simulateTradeReversal(season, teamAQuery, playersAGave, teamBQuery, playersBGave) {
  const { rosters: _r, teamMap, weeksData, playersData, originalRosters } =
    await fetchScenarioData(season);

  const ownerNames = loadOwnerNames();
  const teamA = findTeam(teamMap, teamAQuery, ownerNames);
  const teamB = findTeam(teamMap, teamBQuery, ownerNames);

  if (!teamA) return `Team not found: "${teamAQuery}". Use get_all_teams to list teams.`;
  if (!teamB) return `Team not found: "${teamBQuery}". Use get_all_teams to list teams.`;

  const ridA = String(teamA.roster.roster_id);
  const ridB = String(teamB.roster.roster_id);

  // Resolve player names
  const { resolved: resolvedA, unresolved: unresolvedA } = resolvePlayerNames(playersAGave);
  const { resolved: resolvedB, unresolved: unresolvedB } = resolvePlayerNames(playersBGave);

  const warnings = [];
  if (unresolvedA.length) warnings.push(`Could not find: ${unresolvedA.join(', ')} (skipped)`);
  if (unresolvedB.length) warnings.push(`Could not find: ${unresolvedB.join(', ')} (skipped)`);

  // Build scenario rosters: deep-copy originals then swap players
  const scenarioRosters = {};
  for (const rid in originalRosters) scenarioRosters[rid] = [...originalRosters[rid]];

  // Reversal: team A gets back what they gave, team B gets back what they gave
  for (const { playerId } of resolvedA) {
    // Remove from team B (or wherever they currently are), add to team A
    for (const rid in scenarioRosters) {
      const idx = scenarioRosters[rid].indexOf(playerId);
      if (idx !== -1) { scenarioRosters[rid].splice(idx, 1); break; }
    }
    if (!scenarioRosters[ridA].includes(playerId)) scenarioRosters[ridA].push(playerId);
  }
  for (const { playerId } of resolvedB) {
    // Remove from team A (or wherever they currently are), add to team B
    for (const rid in scenarioRosters) {
      const idx = scenarioRosters[rid].indexOf(playerId);
      if (idx !== -1) { scenarioRosters[rid].splice(idx, 1); break; }
    }
    if (!scenarioRosters[ridB].includes(playerId)) scenarioRosters[ridB].push(playerId);
  }

  const result = runScenario(weeksData, originalRosters, scenarioRosters, playersData);

  const aGaveNames = resolvedA.map((p) => p.name).join(', ') || '—';
  const bGaveNames = resolvedB.map((p) => p.name).join(', ') || '—';

  const lines = [
    `**Trade Reversal Scenario — ${season} Season**\n`,
    `If this trade had never happened:`,
    `  ${teamA.teamName} keeps: **${aGaveNames}** (never traded away)`,
    `  ${teamB.teamName} keeps: **${bGaveNames}** (never traded away)`,
    '',
  ];

  if (warnings.length) {
    for (const w of warnings) lines.push(`⚠️  ${w}`);
    lines.push('');
  }

  lines.push(formatScenarioResult(result, teamMap, season));
  return lines.join('\n');
}

// ─── Simulate roster change ───────────────────────────────────────────────────

export async function simulateRosterChange(season, changes) {
  const { rosters: _r, teamMap, weeksData, playersData, originalRosters } =
    await fetchScenarioData(season);

  const ownerNames    = loadOwnerNames();
  const scenarioRosters = {};
  for (const rid in originalRosters) scenarioRosters[rid] = [...originalRosters[rid]];

  const appliedChanges = [];
  const warnings       = [];

  for (const change of changes) {
    const teamInfo = findTeam(teamMap, change.team, ownerNames);
    if (!teamInfo) {
      warnings.push(`Team not found: "${change.team}" — skipped`);
      continue;
    }
    const rid = String(teamInfo.roster.roster_id);

    const adds    = change.add    ? resolvePlayerNames(change.add)    : { resolved: [], unresolved: [] };
    const removes = change.remove ? resolvePlayerNames(change.remove) : { resolved: [], unresolved: [] };

    for (const { name, playerId } of adds.resolved) {
      // Remove from current team first
      for (const r in scenarioRosters) {
        const idx = scenarioRosters[r].indexOf(playerId);
        if (idx !== -1) { scenarioRosters[r].splice(idx, 1); break; }
      }
      if (!scenarioRosters[rid].includes(playerId)) scenarioRosters[rid].push(playerId);
      appliedChanges.push(`${teamInfo.teamName}: + ${name}`);
    }

    for (const { name, playerId } of removes.resolved) {
      const idx = scenarioRosters[rid].indexOf(playerId);
      if (idx !== -1) {
        scenarioRosters[rid].splice(idx, 1);
        appliedChanges.push(`${teamInfo.teamName}: − ${name}`);
      } else {
        warnings.push(`${name} not found on ${teamInfo.teamName}'s roster — skipped`);
      }
    }

    for (const n of [...adds.unresolved, ...removes.unresolved]) {
      warnings.push(`Player not found: "${n}" — skipped`);
    }
  }

  if (appliedChanges.length === 0) {
    return 'No valid changes could be applied. Check team names and player names.';
  }

  const result = runScenario(weeksData, originalRosters, scenarioRosters, playersData);

  const lines = [`**Custom Roster Scenario — ${season} Season**\n`, 'Changes applied:'];
  for (const c of appliedChanges) lines.push(`  ${c}`);
  if (warnings.length) {
    lines.push('');
    for (const w of warnings) lines.push(`⚠️  ${w}`);
  }
  lines.push('');
  lines.push(formatScenarioResult(result, teamMap, season));
  return lines.join('\n');
}

// ─── Resolve Team Name ────────────────────────────────────────────────────────

export async function resolveTeam(query) {
  const [rosters, users] = await Promise.all([fetchRosters(), fetchUsers()]);
  const teamMap           = buildTeamMap(rosters, users);
  const ownerNames        = loadOwnerNames();
  const teamInfo          = findTeam(teamMap, query, ownerNames);

  if (!teamInfo) {
    // Show what names are registered so the clanker can help the user
    const registered = [];
    for (const [name, rid] of ownerNames) {
      const info = teamMap[rid] || {};
      registered.push(`"${name}" → ${info.teamName || `Roster #${rid}`} (${info.ownerName || rid})`);
    }
    const hint = registered.length
      ? `\nRegistered nicknames:\n${registered.map((r) => `  ${r}`).join('\n')}`
      : '\nNo nicknames registered yet — edit mcp/owner_names.txt to add them.';
    return `Could not resolve "${query}" to a team.${hint}`;
  }

  return (
    `"${query}" → **${teamInfo.teamName}** (${teamInfo.ownerName}), Roster #${teamInfo.roster.roster_id}\n` +
    `🔗 ${SITE_BASE_URL}/team/${teamInfo.roster.roster_id}`
  );
}

// ─── Historical Season Results ────────────────────────────────────────────────

export async function getHistoricalResults(season) {
  const seasonStr = String(season);
  console.error(`[getHistoricalResults] called with season="${seasonStr}"`);

  const leagueId = getLeagueIdForSeason(seasonStr);
  console.error(`[getHistoricalResults] leagueId for ${seasonStr}: ${leagueId}`);

  if (!leagueId) {
    const available = Object.keys(PREVIOUS_YEARS).sort().join(', ');
    console.error(`[getHistoricalResults] no league ID found. PREVIOUS_YEARS keys: ${available}`);
    return `No data available for season ${season}. Available historical seasons: ${available || 'none configured'}.`;
  }

  let rosters, users, weeksData;
  try {
    console.error(`[getHistoricalResults] fetching rosters for ${seasonStr}...`);
    rosters = await fetchRosters(seasonStr);
    console.error(`[getHistoricalResults] rosters OK — ${rosters?.length} entries`);
  } catch (err) {
    console.error(`[getHistoricalResults] fetchRosters FAILED:`, err.message);
    throw err;
  }
  try {
    console.error(`[getHistoricalResults] fetching users for ${seasonStr}...`);
    users = await fetchUsers(seasonStr);
    console.error(`[getHistoricalResults] users OK — ${users?.length} entries`);
  } catch (err) {
    console.error(`[getHistoricalResults] fetchUsers FAILED:`, err.message);
    throw err;
  }
  try {
    console.error(`[getHistoricalResults] fetching all 17 week scores for ${seasonStr}...`);
    weeksData = await fetchAllWeekScores(17, seasonStr);
    const nonNullWeeks = weeksData.filter(Boolean).length;
    console.error(`[getHistoricalResults] weeksData OK — ${nonNullWeeks}/17 weeks returned data`);
  } catch (err) {
    console.error(`[getHistoricalResults] fetchAllWeekScores FAILED:`, err.message);
    throw err;
  }

  const teamMap = buildTeamMap(rosters, users);
  const rosterIds = Object.keys(teamMap).map(Number);
  console.error(`[getHistoricalResults] teamMap built — ${rosterIds.length} rosters: ${rosterIds.join(', ')}`);

  function sumWeeks(rosterId, from1, to1) {
    let total = 0;
    for (let w = from1; w <= to1; w++) {
      const weekArr = weeksData[w - 1];
      if (!weekArr) continue;
      const entry = weekArr.find((e) => e && Number(e.roster_id) === Number(rosterId));
      if (entry) total += entry.points || 0;
    }
    return Math.round(total * 10) / 10;
  }

  // Regular season totals (weeks 1–14) used for playoff seeding
  const regTotals = {};
  for (const rid of rosterIds) regTotals[rid] = sumWeeks(rid, 1, 14);

  const seedOrder = rosterIds.slice().sort((a, b) => regTotals[b] - regTotals[a]);
  const seedMap = {};
  seedOrder.forEach((rid, i) => { seedMap[rid] = i + 1; });

  const top4   = seedOrder.slice(0, 4);
  const others = seedOrder.slice(4);

  // Full season totals (all 17 weeks)
  const fullTotals = {};
  for (const rid of rosterIds) fullTotals[rid] = sumWeeks(rid, 1, 17);

  const finalPlacement = {};
  const playoffLines = [];

  const is2024Format = seasonStr === '2024';

  if (is2024Format) {
    // 2024: cumulative weeks 15–17 determines placement
    const playoffTotals = {};
    for (const rid of top4) playoffTotals[rid] = sumWeeks(rid, 15, 17);

    const playoffSorted = top4.slice().sort((a, b) => playoffTotals[b] - playoffTotals[a]);
    playoffSorted.forEach((rid, i) => { finalPlacement[rid] = i + 1; });
    others.forEach((rid, i) => { finalPlacement[rid] = i + 5; });

    playoffLines.push('\n**Playoff Results (2024 — Cumulative Weeks 15–17)**\n');
    for (const rid of playoffSorted) {
      const info  = teamMap[rid] || {};
      const place = finalPlacement[rid];
      const medal = place === 1 ? '🏆 ' : place === 2 ? '🥈 ' : place === 3 ? '🥉 ' : '   ';
      playoffLines.push(`${medal}${place}. ${info.teamName} (${info.ownerName}) — ${playoffTotals[rid]} playoff pts`);
    }
  } else {
    // 2025+ bracket format: semis weeks 15–16, finals week 17 + buffer
    const [rid1, rid2, rid3, rid4] = top4;

    const semiTotals = {};
    for (const rid of top4) semiTotals[rid] = sumWeeks(rid, 15, 16);

    // Seed 1 vs 4, seed 2 vs 3 — lower seed wins ties
    const topWinner    = semiTotals[rid1] >= semiTotals[rid4] ? rid1 : rid4;
    const topLoser     = topWinner === rid1 ? rid4 : rid1;
    const bottomWinner = semiTotals[rid2] >= semiTotals[rid3] ? rid2 : rid3;
    const bottomLoser  = bottomWinner === rid2 ? rid3 : rid2;

    // Semis buffer: half the gap between the two finalists' semis totals
    const highSemi = Math.max(semiTotals[topWinner], semiTotals[bottomWinner]);
    const lowSemi  = Math.min(semiTotals[topWinner], semiTotals[bottomWinner]);
    const buffer   = highSemi > lowSemi ? Math.round(((highSemi - lowSemi) / 2) * 10) / 10 : 0;

    const finalsRaw = {};
    finalsRaw[topWinner]    = sumWeeks(topWinner,    17, 17);
    finalsRaw[bottomWinner] = sumWeeks(bottomWinner, 17, 17);

    const finalsEffective = { ...finalsRaw };
    if (buffer > 0) {
      const bufferRecipient = semiTotals[topWinner] > semiTotals[bottomWinner] ? topWinner : bottomWinner;
      finalsEffective[bufferRecipient] = Math.round((finalsEffective[bufferRecipient] + buffer) * 10) / 10;
    }

    const champion = finalsEffective[topWinner] >= finalsEffective[bottomWinner] ? topWinner : bottomWinner;
    const runnerUp = champion === topWinner ? bottomWinner : topWinner;
    const third    = semiTotals[topLoser] >= semiTotals[bottomLoser] ? topLoser : bottomLoser;
    const fourth   = third === topLoser ? bottomLoser : topLoser;

    finalPlacement[champion] = 1;
    finalPlacement[runnerUp] = 2;
    finalPlacement[third]    = 3;
    finalPlacement[fourth]   = 4;
    others.forEach((rid, i) => { finalPlacement[rid] = i + 5; });

    const tName = (rid) => (teamMap[rid] || {}).teamName || `Team ${rid}`;

    playoffLines.push('\n**Playoff Results (Bracket Format)**\n');
    playoffLines.push('*Semifinals (Weeks 15–16 cumulative):*');
    playoffLines.push(
      `  Seed 1 vs 4: ${tName(rid1)} (${semiTotals[rid1]}) vs ${tName(rid4)} (${semiTotals[rid4]}) → ${tName(topWinner)} advances`
    );
    playoffLines.push(
      `  Seed 2 vs 3: ${tName(rid2)} (${semiTotals[rid2]}) vs ${tName(rid3)} (${semiTotals[rid3]}) → ${tName(bottomWinner)} advances`
    );
    if (buffer > 0) {
      const bufferRecipient = semiTotals[topWinner] > semiTotals[bottomWinner] ? topWinner : bottomWinner;
      playoffLines.push(`\n*Semis Buffer:* ${tName(bufferRecipient)} enters finals with +${buffer} pts advantage`);
    }
    playoffLines.push(`\n*Finals (Week 17${buffer > 0 ? ' + buffer' : ''}):*`);
    playoffLines.push(
      `  ${tName(champion)}: ${finalsEffective[champion]} pts (raw: ${finalsRaw[champion]}) vs ` +
      `${tName(runnerUp)}: ${finalsEffective[runnerUp]} pts (raw: ${finalsRaw[runnerUp]})` +
      ` → 🏆 ${tName(champion)} wins`
    );
    playoffLines.push(`\n*3rd/4th Place (by semis total):*`);
    playoffLines.push(`  3rd: ${tName(third)} (${semiTotals[third]} semis pts)`);
    playoffLines.push(`  4th: ${tName(fourth)} (${semiTotals[fourth]} semis pts)`);
  }

  // Final output
  const allRids = [...rosterIds].sort((a, b) => (finalPlacement[a] || 99) - (finalPlacement[b] || 99));

  const lines = [
    `**Hwang Dynasty — ${season} Season Final Results**\n`,
    '**Regular Season Standings (Weeks 1–14):**',
  ];

  for (const rid of seedOrder) {
    const info     = teamMap[rid] || {};
    const seed     = seedMap[rid];
    const isTop4   = seed <= 4;
    const label    = isTop4 ? ` [Playoff Seed ${seed}]` : '';
    lines.push(`  ${seed}. ${info.teamName} (${info.ownerName})${label} — ${regTotals[rid]} reg-season pts`);
  }

  lines.push(...playoffLines);

  lines.push('\n**Final Standings:**');
  for (const rid of allRids) {
    const info  = teamMap[rid] || {};
    const place = finalPlacement[rid];
    const medal = place === 1 ? '🏆 ' : place === 2 ? '🥈 ' : place === 3 ? '🥉 ' : '   ';
    const seed  = seedMap[rid];
    const isTop4 = seed <= 4;
    const ptsSuffix = isTop4
      ? `reg: ${regTotals[rid]}, full 17-wk: ${fullTotals[rid]} pts`
      : `${regTotals[rid]} pts`;
    lines.push(`${medal}${place}. ${info.teamName} (${info.ownerName}) — ${ptsSuffix}`);
  }

  // Warn the AI if any team name looks like a Sleeper fallback placeholder
  const placeholderPattern = /^(Team (Owner \d+|\d+)|Owner \d+)$/;
  const hasPlaceholders = rosterIds.some((rid) => {
    const info = teamMap[rid] || {};
    return placeholderPattern.test(info.teamName) || placeholderPattern.test(info.ownerName);
  });
  if (hasPlaceholders) {
    lines.push(
      '\n⚠️  **Note:** One or more teams above have generic placeholder names (e.g. "Team Owner 2"). ' +
      'This means their real team name could not be resolved from the Sleeper API for this season. ' +
      'Call get_league_info to cross-reference the official champion history and resolve the correct team name before responding.'
    );
  }

  lines.push(`\n🔗 ${SITE_BASE_URL}/standings?year=${season}`);
  const output = lines.join('\n');
  console.error(`[getHistoricalResults] returning ${output.length} chars for season ${season}`);
  return output;
}

// ─── League Info ──────────────────────────────────────────────────────────────

export function getLeagueInfo() {
  const infoPath = join(__dirname, '..', 'league_info.md');
  try {
    return readFileSync(infoPath, 'utf8');
  } catch {
    return 'league_info.md not found. Create mcp/league_info.md to add league context.';
  }
}
