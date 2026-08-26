#!/usr/bin/env node
/**
 * build_redraft_dash_snapshot.js
 *
 * Publishes sanitized snapshots of the DBB custom redraft boards for the
 * live site's "Public" Redraft Dash view (superflex + 1QB).
 *
 * Reads the private custom boards and public ADP files, then writes ONLY the
 * aggregated board: rank, player, position, team, tier, pos_rank, pos_tier,
 * adp, sleeper_id. Per-source ranks, coverage, and value scores stay private.
 *
 * ADP pairing:
 *   Superflex → YAFSB Sleeper SF ADP
 *   1QB       → FantasyPros half-PPR ADP (no YAFSB 1QB file checked in yet)
 *
 * Wired into all_updates.sh after custom_rankings so a full refresh updates
 * the committed public CSVs.
 *
 * Usage (run from project root):
 *   node scripts/build_redraft_dash_snapshot.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SEASON = 2026;

const PUBLIC_COLUMNS = [
  'rank', 'player', 'position', 'team', 'tier', 'pos_rank', 'pos_tier', 'adp', 'sleeper_id',
];

const FORBIDDEN_HEADER_RE = /^(etr|lrdg|gibbs|ecr|udk|ffb|coverage)(_|$)|_(sf|eq|1qb)$/i;

const SNAPSHOTS = [
  {
    id: 'superflex',
    dbbpBoard: path.join(ROOT, 'dbbp/redraft-dash/dbb_custom_rankings.csv'),
    syncedBoard: path.join(ROOT, 'site/public/data/redraft_dash/dbb_custom_rankings.csv'),
    adpCsv: path.join(ROOT, 'site/public/data/yafsb_adp_half_superflex.csv'),
    adpField: 'adp',
    outCsv: path.join(ROOT, 'site/public/data/redraft_dash_snapshot.csv'),
    outMeta: path.join(ROOT, 'site/public/data/redraft_dash_snapshot_meta.json'),
    adpHint: 'Run `node scripts/process_yafsb_adp.js` first.',
  },
  {
    id: '1qb',
    dbbpBoard: path.join(ROOT, 'dbbp/redraft-dash/dbb_custom_rankings_1qb.csv'),
    syncedBoard: path.join(ROOT, 'site/public/data/redraft_dash/dbb_custom_rankings_1qb.csv'),
    adpCsv: path.join(ROOT, 'site/public/data/adp/fantasypros_adp_half_2026.csv'),
    adpField: 'avg',
    outCsv: path.join(ROOT, 'site/public/data/redraft_dash_snapshot_1qb.csv'),
    outMeta: path.join(ROOT, 'site/public/data/redraft_dash_snapshot_1qb_meta.json'),
    adpHint: 'Expected FantasyPros half ADP at site/public/data/adp/fantasypros_adp_half_2026.csv.',
  },
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function readCsvObjects(file) {
  if (!fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function numOrEmpty(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '';
}

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

function loadAdpIndex(adpRows, adpField) {
  const bySleeper = new Map();
  const byName = new Map();
  for (const row of adpRows) {
    const adp = Number(row[adpField] ?? row.adp ?? row.avg);
    if (!Number.isFinite(adp)) continue;
    if (row.sleeper_id) bySleeper.set(row.sleeper_id, adp);
    const key = normalisePlayerName(row.player || row.name || '');
    if (key) byName.set(key, adp);
  }
  return { bySleeper, byName };
}

function resolveBoardPath(cfg) {
  if (fs.existsSync(cfg.dbbpBoard)) return cfg.dbbpBoard;
  if (fs.existsSync(cfg.syncedBoard)) return cfg.syncedBoard;
  return null;
}

function writeSnapshot(cfg) {
  const boardPath = resolveBoardPath(cfg);
  if (!boardPath) {
    console.error(`ERROR: ${cfg.id} custom board not found. Run \`node dbbp/scripts/build_custom_rankings.js\` first.`);
    process.exit(1);
  }
  if (!fs.existsSync(cfg.adpCsv)) {
    console.error(`ERROR: ADP file missing: ${cfg.adpCsv}`);
    console.error(cfg.adpHint);
    process.exit(1);
  }

  const boardRows = readCsvObjects(boardPath);
  if (!boardRows.length) {
    console.error(`ERROR: ${boardPath} has no player rows.`);
    process.exit(1);
  }

  const privateHeaders = Object.keys(boardRows[0]).filter((h) => !PUBLIC_COLUMNS.includes(h));
  if (privateHeaders.length) {
    console.log(`[${cfg.id}] Stripped private columns: ${privateHeaders.join(', ')}`);
  }

  const { bySleeper, byName } = loadAdpIndex(readCsvObjects(cfg.adpCsv), cfg.adpField);

  const snapshot = boardRows.map((row) => {
    const sleeperId = row.sleeper_id || '';
    const adp = (sleeperId ? bySleeper.get(sleeperId) : undefined)
      ?? byName.get(normalisePlayerName(row.player || ''))
      ?? null;
    return {
      rank: numOrEmpty(row.rank),
      player: row.player || '',
      position: (row.position || '').toUpperCase(),
      team: (row.team || '').toUpperCase(),
      tier: numOrEmpty(row.tier),
      pos_rank: numOrEmpty(row.pos_rank),
      pos_tier: numOrEmpty(row.pos_tier),
      adp: adp == null ? '' : (Number.isInteger(adp) ? String(adp) : adp.toFixed(1)),
      sleeper_id: sleeperId,
    };
  }).filter((row) => row.player && row.rank !== '');

  const headers = Object.keys(snapshot[0] || {});
  if (headers.join(',') !== PUBLIC_COLUMNS.join(',')) {
    console.error('ERROR: snapshot columns drifted from the public allowlist.');
    console.error(`  got:      ${headers.join(',')}`);
    console.error(`  expected: ${PUBLIC_COLUMNS.join(',')}`);
    process.exit(1);
  }
  const forbiddenOut = headers.filter((h) => FORBIDDEN_HEADER_RE.test(h));
  if (forbiddenOut.length) {
    console.error(`ERROR: refusing to write proprietary columns: ${forbiddenOut.join(', ')}`);
    process.exit(1);
  }

  const lines = [PUBLIC_COLUMNS.join(',')];
  for (const row of snapshot) {
    lines.push(PUBLIC_COLUMNS.map((col) => csvEscape(row[col])).join(','));
  }
  fs.mkdirSync(path.dirname(cfg.outCsv), { recursive: true });
  fs.writeFileSync(cfg.outCsv, `${lines.join('\n')}\n`, 'utf8');

  const withAdp = snapshot.filter((r) => r.adp !== '').length;
  const meta = {
    season: SEASON,
    format: cfg.id,
    generatedAt: new Date().toISOString(),
    playerCount: snapshot.length,
    adpMatched: withAdp,
  };
  fs.writeFileSync(cfg.outMeta, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  console.log(`[${cfg.id}] Output: ${cfg.outCsv} (${snapshot.length} players, ${withAdp} with ADP)`);
  console.log(`[${cfg.id}] Meta:   ${cfg.outMeta}`);
  console.log(`[${cfg.id}] Top 10:`);
  snapshot.slice(0, 10).forEach((r) => {
    console.log(
      `  ${String(r.rank).padStart(3)} T${String(r.tier).padStart(2)}  `
      + `${r.position}${r.pos_rank}`.padEnd(5)
      + ` ${r.player.padEnd(22)} ADP ${r.adp || '—'}`,
    );
  });
}

function run() {
  for (const cfg of SNAPSHOTS) writeSnapshot(cfg);
}

run();
