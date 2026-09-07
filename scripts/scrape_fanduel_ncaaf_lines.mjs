#!/usr/bin/env node
/**
 * Drive the FanDuel Sportsbook Android app via Appium and pull spread + O/U
 * for every upcoming NCAA football game on the slate.
 *
 * Prerequisites:
 *   ANDROID_HOME / JAVA_HOME (or scripts/start-appium.sh)
 *   Appium 3 + uiautomator2 on :4723
 *   emulator-5554 (or --udid) with com.fanduel.sportsbook installed
 *
 * Usage:
 *   node scripts/scrape_fanduel_ncaaf_lines.mjs
 *   node scripts/scrape_fanduel_ncaaf_lines.mjs --udid emulator-5554 --out example_data/ncaaf_drive_results/fanduel_ncaaf_lines.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'example_data', 'ncaaf_drive_results', 'fanduel_ncaaf_lines.json');
const APPIUM = process.env.APPIUM_URL || 'http://127.0.0.1:4723';
const PACKAGE = 'com.fanduel.sportsbook';
const ACTIVITY = 'com.fanduel.sportsbook.Launcher';

function parseArgs(argv) {
  const args = { udid: 'emulator-5554', out: DEFAULT_OUT, keepSession: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--udid') args.udid = argv[++i];
    else if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else if (argv[i] === '--keep-session') args.keepSession = true;
  }
  return args;
}

function decodeXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u00a0/g, ' ');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function wd(method, urlPath, body) {
  const res = await fetch(`${APPIUM}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.value?.message || json?.value?.error || JSON.stringify(json);
    const err = new Error(`${method} ${urlPath} ${res.status}: ${msg}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json.value ?? json;
}

async function createSession(udid) {
  const created = await wd('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:udid': udid,
        'appium:appPackage': PACKAGE,
        'appium:appActivity': ACTIVITY,
        'appium:noReset': true,
        'appium:dontStopAppOnReset': true,
        'appium:autoGrantPermissions': true,
        'appium:newCommandTimeout': 300,
        'appium:disableWindowAnimation': true,
      },
    },
  });
  return created.sessionId;
}

async function source(sessionId) {
  return decodeXml(String(await wd('GET', `/session/${sessionId}/source`)));
}

function parseBounds(fragment) {
  const m = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(fragment);
  if (!m) return null;
  return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
}

function center(bounds) {
  return {
    x: Math.round((bounds.x1 + bounds.x2) / 2),
    y: Math.round((bounds.y1 + bounds.y2) / 2),
  };
}

async function tap(sessionId, x, y) {
  await wd('POST', `/session/${sessionId}/actions`, {
    actions: [{
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 70 },
        { type: 'pointerUp', button: 0 },
      ],
    }],
  });
  await wd('POST', `/session/${sessionId}/actions`, { actions: [] }).catch(() => {});
}

async function tapDesc(sessionId, xml, pattern) {
  const re = new RegExp(`content-desc="([^"]*${pattern}[^"]*)"[\\s\\S]{0,500}?bounds="\\[[^\\]]+\\]\\[[^\\]]+\\]"`);
  const m = re.exec(xml);
  if (!m) return false;
  const b = parseBounds(m[0]);
  if (!b) return false;
  const { x, y } = center(b);
  await tap(sessionId, x, y);
  return true;
}

async function scrollList(sessionId, direction = 'down') {
  await wd('POST', `/session/${sessionId}/execute/sync`, {
    script: 'mobile: scrollGesture',
    args: [{
      left: 40,
      top: 420,
      width: 1000,
      height: 1700,
      direction,
      percent: 0.85,
    }],
  });
}

async function scrollToTop(sessionId) {
  let stagnant = 0;
  let lastFirst = '';
  for (let i = 0; i < 20 && stagnant < 2; i += 1) {
    await scrollList(sessionId, 'up');
    await sleep(400);
    const xml = await source(sessionId);
    const first = (xml.match(/resource-id="event-card-\d+"/) || [])[0] || '';
    stagnant = first && first === lastFirst ? stagnant + 1 : 0;
    lastFirst = first;
  }
}

const GAME_RE = /Scheduled game\s+(.+?)\s+versus\s+(.+?)\s+start at\s+(.+?)(?:\s+O\/U\s+([0-9.]+),\s*([+-]?[0-9.]+))?$/i;

const SHORT_DATE_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.\s+\d{1,2}\/\d{1,2}$/;

function parseGames(xml, dateState) {
  const games = [];
  let date = dateState.value;
  const nodes = [
    ...xml.matchAll(/(?:content-desc|text)="([^"]+)"(?:[\s\S]{0,240}?resource-id="([^"]+)")?/g),
  ];
  for (const m of nodes) {
    const desc = decodeXml(m[1]).replace(/\s+/g, ' ').trim();
    const resourceId = m[2] || '';
    const header = desc.match(/^Header 2\.\s*(.+?)\.\s*List/i);
    if (header) {
      date = header[1].trim();
      dateState.value = date;
      continue;
    }
    if (SHORT_DATE_RE.test(desc)) {
      date = desc;
      dateState.value = date;
      continue;
    }
    if (!desc.startsWith('Scheduled game')) continue;
    const gm = GAME_RE.exec(desc);
    if (!gm) continue;
    const away = gm[1].trim();
    const home = gm[2].trim();
    const start = gm[3].replace(/\s+O\/U.*$/, '').trim();
    const overUnder = gm[4] ? Number(gm[4]) : null;
    const homeSpread = gm[5] != null && gm[5] !== '' ? Number(gm[5]) : null;
    const eventId = (resourceId.match(/event-card-(\d+)/) || [])[1] || null;
    games.push({
      eventId,
      date,
      away,
      home,
      start,
      overUnder,
      homeSpread,
      awaySpread: homeSpread == null ? null : -homeSpread,
      raw: desc,
    });
  }
  return games;
}

function mergeGames(byId, games) {
  let added = 0;
  for (const g of games) {
    const key = g.eventId || `${g.away}|${g.home}|${g.start}`;
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, g);
      added += 1;
    } else if (!prev.date && g.date) {
      prev.date = g.date;
    }
  }
  return added;
}

async function openNcaafList(sessionId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const xml = await source(sessionId);
    const games = parseGames(xml, { value: null });
    if (games.length) {
      // List can reopen mid-slate after a prior session. Close + reopen, then
      // fling to the first date so we do not miss early games.
      if (await tapDesc(sessionId, xml, 'Close modal window')) {
        await sleep(1200);
        const afterClose = await source(sessionId);
        await tapDesc(sessionId, afterClose, 'NCAA Football Games');
        await sleep(1800);
      }
      await scrollToTop(sessionId);
      return source(sessionId);
    }
    if (await tapDesc(sessionId, xml, 'NCAA Football Games')) {
      await sleep(1800);
      continue;
    }
    if (await tapDesc(sessionId, xml, 'College Football')) {
      await sleep(1800);
      continue;
    }
    if (await tapDesc(sessionId, xml, 'NCAA Football')) {
      await sleep(1800);
      continue;
    }
    if (await tapDesc(sessionId, xml, 'All Sports')) {
      await sleep(1800);
      continue;
    }
    await sleep(800);
  }
  return source(sessionId);
}

function sortKey(game) {
  const months = {
    jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
    apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
    aug: '08', august: '08', sep: '09', september: '09', oct: '10', october: '10',
    nov: '11', november: '11', dec: '12', december: '12',
  };
  let month = '99';
  let day = '99';
  const short = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.\s+(\d{1,2})\/(\d{1,2})/i.exec(game.date || '');
  const long = /([A-Za-z]+)\s+(\d{1,2})/.exec(game.date || '');
  if (short) {
    month = String(short[1]).padStart(2, '0');
    day = String(short[2]).padStart(2, '0');
  } else if (long && months[long[1].toLowerCase()]) {
    month = months[long[1].toLowerCase()];
    day = String(long[2]).padStart(2, '0');
  }
  const tm = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(game.start || '');
  let minutes = 9999;
  if (tm) {
    let hour = Number(tm[1]) % 12;
    if (/pm/i.test(tm[3])) hour += 12;
    minutes = hour * 60 + Number(tm[2]);
  }
  return `${month}-${day}-${String(minutes).padStart(4, '0')}`;
}

function formatTable(games) {
  const rows = games.map((g) => {
    const spread = g.homeSpread == null
      ? '—'
      : `${g.home} ${g.homeSpread > 0 ? '+' : ''}${g.homeSpread}`;
    const ou = g.overUnder == null ? '—' : g.overUnder.toFixed(1);
    return {
      matchup: `${g.away} @ ${g.home}`,
      when: [g.date, g.start].filter(Boolean).join(' · '),
      spread,
      ou,
    };
  });
  const w0 = Math.max(8, ...rows.map((r) => r.matchup.length));
  const w1 = Math.max(4, ...rows.map((r) => r.when.length));
  const w2 = Math.max(6, ...rows.map((r) => r.spread.length));
  const lines = [
    `${'MATCHUP'.padEnd(w0)}  ${'WHEN'.padEnd(w1)}  ${'HOME SPREAD'.padEnd(w2)}  O/U`,
    `${''.padEnd(w0, '─')}  ${''.padEnd(w1, '─')}  ${''.padEnd(w2, '─')}  ────`,
    ...rows.map((r) => `${r.matchup.padEnd(w0)}  ${r.when.padEnd(w1)}  ${r.spread.padEnd(w2)}  ${r.ou}`),
  ];
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`Connecting to Appium at ${APPIUM} (udid=${args.udid})...\n`);
  const sessionId = await createSession(args.udid);
  process.stdout.write(`Session ${sessionId}\n`);
  try {
    await sleep(2000);
    let xml = await openNcaafList(sessionId);
    const byId = new Map();
    const dateState = { value: null };
    mergeGames(byId, parseGames(xml, dateState));
    process.stdout.write(`Visible after navigate: ${byId.size} games\n`);

    let stagnant = 0;
    for (let i = 0; i < 40 && stagnant < 3; i += 1) {
      await scrollList(sessionId);
      await sleep(700);
      xml = await source(sessionId);
      const added = mergeGames(byId, parseGames(xml, dateState));
      process.stdout.write(`  scroll ${i + 1}: +${added} (total ${byId.size})\n`);
      stagnant = added === 0 ? stagnant + 1 : 0;
    }

    const games = [...byId.values()];
    games.sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      return ka.localeCompare(kb) || a.away.localeCompare(b.away);
    });

    const payload = {
      source: 'fanduel-sportsbook-android',
      scrapedAt: new Date().toISOString(),
      udid: args.udid,
      gameCount: games.length,
      games: games.map(({ raw, ...rest }) => rest),
    };
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(payload, null, 2)}\n`);

    process.stdout.write(`\n${formatTable(games)}\n\n`);
    process.stdout.write(`Wrote ${games.length} games to ${args.out}\n`);
    if (!games.length) {
      process.exitCode = 1;
    }
  } finally {
    if (!args.keepSession) {
      await wd('DELETE', `/session/${sessionId}`).catch(() => {});
    }
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
