import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR } from './config.mjs';
import { normalisePlayerName } from './helpers.mjs';

// All data is loaded once from disk and held in memory.

let playersCache = null;
let ktcCache = null;
let fcCache = null;
let ffbCache = null;
const statsCache = {}; // keyed by season year string

// ─── CSV helpers ──────────────────────────────────────────────────────────────
// Handles quoted fields (e.g. headshot URLs containing commas).

function parseCSVRow(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

// ─── players.txt ─────────────────────────────────────────────────────────────
// Large JSON mapping sleeperId -> player object from the Sleeper API snapshot.

export function loadPlayersData() {
  if (playersCache) return playersCache;
  const text = readFileSync(join(DATA_DIR, 'players.txt'), 'utf8');
  playersCache = JSON.parse(text);
  return playersCache;
}

// ─── ktc_values.csv ──────────────────────────────────────────────────────────
// Returns { map: Map<normName, entry>, asOf: string }
// entry: { name, position, nflTeam, ktcValue_tep, ktcValue_sf, rank_tep, rank_sf }

export function loadKtcData() {
  if (ktcCache) return ktcCache;

  const text = readFileSync(join(DATA_DIR, 'ktc_values.csv'), 'utf8');
  const lines = text.trim().split('\n').map((l) => l.replace(/\r$/, ''));
  const headers = lines[0].split(',');

  const idx = (h) => headers.indexOf(h);
  const nameIdx   = idx('name');
  const posIdx    = idx('position');
  const teamIdx   = idx('team');
  const sfValIdx  = idx('ktc_value_2qb');
  const tepValIdx = idx('ktc_value_tep_2qb');
  const sfRkIdx   = idx('rank_2qb');
  const tepRkIdx  = idx('rank_tep_2qb');
  const asOfIdx   = idx('as_of');

  const map = new Map();
  let asOf = null;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const name = (cols[nameIdx] || '').trim();
    if (!name) continue;
    if (!asOf && asOfIdx >= 0) asOf = (cols[asOfIdx] || '').trim();

    const ktcValue_tep = parseInt(cols[tepValIdx], 10);
    const ktcValue_sf  = parseInt(cols[sfValIdx],  10);

    map.set(normalisePlayerName(name), {
      name,
      position: (cols[posIdx]  || '').trim(),
      nflTeam:  (cols[teamIdx] || '').trim(),
      ktcValue_tep: Number.isFinite(ktcValue_tep) ? ktcValue_tep : 0,
      ktcValue_sf:  Number.isFinite(ktcValue_sf)  ? ktcValue_sf  : 0,
      rank_tep: tepRkIdx >= 0 ? (parseInt(cols[tepRkIdx], 10) || null) : null,
      rank_sf:  sfRkIdx  >= 0 ? (parseInt(cols[sfRkIdx],  10) || null) : null,
    });
  }

  ktcCache = { map, asOf };
  return ktcCache;
}

// ─── fantasycalc.csv ─────────────────────────────────────────────────────────
// Semicolon-delimited. Returns { bySleeperId: Map, byName: Map }
// entry: { name, team, position, age, sleeperId, value, overallRank, posRank, trend30day }

export function loadFantasyCalcData() {
  if (fcCache) return fcCache;

  const text = readFileSync(join(DATA_DIR, 'fantasycalc.csv'), 'utf8');
  const lines = text.trim().split('\n').map((l) => l.replace(/\r$/, ''));
  const headers = lines[0].split(';');

  const idx = (h) => headers.indexOf(h);
  const nameIdx  = idx('name');
  const teamIdx  = idx('team');
  const posIdx   = idx('position');
  const ageIdx   = idx('age');
  const sidIdx   = idx('sleeperId');
  const valIdx   = idx('value');
  const oRkIdx   = idx('overallRank');
  const pRkIdx   = idx('positionRank');
  const trendIdx = idx('trend30day');

  const bySleeperId = new Map();
  const byName      = new Map();

  for (let i = 1; i < lines.length; i++) {
    const cols  = lines[i].split(';').map((c) => c.replace(/^"|"$/g, '').trim());
    const name  = cols[nameIdx] || '';
    const value = parseInt(cols[valIdx], 10);
    if (!name || !Number.isFinite(value)) continue;

    const entry = {
      name,
      team:       cols[teamIdx] || '',
      position:   cols[posIdx]  || '',
      age:        parseFloat(cols[ageIdx]) || null,
      sleeperId:  cols[sidIdx]  || '',
      value,
      overallRank: parseInt(cols[oRkIdx],   10) || null,
      posRank:     parseInt(cols[pRkIdx],   10) || null,
      trend30day:  parseInt(cols[trendIdx], 10) || null,
    };

    if (entry.sleeperId) bySleeperId.set(entry.sleeperId, entry);
    byName.set(normalisePlayerName(name), entry);
  }

  fcCache = { bySleeperId, byName };
  return fcCache;
}

// ─── ffb.csv ─────────────────────────────────────────────────────────────────
// Returns { bySleeperId: Map, byName: Map }
// entry: { name, rank, sleeperId }

export function loadFfbData() {
  if (ffbCache) return ffbCache;

  const text = readFileSync(join(DATA_DIR, 'ffb.csv'), 'utf8');
  const lines = text.trim().split('\n').map((l) => l.replace(/\r$/, ''));
  const headers = lines[0].split(',').map((h) => h.trim());

  const rankIdx = headers.indexOf('rank');
  const nameIdx = headers.indexOf('name');
  const sidIdx  = headers.indexOf('sleeper_id');

  const bySleeperId = new Map();
  const byName      = new Map();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const name = cols[nameIdx] || '';
    const rank = parseInt(cols[rankIdx], 10);
    if (!name || !Number.isFinite(rank)) continue;

    const entry = { name, rank, sleeperId: cols[sidIdx] || '' };
    if (entry.sleeperId) bySleeperId.set(entry.sleeperId, entry);
    byName.set(normalisePlayerName(name), entry);
  }

  ffbCache = { bySleeperId, byName };
  return ffbCache;
}

// ─── stats_player_reg_{season}.csv ───────────────────────────────────────────
// Season totals from nflreadr/nflfastR. One row per player per season.
// Returns Map<normalizedDisplayName, statsRow> or null if file not found.

export function loadSeasonStats(season) {
  const yr = String(season);
  if (statsCache[yr]) return statsCache[yr];

  let text;
  try {
    text = readFileSync(join(DATA_DIR, `stats_player_reg_${yr}.csv`), 'utf8');
  } catch {
    return null; // season data not available
  }

  const lines = text.trim().split('\n').map((l) => l.replace(/\r$/, ''));
  if (lines.length < 2) return null;

  const headers = parseCSVRow(lines[0]);
  const byNorm = new Map();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] ?? ''; });
    const norm = normalisePlayerName(row.player_display_name || '');
    if (norm) byNorm.set(norm, row);
  }

  statsCache[yr] = byNorm;
  return byNorm;
}

// ─── Player search helper ─────────────────────────────────────────────────────
// Finds the best matching player in players.txt by name.
// Returns { playerId, player } or null.

export function findPlayerByName(searchName) {
  const playersData = loadPlayersData();
  const normSearch  = normalisePlayerName(searchName);

  let bestId     = null;
  let bestPlayer = null;
  let bestScore  = -1;

  for (const [pid, p] of Object.entries(playersData)) {
    // Skip non-skill positions for performance
    const pos = p.position || '';
    if (!['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(pos)) continue;

    const normName = normalisePlayerName(
      p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()
    );

    let score = 0;
    if (normName === normSearch) score = 10;
    else if (normName.startsWith(normSearch) || normSearch.startsWith(normName)) score = 6;
    else if (normName.includes(normSearch) || normSearch.includes(normName)) score = 4;
    else if (normName.split(' ').pop() === normSearch.split(' ').pop()) score = 2;

    if (score > bestScore) {
      bestScore  = score;
      bestId     = pid;
      bestPlayer = p;
    }
  }

  if (!bestPlayer || bestScore === 0) return null;
  return { playerId: bestId, player: bestPlayer };
}

// ─── owner_names.txt ──────────────────────────────────────────────────────────
// Map<normalised lowercase name, rosterIdNumber>
// Mirrors mcp/owner_names.txt so "Mac" / "Aidan" / "Drew" resolve to teams.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
let ownerNamesCache = null;
let ownerAliasesByRosterCache = null;

function loadOwnerNameTables() {
  if (ownerNamesCache && ownerAliasesByRosterCache) {
    return { byName: ownerNamesCache, byRoster: ownerAliasesByRosterCache };
  }

  const candidates = [
    join(MODULE_DIR, 'owner_names.txt'),
    join(MODULE_DIR, '../../../mcp/owner_names.txt'),
    join(DATA_DIR, 'owner_names.txt'),
  ];
  let text = '';
  for (const filePath of candidates) {
    try {
      if (existsSync(filePath)) {
        text = readFileSync(filePath, 'utf8');
        break;
      }
    } catch {
      // try next
    }
  }

  const byName = new Map();
  const byRoster = new Map();
  if (text) {
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '').trim();
      if (!line || line.startsWith('#')) continue;
      const pipeIdx = line.indexOf('|');
      if (pipeIdx === -1) continue;
      const rosterId = parseInt(line.slice(0, pipeIdx).trim(), 10);
      if (!Number.isFinite(rosterId)) continue;
      const names = line
        .slice(pipeIdx + 1)
        .split(',')
        .map((n) => n.trim().toLowerCase())
        .filter(Boolean);
      const ridKey = String(rosterId);
      if (!byRoster.has(ridKey)) byRoster.set(ridKey, []);
      for (const name of names) {
        byName.set(name, rosterId);
        byRoster.get(ridKey).push(name);
      }
    }
  }

  ownerNamesCache = byName;
  ownerAliasesByRosterCache = byRoster;
  return { byName, byRoster };
}

export function loadOwnerNames() {
  return loadOwnerNameTables().byName;
}

/** Map<rosterIdString, lowercase alias[]> — keeps shared last names on every matching roster. */
export function loadOwnerAliasesByRoster() {
  return loadOwnerNameTables().byRoster;
}
