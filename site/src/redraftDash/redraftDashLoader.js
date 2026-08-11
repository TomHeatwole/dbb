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
import { findBestPlayerMatch } from '../utils/playerNameMatcher';

const MANIFEST_URL = '/data/redraft_dash/manifest.json';

let dashDataPromise = null;

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
 * private sources: rank|overall_rank, player|name. Extra columns are ignored.
 */
function parseSourceCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = parseCsvRow(lines[0]).map((h) => h.toLowerCase());
  const rankIdx = headerIndex(header, ['rank', 'overall_rank']);
  const nameIdx = headerIndex(header, ['player', 'name']);
  const posIdx = header.indexOf('position');
  const teamIdx = header.indexOf('team');
  if (rankIdx === -1 || nameIdx === -1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvRow(lines[i]);
    const rank = Number(cells[rankIdx]);
    const name = cells[nameIdx] || '';
    if (!name || !Number.isFinite(rank)) continue;
    rows.push({
      rank,
      name,
      position: posIdx !== -1 ? (cells[posIdx] || '').toUpperCase() : '',
      team: teamIdx !== -1 ? (cells[teamIdx] || '').toUpperCase() : '',
    });
  }
  return rows;
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
  if (!manifest) {
    return { available: false, season: null, sources: [], players: [] };
  }

  const csvTexts = await Promise.all(
    manifest.sources.map((s) => fetchStaticText(`/data/redraft_dash/${s.file}`))
  );

  const sources = [];
  const sourceRows = [];
  manifest.sources.forEach((source, i) => {
    const text = csvTexts[i];
    const rows = text ? parseSourceCsv(text) : [];
    sources.push({
      id: source.id,
      label: source.label,
      trust: source.trust === 'trusted' ? 'trusted' : 'untrusted',
      description: source.description || '',
      count: rows.length,
      missing: !text,
    });
    if (rows.length) sourceRows.push({ sourceId: source.id, rows });
  });

  const players = mergeSources(sourceRows);
  computeAggregates(players);
  players.sort((a, b) => (a.avgRank ?? Infinity) - (b.avgRank ?? Infinity));

  return {
    available: sourceRows.length > 0,
    season: manifest.season ?? null,
    sources,
    players,
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
