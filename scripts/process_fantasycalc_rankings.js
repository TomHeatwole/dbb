#!/usr/bin/env node
/**
 * process_fantasycalc_rankings.js
 *
 * Fetches dynasty player values from the FantasyCalc public API and writes
 * site/public/data/fantasycalc.csv.
 *
 * FantasyCalc serves its rankings page as a client-side Angular SPA — no
 * data is embedded in the HTML.  The underlying API is public and requires
 * no authentication.
 *
 * API endpoint:
 *   https://api.fantasycalc.com/values/current
 *     ?isDynasty=true
 *     &numQbs=2      ← superflex / 2QB format (matches existing data)
 *     &ppr=0.5       ← half-PPR
 *
 * Output format (semicolon-delimited, mirrors FantasyCalc's own CSV export):
 *   name;team;position;age;fantasycalcId;sleeperId;mflId;value;overallRank;positionRank;trend30day
 *
 * Usage (run from project root):
 *   node scripts/process_fantasycalc_rankings.js
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_URL = 'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&ppr=0.5';
const OUT_CSV = path.join(__dirname, '../site/public/data/fantasycalc.csv');

// ── Fetch JSON from the API ───────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; dbb-updater)',
        'Accept':     'application/json',
      },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// ── Build CSV ─────────────────────────────────────────────────────────────────

function q(val) {
  // Wrap strings in double-quotes; pass numbers through unquoted.
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return String(val);
  return `"${String(val).replace(/"/g, '""')}"`;
}

function writeCsv(players) {
  const header = 'name;team;position;age;fantasycalcId;sleeperId;mflId;value;overallRank;positionRank;trend30day';
  const lines   = [header];

  for (const entry of players) {
    const p = entry.player;
    lines.push([
      q(p.name),
      q(p.maybeTeam  ?? ''),
      q(p.position   ?? ''),
      p.maybeAge     ?? '',
      p.id,
      q(p.sleeperId  ?? ''),
      q(p.mflId      ?? ''),
      entry.value       ?? '',
      entry.overallRank ?? '',
      entry.positionRank ?? '',
      entry.trend30Day  ?? 0,
    ].join(';'));
  }

  fs.writeFileSync(OUT_CSV, lines.join('\n') + '\n', 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`Fetching FantasyCalc dynasty values…`);
  console.log(`  ${API_URL}`);

  let data;
  try {
    data = await fetchJson(API_URL);
  } catch (err) {
    console.error(`ERROR: Failed to fetch FantasyCalc data: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(data) || data.length === 0) {
    console.error('ERROR: API returned an unexpected response (expected a non-empty array).');
    process.exit(1);
  }

  writeCsv(data);

  console.log(`Output: ${OUT_CSV}`);
  console.log(`Written ${data.length} players.`);
}

run();
