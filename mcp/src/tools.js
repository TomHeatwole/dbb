import { CURRENT_YEAR, SITE_BASE_URL } from './config.js';
import {
  fetchRosters, fetchUsers, fetchMatchups, fetchTransactions,
  fetchTrendingPlayers, fetchAllWeekScores,
} from './sleeperApi.js';
import {
  loadPlayersData, loadKtcData, loadFantasyCalcData, loadFfbData,
  findPlayerByName,
} from './dataLoader.js';
import {
  getCurrentNFLWeek, getCompletedWeeksCount, normalisePlayerName,
  buildTeamMap, getPlayerDisplayName, lookupKtc, fmt, fmtDate, findTeam,
} from './helpers.js';

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

  const teamInfo = findTeam(teamMap, teamQuery);
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

// ─── Evaluate Trade ───────────────────────────────────────────────────────────

export async function evaluateTrade(giving, receiving) {
  const { map: ktcMap } = loadKtcData();

  function resolvePlayer(name) {
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

export async function getRecentTrades(weeksBack) {
  const lookback    = Math.min(Math.max(weeksBack || 4, 1), 17);
  const currentWeek = getCurrentNFLWeek();
  const completedWeeks = getCompletedWeeksCount();

  if (completedWeeks === 0) {
    return `The ${CURRENT_YEAR} season hasn't started yet — no trades to show.`;
  }

  const [rosters, users] = await Promise.all([fetchRosters(), fetchUsers()]);
  const teamMap           = buildTeamMap(rosters, users);
  const playersData       = loadPlayersData();

  const startWeek = Math.max(1, currentWeek - lookback + 1);
  const weekNums  = Array.from({ length: currentWeek - startWeek + 1 }, (_, i) => startWeek + i);

  const allTransactions = (
    await Promise.all(weekNums.map((w) => fetchTransactions(w).catch(() => [])))
  ).flat();

  const trades = allTransactions
    .filter((t) => t?.type === 'trade' && t?.status === 'complete')
    .sort((a, b) => (b.created || 0) - (a.created || 0));

  if (trades.length === 0) {
    return `No completed trades found in the last ${lookback} week(s).`;
  }

  const lines = [`**Recent Trades — Hwang Dynasty ${CURRENT_YEAR} (last ${lookback} week(s))**\n`];

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
  const teamInfo          = findTeam(teamMap, teamQuery);

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

    const found = findTeam(teamMap, params.team);
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
