/** Shared Appium + FanDuel Sportsbook helpers (Android / UiAutomator2). */

export const APPIUM = process.env.APPIUM_URL || 'http://127.0.0.1:4723';
export const PACKAGE = 'com.fanduel.sportsbook';
export const ACTIVITY = 'com.fanduel.sportsbook.Launcher';

export function decodeXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u00a0/g, ' ');
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function wd(method, urlPath, body) {
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

export async function appiumUp() {
  try {
    const res = await fetch(`${APPIUM}/status`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function createSession(udid, extras = {}) {
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
        'appium:newCommandTimeout': extras.newCommandTimeout ?? 600,
        'appium:disableWindowAnimation': true,
      },
    },
  });
  return created.sessionId;
}

export async function deleteSession(sessionId) {
  if (!sessionId) return;
  await wd('DELETE', `/session/${sessionId}`).catch(() => {});
}

export async function source(sessionId) {
  return decodeXml(String(await wd('GET', `/session/${sessionId}/source`)));
}

export function parseBounds(fragment) {
  const m = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(fragment);
  if (!m) return null;
  return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
}

export function center(bounds) {
  return {
    x: Math.round((bounds.x1 + bounds.x2) / 2),
    y: Math.round((bounds.y1 + bounds.y2) / 2),
  };
}

export async function tap(sessionId, x, y) {
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

export async function windowSize(sessionId) {
  const rect = await wd('GET', `/session/${sessionId}/window/rect`);
  return { width: rect.width || 1080, height: rect.height || 2400 };
}

export async function swipe(sessionId, x1, y1, x2, y2, duration = 350) {
  await wd('POST', `/session/${sessionId}/actions`, { actions: [] }).catch(() => {});
  const { width, height } = await windowSize(sessionId);
  const clamp = (v, max) => Math.max(8, Math.min(max - 8, Math.round(v)));
  const sx = clamp(x1, width);
  const sy = clamp(y1, height);
  const ex = clamp(x2, width);
  const ey = clamp(y2, height);
  try {
    await wd('POST', `/session/${sessionId}/actions`, {
      actions: [{
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: sx, y: sy },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 40 },
          { type: 'pointerMove', duration, x: ex, y: ey },
          { type: 'pointerUp', button: 0 },
        ],
      }],
    });
  } catch {
    const direction = ey < sy ? 'down' : 'up';
    await scrollGesture(sessionId, {
      left: 40,
      top: Math.min(sy, ey),
      width: width - 80,
      height: Math.abs(sy - ey),
      direction,
      percent: 0.8,
    });
  }
  await wd('POST', `/session/${sessionId}/actions`, { actions: [] }).catch(() => {});
}

export async function tapDesc(sessionId, xml, pattern) {
  const flex = String(pattern).replace(/\s+/g, '\\s+');
  const re = new RegExp(
    `content-desc="([^"]*${flex}[^"]*)"[\\s\\S]{0,500}?bounds="\\[[^\\]]+\\]\\[[^\\]]+\\]"`,
  );
  const m = re.exec(xml);
  if (!m) return false;
  const b = parseBounds(m[0]);
  if (!b) return false;
  const { x, y } = center(b);
  await tap(sessionId, x, y);
  return true;
}

export async function scrollGesture(sessionId, opts) {
  const {
    left = 40,
    top = 420,
    width = 1000,
    height = 1700,
    direction = 'down',
    percent = 0.85,
  } = opts || {};
  await wd('POST', `/session/${sessionId}/execute/sync`, {
    script: 'mobile: scrollGesture',
    args: [{ left, top, width, height, direction, percent }],
  });
}

export async function scrollGameList(sessionId, direction = 'down') {
  if (direction === 'down') await swipe(sessionId, 540, 1980, 540, 620, 380);
  else await swipe(sessionId, 540, 720, 540, 1980, 380);
}

export async function scrollMarkets(sessionId, direction = 'down') {
  if (direction === 'down') await swipe(sessionId, 540, 1750, 540, 820, 320);
  else await swipe(sessionId, 540, 900, 540, 1750, 320);
}

export async function scrollToTop(sessionId) {
  let stagnant = 0;
  let lastFirst = '';
  for (let i = 0; i < 12 && stagnant < 2; i += 1) {
    await scrollGameList(sessionId, 'up');
    await sleep(280);
    const xml = await source(sessionId);
    const first = (xml.match(/resource-id="event-card-\d+"/) || [])[0] || '';
    stagnant = first && first === lastFirst ? stagnant + 1 : 0;
    lastFirst = first;
  }
}

const GAME_RE = /^(?:(Live|In[- ]play|Final)\s+)?(?:Scheduled\s+)?game\s+(.+?)\s+versus\s+(.+?)(?:\s+start at\s+(.+?))?(?:\s+O\/U\s+([0-9.]+),\s*([+-]?[0-9.]+))?$/i;
const SHORT_DATE_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.\s+\d{1,2}\/\d{1,2}$/;

export function parseGames(xml, dateState) {
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
    if (!/\bgame\s+.+\s+versus\s+/i.test(desc)) continue;
    if (!/^(?:Live|In[- ]play|Final|Scheduled)\b/i.test(desc) && !desc.startsWith('Scheduled game')) {
      continue;
    }
    const gm = GAME_RE.exec(desc);
    if (!gm) continue;
    const status = (gm[1] || 'Scheduled').toLowerCase();
    const away = gm[2].trim();
    const home = gm[3].trim();
    const start = (gm[4] || '').replace(/\s+O\/U.*$/, '').trim();
    const eventId = (resourceId.match(/event-card-(\d+)/) || [])[1] || null;
    games.push({
      eventId,
      date,
      away,
      home,
      start,
      live: status.startsWith('live') || status.startsWith('in'),
      final: status.startsWith('final'),
      overUnder: gm[5] ? Number(gm[5]) : null,
      homeSpread: gm[6] != null && gm[6] !== '' ? Number(gm[6]) : null,
    });
  }
  return games;
}

export function mergeGames(byId, games) {
  let added = 0;
  for (const g of games) {
    const key = g.eventId || `${g.away}|${g.home}|${g.start}`;
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, g);
      added += 1;
    } else {
      if (!prev.date && g.date) prev.date = g.date;
      if (g.live) prev.live = true;
      if (g.final) prev.final = true;
    }
  }
  return added;
}

export async function openNcaafList(sessionId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const xml = await source(sessionId);
    const games = parseGames(xml, { value: null });
    if (games.length) {
      await scrollToTop(sessionId);
      return source(sessionId);
    }
    if (await tapDesc(sessionId, xml, 'NCAA Football Games')) {
      await sleep(1600);
      continue;
    }
    if (await tapDesc(sessionId, xml, 'College Football')) {
      await sleep(1600);
      continue;
    }
    if (await tapDesc(sessionId, xml, 'NCAA Football')) {
      await sleep(1600);
      continue;
    }
    if (await tapDesc(sessionId, xml, 'All Sports')) {
      await sleep(1600);
      continue;
    }
    await sleep(700);
  }
  return source(sessionId);
}

export async function collectSlate(sessionId, onProgress) {
  let xml = await openNcaafList(sessionId);
  const byId = new Map();
  const dateState = { value: null };
  mergeGames(byId, parseGames(xml, dateState));
  onProgress?.(byId.size, 0);
  let stagnant = 0;
  for (let i = 0; i < 50 && stagnant < 4; i += 1) {
    await scrollGameList(sessionId, 'down');
    await sleep(450);
    xml = await source(sessionId);
    const added = mergeGames(byId, parseGames(xml, dateState));
    onProgress?.(byId.size, i + 1);
    stagnant = added === 0 ? stagnant + 1 : 0;
  }
  await scrollToTop(sessionId);
  return [...byId.values()].filter((g) => g.eventId);
}

export async function ensureListOpen(sessionId) {
  const xml = await source(sessionId);
  if (parseGames(xml, { value: null }).length) return xml;
  if (await tapDesc(sessionId, xml, 'NCAA Football Games')) {
    await sleep(1500);
    return source(sessionId);
  }
  return openNcaafList(sessionId);
}

function cardBounds(xml, eventId) {
  const re = new RegExp(
    `resource-id="event-card-${escapeRe(eventId)}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
  );
  const m = re.exec(xml);
  if (!m) return null;
  return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
}

export async function openGame(sessionId, eventId) {
  await ensureListOpen(sessionId);
  const tryFind = async () => {
    for (let i = 0; i < 28; i += 1) {
      const xml = await source(sessionId);
      const b = cardBounds(xml, eventId);
      if (b && b.y2 > 380 && b.y1 < 2220) {
        const { x, y } = center(b);
        await tap(sessionId, x, y);
        await sleep(1600);
        return true;
      }
      await scrollGameList(sessionId, 'down');
      await sleep(400);
    }
    return false;
  };
  if (await tryFind()) return true;
  await scrollToTop(sessionId);
  return tryFind();
}

export const DRIVE_OUTCOMES = [
  { key: 'td', label: 'OTD', hints: /offensive touchdown|offensive td/i },
  { key: 'fg', label: 'FGA', hints: /field goal attempt|fg attempt/i },
  { key: 'punt', label: 'Punt', hints: /^punt$/i },
  { key: 'other', label: 'Other', hints: /any other|^other$/i },
];

const DRIVE_HEADER_RE = /(.+?)\s+Drive\s+(\d+)\s*-+\s*Result/i;
const DRIVE_ODDS_RE = /(.+?Drive\s+\d+\s*-+\s*Result),\s*([^,]+),\s*,\s*([+-]\d+|EVEN)\s+odds/i;

export function classifyOutcome(name) {
  const n = String(name || '').trim();
  for (const row of DRIVE_OUTCOMES) {
    if (row.hints.test(n)) return row.key;
  }
  return null;
}

export function parseAmerican(token) {
  if (/even/i.test(token)) return 100;
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

export function parseDriveMarkets(xml) {
  const byName = new Map();
  for (const m of xml.matchAll(/content-desc="([^"]+)"/g)) {
    const desc = decodeXml(m[1]).replace(/\s+/g, ' ').trim();
    const header = DRIVE_HEADER_RE.exec(desc);
    if (header && !desc.includes('odds')) {
      const marketName = desc;
      if (!byName.has(marketName)) {
        byName.set(marketName, {
          marketName,
          offense: header[1].trim(),
          drive: Number(header[2]),
          outcomes: {},
        });
      }
      continue;
    }
    const odds = DRIVE_ODDS_RE.exec(desc);
    if (!odds) continue;
    const marketName = odds[1].replace(/\s+/g, ' ').trim();
    const outcomeName = odds[2].trim();
    const american = parseAmerican(odds[3]);
    const key = classifyOutcome(outcomeName);
    if (american == null || !key) continue;
    const headerBits = DRIVE_HEADER_RE.exec(marketName);
    if (!byName.has(marketName)) {
      byName.set(marketName, {
        marketName,
        offense: headerBits ? headerBits[1].trim() : marketName,
        drive: headerBits ? Number(headerBits[2]) : null,
        outcomes: {},
      });
    }
    byName.get(marketName).outcomes[key] = american;
  }
  return [...byName.values()];
}

export function driveHeaders(xml) {
  const names = [];
  for (const m of xml.matchAll(/content-desc="([^"]+)"[^>]*resource-id="collapsible-section-header"/g)) {
    const desc = decodeXml(m[1]).replace(/\s+/g, ' ').trim();
    if (DRIVE_HEADER_RE.test(desc)) names.push(desc);
  }
  // attribute order can flip
  if (!names.length) {
    for (const m of xml.matchAll(/resource-id="collapsible-section-header"[\s\S]{0,200}?content-desc="([^"]+)"/g)) {
      const desc = decodeXml(m[1]).replace(/\s+/g, ' ').trim();
      if (DRIVE_HEADER_RE.test(desc)) names.push(desc);
    }
    for (const m of xml.matchAll(/content-desc="([^"]+Drive\s+\d+\s*-+\s*Result)"/g)) {
      const desc = decodeXml(m[1]).replace(/\s+/g, ' ').trim();
      if (!desc.includes('odds') && DRIVE_HEADER_RE.test(desc)) names.push(desc);
    }
  }
  return [...new Set(names)];
}

export async function expandDriveHeaders(sessionId, xml) {
  const markets = parseDriveMarkets(xml);
  const expanded = new Set(
    markets.filter((m) => Object.keys(m.outcomes).length >= 3).map((m) => m.marketName),
  );
  let taps = 0;
  for (const name of driveHeaders(xml)) {
    if (expanded.has(name)) continue;
    if (await tapDesc(sessionId, xml, escapeRe(name))) {
      taps += 1;
      await sleep(700);
      xml = await source(sessionId);
    }
  }
  return { xml, taps };
}

export function listTabs(xml) {
  const tabs = [];
  for (const m of xml.matchAll(/content-desc="tab-([^"]+)"/g)) {
    tabs.push(decodeXml(m[1]));
  }
  return [...new Set(tabs)];
}

export async function revealDriveTab(sessionId) {
  let xml = await source(sessionId);
  const prefer = [/quick bets/i, /drive sgp/i, /drive result/i, /\bdrives?\b/i];
  const tapMatching = async () => {
    const tabs = listTabs(xml);
    for (const re of prefer) {
      const hit = tabs.find((t) => re.test(t));
      if (hit && await tapDesc(sessionId, xml, `tab-${escapeRe(hit)}`)) {
        await sleep(900);
        xml = await source(sessionId);
        return true;
      }
    }
    return false;
  };
  if (driveHeaders(xml).length) return xml;
  if (await tapMatching()) return source(sessionId);
  for (let i = 0; i < 6; i += 1) {
    await swipe(sessionId, 920, 560, 220, 560, 280);
    await sleep(350);
    xml = await source(sessionId);
    if (driveHeaders(xml).length) return xml;
    if (await tapMatching()) return source(sessionId);
  }
  return source(sessionId);
}

function marketComplete(market) {
  return DRIVE_OUTCOMES.every((row) => market.outcomes[row.key] != null);
}

export async function scrapeDriveResults(sessionId) {
  let xml = await revealDriveTab(sessionId);
  const seen = new Map();
  const ingest = (rows) => {
    for (const row of rows) {
      const prev = seen.get(row.marketName);
      if (!prev) {
        seen.set(row.marketName, row);
        continue;
      }
      prev.outcomes = { ...prev.outcomes, ...row.outcomes };
    }
  };

  const harvest = async () => {
    const expanded = await expandDriveHeaders(sessionId, xml);
    xml = expanded.xml;
    ingest(parseDriveMarkets(xml));
  };

  await harvest();
  let stagnant = 0;
  for (let i = 0; i < 10 && stagnant < 4; i += 1) {
    const complete = [...seen.values()].filter(marketComplete).length;
    if (complete >= 2) break;
    const before = JSON.stringify([...seen.values()].map((m) => [m.marketName, m.outcomes]));
    await scrollMarkets(sessionId, 'down');
    await sleep(500);
    xml = await source(sessionId);
    await harvest();
    const after = JSON.stringify([...seen.values()].map((m) => [m.marketName, m.outcomes]));
    stagnant = after === before ? stagnant + 1 : 0;
  }
  return [...seen.values()].filter((m) => Object.keys(m.outcomes).length);
}
