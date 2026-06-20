#!/usr/bin/env node
/**
 * process_fantasypros_adp.js
 *
 * Fetches a FantasyPros ADP page, parses the rankings table, optionally
 * matches players to Sleeper IDs, and writes a CSV.
 *
 * Output columns (fixed):
 *   rank, name, fp_id, player_slug, team, bye_week, position, pos_rank, avg, sleeper_id
 * Plus one column per ADP source site (e.g. sleeper, rtsports, espn).
 *
 * Usage:
 *   node scripts/process_fantasypros_adp.js <type> <year> [output_csv]
 *
 *   type        — overall | half | ppr | bestball
 *   year        — season year, e.g. 2024
 *   output_csv  — optional; defaults to site/public/data/adp/fantasypros_adp_<type>_<year>.csv
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

const PLAYERS_FILE       = path.join(__dirname, '../site/public/data/players.txt');
const RELEVANT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST']);

const URLS = {
  overall:  'https://www.fantasypros.com/nfl/adp/overall.php?year={year}',
  half:     'https://www.fantasypros.com/nfl/adp/half-point-ppr-overall.php?year={year}',
  ppr:      'https://www.fantasypros.com/nfl/adp/ppr-overall.php?year={year}',
  bestball: 'https://www.fantasypros.com/nfl/adp/best-ball-overall.php?year={year}',
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

// ── Args ──────────────────────────────────────────────────────────────────────

const [,, type, yearStr, outCsvArg] = process.argv;

if (!type || !yearStr || !URLS[type]) {
  console.error('Usage: node process_fantasypros_adp.js <overall|half|ppr|bestball> <year> [output_csv]');
  process.exit(1);
}

const year = parseInt(yearStr, 10);
if (!Number.isFinite(year)) {
  console.error(`Invalid year: ${yearStr}`);
  process.exit(1);
}

const outCsv = outCsvArg || path.join(
  __dirname,
  '../site/public/data/adp',
  `fantasypros_adp_${type}_${year}.csv`,
);

// ── Fetch ─────────────────────────────────────────────────────────────────────

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error(`Timeout fetching ${url}`)); });
  });
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function stripTags(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeSourceHeader(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function parsePosRank(posCell) {
  const m = (posCell || '').trim().match(/^([A-Z]+)(\d+)$/);
  if (!m) return { position: (posCell || '').trim(), posRank: '' };
  return { position: m[1], posRank: parseInt(m[2], 10) };
}

function parsePlayerCell(cellHtml) {
  const fpIdMatch = cellHtml.match(/fp-id-(\d+)/);
  const nameMatch = cellHtml.match(/fp-player-name="([^"]*)"/);
  const hrefMatch = cellHtml.match(/href="\/nfl\/players\/([^"]+)\.php"/);
  const smalls = [...cellHtml.matchAll(/<small>([^<]*)<\/small>/g)].map((m) => m[1].trim());

  let team = '';
  let byeWeek = '';
  for (const s of smalls) {
    const bye = s.match(/^\((\d+)\)$/);
    if (bye) byeWeek = bye[1];
    else if (/^[A-Z]{2,3}$/.test(s)) team = s;
  }

  return {
    name:       nameMatch ? nameMatch[1].trim() : stripTags(cellHtml),
    fpId:       fpIdMatch ? fpIdMatch[1] : '',
    playerSlug: hrefMatch ? hrefMatch[1] : '',
    team,
    byeWeek,
  };
}

function parseAdpPage(html) {
  if (html.includes('Sorry, this report is not available')) {
    return { unavailable: true, sources: [], players: [] };
  }

  const theadMatch = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  if (!theadMatch) {
    throw new Error('Could not find <thead> in page HTML.');
  }

  const headerCells = [...theadMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
    .map((m) => stripTags(m[1]));

  const avgIndex = headerCells.findIndex((h) => h.toUpperCase() === 'AVG');
  if (avgIndex === -1) {
    throw new Error('Could not find AVG column in table header.');
  }

  // Source columns sit between POS and AVG; any columns after AVG (e.g. Real-Time) are bonus sources.
  const sourceHeaders = [
    ...headerCells.slice(3, avgIndex),
    ...headerCells.slice(avgIndex + 1),
  ];
  const sources = sourceHeaders.map(normalizeSourceHeader).filter(Boolean);

  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) {
    throw new Error('Could not find <tbody> in page HTML.');
  }

  const players = [];
  const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRe.exec(tbodyMatch[1])) !== null) {
    const rowHtml = rowMatch[1];
    if (rowHtml.includes('colspan')) continue;

    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 4) continue;

    const rank = parseInt(stripTags(cells[0]), 10);
    if (!Number.isFinite(rank)) continue;

    const player = parsePlayerCell(cells[1]);
    const { position, posRank } = parsePosRank(stripTags(cells[2]));

    const sourceValues = {};
    const sourceCellIndices = [
      ...Array.from({ length: avgIndex - 3 }, (_, i) => i + 3),
      ...Array.from({ length: cells.length - avgIndex - 1 }, (_, i) => avgIndex + 1 + i),
    ];
    for (let i = 0; i < sources.length; i++) {
      const cellIdx = sourceCellIndices[i];
      if (cellIdx != null && cellIdx < cells.length) {
        sourceValues[sources[i]] = stripTags(cells[cellIdx]);
      }
    }

    const avg = stripTags(cells[avgIndex]);

    players.push({
      rank,
      ...player,
      position,
      posRank,
      avg,
      sources: sourceValues,
    });
  }

  if (players.length === 0) {
    throw new Error('No player rows found in page HTML.');
  }

  return { unavailable: false, sources, players };
}

// ── Name normalisation / Sleeper matching (same logic as rankings scraper) ───

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

function findBestPlayerMatch(searchName, candidates, hints) {
  const normSearch     = normalise(searchName);
  const lastNameSearch = normSearch.split(' ').pop();

  function hintScore(c) {
    let score = 0;
    if (hints.position && c.position) {
      if (c.position.toUpperCase() === hints.position.toUpperCase()) score += 4;
    }
    if (hints.team && c.team) {
      if (c.team.toUpperCase() === hints.team.toUpperCase()) score += 2;
    }
    return score;
  }

  function pickBest(pool) {
    if (pool.length === 0) return null;
    if (pool.length === 1) return pool[0];
    const hasHints = hints.position || hints.team;
    if (!hasHints) return null;
    const scored = pool
      .map((c) => ({ c, score: hintScore(c) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score > 0 && scored[0].score > scored[1].score) return scored[0].c;
    return null;
  }

  const exactPool = candidates.filter((c) => c.fullName === searchName);
  if (exactPool.length === 1) return exactPool[0];
  if (exactPool.length > 1) {
    const best = pickBest(exactPool);
    if (best) return best;
    return null;
  }

  const normPool = candidates.filter((c) => normalise(c.fullName) === normSearch);
  if (normPool.length === 1) return normPool[0];
  if (normPool.length > 1) {
    const best = pickBest(normPool);
    if (best) return best;
    return null;
  }

  if (hints.position || hints.team) {
    const lastNamePool = candidates.filter((c) => {
      const normCand = normalise(c.fullName);
      if (normCand.split(' ').pop() !== lastNameSearch) return false;
      if (hints.position && c.position.toUpperCase() !== hints.position.toUpperCase()) return false;
      if (hints.team    && c.team.toUpperCase()     !== hints.team.toUpperCase())     return false;
      return true;
    });
    if (lastNamePool.length === 1) return lastNamePool[0];
    if (lastNamePool.length > 1) {
      const best = pickBest(lastNamePool);
      if (best) return best;
    }
  }

  return null;
}

function loadSleeperCandidates() {
  if (!fs.existsSync(PLAYERS_FILE)) {
    console.warn(`  WARNING: players.txt not found — skipping Sleeper ID matching.`);
    return [];
  }
  const data = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));

  return Object.entries(data)
    .map(([id, p]) => {
      const pos = p.position || (p.fantasy_positions && p.fantasy_positions[0]) || '';
      if (!RELEVANT_POSITIONS.has(pos)) return null;
      const fullName = (p.full_name || '').trim();
      if (!fullName) return null;
      return {
        sleeperId: id,
        fullName,
        position:  pos,
        team:      (p.team || p.team_abbr || '').toUpperCase(),
      };
    })
    .filter(Boolean);
}

// ── CSV output ────────────────────────────────────────────────────────────────

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(players, sources) {
  const outDir = path.dirname(outCsv);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const fixedCols = ['rank', 'name', 'fp_id', 'player_slug', 'team', 'bye_week', 'position', 'pos_rank'];
  const tailCols  = ['avg', 'sleeper_id'];
  const header    = [...fixedCols, ...sources, ...tailCols];

  const lines = [header.join(',')];
  for (const p of players) {
    const row = [
      p.rank,
      csvEscape(p.name),
      p.fpId,
      p.playerSlug,
      p.team,
      p.byeWeek,
      p.position,
      p.posRank,
      ...sources.map((s) => p.sources[s] ?? ''),
      p.avg,
      p.sleeperId ?? '',
    ];
    lines.push(row.join(','));
  }

  fs.writeFileSync(outCsv, lines.join('\n') + '\n', 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const url = URLS[type].replace('{year}', year);
  console.log(`  Fetching ${type} ADP ${year}…`);

  const html = await fetchUrl(url);
  const { unavailable, sources, players } = parseAdpPage(html);

  if (unavailable) {
    console.log(`  Skipped: data not available for ${type} ${year}`);
    process.exit(0);
  }

  const sleeperPool = loadSleeperCandidates();
  let matched = 0;

  for (const p of players) {
    const candidate = findBestPlayerMatch(p.name, sleeperPool, {
      position: p.position,
      team:     p.team || undefined,
    });
    if (candidate) {
      p.sleeperId = candidate.sleeperId;
      matched++;
    }
  }

  writeCsv(players, sources);

  console.log(`  Output: ${outCsv}`);
  console.log(`  ${players.length} players, ${sources.length} source(s): ${sources.join(', ') || 'none'}`);
  if (sleeperPool.length > 0) {
    console.log(`  Matched ${matched} / ${players.length} to Sleeper IDs`);
  }

  return 'ok';
}

run().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
