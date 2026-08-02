import { CURRENT_YEAR, SITE_BASE_URL, PREVIOUS_YEARS, getLeagueIdForSeason } from './config.mjs';
import {
  fetchRosters, fetchUsers, fetchMatchups, fetchTransactions,
  fetchTrendingPlayers, fetchAllWeekScores,
} from './sleeperApi.mjs';
import {
  loadPlayersData, loadKtcData, loadFantasyCalcData, loadFfbData,
  findPlayerByName, loadSeasonStats,
} from './dataLoader.mjs';
import {
  getCurrentNFLWeek, getCompletedWeeksCount, normalisePlayerName,
  buildTeamMap, getPlayerDisplayName, lookupKtc, fmt, fmtDate, findTeam,
} from './helpers.mjs';
import { runScenarioEval } from './scenarioEngine.mjs';
import {
  VALUE_SOURCES, VALUE_SOURCE_LABELS,
  getValueLookups, lookupValueEntry, evaluateKtcStyleTrade,
} from './values.mjs';
import { prepareSimContext, runSeasonSim, DEFAULT_ITERATIONS } from './simEngine.mjs';
import { loadSimulationInputs } from './simData.mjs';

// ── Link helpers ─────────────────────────────────────────────────────────────

/** Markdown link to a team's page. */
function teamLink(teamName, rosterId) {
  return `[${teamName}](${SITE_BASE_URL}/team/${rosterId})`;
}

/**
 * Encode a scenario into a shareable site URL.
 * Mirrors scenarioEncoding.js (using Buffer instead of btoa for Node.js).
 */
function buildScenarioUrl(season, originalRosters, scenarioRosters) {
  const changes = [];
  for (const rid in originalRosters) {
    const orig    = new Set(originalRosters[rid] || []);
    const curr    = scenarioRosters[rid] || [];
    const currSet = new Set(curr);
    const added   = curr.filter(pid => !orig.has(pid));
    const removed = [...orig].filter(pid => !currSet.has(pid));
    if (added.length || removed.length) {
      changes.push({ r: Number(rid), a: added, d: removed });
    }
  }
  const encoded = Buffer.from(JSON.stringify({ y: String(season), c: changes })).toString('base64');
  return `${SITE_BASE_URL}/scenarios?state=eval&scenario=${encoded}`;
}

// ─── Standings ────────────────────────────────────────────────────────────────

export async function getStandings(season) {
  const yr = season ? String(season) : CURRENT_YEAR;
  const completedWeeks = getCompletedWeeksCount(yr);
  if (completedWeeks === 0) {
    return `The ${yr} season hasn't started yet — no completed weeks.`;
  }

  const [rosters, users, weeksData] = await Promise.all([
    fetchRosters(yr),
    fetchUsers(yr),
    fetchAllWeekScores(completedWeeks, yr),
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
    `**Hwang Dynasty Standings — ${yr} Season (through Week ${completedWeeks})**\n`,
  ];
  for (const s of standings) {
    lines.push(`${s.place}. ${teamLink(s.teamName, s.roster_id)} (${s.ownerName}) — ${s.points} pts`);
  }
  lines.push(`\n[View full standings](${SITE_BASE_URL}/standings)`);
  return lines.join('\n');
}

// ─── Weekly Scores ────────────────────────────────────────────────────────────

export async function getWeeklyScores(week, season) {
  const yr = season ? String(season) : CURRENT_YEAR;
  const [rosters, users, weekData] = await Promise.all([
    fetchRosters(yr),
    fetchUsers(yr),
    fetchMatchups(week, yr).catch(() => null),
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

  const lines = [`**Hwang Dynasty — Week ${week} Scores (${yr} Season)**\n`];
  for (const [, teams] of Object.entries(matchups).sort()) {
    if (teams.length < 2) continue;
    const [a, b] = teams.sort((x, y) => (y.points || 0) - (x.points || 0));
    const aInfo  = teamMap[Number(a.roster_id)] || {};
    const bInfo  = teamMap[Number(b.roster_id)] || {};
    const aLink  = teamLink(aInfo.teamName || `Team ${a.roster_id}`, a.roster_id);
    const bLink  = teamLink(bInfo.teamName || `Team ${b.roster_id}`, b.roster_id);
    lines.push(`🏆 ${aLink}: **${a.points ?? '—'}**  vs  ${bLink}: ${b.points ?? '—'}`);
  }

  lines.push(`\n[View Week ${week} scores](${SITE_BASE_URL}/Scores/Week?week=${week}&year=${yr})`);
  return lines.join('\n');
}

// ─── Team Roster ──────────────────────────────────────────────────────────────

export async function getRoster(teamQuery, season) {
  const yr = season ? String(season) : CURRENT_YEAR;
  const [rosters, users] = await Promise.all([fetchRosters(yr), fetchUsers(yr)]);
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

  const rid = teamInfo.roster.roster_id;
  const lines = [`**${teamLink(teamInfo.teamName, rid)}** (${teamInfo.ownerName}) — Roster\n`];
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

  return lines.join('\n');
}

// ─── All Teams ────────────────────────────────────────────────────────────────

export async function getAllTeams(season) {
  const yr = season ? String(season) : CURRENT_YEAR;
  const [rosters, users] = await Promise.all([fetchRosters(yr), fetchUsers(yr)]);
  const teamMap = buildTeamMap(rosters, users);

  const lines = [`**Hwang Dynasty ${yr} — All Teams**\n`];
  for (const [rid, info] of Object.entries(teamMap).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const playerCount = info.roster.players?.length || 0;
    lines.push(`Roster #${rid}: **${teamLink(info.teamName, rid)}** (${info.ownerName}) — ${playerCount} players`);
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

// ─── Draft pick resolution ────────────────────────────────────────────────────

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

function resolvePick(name, ktcMap) {
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

// ─── Compare Players ──────────────────────────────────────────────────────────

export async function comparePlayers(names) {
  const { map: ktcMap }                   = loadKtcData();
  const { bySleeperId: fcById, byName: fcByName } = loadFantasyCalcData();
  const { bySleeperId: ffbById, byName: ffbByName } = loadFfbData();

  const rows = names.map((name) => {
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

// ─── Evaluate Trade ───────────────────────────────────────────────────────────

const CROSS_CHECK_SOURCES = [
  'ktc_sf_tep',
  'hwang_market_value',
  'hwang_true_value',
  'competitor_adjusted',
  'rebuilder_adjusted',
];

/**
 * Resolve one trade asset (player or pick) in a given value source.
 * Picks are always valued off the KTC pick board regardless of source.
 */
function resolveAssetForSource(name, source, ktcMap) {
  const pick = resolvePick(name, ktcMap);
  if (pick) {
    return { label: pick.label, value: pick.value, position: 'PICK', found: true, isPick: true };
  }

  const result = findPlayerByName(name);
  if (!result) return { label: name, value: 0, position: null, found: false, isPick: false };

  const displayName = getPlayerDisplayName(result.player);
  const pos = result.player.position || '';
  const entry = lookupValueEntry(displayName, source, { position: pos });
  return {
    label: displayName,
    value: entry?.value || 0,
    position: pos,
    posRank: entry?.posRank || null,
    found: true,
    isPick: false,
  };
}

// Appended to every value-heavy tool output. The model tends to quote whatever
// labels sit next to the numbers, so the translation reminder has to live HERE,
// not just in the system prompt.
const VALUE_CONFIDENTIALITY_NOTE =
  '\n⚠️ INTERNAL DATA — model names ("Hwang True", "Hwang Market", "Competitor Adjusted", ' +
  '"Rebuild Adjusted") and their value numbers are for YOUR reasoning only. NEVER repeat them ' +
  'to the user — not even unlabeled ("my numbers have him at 2,260" is a leak). Express internal ' +
  'values ONLY as: a percentage vs. the public KTC number ("about 10% lower through a win-now ' +
  'lens"), a rank/tier, or a pick equivalent. Public KTC/FantasyCalc figures ARE fine to cite ' +
  'by name and number.';

/**
 * Evaluate a trade with the Hwang value engine.
 *
 * @param {string[]} giving
 * @param {string[]} receiving
 * @param {string} [valueSource='hwang_true_value']  One of VALUE_SOURCES.
 */
export async function evaluateTrade(giving, receiving, valueSource) {
  const source = VALUE_SOURCES.includes(valueSource) ? valueSource : 'hwang_true_value';
  const { map: ktcMap } = loadKtcData();
  getValueLookups(); // warm cache

  const givingSide = giving.map((n) => resolveAssetForSource(n, source, ktcMap));
  const receivingSide = receiving.map((n) => resolveAssetForSource(n, source, ktcMap));

  const givingTotal = givingSide.reduce((s, p) => s + p.value, 0);
  const receivingTotal = receivingSide.reduce((s, p) => s + p.value, 0);

  // KTC-style value adjustment: consolidation credit for the stud side in
  // uneven-count packages, judged by nonlinear raw scores.
  const va = evaluateKtcStyleTrade(
    givingSide.map((p) => p.value),
    receivingSide.map((p) => p.value),
  );
  const adjGiving = givingTotal + (va.adjustmentForA || 0);
  const adjReceiving = receivingTotal + (va.adjustmentForB || 0);
  const diff = adjReceiving - adjGiving;
  const pct = adjGiving > 0 ? Math.round((diff / adjGiving) * 100) : 0;

  let verdict;
  if (va.isEven || Math.abs(pct) <= 5) {
    verdict = '⚖️  Roughly even trade';
  } else if (va.rawWinner === 'B') {
    verdict = `✅ You WIN this trade (+${fmt(Math.abs(diff))} value-adjusted, +${pct}%)`;
  } else {
    verdict = `❌ You LOSE this trade (−${fmt(Math.abs(diff))} value-adjusted, ${pct}%)`;
  }

  const lines = [`**Trade Evaluator — ${VALUE_SOURCE_LABELS[source]} Values**\n`];

  lines.push('**You give:**');
  for (const p of givingSide) {
    lines.push(`  ${p.found ? `${p.label}${p.posRank ? ` (${p.position}${p.posRank})` : ''} — ${fmt(p.value)}` : `❓ ${p.label} (not found)`}`);
  }
  if (va.adjustmentForA > 0) lines.push(`  Value Adjustment (consolidation credit) — ${fmt(va.adjustmentForA)}`);
  lines.push(`  Total: **${fmt(adjGiving)}**\n`);

  lines.push('**You receive:**');
  for (const p of receivingSide) {
    lines.push(`  ${p.found ? `${p.label}${p.posRank ? ` (${p.position}${p.posRank})` : ''} — ${fmt(p.value)}` : `❓ ${p.label} (not found)`}`);
  }
  if (va.adjustmentForB > 0) lines.push(`  Value Adjustment (consolidation credit) — ${fmt(va.adjustmentForB)}`);
  lines.push(`  Total: **${fmt(adjReceiving)}**\n`);

  lines.push(verdict);

  // Cross-source totals so the verdict can be sanity-checked against other models
  lines.push('\n**Totals across value models** (give → receive):');
  for (const src of CROSS_CHECK_SOURCES) {
    const g = giving.map((n) => resolveAssetForSource(n, src, ktcMap)).reduce((s, p) => s + p.value, 0);
    const r = receiving.map((n) => resolveAssetForSource(n, src, ktcMap)).reduce((s, p) => s + p.value, 0);
    const marker = src === source ? ' ← primary' : '';
    const lean = g === r ? 'even' : (r > g ? 'receive side' : 'give side');
    lines.push(`  ${VALUE_SOURCE_LABELS[src].padEnd(16)} ${fmt(g)} → ${fmt(r)}  (favors ${lean})${marker}`);
  }

  lines.push('\n*Draft picks are valued off the KTC pick board in every model. Competitor/Rebuild models only make sense from one team\'s perspective — use the model matching the asking team\'s timeline.*');
  lines.push(VALUE_CONFIDENTIALITY_NOTE);

  return lines.join('\n');
}

// ─── Player Value Breakdown ───────────────────────────────────────────────────

/**
 * Full multi-model value profile for one player — the atomic unit of any
 * value argument.
 */
export function getPlayerValueBreakdown(name) {
  const result = findPlayerByName(name);
  if (!result) {
    return `Player "${name}" not found. Try a full name like "Justin Jefferson".`;
  }

  const { playerId, player } = result;
  const displayName = getPlayerDisplayName(player);
  const pos = player.position || '?';
  const nflTeam = player.team || 'FA';

  const { bySleeperId: fcById, byName: fcByName } = loadFantasyCalcData();
  const fc = fcById.get(playerId) || fcByName.get(normalisePlayerName(displayName));

  getValueLookups();

  const lines = [
    `**${displayName}** | ${pos} | ${nflTeam}${fc?.age ? ` | Age ${fc.age}` : ''}`,
    '',
    '**Value across all models:**',
  ];

  let anyFound = false;
  for (const src of VALUE_SOURCES) {
    const entry = lookupValueEntry(displayName, src, { position: pos });
    if (!entry) continue;
    anyFound = true;
    const rankStr = entry.posRank ? ` — ${entry.position || pos}${entry.posRank}, #${entry.overallRank} overall` : '';
    lines.push(`  ${VALUE_SOURCE_LABELS[src].padEnd(20)} ${fmt(entry.value)}${rankStr}`);
  }
  if (!anyFound) {
    lines.push('  No value data found in any model — likely a deep bench / undrafted player.');
  }

  if (fc?.trend30day) {
    lines.push(`\n30-day market trend: ${fc.trend30day > 0 ? '+' : ''}${fc.trend30day} (FantasyCalc)`);
  }

  lines.push('\n*Hwang Market/True apply positional multipliers to stitched KTC (TE+ for TEs, SF for others). Competitor/Rebuild reweight for win-now vs long-term timelines. Use search_player for league ownership.*');
  lines.push(VALUE_CONFIDENTIALITY_NOTE);
  return lines.join('\n');
}

// ─── Team Value Summary ───────────────────────────────────────────────────────

async function computeRosterValueTotals(playerIds, playersData) {
  const totals = { hwang_true_value: 0, ktc_sf_tep: 0, competitor_adjusted: 0, rebuilder_adjusted: 0 };
  const rows = [];
  const { bySleeperId: fcById } = loadFantasyCalcData();

  for (const pid of playerIds) {
    const p = playersData[pid];
    if (!p) continue;
    const name = getPlayerDisplayName(p);
    const pos = p.position || '?';
    const row = { name, position: pos, age: fcById.get(pid)?.age || null };
    for (const src of Object.keys(totals)) {
      const entry = lookupValueEntry(name, src, { position: pos });
      row[src] = entry?.value || 0;
      totals[src] += row[src];
    }
    rows.push(row);
  }
  return { totals, rows };
}

/**
 * Roster construction report: value totals across models, positional breakdown,
 * age profile, and a competitor-vs-rebuilder lean — with league-wide context.
 */
export async function getTeamValueSummary(teamQuery) {
  const [rosters, users] = await Promise.all([fetchRosters(), fetchUsers()]);
  const teamMap = buildTeamMap(rosters, users);
  const teamInfo = findTeam(teamMap, teamQuery);

  if (!teamInfo) {
    const allTeams = Object.values(teamMap).map((t) => `"${t.teamName}" (${t.ownerName})`).join(', ');
    return `Team not found for "${teamQuery}". Available: ${allTeams}`;
  }

  const playersData = loadPlayersData();
  getValueLookups();

  // League-wide totals for context
  const leagueRows = [];
  for (const [rid, info] of Object.entries(teamMap)) {
    const { totals } = await computeRosterValueTotals(info.roster.players || [], playersData);
    leagueRows.push({ rid: Number(rid), teamName: info.teamName, ownerName: info.ownerName, ...totals });
  }
  leagueRows.sort((a, b) => b.hwang_true_value - a.hwang_true_value);

  const rid = teamInfo.roster.roster_id;
  const mine = leagueRows.find((r) => r.rid === rid);
  const myRank = leagueRows.indexOf(mine) + 1;

  const { rows } = await computeRosterValueTotals(teamInfo.roster.players || [], playersData);

  // Positional breakdown by Hwang True value
  const byPos = { QB: [], RB: [], WR: [], TE: [] };
  for (const row of rows) {
    if (byPos[row.position]) byPos[row.position].push(row);
  }

  // Value-weighted average age
  let ageWeightSum = 0;
  let weightSum = 0;
  for (const row of rows) {
    if (row.age && row.hwang_true_value > 0) {
      ageWeightSum += row.age * row.hwang_true_value;
      weightSum += row.hwang_true_value;
    }
  }
  const weightedAge = weightSum > 0 ? (ageWeightSum / weightSum).toFixed(1) : null;

  // Competitor vs rebuilder lean
  const comp = mine.competitor_adjusted;
  const reb = mine.rebuilder_adjusted;
  const leanPct = (comp + reb) > 0 ? Math.round(((comp - reb) / ((comp + reb) / 2)) * 100) : 0;
  const leanLabel = leanPct > 5 ? 'WIN-NOW build' : leanPct < -5 ? 'REBUILD-tilted assets' : 'balanced timeline';

  const lines = [
    `**${teamLink(teamInfo.teamName, rid)}** (${teamInfo.ownerName}) — Roster Construction Report\n`,
    `Total value rank: **#${myRank} of ${leagueRows.length}** by Hwang True value`,
    `  Hwang True:      ${fmt(mine.hwang_true_value)}`,
    `  KTC SF TE+:      ${fmt(mine.ktc_sf_tep)}`,
    `  Competitor Adj:  ${fmt(mine.competitor_adjusted)}`,
    `  Rebuild Adj:     ${fmt(mine.rebuilder_adjusted)}`,
    `Timeline lean: **${leanLabel}** (competitor vs rebuild value: ${leanPct > 0 ? '+' : ''}${leanPct}%)`,
    weightedAge ? `Value-weighted roster age: **${weightedAge}**` : '',
    '',
    '**Positional breakdown (Hwang True):**',
  ];

  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const group = byPos[pos].sort((a, b) => b.hwang_true_value - a.hwang_true_value);
    const posTotal = group.reduce((s, r) => s + r.hwang_true_value, 0);
    const top = group.slice(0, 4)
      .filter((r) => r.hwang_true_value > 0)
      .map((r) => `${r.name} ${fmt(r.hwang_true_value)}${r.age ? ` (${r.age})` : ''}`)
      .join(', ');
    lines.push(`  ${pos}: **${fmt(posTotal)}** — ${top || 'no valued assets'}`);
  }

  lines.push('', '**League value board (Hwang True):**');
  leagueRows.forEach((r, i) => {
    const marker = r.rid === rid ? ' ◄' : '';
    lines.push(`  ${i + 1}. ${r.teamName} (${r.ownerName}) — ${fmt(r.hwang_true_value)}${marker}`);
  });
  lines.push(VALUE_CONFIDENTIALITY_NOTE);

  return lines.join('\n');
}

// ─── Season Odds (Monte Carlo) ────────────────────────────────────────────────

let seasonOddsCache = null; // { key, ts, output }
const SEASON_ODDS_TTL_MS = 15 * 60 * 1000;

function buildRosterMapFromSleeper(rosters) {
  const map = {};
  for (const r of rosters) {
    if (r?.roster_id != null) map[Number(r.roster_id)] = [...(r.players || [])];
  }
  return map;
}

function formatOddsTable(results, teamMap, deltasById = null) {
  const lines = [];
  results.forEach((row, i) => {
    const info = teamMap[row.rosterId] || {};
    const name = info.teamName || `Team ${row.rosterId}`;
    let deltaStr = '';
    if (deltasById) {
      const d = deltasById[row.rosterId];
      if (d && Math.abs(d.winPctDelta) >= 0.05) {
        deltaStr = ` (title ${d.winPctDelta > 0 ? '+' : ''}${d.winPctDelta.toFixed(1)}pp)`;
      }
    }
    lines.push(
      `  ${String(i + 1).padStart(2)}. ${name} (${info.ownerName || '?'}) — ` +
      `title ${row.winPct.toFixed(1)}% | playoffs ${row.playoffPct.toFixed(1)}% | ` +
      `top-3 ${row.top3Pct.toFixed(1)}% | avg finish ${row.avgFinish.toFixed(1)} | ` +
      `avg pts ${Math.round(row.avgTotalScore).toLocaleString()}${deltaStr}`
    );
  });
  return lines;
}

function countUnrankedByTeam(rosterMap, hwangAdpRankMap, playersData) {
  const counts = {};
  for (const [rid, pids] of Object.entries(rosterMap)) {
    let n = 0;
    for (const pid of pids) {
      const pos = (playersData[pid]?.position || '').toUpperCase();
      if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
      if (!hwangAdpRankMap[pid]) n += 1;
    }
    counts[rid] = n;
  }
  return counts;
}

/**
 * Baseline Monte Carlo championship odds for the current season.
 */
export async function getSeasonOdds(iterations) {
  const iters = Math.max(250, Math.min(3000, Math.round(Number(iterations) || DEFAULT_ITERATIONS)));

  const [rosters, users] = await Promise.all([fetchRosters(), fetchUsers()]);
  const teamMap = buildTeamMap(rosters, users);
  const rosterMap = buildRosterMapFromSleeper(rosters);

  const cacheKey = `${iters}:${JSON.stringify(rosterMap)}`;
  if (seasonOddsCache && seasonOddsCache.key === cacheKey
      && Date.now() - seasonOddsCache.ts < SEASON_ODDS_TTL_MS) {
    return seasonOddsCache.output;
  }

  const inputs = await loadSimulationInputs();
  const ctx = prepareSimContext({
    scenarioRosters: rosterMap,
    hwangAdpRankMap: inputs.hwangAdpRankMap,
    catalog: inputs.catalog,
    positionMaxRanks: inputs.positionMaxRanks,
    basePointsByYear: inputs.basePointsByYear,
    playersData: inputs.playersData,
  });
  const { results, iterations: ran } = runSeasonSim(ctx, iters);

  const lines = [
    `**${CURRENT_YEAR} Season Simulation — ${ran.toLocaleString()} Monte Carlo runs**`,
    '*(Each run rolls a season outcome for every player from historical seasons of players drafted at a similar ADP, then scores optimal best-ball lineups for all 17 weeks. Top 4 regular-season scores make the playoffs; best weeks 15–17 total wins the title.)*',
    '',
  ];
  lines.push(...formatOddsTable(results, teamMap));

  const unranked = countUnrankedByTeam(rosterMap, inputs.hwangAdpRankMap, inputs.playersData);
  const totalUnranked = Object.values(unranked).reduce((s, n) => s + n, 0);
  if (totalUnranked > 0) {
    lines.push('', `*Note: ${totalUnranked} rostered skill players league-wide have no draft-capital projection and contribute 0 in simulations (deep bench/undrafted types).*`);
  }

  const output = lines.join('\n');
  seasonOddsCache = { key: cacheKey, ts: Date.now(), output };
  return output;
}

/**
 * Delta simulation: how do championship odds change if rosters are modified?
 * Baseline and scenario are scored with identical player-outcome rolls each
 * iteration, so the deltas isolate the roster change itself.
 *
 * @param {Object} params
 * @param {Array}  params.changes    [{ team, add: [names], drop: [names] }]
 * @param {number} [params.iterations]
 */
export async function simulateRosterChangeOdds({ changes = [], iterations }) {
  const iters = Math.max(250, Math.min(3000, Math.round(Number(iterations) || DEFAULT_ITERATIONS)));

  const [rosters, users] = await Promise.all([fetchRosters(), fetchUsers()]);
  const teamMap = buildTeamMap(rosters, users);
  const baselineRosters = buildRosterMapFromSleeper(rosters);
  const playersData = loadPlayersData();
  const inputs = await loadSimulationInputs();

  const scenarioRosters = {};
  for (const [rid, pids] of Object.entries(baselineRosters)) scenarioRosters[rid] = [...pids];

  const warnings = [];
  const appliedChanges = [];
  const modifiedRids = new Set();

  for (const change of changes) {
    const teamInfo = findTeam(teamMap, change.team || '');
    if (!teamInfo) {
      const available = Object.values(teamMap).map((t) => `"${t.teamName}"`).join(', ');
      warnings.push(`⚠️  Team not found: "${change.team}". Available: ${available}`);
      continue;
    }
    const rid = teamInfo.roster.roster_id;
    modifiedRids.add(rid);
    const added = [];
    const dropped = [];

    for (const playerName of (change.add || [])) {
      const found = findPlayerByName(playerName);
      if (!found) { warnings.push(`⚠️  Player not found: "${playerName}" — skipped.`); continue; }
      const pid = found.playerId;
      if (!scenarioRosters[rid].includes(pid)) scenarioRosters[rid].push(pid);
      const displayName = getPlayerDisplayName(found.player);
      added.push(displayName);
      if (!inputs.hwangAdpRankMap[pid]) {
        warnings.push(`⚠️  ${displayName} has no draft-capital projection this season — he contributes 0 points in the simulation, so his real impact is understated.`);
      }
    }
    for (const playerName of (change.drop || [])) {
      const found = findPlayerByName(playerName);
      if (!found) { warnings.push(`⚠️  Player not found: "${playerName}" — skipped.`); continue; }
      const pid = found.playerId;
      scenarioRosters[rid] = scenarioRosters[rid].filter((id) => id !== pid);
      dropped.push(getPlayerDisplayName(found.player));
    }

    const parts = [];
    if (added.length) parts.push(`+${added.join(', +')}`);
    if (dropped.length) parts.push(`−${dropped.join(', −')}`);
    if (parts.length) appliedChanges.push(`  ${teamInfo.teamName} (${teamInfo.ownerName}): ${parts.join('  ')}`);
  }

  if (appliedChanges.length === 0) {
    return ['No valid roster changes to simulate.', ...warnings].join('\n');
  }

  const ctx = prepareSimContext({
    scenarioRosters,
    baselineRosters,
    hwangAdpRankMap: inputs.hwangAdpRankMap,
    catalog: inputs.catalog,
    positionMaxRanks: inputs.positionMaxRanks,
    basePointsByYear: inputs.basePointsByYear,
    playersData: inputs.playersData,
  });
  const { results, baselineResults, iterations: ran } = runSeasonSim(ctx, iters);

  const baseById = {};
  for (const row of (baselineResults || [])) baseById[row.rosterId] = row;
  const deltasById = {};
  for (const row of results) {
    const base = baseById[row.rosterId];
    if (!base) continue;
    deltasById[row.rosterId] = {
      winPctDelta: row.winPct - base.winPct,
      playoffPctDelta: row.playoffPct - base.playoffPct,
      avgFinishDelta: row.avgFinish - base.avgFinish,
      avgTotalScoreDelta: row.avgTotalScore - base.avgTotalScore,
    };
  }

  const lines = [
    `**${CURRENT_YEAR} Season Delta Simulation — ${ran.toLocaleString()} paired Monte Carlo runs**`,
    '*(Baseline vs modified rosters scored with identical player-outcome rolls — deltas isolate the roster change.)*',
    '',
    '**Changes applied:**',
    ...appliedChanges,
  ];
  if (warnings.length) {
    lines.push('', ...warnings);
  }

  lines.push('', '**Impact on modified teams:**');
  for (const rid of modifiedRids) {
    const info = teamMap[rid] || {};
    const scen = results.find((r) => r.rosterId === rid);
    const base = baseById[rid];
    const d = deltasById[rid];
    if (!scen || !base || !d) continue;
    lines.push(`  **${info.teamName}** (${info.ownerName})`);
    lines.push(`    Title odds:    ${base.winPct.toFixed(1)}% → ${scen.winPct.toFixed(1)}%  (${d.winPctDelta >= 0 ? '+' : ''}${d.winPctDelta.toFixed(1)}pp)`);
    lines.push(`    Playoff odds:  ${base.playoffPct.toFixed(1)}% → ${scen.playoffPct.toFixed(1)}%  (${d.playoffPctDelta >= 0 ? '+' : ''}${d.playoffPctDelta.toFixed(1)}pp)`);
    lines.push(`    Avg finish:    ${base.avgFinish.toFixed(1)} → ${scen.avgFinish.toFixed(1)}`);
    lines.push(`    Avg total pts: ${Math.round(base.avgTotalScore).toLocaleString()} → ${Math.round(scen.avgTotalScore).toLocaleString()}  (${d.avgTotalScoreDelta >= 0 ? '+' : ''}${Math.round(d.avgTotalScoreDelta)})`);
  }

  lines.push('', '**Full odds under the modified rosters:**');
  lines.push(...formatOddsTable(results, teamMap, deltasById));

  return lines.join('\n');
}

// ─── Draft Pick Lookup ────────────────────────────────────────────────────────

export function lookupDraftPick(name) {
  const { map: ktcMap, asOf } = loadKtcData();

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

  const lines = [
    `**${year} ${round} Draft Pick — KTC SF TE+ Values** *(as of ${asOf || 'recent'})*`,
    `*${year} draft = ${proximity}*`,
    '',
  ];

  if (tierKey) {
    const tier  = PICK_TIER_MAP[tierKey];
    const entry = ktcMap.get(normalisePlayerName(`${year} ${tier} ${round}`));
    if (!entry) {
      return `No KTC data found for "${year} ${tier} ${round}". The pick may be beyond available data.`;
    }
    lines.push(`  **${entry.name}** — KTC: ${fmt(entry.ktcValue_tep)} (Overall #${entry.rank_tep || '?'})`);
  } else {
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
  if (isOffseason)       seasonLabel = `${yr} Offseason`;
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
      const tName    = info.teamName || `Team ${rid}`;
      const received = [
        ...side.players,
        ...side.picks,
        side.faab ? `$${side.faab} FAAB` : null,
      ].filter(Boolean);
      lines.push(`  **${teamLink(tName, rid)}** receives: ${received.length ? received.join(', ') : '—'}`);
    }
    lines.push('');
  }

  lines.push(`[View all trades](${SITE_BASE_URL}/trades)`);
  return lines.join('\n');
}

// ─── Team Season Scores ───────────────────────────────────────────────────────

export async function getTeamScores(teamQuery, season) {
  const yr = season ? String(season) : CURRENT_YEAR;
  const [rosters, users] = await Promise.all([fetchRosters(yr), fetchUsers(yr)]);
  const teamMap           = buildTeamMap(rosters, users);
  const teamInfo          = findTeam(teamMap, teamQuery);

  if (!teamInfo) {
    const all = Object.values(teamMap).map((t) => `"${t.teamName}"`).join(', ');
    return `Team not found for "${teamQuery}" in ${yr}. Available: ${all}`;
  }

  const completedWeeks = getCompletedWeeksCount(yr);
  if (completedWeeks === 0) {
    return `The ${yr} season hasn't started yet.`;
  }

  const weeksData = await fetchAllWeekScores(completedWeeks, yr);
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
    `**${teamLink(teamInfo.teamName, rid)}** (${teamInfo.ownerName}) — ${yr} Season Scores\n`,
    `Record: **${wins}-${losses}** | Total: **${Math.round(totalPts * 10) / 10} pts** | Avg: **${avg} pts/wk**`,
    maxWk ? `High:  Week ${maxWk.week} vs ${maxWk.oppName} — **${maxWk.pts}** pts` : '',
    minWk ? `Low:   Week ${minWk.week} vs ${minWk.oppName} — **${minWk.pts}** pts` : '',
    '',
  ];

  for (const r of rows) {
    const result = r.won ? '✅ W' : '❌ L';
    lines.push(`  Wk ${String(r.week).padStart(2)}: ${result} ${String(r.pts).padStart(6)} pts  vs  ${r.oppName} (${r.oppPts})`);
  }

  return lines.join('\n');
}

// ─── Player Season Stats ──────────────────────────────────────────────────────

export function getPlayerStats(name, season) {
  const result = findPlayerByName(name);
  if (!result) {
    return `Player "${name}" not found. Try a full name like "Justin Jefferson".`;
  }

  const { player } = result;
  const displayName = getPlayerDisplayName(player);
  const pos = (player.position || '').toUpperCase();

  // Default to most recent complete season when none is specified
  const yr = season ? String(season) : String(parseInt(CURRENT_YEAR) - 1);

  const statsMap = loadSeasonStats(yr);
  if (!statsMap) {
    return `No stats data available for the ${yr} season.`;
  }

  // Try exact normalized match, then fall back to partial
  const normDisplay = normalisePlayerName(displayName);
  let statsRow = statsMap.get(normDisplay);

  if (!statsRow) {
    for (const [key, row] of statsMap) {
      if (key.includes(normDisplay) || normDisplay.includes(key)) {
        statsRow = row;
        break;
      }
    }
  }

  if (!statsRow) {
    return `No ${yr} regular season stats found for ${displayName}. They may not have played or recorded stats that season.`;
  }

  const gi = (col) => parseInt(statsRow[col])  || 0;
  const gf = (col) => parseFloat(statsRow[col]) || 0;

  const games   = gi('games');
  const nflTeam = statsRow.recent_team || '?';
  const fp      = gf('fantasy_points'); // standard 0-PPR scoring

  const lines = [
    `**${displayName}** — ${yr} NFL Regular Season Stats`,
    `Position: ${pos} | Team: ${nflTeam} | Games Played: ${games}`,
    '',
  ];

  if (pos === 'QB') {
    const cmp  = gi('completions');
    const att  = gi('attempts');
    const pyds = gi('passing_yards');
    const ptds = gi('passing_tds');
    const ints = gi('passing_interceptions');
    const cars = gi('carries');
    const ryds = gi('rushing_yards');
    const rtds = gi('rushing_tds');
    const pct  = att > 0 ? ((cmp / att) * 100).toFixed(1) : '—';
    lines.push(`**Passing:** ${cmp}/${att} (${pct}%), ${pyds.toLocaleString()} yds, ${ptds} TD, ${ints} INT`);
    lines.push(`**Rushing:** ${cars} car, ${ryds} yds, ${rtds} TD`);
  } else if (pos === 'RB') {
    const cars   = gi('carries');
    const ryds   = gi('rushing_yards');
    const rtds   = gi('rushing_tds');
    const rec    = gi('receptions');
    const tgts   = gi('targets');
    const rcvyds = gi('receiving_yards');
    const rcvtds = gi('receiving_tds');
    const ypc    = cars > 0 ? (ryds / cars).toFixed(1) : '—';
    lines.push(`**Rushing:** ${cars} car, ${ryds} yds, ${rtds} TD (${ypc} YPC)`);
    lines.push(`**Receiving:** ${rec} rec / ${tgts} tgt, ${rcvyds} yds, ${rcvtds} TD`);
  } else if (pos === 'WR' || pos === 'TE') {
    const rec    = gi('receptions');
    const tgts   = gi('targets');
    const rcvyds = gi('receiving_yards');
    const rcvtds = gi('receiving_tds');
    const tshare = gf('target_share');
    lines.push(`**Receiving:** ${rec} rec / ${tgts} tgt, ${rcvyds} yds, ${rcvtds} TD`);
    if (tshare > 0) lines.push(`Target share: ${(tshare * 100).toFixed(1)}%`);
  }

  lines.push('');

  if (pos === 'TE') {
    const tepPts = fp + gi('receptions') * 0.5;
    lines.push(`**Fantasy Pts (0 PPR standard):** ${fp.toFixed(1)}  |  **With TEP (+0.5/rec):** ${tepPts.toFixed(1)}`);
    if (games > 0) lines.push(`Per game (with TEP): ${(tepPts / games).toFixed(1)} pts/game`);
  } else {
    lines.push(`**Fantasy Pts (0 PPR standard):** ${fp.toFixed(1)}`);
    if (games > 0) lines.push(`Per game: ${(fp / games).toFixed(1)} pts/game`);
  }

  return lines.join('\n');
}

// ─── Free Agents ──────────────────────────────────────────────────────────────

export async function getFreeAgents(position) {
  const [rosters, playersData] = await Promise.all([
    fetchRosters(),
    Promise.resolve(loadPlayersData()),
  ]);

  // Build set of all rostered player IDs — checked by ID only, no name matching
  const rostered = new Set();
  for (const r of rosters) {
    for (const pid of r.players || []) rostered.add(pid);
  }

  const { map: ktcMap }                      = loadKtcData();
  const { bySleeperId: fcById, byName: fcByName } = loadFantasyCalcData();

  // Iterate from Sleeper's player universe so roster membership is a pure ID check.
  // Name matching is only used for value enrichment (KTC/FC lookup), where a miss
  // is a benign false negative — never a false positive rostered player slipping through.
  const freeAgents = [];

  for (const [pid, player] of Object.entries(playersData)) {
    const pos = (player.position || '').toUpperCase();
    if (!['QB', 'RB', 'WR', 'TE', 'K'].includes(pos)) continue;
    if (position && pos !== position.toUpperCase()) continue;

    // Pure ID-based roster check — completely independent of name normalisation
    if (rostered.has(pid)) continue;

    // Enrich with KTC value via name lookup
    const displayName = getPlayerDisplayName(player);
    const normName    = normalisePlayerName(displayName);
    const ktc         = ktcMap.get(normName);
    if (!ktc || (ktc.ktcValue_tep || 0) < 1000) continue;

    // Prefer Sleeper ID for FC lookup, fall back to name
    const fc = fcById.get(pid) || fcByName.get(normName);

    freeAgents.push({
      name:     ktc.name,
      position: ktc.position || pos,
      nflTeam:  ktc.nflTeam  || player.team || 'FA',
      ktcValue: ktc.ktcValue_tep,
      ktcRank:  ktc.rank_tep,
      fcValue:  fc?.value || null,
      age:      fc?.age   || null,
    });
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

// ─── Scenario Simulator ───────────────────────────────────────────────────────

/**
 * Simulate "what if" roster changes for a completed season.
 *
 * @param {object} params
 * @param {number|string} params.season   Season year (e.g. 2024 or 2025)
 * @param {Array}  params.changes         Array of { team, add, drop }
 *   team  — team or owner name
 *   add   — array of player names to add to that team
 *   drop  — array of player names to drop from that team
 */
export async function runScenario({ season, changes = [] }) {
  const yr = season ? String(season) : CURRENT_YEAR;
  const completedWeeks = getCompletedWeeksCount(yr);

  if (completedWeeks === 0) {
    return `The ${yr} season hasn't started yet — no data to run a scenario against.`;
  }

  const [rosters, users, weeksData] = await Promise.all([
    fetchRosters(yr),
    fetchUsers(yr),
    fetchAllWeekScores(Math.min(completedWeeks, 17), yr),
  ]);

  const teamMap   = buildTeamMap(rosters, users);
  const playersData = loadPlayersData();

  // Build original rosters map { rosterId: [playerIds] }
  const originalRosters = {};
  for (const r of rosters) {
    originalRosters[r.roster_id] = r.players || [];
  }

  // Parse and validate each change
  const appliedChanges = [];
  const warnings = [];

  const scenarioRosters = {};
  for (const [rid, playerIds] of Object.entries(originalRosters)) {
    scenarioRosters[rid] = [...playerIds];
  }

  for (const change of changes) {
    const teamInfo = findTeam(teamMap, change.team || '');
    if (!teamInfo) {
      const available = Object.values(teamMap).map(t => `"${t.teamName}"`).join(', ');
      warnings.push(`⚠️  Team not found: "${change.team}". Available: ${available}`);
      continue;
    }

    const rid = teamInfo.roster.roster_id;
    const teamLabel = `${teamInfo.teamName} (${teamInfo.ownerName})`;

    const addedNames = [];
    const droppedNames = [];

    // Process adds
    for (const playerName of (change.add || [])) {
      const found = findPlayerByName(playerName);
      if (!found) {
        warnings.push(`⚠️  Player not found: "${playerName}" — skipped.`);
        continue;
      }
      const pid = found.playerId;
      if (!scenarioRosters[rid].includes(pid)) {
        scenarioRosters[rid] = [...scenarioRosters[rid], pid];
      }
      addedNames.push(getPlayerDisplayName(found.player));
    }

    // Process drops
    for (const playerName of (change.drop || [])) {
      const found = findPlayerByName(playerName);
      if (!found) {
        warnings.push(`⚠️  Player not found: "${playerName}" — skipped.`);
        continue;
      }
      const pid = found.playerId;
      scenarioRosters[rid] = scenarioRosters[rid].filter(id => id !== pid);
      droppedNames.push(getPlayerDisplayName(found.player));
    }

    if (addedNames.length > 0 || droppedNames.length > 0) {
      const parts = [];
      if (addedNames.length)   parts.push(`+${addedNames.join(', +')}`);
      if (droppedNames.length) parts.push(`−${droppedNames.join(', −')}`);
      appliedChanges.push(`  ${teamLabel}: ${parts.join('  ')}`);
    }
  }

  // Run the engine
  const { originalStandings, scenarioStandings, teamDeltas } =
    runScenarioEval(weeksData, originalRosters, scenarioRosters, playersData);

  // Build a lookup from rosterId → scenario standings row for easy reference
  const scenRowById = {};
  for (const r of scenarioStandings) scenRowById[r.rosterId] = r;

  // Generate a shareable scenario URL
  const scenarioUrl = buildScenarioUrl(yr, originalRosters, scenarioRosters);

  // Track which roster IDs were modified
  const modifiedRids = new Set();
  for (const change of changes) {
    const teamInfo = findTeam(teamMap, change.team || '');
    if (teamInfo) modifiedRids.add(teamInfo.roster.roster_id);
  }

  // Format output as markdown
  const lines = [
    `**Hwang Dynasty Scenario Simulator — ${yr} Season**`,
    `*(Optimal lineups — best possible roster each week for all 17 weeks)*\n`,
  ];

  if (appliedChanges.length > 0) {
    lines.push('**Roster Changes Applied:**');
    lines.push(...appliedChanges);
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push(...warnings);
    lines.push('');
  }

  lines.push('**Standings Comparison** (Original → Scenario)\n');

  const sortedOrig = [...originalStandings].sort((a, b) => a.place - b.place);
  for (const origRow of sortedOrig) {
    const rid     = origRow.rosterId;
    const info    = teamMap[rid] || {};
    const tName   = info.teamName || `Team ${rid}`;
    const owner   = info.ownerName || '?';
    const delta   = teamDeltas.find(d => d.rosterId === rid) || {};
    const scenRow = scenRowById[rid] || {};

    const dPts    = delta.regSeasonDelta ?? 0;
    const dPlace  = delta.placeDelta ?? 0;

    const dPtsStr   = dPts === 0 ? '' : ` **(${dPts > 0 ? '+' : ''}${dPts} pts)**`;
    const dPlaceStr = dPlace === 0 ? '' : ` **(${dPlace > 0 ? `↑${dPlace}` : `↓${Math.abs(dPlace)}`})**`;

    const origPlay = origRow.isPlayoff ? '✅' : '❌';
    const scenPlay = scenRow.isPlayoff ? '✅' : '❌';
    const playStr  = origPlay === scenPlay ? origPlay : `${origPlay}→${scenPlay}`;

    const isModified = modifiedRids.has(rid);
    const modMarker  = isModified ? ' ✱' : '';

    const origPts = origRow.regSeasonTotal;
    const scenPts = scenRow.regSeasonTotal ?? '—';
    const ptStr   = origPts === scenPts ? `${origPts} pts` : `${origPts} → ${scenPts} pts`;

    lines.push(
      `${origRow.place}. **${teamLink(tName, rid)}**${modMarker} (${owner}) — ${ptStr}${dPtsStr}${dPlaceStr} ${playStr}`
    );
  }

  lines.push('');
  lines.push('*(✱ = modified team. Scores based on optimal lineups, not actual manager decisions.)*');
  lines.push(`\n[View this scenario interactively](${scenarioUrl})`);

  return lines.join('\n');
}

// ─── Historical Season Results ────────────────────────────────────────────────

export async function getHistoricalResults(season) {
  const seasonStr = String(season);

  if (!getLeagueIdForSeason(seasonStr)) {
    const available = Object.keys(PREVIOUS_YEARS).sort().join(', ');
    return `No data available for season ${season}. Available historical seasons: ${available || 'none configured'}.`;
  }

  const [rosters, users, weeksData] = await Promise.all([
    fetchRosters(seasonStr),
    fetchUsers(seasonStr),
    fetchAllWeekScores(17, seasonStr),
  ]);
  const teamMap  = buildTeamMap(rosters, users);
  const rosterIds = Object.keys(teamMap).map(Number);

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
  const seedMap   = {};
  seedOrder.forEach((rid, i) => { seedMap[rid] = i + 1; });

  const top4   = seedOrder.slice(0, 4);
  const others = seedOrder.slice(4);

  // Full season totals (all 17 weeks)
  const fullTotals = {};
  for (const rid of rosterIds) fullTotals[rid] = sumWeeks(rid, 1, 17);

  const finalPlacement = {};
  const playoffLines   = [];
  const tName = (rid) => (teamMap[rid] || {}).teamName || `Team ${rid}`;
  const tLink = (rid) => teamLink(tName(rid), rid);

  const is2024Format = seasonStr === '2024';

  if (is2024Format) {
    // 2024: cumulative weeks 15–17 determines placement
    const playoffTotals = {};
    for (const rid of top4) playoffTotals[rid] = sumWeeks(rid, 15, 17);

    const playoffSorted = top4.slice().sort((a, b) => playoffTotals[b] - playoffTotals[a]);
    playoffSorted.forEach((rid, i) => { finalPlacement[rid] = i + 1; });
    others.forEach((rid, i)        => { finalPlacement[rid] = i + 5; });

    playoffLines.push('\n**Playoff Results (2024 — Cumulative Weeks 15–17)**\n');
    for (const rid of playoffSorted) {
      const info  = teamMap[rid] || {};
      const place = finalPlacement[rid];
      const medal = place === 1 ? '🏆 ' : place === 2 ? '🥈 ' : place === 3 ? '🥉 ' : '   ';
      playoffLines.push(`${medal}${place}. ${teamLink(info.teamName || `Team ${rid}`, rid)} (${info.ownerName || `Owner ${rid}`}) — ${playoffTotals[rid]} playoff pts`);
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
      const bufRec = semiTotals[topWinner] > semiTotals[bottomWinner] ? topWinner : bottomWinner;
      finalsEffective[bufRec] = Math.round((finalsEffective[bufRec] + buffer) * 10) / 10;
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

    playoffLines.push('\n**Playoff Results (Bracket Format)**\n');
    playoffLines.push('*Semifinals (Weeks 15–16 cumulative):*');
    playoffLines.push(`  Seed 1 vs 4: ${tLink(rid1)} (${semiTotals[rid1]}) vs ${tLink(rid4)} (${semiTotals[rid4]}) → ${tName(topWinner)} advances`);
    playoffLines.push(`  Seed 2 vs 3: ${tLink(rid2)} (${semiTotals[rid2]}) vs ${tLink(rid3)} (${semiTotals[rid3]}) → ${tName(bottomWinner)} advances`);
    if (buffer > 0) {
      const bufRec = semiTotals[topWinner] > semiTotals[bottomWinner] ? topWinner : bottomWinner;
      playoffLines.push(`\n*Semis Buffer:* ${tName(bufRec)} enters finals with +${buffer} pts advantage`);
    }
    playoffLines.push(`\n*Finals (Week 17${buffer > 0 ? ' + buffer' : ''}):*`);
    playoffLines.push(
      `  ${tLink(champion)}: ${finalsEffective[champion]} pts (raw: ${finalsRaw[champion]}) vs ` +
      `${tLink(runnerUp)}: ${finalsEffective[runnerUp]} pts (raw: ${finalsRaw[runnerUp]})` +
      ` → 🏆 ${tName(champion)} wins`
    );
    playoffLines.push(`\n*3rd/4th Place (by semis total):*`);
    playoffLines.push(`  3rd: ${tLink(third)} (${semiTotals[third]} semis pts)`);
    playoffLines.push(`  4th: ${tLink(fourth)} (${semiTotals[fourth]} semis pts)`);
  }

  // Assemble output
  const allRids = [...rosterIds].sort((a, b) => (finalPlacement[a] || 99) - (finalPlacement[b] || 99));

  const lines = [
    `**Hwang Dynasty — ${season} Season Final Results**\n`,
    '**Regular Season Standings (Weeks 1–14):**',
  ];

  for (const rid of seedOrder) {
    const info   = teamMap[rid] || {};
    const seed   = seedMap[rid];
    const label  = seed <= 4 ? ` [Playoff Seed ${seed}]` : '';
    lines.push(`  ${seed}. ${teamLink(info.teamName || `Team ${rid}`, rid)} (${info.ownerName || `Owner ${rid}`})${label} — ${regTotals[rid]} reg-season pts`);
  }

  lines.push(...playoffLines);

  lines.push('\n**Final Standings:**');
  for (const rid of allRids) {
    const info   = teamMap[rid] || {};
    const place  = finalPlacement[rid];
    const medal  = place === 1 ? '🏆 ' : place === 2 ? '🥈 ' : place === 3 ? '🥉 ' : '   ';
    const seed   = seedMap[rid];
    const ptsSuffix = seed <= 4
      ? `reg: ${regTotals[rid]}, full 17-wk: ${fullTotals[rid]} pts`
      : `${regTotals[rid]} pts`;
    lines.push(`${medal}${place}. ${teamLink(info.teamName || `Team ${rid}`, rid)} (${info.ownerName || `Owner ${rid}`}) — ${ptsSuffix}`);
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

  lines.push(`\n[View standings](${SITE_BASE_URL}/standings?year=${season})`);
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
        lines.push(`${teamLink(info.teamName, rid)} (${info.ownerName})`);
      }
      return lines.join('\n');
    }

    const found = findTeam(teamMap, params.team);
    if (!found) return `Team "${params.team}" not found.`;
    return `${teamLink(found.teamName, found.roster.roster_id)} (${found.ownerName})`;
  }

  const path = staticRoutes[p];
  if (!path) {
    const available = [...Object.keys(staticRoutes), 'scores', 'team'].join(', ');
    return `Unknown page "${page}". Available pages: ${available}`;
  }

  return `🔗 ${SITE_BASE_URL}${path}`;
}
