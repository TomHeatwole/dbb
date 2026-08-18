/**
 * redraftDashLoader.js
 *
 * Loads the private "Redraft Dash" ranking sources synced from the sibling
 * dbbp repo into /data/redraft_dash/ (see site/scripts/sync-dbbp-data.mjs).
 *
 * The data is intentionally absent from public deploys — dbbp/ only exists on
 * local checkouts — so every fetch here must tolerate "file missing". The CRA
 * dev server and the production rewrite both answer missing static paths with
 * index.html (HTTP 200), so we sniff the payload rather than trusting res.ok.
 *
 * Cross-source joining uses the shared player-name matcher so suffix and
 * spelling variants ("Marvin Harrison" vs "Marvin Harrison Jr.") land on the
 * same row.
 */
import { findBestPlayerMatch, normalisePlayerName } from '../utils/playerNameMatcher';

const MANIFEST_URL = '/data/redraft_dash/manifest.json';

/** Skill positions plus kickers (kickers splice into the overall board). DST stays off it. */
const DASH_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K']);

/**
 * Public sources shipped with the dbb repo (site/public/data). Unlike the
 * manifest sources these exist on the deployed site too, so the dash can
 * render them even when the private dbbp data is absent.
 */
const PUBLIC_SOURCES = [
  {
    id: 'fp_ecr_half',
    label: 'FP ECR Half',
    trust: 'trusted',
    format: '1qb',
    url: '/data/fantasypros_ecr_half.csv',
    description: 'FantasyPros half-PPR expert consensus (1QB) with tiers.',
  },
  {
    id: 'fp_ecr_half_sf',
    label: 'FP ECR SF',
    trust: 'trusted',
    format: 'superflex',
    url: '/data/fantasypros_ecr_half_superflex.csv',
    description: 'FantasyPros half-PPR superflex consensus with tiers — QBs rank much higher by design.',
  },
  {
    id: 'yafsb_adp_half_sf',
    label: 'YAFSB SF ADP',
    trust: 'trusted',
    format: 'superflex',
    url: '/data/yafsb_adp_half_superflex.csv',
    description: 'Real Sleeper redraft ADP (12-team, half-PPR, superflex) from YAFSB. Mean pick across recent matching drafts.',
  },
];

const GIBBS_SOURCE = {
  id: 'gibbs_implied',
  label: 'Jacob Gibbs',
  trust: 'trusted',
  format: '1qb',
  description: 'Implied full board: half-PPR ECR with Gibbs deltas (|diff| ≥ 2) substituted in.',
};

/**
 * The formula inputs behind the DBB Custom board (dbb_custom_rankings.csv),
 * in blend-weight order. `column` is the CSV column carrying that source's
 * equivalent-SF rank for the player (1QB sources are pre-converted to the
 * SF scale by the build script, so all five are directly comparable).
 */
export const CUSTOM_BOARD_SOURCES = [
  { id: 'etr', label: 'ETR', column: 'etr_sf', weight: 30 },
  { id: 'lrdg', label: 'LRDG', column: 'lrdg_eq', weight: 22.5 },
  { id: 'gibbs', label: 'Gibbs', column: 'gibbs_eq', weight: 22.5 },
  { id: 'ecr', label: 'ECR', column: 'ecr_sf', weight: 12.5 },
  { id: 'ffb', label: 'FFB', column: 'udk_sf', weight: 12.5 },
];

let dashDataPromise = null;
let snapshotDataPromise = null;

const SNAPSHOT_CSV_URL = '/data/redraft_dash_snapshot.csv';
const SNAPSHOT_META_URL = '/data/redraft_dash_snapshot_meta.json';

/** Quote-aware CSV row parser (same convention as the other loaders). */
function parseCsvRow(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

/**
 * Fetch a static file, returning null when it's missing. Missing static paths
 * come back as the SPA's index.html, so treat HTML payloads as "not found".
 */
async function fetchStaticText(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    return null;
  }
  if (!res.ok) return null;
  const text = await res.text();
  if (/^\s*(<!doctype|<html)/i.test(text)) return null;
  return text;
}

async function loadManifest() {
  const text = await fetchStaticText(MANIFEST_URL);
  if (!text) return null;
  try {
    const manifest = JSON.parse(text);
    if (!Array.isArray(manifest.sources)) return null;
    return manifest;
  } catch (err) {
    return null;
  }
}

/** First matching header index among aliases, or -1. */
function headerIndex(header, aliases) {
  for (const alias of aliases) {
    const idx = header.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse one source CSV into row objects. Column aliases cover the different
 * sources: rank|overall_rank, player|name. DST rows are dropped (separate
 * tab). Kickers are kept. Tier is carried when present.
 */
function parseSourceCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = parseCsvRow(lines[0]).map((h) => h.toLowerCase());
  const rankIdx = headerIndex(header, ['rank', 'overall_rank']);
  const nameIdx = headerIndex(header, ['player', 'name']);
  const posIdx = header.indexOf('position');
  const teamIdx = header.indexOf('team');
  const tierIdx = header.indexOf('tier');
  if (rankIdx === -1 || nameIdx === -1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvRow(lines[i]);
    const rank = Number(cells[rankIdx]);
    const name = cells[nameIdx] || '';
    if (!name || !Number.isFinite(rank)) continue;
    const position = posIdx !== -1 ? (cells[posIdx] || '').toUpperCase() : '';
    if (position && !DASH_POSITIONS.has(position)) continue;
    const tier = tierIdx !== -1 ? Number(cells[tierIdx]) : NaN;
    rows.push({
      rank,
      name,
      position,
      team: teamIdx !== -1 ? (cells[teamIdx] || '').toUpperCase() : '',
      tier: Number.isFinite(tier) ? tier : null,
    });
  }
  return rows;
}

/**
 * Build Jacob Gibbs' implied full board: start from the half-PPR ECR baseline
 * and substitute his rank wherever the deltas file records a disagreement.
 * Joined on sleeper_id with a normalised-name fallback.
 */
function buildGibbsImpliedRows(ecrText, deltasText) {
  if (!ecrText || !deltasText) return [];

  const deltaLines = deltasText.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (deltaLines.length < 2) return [];
  const dHeader = parseCsvRow(deltaLines[0]).map((h) => h.toLowerCase());
  const dName = dHeader.indexOf('player');
  const dGibbs = dHeader.indexOf('gibbs_rank');
  const dSleeper = dHeader.indexOf('sleeper_id');
  if (dName === -1 || dGibbs === -1) return [];

  const gibbsBySleeper = new Map();
  const gibbsByName = new Map();
  for (let i = 1; i < deltaLines.length; i += 1) {
    const cells = parseCsvRow(deltaLines[i]);
    const rank = Number(cells[dGibbs]);
    if (!Number.isFinite(rank)) continue;
    const sleeperId = dSleeper !== -1 ? cells[dSleeper] : '';
    if (sleeperId) gibbsBySleeper.set(sleeperId, rank);
    gibbsByName.set(normalisePlayerName(cells[dName] || ''), rank);
  }

  const ecrLines = ecrText.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (ecrLines.length < 2) return [];
  const eHeader = parseCsvRow(ecrLines[0]).map((h) => h.toLowerCase());
  const eRank = eHeader.indexOf('rank');
  const eName = eHeader.indexOf('name');
  const ePos = eHeader.indexOf('position');
  const eTeam = eHeader.indexOf('team');
  const eSleeper = eHeader.indexOf('sleeper_id');
  if (eRank === -1 || eName === -1) return [];

  const rows = [];
  for (let i = 1; i < ecrLines.length; i += 1) {
    const cells = parseCsvRow(ecrLines[i]);
    const ecrRank = Number(cells[eRank]);
    const name = cells[eName] || '';
    if (!name || !Number.isFinite(ecrRank)) continue;
    const position = ePos !== -1 ? (cells[ePos] || '').toUpperCase() : '';
    if (position && !DASH_POSITIONS.has(position)) continue;

    const sleeperId = eSleeper !== -1 ? cells[eSleeper] : '';
    const gibbsRank = (sleeperId ? gibbsBySleeper.get(sleeperId) : undefined)
      ?? gibbsByName.get(normalisePlayerName(name))
      ?? null;

    rows.push({
      rank: gibbsRank ?? ecrRank,
      name,
      position,
      team: eTeam !== -1 ? (cells[eTeam] || '').toUpperCase() : '',
      tier: null,
    });
  }
  return rows;
}

/**
 * Parse the DBB Custom board with its full column set (tiers, value score,
 * per-source equivalent-SF ranks) for the tier view. Returns [] when the
 * file is absent (public deploys).
 */
function parseCustomBoard(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = parseCsvRow(lines[0]).map((h) => h.toLowerCase());
  const col = (name) => header.indexOf(name);
  const idx = {
    rank: col('rank'),
    player: col('player'),
    position: col('position'),
    team: col('team'),
    tier: col('tier'),
    posRank: col('pos_rank'),
    posTier: col('pos_tier'),
    value: col('value'),
    coverage: col('coverage'),
    sleeperId: col('sleeper_id'),
  };
  if (idx.rank === -1 || idx.player === -1 || idx.tier === -1) return [];
  const sourceIdx = CUSTOM_BOARD_SOURCES.map((s) => col(s.column));

  const num = (cells, i) => {
    if (i === -1) return null;
    const v = Number(cells[i]);
    return Number.isFinite(v) ? v : null;
  };

  const players = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvRow(lines[i]);
    const rank = num(cells, idx.rank);
    const name = cells[idx.player] || '';
    if (!name || rank == null) continue;
    const sourceRanks = {};
    CUSTOM_BOARD_SOURCES.forEach((s, j) => {
      sourceRanks[s.id] = num(cells, sourceIdx[j]);
    });
    players.push({
      rank,
      name,
      position: idx.position !== -1 ? (cells[idx.position] || '').toUpperCase() : '',
      team: idx.team !== -1 ? (cells[idx.team] || '').toUpperCase() : '',
      tier: num(cells, idx.tier),
      posRank: num(cells, idx.posRank),
      posTier: num(cells, idx.posTier),
      value: num(cells, idx.value),
      coverage: num(cells, idx.coverage),
      sleeperId: idx.sleeperId !== -1 ? (cells[idx.sleeperId] || '') : '',
      adp: null, // attached later from the YAFSB SF ADP file
      sourceRanks,
    });
  }
  return players;
}

/**
 * ETR 2QB/half defense ranks from etr_tiers.csv. Defenses stay off the
 * overall board — the dash renders them on a separate tab like punters.
 */
function parseEtrDefenses(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = parseCsvRow(lines[0]).map((h) => h.toLowerCase());
  const nameIdx = headerIndex(header, ['name', 'player']);
  const posIdx = header.indexOf('position');
  const teamIdx = header.indexOf('team');
  const rankIdx = header.indexOf('rank_2qb_half');
  const posRankIdx = header.indexOf('pos_rank_2qb_half');
  const tierIdx = header.indexOf('tier_2qb_half');
  if (nameIdx === -1 || rankIdx === -1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvRow(lines[i]);
    const position = posIdx !== -1 ? (cells[posIdx] || '').toUpperCase() : '';
    if (position !== 'DST' && position !== 'DEF') continue;
    const name = cells[nameIdx] || '';
    const rank = Number(cells[rankIdx]);
    if (!name || !Number.isFinite(rank)) continue;
    const posRank = posRankIdx !== -1 ? Number(cells[posRankIdx]) : NaN;
    const tier = tierIdx !== -1 ? Number(cells[tierIdx]) : NaN;
    rows.push({
      name,
      team: teamIdx !== -1 ? (cells[teamIdx] || '').toUpperCase() : '',
      etrRank: rank,
      posRank: Number.isFinite(posRank) ? posRank : rows.length + 1,
      tier: Number.isFinite(tier) ? tier : null,
    });
  }
  rows.sort((a, b) => a.etrRank - b.etrRank || a.posRank - b.posRank);
  return rows;
}

/**
 * Attach Sleeper superflex ADP (YAFSB file) to the custom board so the tier
 * view can show market cost vs our rank. ADP is display-only — it is never an
 * input to the blend. Joined on sleeper_id with a normalised-name fallback.
 */
function attachAdpToCustomBoard(customBoard, yafsbText) {
  if (!customBoard.length || !yafsbText) return;
  const lines = yafsbText.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return;
  const header = parseCsvRow(lines[0]).map((h) => h.toLowerCase());
  const adpIdx = header.indexOf('adp');
  const nameIdx = header.indexOf('player');
  const sleeperIdx = header.indexOf('sleeper_id');
  if (adpIdx === -1 || nameIdx === -1) return;

  const bySleeper = new Map();
  const byName = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvRow(lines[i]);
    const adp = Number(cells[adpIdx]);
    if (!Number.isFinite(adp)) continue;
    const sleeperId = sleeperIdx !== -1 ? cells[sleeperIdx] : '';
    if (sleeperId) bySleeper.set(sleeperId, adp);
    byName.set(normalisePlayerName(cells[nameIdx] || ''), adp);
  }
  for (const p of customBoard) {
    p.adp = (p.sleeperId ? bySleeper.get(p.sleeperId) : undefined)
      ?? byName.get(normalisePlayerName(p.name))
      ?? null;
  }
}

/**
 * Merge per-source rows into one player list. Sources are processed in
 * manifest order; each row either fuzzy-matches an existing player (name +
 * position/team hints) or starts a new one.
 */
function mergeSources(sourceRows) {
  const players = [];
  for (const { sourceId, rows } of sourceRows) {
    for (const row of rows) {
      const { candidate } = findBestPlayerMatch(
        row.name,
        players,
        { position: row.position || undefined, team: row.team || undefined },
      );
      if (candidate) {
        candidate.ranks[sourceId] = row.rank;
        if (row.tier != null) candidate.tiers[sourceId] = row.tier;
        // Prefer the longer name variant (usually includes the suffix)
        if (row.name.length > candidate.name.length) candidate.name = row.name;
        if (!candidate.position && row.position) candidate.position = row.position;
        if (!candidate.team && row.team) candidate.team = row.team;
      } else {
        players.push({
          name: row.name,
          position: row.position,
          team: row.team,
          ranks: { [sourceId]: row.rank },
          tiers: row.tier != null ? { [sourceId]: row.tier } : {},
        });
      }
    }
  }
  return players;
}

/** Attach avgRank / bestRank / worstRank / spread across present sources. */
function computeAggregates(players) {
  for (const player of players) {
    const ranks = Object.values(player.ranks);
    const sum = ranks.reduce((acc, r) => acc + r, 0);
    player.avgRank = ranks.length ? sum / ranks.length : null;
    player.bestRank = ranks.length ? Math.min(...ranks) : null;
    player.worstRank = ranks.length ? Math.max(...ranks) : null;
    player.spread = ranks.length > 1 ? player.worstRank - player.bestRank : null;
    player.sourceCount = ranks.length;
  }
}

async function loadRedraftDashDataUncached() {
  const manifest = await loadManifest();

  const sources = [];
  const sourceRows = [];
  const addSource = (meta, rows, missing) => {
    sources.push({ ...meta, count: rows.length, missing });
    if (rows.length) sourceRows.push({ sourceId: meta.id, rows });
  };

  // Private sources from the dbbp manifest (absent on public deploys)
  let customBoard = [];
  if (manifest) {
    const csvTexts = await Promise.all(
      manifest.sources.map((s) => fetchStaticText(`/data/redraft_dash/${s.file}`))
    );
    const customIdx = manifest.sources.findIndex((s) => s.id === 'dbb_custom');
    if (customIdx !== -1) customBoard = parseCustomBoard(csvTexts[customIdx]);
    manifest.sources.forEach((source, i) => {
      const text = csvTexts[i];
      addSource(
        {
          id: source.id,
          label: source.label,
          trust: source.trust === 'trusted' ? 'trusted' : 'untrusted',
          // QB ranks are not comparable across formats — superflex sources
          // rank QBs far higher. Analytics must group/convert by format.
          format: source.format === 'superflex' ? 'superflex' : '1qb',
          description: source.description || '',
        },
        text ? parseSourceCsv(text) : [],
        !text,
      );
    });
  }

  // Public sources shipped with the dbb repo
  const [publicTexts, gibbsDeltasText] = await Promise.all([
    Promise.all(PUBLIC_SOURCES.map((s) => fetchStaticText(s.url))),
    fetchStaticText('/data/gibbs_deltas.csv'),
  ]);
  PUBLIC_SOURCES.forEach((source, i) => {
    const text = publicTexts[i];
    const { url, ...meta } = source;
    addSource(meta, text ? parseSourceCsv(text) : [], !text);
  });

  // Market ADP overlay for the custom board (display-only, not a blend input)
  const yafsbText = publicTexts[PUBLIC_SOURCES.findIndex((s) => s.id === 'yafsb_adp_half_sf')];
  attachAdpToCustomBoard(customBoard, yafsbText);

  const etrTiersText = await fetchStaticText('/data/redraft_dash/etr/etr_tiers.csv');
  const defenses = parseEtrDefenses(etrTiersText);

  // Derived: Gibbs implied board = ECR half baseline + his deltas
  const ecrHalfText = publicTexts[PUBLIC_SOURCES.findIndex((s) => s.id === 'fp_ecr_half')];
  const gibbsRows = buildGibbsImpliedRows(ecrHalfText, gibbsDeltasText);
  addSource(GIBBS_SOURCE, gibbsRows, gibbsRows.length === 0);

  const players = mergeSources(sourceRows);
  computeAggregates(players);
  players.sort((a, b) => (a.avgRank ?? Infinity) - (b.avgRank ?? Infinity));

  return {
    available: sourceRows.length > 0,
    privateMissing: !manifest,
    season: manifest?.season ?? 2026,
    sources,
    players,
    customBoard,
    defenses,
  };
}

/**
 * Load everything the dash needs. Cached for the session.
 * @returns {Promise<{available: boolean, season: number|null,
 *   sources: Array<{id, label, trust, description, count, missing}>,
 *   players: Array<{name, position, team, ranks: Object,
 *     avgRank, bestRank, worstRank, spread, sourceCount}>}>}
 */
export function loadRedraftDashData() {
  if (!dashDataPromise) {
    dashDataPromise = loadRedraftDashDataUncached().catch((err) => {
      dashDataPromise = null;
      throw err;
    });
  }
  return dashDataPromise;
}

/**
 * Parse the public snapshot CSV. Only the aggregated board columns are
 * read — per-source ranks are never present in this file and are not
 * reconstructed here.
 */
function parseSnapshotBoard(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = parseCsvRow(lines[0]).map((h) => h.toLowerCase());
  const col = (name) => header.indexOf(name);
  const idx = {
    rank: col('rank'),
    player: col('player'),
    position: col('position'),
    team: col('team'),
    tier: col('tier'),
    posRank: col('pos_rank'),
    posTier: col('pos_tier'),
    value: col('value'),
    adp: col('adp'),
    sleeperId: col('sleeper_id'),
  };
  if (idx.rank === -1 || idx.player === -1 || idx.tier === -1) return [];

  const num = (cells, i) => {
    if (i === -1) return null;
    const v = Number(cells[i]);
    return Number.isFinite(v) ? v : null;
  };

  const players = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvRow(lines[i]);
    const rank = num(cells, idx.rank);
    const name = cells[idx.player] || '';
    if (!name || rank == null) continue;
    players.push({
      rank,
      name,
      position: idx.position !== -1 ? (cells[idx.position] || '').toUpperCase() : '',
      team: idx.team !== -1 ? (cells[idx.team] || '').toUpperCase() : '',
      tier: num(cells, idx.tier),
      posRank: num(cells, idx.posRank),
      posTier: num(cells, idx.posTier),
      value: num(cells, idx.value),
      coverage: null,
      sleeperId: idx.sleeperId !== -1 ? (cells[idx.sleeperId] || '') : '',
      adp: num(cells, idx.adp),
      sourceRanks: {},
    });
  }
  return players;
}

async function loadRedraftDashSnapshotUncached() {
  const [csvText, metaText] = await Promise.all([
    fetchStaticText(SNAPSHOT_CSV_URL),
    fetchStaticText(SNAPSHOT_META_URL),
  ]);
  const customBoard = parseSnapshotBoard(csvText);
  let season = 2026;
  let generatedAt = null;
  if (metaText) {
    try {
      const meta = JSON.parse(metaText);
      if (Number.isFinite(Number(meta.season))) season = Number(meta.season);
      generatedAt = meta.generatedAt || null;
    } catch (err) {
      // ignore malformed meta — the CSV is the source of truth
    }
  }
  return {
    available: customBoard.length > 0,
    season,
    generatedAt,
    customBoard,
  };
}

/**
 * Load the sanitized public snapshot (committed CSV). Cached for the session.
 * Safe on prod: no dbbp/ files are fetched.
 */
export function loadRedraftDashSnapshot() {
  if (!snapshotDataPromise) {
    snapshotDataPromise = loadRedraftDashSnapshotUncached().catch((err) => {
      snapshotDataPromise = null;
      throw err;
    });
  }
  return snapshotDataPromise;
}
