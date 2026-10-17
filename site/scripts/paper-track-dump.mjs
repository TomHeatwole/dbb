#!/usr/bin/env node
/**
 * Dump paper_snapshots from Neon into git-tracked CSVs, then delete the rows.
 *
 *   npm run paper-track:dump --prefix site
 *   npm run paper-track:dump --prefix site -- --keep
 *   npm run paper-track:dump --prefix site -- --sport sop
 *
 * Default output: example_data/paper_track/{sop,drives,corners}.csv (repo root).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';
import {
  deleteSnapshotsByIds,
  ensurePaperTrackSchema,
  fetchAllSnapshots,
} from '../lib/paperTrackCore.mjs';

const SOP_CSV_COLUMNS = [
  'id', 'sport', 'odds_fingerprint',
  'captured_at', 'event_id', 'name', 'home', 'away', 'kickoff_at',
  'competition', 'competition_name', 'phase', 'situation',
  'score_home', 'score_away', 'next_goal_n', 'clock', 'in_play',
  'longest_ng_book', 'longest_ng_source', 'longest_ng_american', 'longest_ng_label',
  'model_no_goal_p', 'model_goal_p', 'live_no_goal_p', 'live_goal_p',
  'fd_ng_nextGoalMethod', 'fd_ng_correctScore', 'fd_ng_totalGoalsUnder',
  'fd_ng_nthGoalNeither', 'fd_ng_nextGoalscorer',
  'dk_ng_nextGoalMethod', 'dk_ng_correctScore', 'dk_ng_totalGoalsUnder',
  'dk_ng_nthGoalNeither', 'dk_ng_nextGoalscorer',
  'klsh_ng_nextGoalMethod', 'klsh_ng_correctScore', 'klsh_ng_totalGoalsUnder',
  'klsh_ng_nthGoalNeither', 'klsh_ng_nextGoalscorer',
  'fd_sop', 'fd_header', 'fd_pk', 'fd_fk', 'fd_og',
  'dk_sop', 'dk_header', 'dk_pk', 'dk_fk', 'dk_og',
  'model_sop_p', 'model_header_p', 'model_pk_p', 'model_fk_p', 'model_og_p',
  'live_sop_p', 'live_header_p', 'live_pk_p', 'live_fk_p', 'live_og_p',
  'pregame_longest_ng_book', 'pregame_longest_ng_source', 'pregame_longest_ng_american',
  'pregame_model_goal_p', 'pregame_model_no_goal_p',
  'pregame_fd_ng_totalGoalsUnder', 'pregame_fd_ng_nextGoalMethod', 'pregame_fd_ng_correctScore',
  'pregame_fd_sop', 'pregame_fd_header', 'pregame_json',
];

const CORNERS_CSV_COLUMNS = [
  'id', 'sport', 'odds_fingerprint',
  'captured_at', 'league', 'event_id', 'name', 'home', 'away', 'kickoff_at',
  'competition', 'phase', 'situation', 'clock_bin',
  'score_home', 'score_away', 'corners_so_far', 'clock', 'in_play',
  'baseline_book', 'baseline_line',
  'fd_total_line', 'fd_over', 'fd_under',
  'dk_total_line', 'dk_over', 'dk_under',
  'klsh_plus_n', 'klsh_yes', 'klsh_no',
  'model_remaining', 'market_remaining', 'live_over_p',
  'next5_1plus_american', 'next5_1plus_model_p', 'next5_1plus_live_p',
  'next10_1plus_american', 'next10_1plus_model_p', 'next10_1plus_live_p',
  'next5_json', 'next10_json',
  'pregame_fd_total_line', 'pregame_fd_over', 'pregame_fd_under',
  'pregame_dk_total_line', 'pregame_dk_over', 'pregame_dk_under',
  'pregame_klsh_plus_n', 'pregame_klsh_yes', 'pregame_model_remaining',
  'pregame_json',
];

const DRIVES_CSV_COLUMNS = [
  'id', 'sport', 'odds_fingerprint',
  'captured_at', 'event_id', 'name', 'home', 'away', 'kickoff_at',
  'phase', 'offense_side', 'offense_name', 'drive_number', 'market_name',
  'score_home', 'score_away',
  'fd_td', 'fd_fg', 'fd_punt', 'fd_other',
  'dk_td', 'dk_fg', 'dk_punt', 'dk_other',
  'model_td', 'model_fg', 'model_punt', 'model_other',
  'model_p_td', 'model_p_fg', 'model_p_punt', 'model_p_other',
  'live_p_td', 'live_p_fg', 'live_p_punt', 'live_p_other',
  'home_spread', 'total',
  'spread_home_american', 'spread_away_american',
  'total_over_american', 'total_under_american',
  'period', 'clock',
  'pregame_spread', 'pregame_total',
];

const siteDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(siteDir);

try {
  const envContent = fs.readFileSync(path.join(siteDir, '.env.local'), 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch (_) {}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not found in environment or site/.env.local');
  process.exit(1);
}

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const sportArg = args.find((arg) => arg.startsWith('--sport='))?.slice('--sport='.length)
  ?? (args.includes('--sport') ? args[args.indexOf('--sport') + 1] : null);
const outDir = args.find((arg) => arg.startsWith('--out='))?.slice('--out='.length)
  ?? path.join(repoRoot, 'example_data', 'paper_track');

const sql = neon(process.env.DATABASE_URL);

function csvCell(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return csvCell(JSON.stringify(value));
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseExistingIds(file) {
  if (!fs.existsSync(file)) return new Set();
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.length);
  if (lines.length < 2) return new Set();
  const header = splitCsvLine(lines[0]);
  const idIdx = header.indexOf('id');
  if (idIdx < 0) return new Set();
  const ids = new Set();
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    if (cells[idIdx]) ids.add(String(cells[idIdx]));
  }
  return ids;
}

function splitCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function flattenRow(row, columns) {
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? row.payload
    : {};
  const captured = row.captured_at instanceof Date
    ? row.captured_at.toISOString()
    : (payload.captured_at ?? row.captured_at ?? '');
  const merged = {
    ...payload,
    id: row.id,
    sport: row.sport,
    odds_fingerprint: row.odds_fingerprint,
    captured_at: captured,
    event_id: payload.event_id ?? row.event_id,
    phase: payload.phase ?? row.phase,
  };
  return columns.map((col) => csvCell(merged[col] ?? ''));
}

function replaceCsvHeaderIfNeeded(file, columns) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return;
  const text = fs.readFileSync(file, 'utf8');
  const nl = text.indexOf('\n');
  const existingHeader = (nl >= 0 ? text.slice(0, nl) : text).replace(/\r$/, '');
  const wanted = columns.join(',');
  if (existingHeader === wanted) return;
  const rest = nl >= 0 ? text.slice(nl + 1) : '';
  const body = rest.endsWith('\n') || rest === '' ? rest : `${rest}\n`;
  fs.writeFileSync(file, `${wanted}\n${body}`);
}

function appendCsv(file, columns, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  replaceCsvHeaderIfNeeded(file, columns);
  const existing = parseExistingIds(file);
  const fresh = rows.filter((row) => !existing.has(String(row.id)));
  if (!fresh.length) return { wrote: 0, existed: rows.length };
  const lines = fresh.map((row) => flattenRow(row, columns).join(','));
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    fs.writeFileSync(file, `${columns.join(',')}\n${lines.join('\n')}\n`);
  } else {
    fs.appendFileSync(file, `${lines.join('\n')}\n`);
  }
  return { wrote: fresh.length, existed: rows.length - fresh.length };
}

await ensurePaperTrackSchema(sql);
const sport = sportArg === 'sop' || sportArg === 'drives' || sportArg === 'corners' ? sportArg : null;
const rows = await fetchAllSnapshots(sport, sql);
const bySport = { sop: [], drives: [], corners: [] };
for (const row of rows) {
  if (row.sport === 'sop' || row.sport === 'drives' || row.sport === 'corners') {
    bySport[row.sport].push(row);
  }
}

const dumpedIds = [];
for (const [name, columns] of [
  ['sop', SOP_CSV_COLUMNS],
  ['drives', DRIVES_CSV_COLUMNS],
  ['corners', CORNERS_CSV_COLUMNS],
]) {
  if (sport && sport !== name) continue;
  const file = path.join(outDir, `${name}.csv`);
  const result = appendCsv(file, columns, bySport[name]);
  console.log(`${name}: wrote ${result.wrote} new row(s) to ${file} (${result.existed} already in CSV)`);
  dumpedIds.push(...bySport[name].map((row) => row.id));
}

if (keep) {
  console.log('kept Neon rows (--keep)');
} else if (!dumpedIds.length) {
  console.log('nothing to delete');
} else {
  const deleted = await deleteSnapshotsByIds(dumpedIds, sql);
  console.log(`deleted ${deleted} Neon row(s)`);
}
