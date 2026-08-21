#!/usr/bin/env node
/**
 * Diff the live DBB custom board against a frozen pre-update baseline.
 *
 * Usage (from project root):
 *   node scripts/diff_redraft_baseline.js
 *   node scripts/diff_redraft_baseline.js 2026-08-21_pre_draft
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASELINES = path.join(ROOT, 'dbbp/redraft-dash/baselines');
const LIVE = path.join(ROOT, 'dbbp/redraft-dash/dbb_custom_rankings.csv');

const label = process.argv[2] || newestBaseline();
if (!label) {
  console.error('No baselines found under dbbp/redraft-dash/baselines/');
  process.exit(1);
}

const baselineCsv = path.join(BASELINES, label, 'dbb_custom_rankings.csv');
if (!fs.existsSync(baselineCsv)) {
  console.error(`Missing baseline board: ${baselineCsv}`);
  process.exit(1);
}
if (!fs.existsSync(LIVE)) {
  console.error(`Missing live board: ${LIVE}`);
  process.exit(1);
}

function newestBaseline() {
  if (!fs.existsSync(BASELINES)) return null;
  return fs.readdirSync(BASELINES)
    .filter((d) => fs.existsSync(path.join(BASELINES, d, 'dbb_custom_rankings.csv')))
    .sort()
    .at(-1) || null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; }
        else inQuotes = false;
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

function readBoard(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function keyOf(row) {
  if (row.sleeper_id) return `id:${row.sleeper_id}`;
  return `name:${row.player.toLowerCase().replace(/[^a-z0-9]/g, '')}|${row.position}`;
}

const oldRows = readBoard(baselineCsv);
const newRows = readBoard(LIVE);
const oldMap = new Map(oldRows.map((r) => [keyOf(r), r]));
const newMap = new Map(newRows.map((r) => [keyOf(r), r]));

const entered = [];
const left = [];
const moved = [];

for (const [k, n] of newMap) {
  const o = oldMap.get(k);
  if (!o) {
    entered.push(n);
    continue;
  }
  const oRank = Number(o.rank);
  const nRank = Number(n.rank);
  const oTier = Number(o.tier);
  const nTier = Number(n.tier);
  const delta = oRank - nRank;
  if (delta !== 0 || oTier !== nTier) {
    moved.push({
      player: n.player,
      position: n.position,
      oldRank: oRank,
      newRank: nRank,
      delta,
      oldTier: oTier,
      newTier: nTier,
      abs: Math.abs(delta),
    });
  }
}
for (const [k, o] of oldMap) {
  if (!newMap.has(k)) left.push(o);
}

moved.sort((a, b) => b.abs - a.abs || b.delta - a.delta || a.newRank - b.newRank);
entered.sort((a, b) => Number(a.rank) - Number(b.rank));
left.sort((a, b) => Number(a.rank) - Number(b.rank));

console.log(`Baseline: ${label}`);
console.log(`Live:     ${LIVE}`);
console.log(`Counts:   ${oldRows.length} → ${newRows.length}`);
console.log(`Moved:    ${moved.filter((m) => m.abs > 0).length} ranks changed (${moved.filter((m) => m.abs >= 5).length} by ≥5)`);
console.log(`Entered:  ${entered.length}`);
console.log(`Left:     ${left.length}`);

const topN = Math.min(20, oldRows.length, newRows.length);
let topChanged = false;
for (let i = 0; i < topN; i += 1) {
  if (oldRows[i].player !== newRows[i].player) {
    if (!topChanged) {
      console.log(`\nTop-${topN} order changes:`);
      topChanged = true;
    }
    console.log(`  #${i + 1}: ${oldRows[i].player} → ${newRows[i].player}`);
  }
}
if (!topChanged) console.log(`\nTop-${topN}: unchanged order`);

console.log('\nBiggest movers (|Δ|≥3):');
const big = moved.filter((m) => m.abs >= 3);
if (!big.length) console.log('  (none)');
for (const m of big.slice(0, 40)) {
  const tier = m.oldTier !== m.newTier ? ` T${m.oldTier}→T${m.newTier}` : ` T${m.newTier}`;
  const sign = m.delta > 0 ? '+' : '';
  console.log(`  ${m.oldRank}→${m.newRank} (${sign}${m.delta})  ${m.player} (${m.position})${tier}`);
}

if (entered.length) {
  console.log('\nEntered:');
  for (const r of entered.slice(0, 20)) {
    console.log(`  + #${r.rank} ${r.player} (${r.position}) T${r.tier}`);
  }
}
if (left.length) {
  console.log('\nLeft:');
  for (const r of left.slice(0, 20)) {
    console.log(`  - #${r.rank} ${r.player} (${r.position}) T${r.tier}`);
  }
}
