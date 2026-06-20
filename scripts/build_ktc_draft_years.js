#!/usr/bin/env node
/**
 * build_ktc_draft_years.js
 *
 * Builds name/sleeper_id → NFL draft year lookup from:
 *   - KTC dynasty rankings playersArray (draftYear)
 *   - KTC rookie rankings playersArray (draftYear)
 *   - Sleeper players.txt metadata.rookie_year (fallback)
 *
 * Output: site/public/data/ktc_draft_years.json
 *
 * Usage (from project root):
 *   node scripts/build_ktc_draft_years.js
 *   node scripts/build_ktc_draft_years.js --ktc-html /tmp/ktc.html --rookie-html /tmp/rook.html
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR     = path.join(__dirname, '../site/public/data');
const OUT_FILE     = path.join(DATA_DIR, 'ktc_draft_years.json');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.txt');
const NAME_IDS     = path.join(DATA_DIR, 'ktc_historical_name_ids.csv');
const DEFAULT_KTC  = '/tmp/ktc_rankings.html';
const DEFAULT_ROOK = '/tmp/ktc_rookie_rankings.html';

function normalise(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadPlayersArray(htmlPath) {
  if (!fs.existsSync(htmlPath)) return [];
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/var playersArray\s*=\s*(\[.*?\]);/s);
  if (!m) return [];
  return JSON.parse(m[1]);
}

function setDraftYear(maps, name, sleeperId, year) {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 1950 || y > 2100) return;
  if (name) {
    maps.byName.set(name, y);
    maps.byNormalisedName.set(normalise(name), y);
  }
  if (sleeperId) maps.bySleeperId.set(String(sleeperId), y);
}

function loadSleeperFallback() {
  const raw = fs.readFileSync(PLAYERS_FILE, 'utf8');
  const data = JSON.parse(raw);
  const bySleeperId = new Map();
  for (const [id, p] of Object.entries(data)) {
    const ry = p.metadata?.rookie_year;
    if (!ry) continue;
    bySleeperId.set(String(id), Number(ry));
  }
  return bySleeperId;
}

function loadNameIdSleeperHints() {
  if (!fs.existsSync(NAME_IDS)) return new Map();
  const lines = fs.readFileSync(NAME_IDS, 'utf8').trim().split('\n');
  const headers = lines[0].split(',');
  const nameIdx = headers.indexOf('name');
  const sidIdx  = headers.indexOf('sleeper_id');
  const hints = new Map();
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const name = (cols[nameIdx] || '').trim();
    const sid  = (cols[sidIdx] || '').trim();
    if (name && sid) hints.set(name, sid);
  }
  return hints;
}

function mergeKtcHtml(maps, htmlPath, nameToSleeper) {
  for (const p of loadPlayersArray(htmlPath)) {
    const name = (p.playerName || '').trim();
    const year = p.draftYear;
    if (!name || year == null) continue;
    const sid = nameToSleeper.get(name) || '';
    setDraftYear(maps, name, sid, year);
  }
}

function run() {
  const args = process.argv.slice(2);
  const ktcIdx = args.indexOf('--ktc-html');
  const rookIdx = args.indexOf('--rookie-html');
  const ktcHtml = ktcIdx >= 0 ? args[tcIdx + 1] : DEFAULT_KTC;
  const rookHtml = rookIdx >= 0 ? args[rookIdx + 1] : DEFAULT_ROOK;

  const byName = new Map();
  const byNormalisedName = new Map();
  const bySleeperId = loadSleeperFallback();
  const nameToSleeper = loadNameIdSleeperHints();

  // KTC draftYear overrides Sleeper where present (prospect classes are fresher).
  mergeKtcHtml({ byName, byNormalisedName, bySleeperId }, ktcHtml, nameToSleeper);
  mergeKtcHtml({ byName, byNormalisedName, bySleeperId }, rookHtml, nameToSleeper);

  const out = {
    generated: new Date().toISOString(),
    byName: Object.fromEntries(byName),
    byNormalisedName: Object.fromEntries(byNormalisedName),
    bySleeperId: Object.fromEntries(bySleeperId),
  };

  fs.writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${byName.size.toLocaleString()} KTC names → ${OUT_FILE}`);
}

run();
