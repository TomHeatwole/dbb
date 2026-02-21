import { readFileSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from './config.js';
import { normalisePlayerName } from './helpers.js';

// All data is loaded once from disk and held in memory.

let playersCache = null;
let ktcCache = null;
let fcCache = null;
let ffbCache = null;

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
