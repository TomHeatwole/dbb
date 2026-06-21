/**
 * Loaders for Historical KTC Ranks sandbox module.
 */

const RANKS_CSV = '/data/sf_ktc_pos_ranks_historical.csv';
const PLAYERS_CSV = '/data/sf_ktc_rank_history_players.csv';
const VALUES_CSV = '/data/sf_ktc_values_historical.csv';

const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

let cache = null;
let valuesByDateCache = null;

function parseCsvRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseCsvRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

function parseIntField(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function yearFromDate(date) {
  return parseInt(String(date).slice(0, 4), 10);
}

async function loadValuesByDate() {
  if (valuesByDateCache) return valuesByDateCache;

  const res = await fetch(VALUES_CSV);
  if (!res.ok) throw new Error(`Failed to fetch ${VALUES_CSV}`);
  const { rows } = parseCsv(await res.text());

  const byDate = new Map();
  for (const row of rows) {
    const date = (row.date || '').trim();
    const name = (row.name || '').trim();
    if (!date || !name) continue;
    if (!byDate.has(date)) byDate.set(date, new Set());
    byDate.get(date).add(name);
  }

  valuesByDateCache = byDate;
  return byDate;
}

export async function loadHistoricalKtcRanksData() {
  if (cache) return cache;

  const [ranksRes, playersRes] = await Promise.all([
    fetch(RANKS_CSV),
    fetch(PLAYERS_CSV),
  ]);

  if (!ranksRes.ok) {
    throw new Error(
      `Missing ${RANKS_CSV}. Run: bash scripts/fetch_sf_ktc_rank_history.sh`
    );
  }
  if (!playersRes.ok) {
    throw new Error(
      `Missing ${PLAYERS_CSV}. Run: bash scripts/fetch_sf_ktc_rank_history.sh`
    );
  }

  const { rows: rankRows } = parseCsv(await ranksRes.text());
  const { rows: playerRows } = parseCsv(await playersRes.text());

  const byDate = new Map();
  const dates = new Set();
  const years = new Set();

  for (const row of rankRows) {
    const date = (row.date || '').trim();
    const name = (row.name || '').trim();
    const position = (row.position || '').trim().toUpperCase();
    const positionalRank = parseIntField(row.positional_rank);
    const overallRank = parseIntField(row.overall_rank);
    if (!date || !name || !position || positionalRank == null) continue;

    dates.add(date);
    years.add(yearFromDate(date));

    const entry = {
      date,
      name,
      position,
      positionalRank,
      overallRank,
      ktcPlayerId: (row.ktc_player_id || '').trim(),
      ktcSlug: (row.ktc_slug || '').trim(),
      sleeperId: (row.sleeper_id || '').trim(),
      rankBasis: (row.rank_basis || '').trim(),
    };

    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(entry);
  }

  const sortedDates = [...dates].sort();
  const sortedYears = [...years].sort((a, b) => a - b);

  const players = playerRows.map((row) => ({
    name: (row.name || '').trim(),
    position: (row.position || '').trim().toUpperCase(),
    ktcPlayerId: (row.ktc_player_id || '').trim(),
    ktcSlug: (row.ktc_slug || '').trim(),
    sleeperId: (row.sleeper_id || '').trim(),
    team: (row.team || '').trim(),
    rankBasis: (row.rank_basis || '').trim(),
    historyDays: parseIntField(row.history_days),
    historyStart: (row.history_start || '').trim(),
    historyEnd: (row.history_end || '').trim(),
  }));

  cache = {
    byDate,
    dates: sortedDates,
    years: sortedYears,
    players,
    playerCount: players.length,
    recordCount: rankRows.length,
  };
  return cache;
}

export function getDatesForYear(dates, year) {
  return dates.filter((d) => yearFromDate(d) === Number(year));
}

export function defaultDateForYear(dates, year) {
  const yearDates = getDatesForYear(dates, year);
  return yearDates.length ? yearDates[yearDates.length - 1] : null;
}

/**
 * Build a positional rank board for one date, inserting gap rows for missing slots.
 */
export function buildRankBoard(rowsForDate, position, valueNamesForDate = null) {
  const pos = position === 'ALL' ? null : position;
  const filtered = pos
    ? rowsForDate.filter((r) => r.position === pos)
    : [...rowsForDate];

  if (pos) {
    return buildSinglePositionBoard(filtered, pos, valueNamesForDate);
  }

  const boards = POSITIONS.map((p) => {
    const posRows = filtered.filter((r) => r.position === p);
    return {
      position: p,
      rows: buildSinglePositionBoard(posRows, p, valueNamesForDate),
    };
  });

  return { mode: 'all', boards };
}

function buildSinglePositionBoard(rows, position, valueNamesForDate) {
  const bySlot = new Map();
  for (const row of rows) {
    if (!bySlot.has(row.positionalRank)) {
      bySlot.set(row.positionalRank, row);
    }
  }

  const maxRank = rows.reduce((max, row) => Math.max(max, row.positionalRank), 0);
  const board = [];

  for (let slot = 1; slot <= maxRank; slot += 1) {
    const player = bySlot.get(slot);
    if (player) {
      const inValues = valueNamesForDate ? valueNamesForDate.has(player.name) : null;
      board.push({
        kind: 'player',
        slot,
        slotLabel: `${position}${slot}`,
        ...player,
        inValues,
      });
    } else {
      board.push({
        kind: 'gap',
        slot,
        slotLabel: `${position}${slot}`,
        position,
        name: null,
        positionalRank: slot,
        overallRank: null,
        inValues: null,
      });
    }
  }

  return board;
}

export async function getValueNamesForDate(date) {
  const byDate = await loadValuesByDate();
  return byDate.get(date) || new Set();
}

export function summarizeCoverage(rowsForDate, valueNamesForDate) {
  const rankNames = new Set(rowsForDate.map((r) => r.name));
  let inBoth = 0;
  let ranksOnly = 0;
  let valuesOnly = 0;

  for (const name of rankNames) {
    if (valueNamesForDate.has(name)) inBoth += 1;
    else ranksOnly += 1;
  }
  for (const name of valueNamesForDate) {
    if (!rankNames.has(name)) valuesOnly += 1;
  }

  return { inBoth, ranksOnly, valuesOnly, rankCount: rankNames.size, valueCount: valueNamesForDate.size };
}

export function countGaps(boardRows) {
  return boardRows.filter((r) => r.kind === 'gap').length;
}

export { POSITIONS, RANKS_CSV, VALUES_CSV };
