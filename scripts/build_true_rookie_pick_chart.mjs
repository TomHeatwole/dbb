#!/usr/bin/env node
/**
 * Build site/public/data/true_rookie_pick_chart.json
 *
 * 5-season Hwang True pick chart: order each May 20 rookie class by True value,
 * map onto Early/Mid/Late slots, average True ÷ market multipliers.
 *
 * Usage: node scripts/build_true_rookie_pick_chart.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'site/public/data');

const TRUE_COEFFS = {
  QB: { c: 0.932, k: -0.175 },
  RB: { c: 1.263, k: 0.345 },
  WR: { c: 0.866, k: -0.030 },
  TE: { c: 0.981, k: -0.140 },
};
const VREF = 5000;
const TEAMS = 12;
const TOP_N = 48;
const WINDOW = 5;
const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];
const ROUND_ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
const ROUND_LABELS = { 1: 'First', 2: 'Second', 3: 'Third', 4: 'Fourth' };
const TIER_ORDER = ['Early', 'Mid', 'Late'];

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    return row;
  });
}

function trueVal(pos, v) {
  const coeff = TRUE_COEFFS[pos];
  if (!coeff) return null;
  const vv = Math.max(Number(v) || 0, 100);
  return Math.round(v * coeff.c * ((vv / VREF) ** coeff.k));
}

function mean(xs) {
  if (!xs.length) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

function slotMeta(slot) {
  const round = Math.ceil(slot / TEAMS);
  const pickInRound = ((slot - 1) % TEAMS) + 1;
  const tier = pickInRound <= 4 ? 'Early' : pickInRound <= 8 ? 'Mid' : 'Late';
  return {
    round,
    pickInRound,
    tier,
    draftSlot: `${round}.${String(pickInRound).padStart(2, '0')}`,
    tierKey: `${tier} ${ROUND_ORD[round]}`,
  };
}

function summarize(trueValues, marketValues, pairedTrue) {
  const avgTrueValue = mean(trueValues);
  const avgMarketValue = mean(marketValues);
  const avgTrueForMult = mean(pairedTrue);
  const multiplier = (avgTrueForMult != null && avgMarketValue > 0)
    ? Number((avgTrueForMult / avgMarketValue).toFixed(4))
    : null;
  return { avgTrueValue, avgMarketValue, multiplier };
}

const draftMap = JSON.parse(readFileSync(join(DATA, 'ktc_draft_years.json'), 'utf8'));

function draftYear(name, sid) {
  if (sid && draftMap.bySleeperId?.[sid] != null) return Number(draftMap.bySleeperId[sid]);
  if (name && draftMap.byName?.[name] != null) return Number(draftMap.byName[name]);
  return null;
}

const picksByDate = new Map();
for (const row of parseCsv(readFileSync(join(DATA, 'sf_non_tep_ktc_values_historical.csv'), 'utf8'))) {
  const name = (row.name || '').trim();
  const parts = name.split(/\s+/);
  if (parts.length < 3 || !TIER_ORDER.includes(parts[1])) continue;
  const date = (row.date || '').trim();
  const value = parseInt(row.ktc_value, 10);
  if (!date || !Number.isFinite(value)) continue;
  if (!picksByDate.has(date)) picksByDate.set(date, new Map());
  picksByDate.get(date).set(name, value);
}

function buildClassRows(year, rookies) {
  const target = `${year}-05-20`;
  const dayPicks = picksByDate.get(target) || new Map();
  return rookies.slice(0, TOP_N).map((r, idx) => {
    const meta = slotMeta(idx + 1);
    const pickName = `${year} ${meta.tier} ${ROUND_ORD[meta.round]}`;
    return {
      trueValue: r.trueValue,
      pickValue: dayPicks.get(pickName) ?? null,
      ...meta,
    };
  });
}

const byYear = new Map();

const filled = parseCsv(readFileSync(join(DATA, 'sf_ktc_values_historical_filled.csv'), 'utf8'));
for (const year of YEARS.filter((y) => y <= 2025)) {
  const rookies = [];
  for (const row of filled) {
    if ((row.snapshot_kind || '').trim() !== 'rookie_draft') continue;
    if (Number(row.year) !== year) continue;
    const name = (row.name || '').trim();
    const position = (row.position || '').trim().toUpperCase();
    const ktcValue = parseInt(row.ktc_value, 10);
    const sid = (row.sleeper_id || '').trim();
    if (!TRUE_COEFFS[position] || !Number.isFinite(ktcValue)) continue;
    if (draftYear(name, sid) !== year) continue;
    const tv = trueVal(position, ktcValue);
    if (tv == null) continue;
    rookies.push({ trueValue: tv, ktcValue, name, position });
  }
  rookies.sort((a, b) => b.trueValue - a.trueValue || b.ktcValue - a.ktcValue);
  byYear.set(year, buildClassRows(year, rookies));
}

// 2026 from live board
{
  const live = parseCsv(readFileSync(join(DATA, 'ktc_values.csv'), 'utf8'));
  const rookies = [];
  for (const row of live) {
    const position = (row.position || '').trim().toUpperCase();
    if (!TRUE_COEFFS[position]) continue;
    const name = (row.name || '').trim();
    if (draftYear(name, '') !== 2026) continue;
    const sf = parseInt(row.ktc_value_2qb, 10);
    const tep = parseInt(row.ktc_value_tep_2qb, 10);
    const ktcValue = position === 'TE' ? (Number.isFinite(tep) ? tep : sf) : sf;
    if (!Number.isFinite(ktcValue)) continue;
    const tv = trueVal(position, ktcValue);
    if (tv == null) continue;
    rookies.push({ trueValue: tv, ktcValue, name, position });
  }
  rookies.sort((a, b) => b.trueValue - a.trueValue || b.ktcValue - a.ktcValue);
  byYear.set(2026, buildClassRows(2026, rookies));
}

const available = YEARS.filter((y) => (byYear.get(y) || []).length > 0);
const avgYears = available.slice(-WINDOW);

const slotTrue = new Map();
const slotMarket = new Map();
const slotPaired = new Map();
const roundTrue = new Map();
const roundMarket = new Map();
const roundPaired = new Map();
const tierTrue = new Map();
const tierMarket = new Map();
const tierPaired = new Map();
const marketYears = new Set();

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

for (const year of avgYears) {
  const seen = new Set();
  let hasMarket = false;
  for (const row of byYear.get(year)) {
    const has = row.pickValue != null && row.pickValue > 0;
    if (has) hasMarket = true;
    push(slotTrue, row.draftSlot, row.trueValue);
    push(roundTrue, row.round, row.trueValue);
    push(tierTrue, row.tierKey, row.trueValue);
    if (has) {
      push(slotMarket, row.draftSlot, row.pickValue);
      push(slotPaired, row.draftSlot, row.trueValue);
      push(roundMarket, row.round, row.pickValue);
      push(roundPaired, row.round, row.trueValue);
      push(tierPaired, row.tierKey, row.trueValue);
      if (!seen.has(row.tierKey)) {
        seen.add(row.tierKey);
        push(tierMarket, row.tierKey, row.pickValue);
      }
    }
  }
  if (hasMarket) marketYears.add(year);
}

const slots = [];
for (let i = 1; i <= TOP_N; i += 1) {
  const meta = slotMeta(i);
  slots.push({
    draftSlot: meta.draftSlot,
    overallSlot: i,
    round: meta.round,
    pickInRound: meta.pickInRound,
    tier: meta.tier.toLowerCase(),
    tierLabel: meta.tierKey,
    ...summarize(
      slotTrue.get(meta.draftSlot) || [],
      slotMarket.get(meta.draftSlot) || [],
      slotPaired.get(meta.draftSlot) || [],
    ),
  });
}

const rounds = [1, 2, 3, 4].map((round) => ({
  round,
  label: ROUND_LABELS[round],
  ...summarize(
    roundTrue.get(round) || [],
    roundMarket.get(round) || [],
    roundPaired.get(round) || [],
  ),
}));

const tiers = [];
for (const round of [1, 2, 3, 4]) {
  for (const tier of TIER_ORDER) {
    const key = `${tier} ${ROUND_ORD[round]}`;
    tiers.push({
      key,
      tier: tier.toLowerCase(),
      round,
      roundOrd: ROUND_ORD[round],
      label: key,
      ...summarize(
        tierTrue.get(key) || [],
        tierMarket.get(key) || [],
        tierPaired.get(key) || [],
      ),
    });
  }
}

const out = {
  generated: new Date().toISOString(),
  windowSize: WINDOW,
  years: avgYears,
  marketYears: [...marketYears].sort((a, b) => a - b),
  teamsPerRound: TEAMS,
  earlyPickMax: 4,
  midPickMax: 8,
  rounds,
  tiers,
  slots,
  multiplierByTier: Object.fromEntries(tiers.map((t) => [t.key, t.multiplier])),
  avgTrueByTier: Object.fromEntries(tiers.map((t) => [t.key, t.avgTrueValue])),
  multiplierBySlot: Object.fromEntries(slots.map((s) => [s.draftSlot, s.multiplier])),
  avgTrueBySlot: Object.fromEntries(slots.map((s) => [s.draftSlot, s.avgTrueValue])),
  multiplierByRound: Object.fromEntries(rounds.map((r) => [String(r.round), r.multiplier])),
};

const outPath = join(DATA, 'true_rookie_pick_chart.json');
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
console.log('Years:', avgYears.join(', '));
console.log('Sample multipliers:', out.multiplierByTier);
