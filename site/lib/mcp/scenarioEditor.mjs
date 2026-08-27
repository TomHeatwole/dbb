/**
 * Natural-language scenario roster editor.
 *
 * The model extracts intent (trade / add / drop / move / reset); this module
 * resolves player names against the CURRENT scenario snapshot and infers
 * which teams are involved from ownership. That way "Trade Chase for Puka"
 * swaps them even if the model never names the teams.
 */

const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

function normalisePlayerName(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPlayerDisplayName(player) {
  if (!player) return 'Unknown';
  return (
    player.full_name ||
    `${player.first_name || ''} ${player.last_name || ''}`.trim() ||
    'Unknown'
  );
}

function asArray(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.filter((v) => v != null && String(v).trim() !== '').map(String);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        return asArray(JSON.parse(trimmed));
      } catch {
        // fall through
      }
    }
    return trimmed.split(/\s*(?:,|&| and )\s*/i).map((s) => s.trim()).filter(Boolean);
  }
  return [String(value)];
}

function cloneRosters(rosters) {
  const out = {};
  for (const rid of Object.keys(rosters || {})) {
    out[String(rid)] = (rosters[rid] || []).map(String);
  }
  return out;
}

function playerName(player, fallbackId) {
  return getPlayerDisplayName(player) || `Player ${fallbackId}`;
}

function firstNamesCompatible(nameA, nameB) {
  const a = normalisePlayerName(nameA).split(' ')[0] || '';
  const b = normalisePlayerName(nameB).split(' ')[0] || '';
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const limit = Math.min(a.length, b.length);
  let shared = 0;
  while (shared < limit && a[shared] === b[shared]) shared += 1;
  return shared >= 3;
}

function buildRosteredIndex(rosters, playersData) {
  const list = [];
  const byId = new Map();
  for (const [rid, pids] of Object.entries(rosters || {})) {
    for (const pid of pids || []) {
      const id = String(pid);
      const p = playersData?.[id];
      const entry = {
        playerId: id,
        name: p ? playerName(p, id) : id,
        position: p?.position || '',
        rosterId: String(rid),
      };
      list.push(entry);
      byId.set(id, entry);
    }
  }
  return { list, byId };
}

function uniqueTeam(resolvedPlayers, label) {
  const rids = [...new Set(resolvedPlayers.map((p) => p.rosterId).filter(Boolean))];
  if (rids.length > 1) {
    return {
      error: `${label} are on different teams — split that into separate moves.`,
    };
  }
  return { rosterId: rids[0] || null };
}

/**
 * Resolve a player name, preferring people currently on the scenario rosters
 * (so "Jamar Chase" hits Ja'Marr even with the missing apostrophe-r, and
 * "Puka" hits Puka Nacua when he's rostered).
 */
export function resolvePlayerName(searchName, { rosters, playersData }) {
  const raw = String(searchName || '').trim();
  if (!raw) return { error: 'Empty player name.' };

  const { list: rostered } = buildRosteredIndex(rosters, playersData);
  const normSearch = normalisePlayerName(raw);
  const tokens = normSearch.split(' ').filter(Boolean);
  const lastSearch = tokens[tokens.length - 1] || '';
  const firstSearch = tokens[0] || '';

  const exact = rostered.filter((p) => normalisePlayerName(p.name) === normSearch);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    return { error: `"${raw}" is ambiguous (${exact.map((p) => p.name).join(', ')}). Use a full name.` };
  }

  if (tokens.length >= 2 && lastSearch) {
    const compat = rostered.filter((p) => {
      const n = normalisePlayerName(p.name);
      return n.split(' ').pop() === lastSearch && firstNamesCompatible(raw, p.name);
    });
    if (compat.length === 1) return compat[0];
    if (compat.length > 1) {
      return { error: `"${raw}" is ambiguous (${compat.map((p) => p.name).join(', ')}). Use a full name.` };
    }
  }

  if (tokens.length === 1) {
    const firstExact = rostered.filter((p) => normalisePlayerName(p.name).split(' ')[0] === firstSearch);
    const lastExact = rostered.filter((p) => normalisePlayerName(p.name).split(' ').pop() === lastSearch);
    const union = [];
    const seen = new Set();
    for (const p of [...firstExact, ...lastExact]) {
      if (seen.has(p.playerId)) continue;
      seen.add(p.playerId);
      union.push(p);
    }
    if (union.length === 1) return union[0];
    if (union.length > 1) {
      return { error: `"${raw}" is ambiguous (${union.map((p) => p.name).join(', ')}). Use a full name.` };
    }
    const includes = rostered.filter((p) => normalisePlayerName(p.name).includes(normSearch));
    if (includes.length === 1) return includes[0];
    if (includes.length > 1) {
      return { error: `"${raw}" is ambiguous (${includes.map((p) => p.name).join(', ')}). Use a full name.` };
    }
  }

  // Global fallback for free agents / unrostered players.
  let best = null;
  let bestScore = -1;
  let tied = false;
  for (const [pid, p] of Object.entries(playersData || {})) {
    const pos = p?.position || '';
    if (!SKILL_POSITIONS.has(pos)) continue;
    const normName = normalisePlayerName(
      p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    );
    if (!normName) continue;
    let score = 0;
    if (normName === normSearch) score = 10;
    else if (tokens.length >= 2 && firstNamesCompatible(raw, normName) && normName.split(' ').pop() === lastSearch) score = 8;
    else if (normName.startsWith(normSearch) || normSearch.startsWith(normName)) score = 6;
    else if (normName.includes(normSearch) || (normSearch.length >= 6 && normSearch.includes(normName))) score = 4;
    if (score > bestScore) {
      bestScore = score;
      best = { playerId: String(pid), name: playerName(p, pid), position: pos, rosterId: null };
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }
  if (best && bestScore >= 6 && !tied) {
    const owned = rostered.find((p) => p.playerId === best.playerId);
    return owned || best;
  }
  if (tied && bestScore >= 6) {
    return { error: `"${raw}" is ambiguous. Use a full name.` };
  }
  return { error: `Player not found: "${raw}".` };
}

function teamAliases(team) {
  return (team?.aliases || [])
    .map((a) => String(a || '').trim().toLowerCase())
    .filter(Boolean);
}

function teamSearchKeys(team) {
  const owner = String(team?.ownerName || '').trim();
  const ownerFirst = owner.split(/\s+/)[0] || '';
  return [
    String(team?.teamName || '').toLowerCase(),
    owner.toLowerCase(),
    ownerFirst.length >= 3 ? ownerFirst.toLowerCase() : '',
    ...teamAliases(team),
  ].filter(Boolean);
}

/**
 * Attach first-name / nickname aliases from owner_names.txt onto team objects.
 * Aliases are keyed by roster ID, matching the MCP HwangAI owner map.
 */
export function applyOwnerAliases(teams, ownerNamesMap) {
  if (!Array.isArray(teams)) return [];
  const byRid = new Map();
  const add = (rid, name) => {
    const key = String(rid);
    const n = String(name || '').trim().toLowerCase();
    if (!n) return;
    if (!byRid.has(key)) byRid.set(key, []);
    byRid.get(key).push(n);
  };
  if (ownerNamesMap && typeof ownerNamesMap.forEach === 'function') {
    ownerNamesMap.forEach((value, key) => {
      if (Array.isArray(value)) {
        for (const name of value) add(key, name);
      } else {
        add(value, key);
      }
    });
  }
  return teams.map((t) => {
    const extra = byRid.get(String(t.rosterId)) || [];
    const ownerFirst = String(t.ownerName || '').trim().split(/\s+/)[0] || '';
    const firstAlias = ownerFirst.length >= 3 ? [ownerFirst.toLowerCase()] : [];
    const aliases = [...new Set([...teamAliases(t), ...extra, ...firstAlias])];
    return { ...t, aliases };
  });
}

export function findScenarioTeam(teams, query) {
  if (query == null || String(query).trim() === '') return null;
  const q = String(query).trim().toLowerCase();
  const list = teams || [];

  for (const t of list) {
    if (String(t.rosterId) === String(query).trim()) return t;
  }

  const exact = list.filter((t) => teamSearchKeys(t).includes(q));
  if (exact.length === 1) return exact[0];

  const partial = list.filter((t) => {
    const keys = teamSearchKeys(t);
    return keys.some((k) => k.includes(q) || (k && q.includes(k)));
  });
  if (partial.length === 1) return partial[0];
  return null;
}

function netEdits(before, after) {
  const edits = [];
  const rids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const rid of rids) {
    const orig = new Set((before[rid] || []).map(String));
    const curr = (after[rid] || []).map(String);
    const currSet = new Set(curr);
    const added = curr.filter((pid) => !orig.has(pid));
    const removed = [...orig].filter((pid) => !currSet.has(pid));
    if (added.length || removed.length) {
      edits.push({ rosterId: Number(rid), add: added, drop: removed });
    }
  }
  return edits;
}

function formatTeamLabel(team) {
  if (!team) return 'Unknown team';
  const given = teamAliases(team)[0];
  const owner = team.ownerName;
  const name = team.teamName || owner || `Team ${team.rosterId}`;
  if (given && owner && given !== String(owner).toLowerCase()) {
    return `${name} (${given} / ${owner})`;
  }
  if (given) return `${name} (${given})`;
  if (owner && owner !== name) return `${name} (${owner})`;
  return name;
}

function teamById(teams, rid) {
  return (teams || []).find((t) => String(t.rosterId) === String(rid)) || { rosterId: rid, teamName: `Team ${rid}` };
}

function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return /^(true|1|yes)$/i.test(value.trim());
  return false;
}

function isFalseyFlag(value) {
  if (value === false || value === 0) return true;
  if (typeof value === 'string') return /^(false|0|no)$/i.test(value.trim());
  return false;
}

/** Copy instead of steal: keep the player on every team they already belong to. */
function wantsCopy(op) {
  if (!op || typeof op !== 'object') return false;
  if (isTruthyFlag(op.keep_on_other_teams) || isTruthyFlag(op.copy) || isTruthyFlag(op.duplicate) || isTruthyFlag(op.keep)) {
    return true;
  }
  if (isFalseyFlag(op.exclusive)) return true;
  return false;
}

function formatTradeDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Compact a Sleeper trade transaction into the shape the scenario editor uses.
 */
export function summarizeTrade(trade, playersData) {
  const data = playersData || {};
  const rosterIds = [...new Set((trade?.roster_ids || []).map((rid) => String(rid)))];
  const adds = trade?.adds || {};
  const drops = trade?.drops || {};
  const players = [];
  for (const [pid, toRid] of Object.entries(adds)) {
    const to = String(toRid);
    let from = drops[pid] != null ? String(drops[pid]) : null;
    if (!from && rosterIds.length === 2) {
      from = rosterIds.find((rid) => rid !== to) || null;
    }
    const p = data[String(pid)];
    players.push({
      playerId: String(pid),
      name: p ? playerName(p, pid) : `Player ${pid}`,
      fromRosterId: from,
      toRosterId: to,
    });
  }
  const picks = (trade?.draft_picks || [])
    .filter((pk) => pk && pk.owner_id != null)
    .map((pk) => `${pk.season} Rd ${pk.round}`);
  return {
    id: String(trade?.transaction_id || ''),
    created: Number(trade?.created) || 0,
    rosterIds,
    players,
    picks,
  };
}

function tradeInvolvesRosters(trade, rosterIds) {
  if (!rosterIds.length) return true;
  const involved = new Set((trade?.rosterIds || []).map(String));
  return rosterIds.every((rid) => involved.has(String(rid)));
}

function tradePlayerHintMatches(trade, hint) {
  const q = normalisePlayerName(hint);
  if (!q) return true;
  return (trade?.players || []).some((p) => {
    const name = normalisePlayerName(p.name);
    const id = String(p.playerId || '');
    return name === q || name.includes(q) || q.includes(name) || id === String(hint).trim();
  });
}

function tradeWouldChangeRosters(trade, rosters) {
  if (!rosters) return true;
  return (trade?.players || []).some((p) => {
    const dest = (rosters[String(p.toRosterId)] || rosters[p.toRosterId] || []).map(String);
    return dest.includes(String(p.playerId));
  });
}

/**
 * Pick the most recent listed trade that involves all of the named teams
 * (and optional player hint). Used for "reverse that trade between Mac and Aidan".
 * When current rosters are provided, prefer a trade that is still reflected
 * on those rosters so we don't no-op a later-season deal on an older snapshot.
 */
export function findMatchingScenarioTrade(trades, rosterIds, playerHint, rosters) {
  const matches = (trades || [])
    .filter((t) => tradeInvolvesRosters(t, rosterIds))
    .filter((t) => tradePlayerHintMatches(t, playerHint))
    .slice()
    .sort((a, b) => (b.created || 0) - (a.created || 0));
  if (rosters) {
    const live = matches.find((t) => tradeWouldChangeRosters(t, rosters));
    if (live) return live;
  }
  return matches[0] || null;
}

function formatTradeLine(trade, teams, index) {
  const date = formatTradeDate(trade.created);
  const byRid = {};
  for (const p of trade.players || []) {
    const rid = String(p.toRosterId);
    if (!byRid[rid]) byRid[rid] = [];
    byRid[rid].push(p.name);
  }
  const rids = [...new Set([
    ...(trade.rosterIds || []).map(String),
    ...Object.keys(byRid),
  ])];
  const parts = rids.map((rid) => {
    const received = byRid[rid] || [];
    return `${formatTeamLabel(teamById(teams, rid))} got ${received.length ? received.join(', ') : '—'}`;
  });
  const pickNote = (trade.picks || []).length ? ` (also ${trade.picks.join(', ')}; picks are ignored here)` : '';
  return `${index}. ${date ? `${date} — ` : ''}${parts.join('; ')}${pickNote}`;
}

/**
 * Apply model-extracted operations to a scenario snapshot.
 *
 * @returns {{
 *   ok: boolean,
 *   edits: Array<{ rosterId: number, add: string[], drop: string[] }>,
 *   reset?: boolean,
 *   summary: string,
 *   toolMessage: string,
 *   warnings: string[],
 * }}
 */
export function applyScenarioEditorOperations(operations, snapshot, playersData) {
  const data = playersData || {};
  const teams = snapshot?.teams || [];
  const warnings = [];
  const notes = [];

  let ops = operations;
  if (typeof ops === 'string') {
    try { ops = JSON.parse(ops); } catch { ops = []; }
  }
  if (ops && !Array.isArray(ops) && typeof ops === 'object') ops = [ops];
  if (!Array.isArray(ops) || ops.length === 0) {
    const msg = 'No roster operations were provided.';
    return { ok: false, edits: [], summary: msg, toolMessage: msg, warnings };
  }

  const before = cloneRosters(snapshot?.rosters);
  const working = cloneRosters(snapshot?.rosters);
  const original = cloneRosters(snapshot?.originalRosters || snapshot?.rosters);

  const ensureRoster = (rid) => {
    const key = String(rid);
    if (!working[key]) working[key] = [];
    return key;
  };

  const removeFromAll = (pid) => {
    const id = String(pid);
    for (const rid of Object.keys(working)) {
      if (working[rid].includes(id)) {
        working[rid] = working[rid].filter((p) => p !== id);
      }
    }
  };

  const addTo = (rid, pid, { exclusive = true } = {}) => {
    const key = ensureRoster(rid);
    const id = String(pid);
    if (exclusive) removeFromAll(id);
    if (!working[key].includes(id)) working[key].push(id);
  };

  const dropFrom = (rid, pid) => {
    const key = ensureRoster(rid);
    const id = String(pid);
    working[key] = working[key].filter((p) => p !== id);
  };

  const resolve = (name) => resolvePlayerName(name, { rosters: working, playersData: data });

  const resolveAll = (names, label) => {
    const resolved = [];
    for (const name of asArray(names)) {
      const found = resolve(name);
      if (found.error) {
        warnings.push(found.error);
        continue;
      }
      resolved.push(found);
    }
    if (names && asArray(names).length > 0 && resolved.length === 0) {
      warnings.push(`Could not resolve any players for ${label}.`);
    }
    return resolved;
  };

  const resolveTeam = (query, required) => {
    if (query == null || String(query).trim() === '') {
      if (required) warnings.push('A team name is required for that edit.');
      return null;
    }
    const team = findScenarioTeam(teams, query);
    if (!team) {
      const available = teams.map((t) => `"${formatTeamLabel(t)}"`).join(', ');
      warnings.push(`Team not found: "${query}". Available: ${available}`);
      return null;
    }
    return team;
  };

  let didReset = false;

  for (const rawOp of ops) {
    const op = rawOp && typeof rawOp === 'object' ? rawOp : {};
    const type = String(op.type || op.op || '').toLowerCase().trim();

    if (type === 'reset' || type === 'clear' || type === 'undo_all') {
      const team = op.team ? resolveTeam(op.team, false) : null;
      if (team) {
        const rid = String(team.rosterId);
        working[rid] = [...(original[rid] || [])];
        notes.push(`Reverted ${formatTeamLabel(team)} to the original roster.`);
      } else {
        for (const rid of Object.keys(original)) working[rid] = [...original[rid]];
        for (const rid of Object.keys(working)) {
          if (!(rid in original)) delete working[rid];
        }
        didReset = true;
        notes.push('Reset the scenario to the original rosters.');
      }
      continue;
    }

    if (type === 'trade' || type === 'swap') {
      const sideA = resolveAll(op.players_a || op.side_a || op.giving || op.playersA, 'side A');
      const sideB = resolveAll(op.players_b || op.side_b || op.receiving || op.playersB, 'side B');
      if (sideA.length === 0 && sideB.length === 0) continue;

      const teamA = uniqueTeam(sideA, 'Side A');
      const teamB = uniqueTeam(sideB, 'Side B');
      if (teamA.error) { warnings.push(teamA.error); continue; }
      if (teamB.error) { warnings.push(teamB.error); continue; }

      const ridA = teamA.rosterId;
      const ridB = teamB.rosterId;

      if (!ridA && !ridB) {
        warnings.push('None of those players are on a roster, so there is nothing to trade.');
        continue;
      }
      if (ridA && ridB && ridA === ridB) {
        warnings.push('Both sides of that trade are already on the same team.');
        continue;
      }

      // FA-for-rostered: the rostered side receives the FA(s) and drops its players.
      if (ridA && ridB) {
        for (const p of sideA) dropFrom(ridA, p.playerId);
        for (const p of sideB) dropFrom(ridB, p.playerId);
        for (const p of sideB) addTo(ridA, p.playerId);
        for (const p of sideA) addTo(ridB, p.playerId);
        notes.push(
          `Traded ${sideA.map((p) => p.name).join(', ')} (${formatTeamLabel(teamById(teams, ridA))})`
          + ` for ${sideB.map((p) => p.name).join(', ')} (${formatTeamLabel(teamById(teams, ridB))}).`,
        );
      } else if (ridA) {
        for (const p of sideA) dropFrom(ridA, p.playerId);
        for (const p of sideB) addTo(ridA, p.playerId);
        notes.push(
          `${formatTeamLabel(teamById(teams, ridA))} dropped ${sideA.map((p) => p.name).join(', ')}`
          + ` and added ${sideB.map((p) => p.name).join(', ')}.`,
        );
      } else {
        for (const p of sideB) dropFrom(ridB, p.playerId);
        for (const p of sideA) addTo(ridB, p.playerId);
        notes.push(
          `${formatTeamLabel(teamById(teams, ridB))} dropped ${sideB.map((p) => p.name).join(', ')}`
          + ` and added ${sideA.map((p) => p.name).join(', ')}.`,
        );
      }
      continue;
    }

    if (type === 'add' || type === 'give' || type === 'copy') {
      const team = resolveTeam(op.team || op.to_team || op.toTeam, true);
      const players = resolveAll(op.players || op.player || op.add, 'add');
      if (!team || players.length === 0) continue;
      const exclusive = type === 'copy' ? false : !wantsCopy(op);
      for (const p of players) addTo(team.rosterId, p.playerId, { exclusive });
      if (exclusive) {
        notes.push(`Added ${players.map((p) => p.name).join(', ')} to ${formatTeamLabel(team)}.`);
      } else {
        notes.push(
          `Copied ${players.map((p) => p.name).join(', ')} onto ${formatTeamLabel(team)}`
          + ` without removing them from other rosters.`,
        );
      }
      continue;
    }

    if (type === 'drop' || type === 'remove') {
      const players = resolveAll(op.players || op.player || op.drop, 'drop');
      const team = op.team ? resolveTeam(op.team, false) : null;
      if (players.length === 0) continue;
      for (const p of players) {
        const rid = team ? String(team.rosterId) : p.rosterId;
        if (!rid) {
          warnings.push(`${p.name} is not on any roster.`);
          continue;
        }
        dropFrom(rid, p.playerId);
      }
      const label = team ? formatTeamLabel(team) : 'their current team';
      notes.push(`Dropped ${players.map((p) => p.name).join(', ')} from ${label}.`);
      continue;
    }

    if (type === 'move' || type === 'send') {
      const team = resolveTeam(op.to_team || op.toTeam || op.team, true);
      const players = resolveAll(op.players || op.player, 'move');
      if (!team || players.length === 0) continue;
      const exclusive = !wantsCopy(op);
      for (const p of players) addTo(team.rosterId, p.playerId, { exclusive });
      notes.push(
        exclusive
          ? `Moved ${players.map((p) => p.name).join(', ')} to ${formatTeamLabel(team)}.`
          : `Copied ${players.map((p) => p.name).join(', ')} onto ${formatTeamLabel(team)} without removing them from other rosters.`,
      );
      continue;
    }

    if (type === 'edit' || type === 'change') {
      const team = resolveTeam(op.team, true);
      if (!team) continue;
      const adding = resolveAll(op.add || op.players_add, 'add');
      const dropping = resolveAll(op.drop || op.players_drop, 'drop');
      const exclusive = !wantsCopy(op);
      for (const p of dropping) dropFrom(team.rosterId, p.playerId);
      for (const p of adding) addTo(team.rosterId, p.playerId, { exclusive });
      const parts = [];
      if (adding.length) parts.push(`+${adding.map((p) => p.name).join(', +')}`);
      if (dropping.length) parts.push(`−${dropping.map((p) => p.name).join(', −')}`);
      if (parts.length) notes.push(`${formatTeamLabel(team)}: ${parts.join('  ')}`);
      continue;
    }

    if (type === 'reverse_trade' || type === 'undo_trade' || type === 'untrade' || type === 'reverse') {
      const teamQueries = [
        ...asArray(op.teams),
        ...asArray(op.team_a || op.teamA),
        ...asArray(op.team_b || op.teamB),
      ];
      if (op.team && (op.to_team || op.toTeam)) {
        teamQueries.push(op.team, op.to_team || op.toTeam);
      } else if (op.team && teamQueries.length === 0) {
        teamQueries.push(op.team);
      }
      const rosterIds = [];
      let teamFail = false;
      for (const q of teamQueries) {
        const team = resolveTeam(q, true);
        if (!team) { teamFail = true; break; }
        rosterIds.push(String(team.rosterId));
      }
      if (teamFail) continue;
      const uniqueRids = [...new Set(rosterIds)];
      const hint = op.player || op.hint || asArray(op.players)[0] || '';
      const trade = findMatchingScenarioTrade(snapshot?.trades, uniqueRids, hint, working);
      if (!trade) {
        const who = uniqueRids.length
          ? uniqueRids.map((rid) => formatTeamLabel(teamById(teams, rid))).join(' and ')
          : 'those teams';
        warnings.push(`No listed trade found between ${who}.`);
        continue;
      }
      const moved = [];
      for (const p of trade.players || []) {
        if (!p.fromRosterId) {
          warnings.push(`Can't reverse ${p.name} — original team unknown.`);
          continue;
        }
        addTo(p.fromRosterId, p.playerId, { exclusive: true });
        moved.push(`${p.name} → ${formatTeamLabel(teamById(teams, p.fromRosterId))}`);
      }
      if (moved.length) {
        const pickNote = (trade.picks || []).length ? ' Picks were ignored.' : '';
        notes.push(`Reversed the trade: ${moved.join('; ')}.${pickNote}`);
      }
      continue;
    }

    warnings.push(`Unknown operation type: "${op.type || ''}". Use trade, add, drop, move, edit, reverse_trade, or reset.`);
  }

  if (didReset) {
    const summary = notes.join(' ') || 'Reset the scenario.';
    const toolMessage = [summary, ...warnings].join('\n');
    return {
      ok: warnings.length === 0 || notes.length > 0,
      edits: [],
      reset: true,
      summary,
      toolMessage,
      warnings,
    };
  }

  const edits = netEdits(before, working);
  if (edits.length === 0 && warnings.length > 0 && notes.length === 0) {
    const summary = warnings.join(' ');
    return { ok: false, edits: [], summary, toolMessage: summary, warnings };
  }

  const summary = notes.length > 0
    ? notes.join(' ')
    : (edits.length === 0 ? 'No roster changes needed.' : 'Updated the scenario.');
  const toolMessage = [
    `Applied. ${summary}`,
    edits.length ? `Edits: ${JSON.stringify(edits)}` : null,
    warnings.length ? `Warnings:\n${warnings.join('\n')}` : null,
  ].filter(Boolean).join('\n');

  return {
    ok: true,
    edits,
    summary,
    toolMessage,
    warnings,
  };
}

export function formatScenarioContext(snapshot, playersData) {
  if (!snapshot || !Array.isArray(snapshot.teams)) return '';
  const data = playersData || {};
  const teams = snapshot.teams;
  const rosters = snapshot.rosters || {};
  const original = snapshot.originalRosters || {};
  const season = snapshot.season || '';

  const lines = [
    '════════════════════════════════════════',
    `CURRENT SCENARIO — ${season} season`,
    '════════════════════════════════════════',
    'These are the rosters AFTER any edits already applied in this builder session.',
    'A player is usually on one team. If the user asked to copy/keep them on another roster, they may appear twice.',
    '',
    'Teams — users refer to these by team name, Sleeper name, OR first name/nickname:',
  ];

  for (const team of teams) {
    const aliases = teamAliases(team);
    const aliasStr = aliases.length ? ` a.k.a. ${aliases.join(', ')}` : '';
    lines.push(`- ${formatTeamLabel(team)} [roster ${team.rosterId}]${aliasStr}`);
  }

  lines.push('', 'Current rosters:');
  for (const team of teams) {
    const pids = rosters[team.rosterId] || rosters[String(team.rosterId)] || [];
    const names = pids.map((pid) => {
      const p = data[String(pid)];
      const name = p ? playerName(p, pid) : String(pid);
      const pos = p?.position ? ` ${p.position}` : '';
      return `${name}${pos}`;
    });
    lines.push(`${formatTeamLabel(team)}: ${names.length ? names.join(', ') : '(empty)'}`);
  }

  const deltaLines = [];
  for (const team of teams) {
    const rid = team.rosterId;
    const orig = new Set((original[rid] || original[String(rid)] || []).map(String));
    const curr = (rosters[rid] || rosters[String(rid)] || []).map(String);
    const currSet = new Set(curr);
    const added = curr.filter((pid) => !orig.has(pid)).map((pid) => {
      const p = data[String(pid)];
      return p ? playerName(p, pid) : pid;
    });
    const removed = [...orig].filter((pid) => !currSet.has(pid)).map((pid) => {
      const p = data[String(pid)];
      return p ? playerName(p, pid) : pid;
    });
    if (added.length || removed.length) {
      const parts = [];
      if (added.length) parts.push(`+${added.join(', +')}`);
      if (removed.length) parts.push(`−${removed.join(', −')}`);
      deltaLines.push(`- ${formatTeamLabel(team)}: ${parts.join('  ')}`);
    }
  }
  lines.push('', 'Edits vs original rosters:');
  if (deltaLines.length === 0) lines.push('(none yet)');
  else lines.push(...deltaLines);

  const trades = snapshot.trades || [];
  lines.push('', 'Recent trades (newest first), including this season and the current offseason. Reverse with type "reverse_trade" and the team first names — do not reconstruct the player lists yourself:');
  if (trades.length === 0) {
    lines.push('(none loaded)');
  } else {
    trades.forEach((trade, i) => lines.push(formatTradeLine(trade, teams, i + 1)));
  }

  return lines.join('\n');
}
