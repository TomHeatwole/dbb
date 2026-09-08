/** Shared Appium + FanDuel Sportsbook helpers (Android / UiAutomator2). */

import { execFileSync } from 'node:child_process';

export const APPIUM = process.env.APPIUM_URL || 'http://127.0.0.1:4723';
export const PACKAGE = 'com.fanduel.sportsbook';
export const ACTIVITY = 'com.fanduel.sportsbook.Launcher';

let lastUdid = process.env.ANDROID_SERIAL || 'emulator-5554';

function adbBin() {
  const home = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
  return `${home}/platform-tools/adb`;
}

export function setDeviceUdid(udid) {
  if (udid) lastUdid = udid;
}

export function adbUiDump(udid = lastUdid) {
  try {
    const adb = adbBin();
    execFileSync(adb, ['-s', udid, 'shell', 'uiautomator', 'dump', '/sdcard/uidump.xml'], {
      stdio: 'pipe',
      timeout: 8000,
    });
    return execFileSync(adb, ['-s', udid, 'exec-out', 'cat', '/sdcard/uidump.xml'], {
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch {
    return '';
  }
}

export function listXml(sessionXml) {
  if (parseGames(sessionXml, { value: null }).length) return sessionXml;
  const dump = adbUiDump();
  return dump && parseGames(dump, { value: null }).length ? dump : sessionXml;
}

function elementId(el) {
  if (!el) return null;
  if (typeof el === 'string') return el;
  return el.ELEMENT || el['element-6066-11e4-a52e-4f735466cecf'] || null;
}

export async function findUi(sessionId, selector) {
  try {
    const el = await wd('POST', `/session/${sessionId}/element`, {
      using: '-android uiautomator',
      value: selector,
    });
    return elementId(el);
  } catch {
    return null;
  }
}

export async function findAllUi(sessionId, selector) {
  try {
    const els = await wd('POST', `/session/${sessionId}/elements`, {
      using: '-android uiautomator',
      value: selector,
    });
    return (els || []).map(elementId).filter(Boolean);
  } catch {
    return [];
  }
}

export async function elementAttr(sessionId, id, name) {
  if (!id) return null;
  try {
    return await wd('GET', `/session/${sessionId}/element/${id}/attribute/${name}`);
  } catch {
    return null;
  }
}

export async function clickUi(sessionId, selector) {
  const id = await findUi(sessionId, selector);
  if (!id) return false;
  try {
    await wd('POST', `/session/${sessionId}/element/${id}/click`);
    return true;
  } catch {
    const rect = await wd('GET', `/session/${sessionId}/element/${id}/rect`).catch(() => null);
    if (!rect) return false;
    await tap(sessionId, Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
    return true;
  }
}

export function decodeXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\u00a0\u202f\u2007]/g, ' ');
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
  if (udid) lastUdid = udid;
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
  const px = Math.round(x);
  const py = Math.round(y);
  try {
    await wd('POST', `/session/${sessionId}/actions`, {
      actions: [{
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: px, y: py },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 70 },
          { type: 'pointerUp', button: 0 },
        ],
      }],
    });
    await wd('POST', `/session/${sessionId}/actions`, { actions: [] }).catch(() => {});
    return;
  } catch {
    await wd('POST', `/session/${sessionId}/actions`, { actions: [] }).catch(() => {});
  }
  await wd('POST', `/session/${sessionId}/execute/sync`, {
    script: 'mobile: clickGesture',
    args: [{ x: px, y: py }],
  });
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
  if (m) {
    const desc = decodeXml(m[1]);
    if (desc && await clickUi(sessionId, `new UiSelector().description("${desc.replace(/"/g, '')}")`)) {
      return true;
    }
    const b = parseBounds(m[0]);
    if (b) {
      const { x, y } = center(b);
      await tap(sessionId, x, y);
      return true;
    }
  }
  const raw = decodeXml(String(pattern)).replace(/\\/g, '');
  return clickUi(sessionId, `new UiSelector().descriptionContains("${raw.replace(/"/g, '')}")`);
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

export async function scrollMarketsToTop(sessionId) {
  let stagnant = 0;
  let lastSig = '';
  for (let i = 0; i < 10 && stagnant < 2; i += 1) {
    await scrollMarkets(sessionId, 'up');
    await sleep(280);
    const xml = await source(sessionId);
    const sig = (xml.match(/content-desc="[^"]*Drive\s+\d+[^"]*"/) || [])[0] || '';
    stagnant = sig && sig === lastSig ? stagnant + 1 : 0;
    lastSig = sig;
  }
}

export async function scrollToTop(sessionId) {
  let stagnant = 0;
  let lastFirst = '';
  for (let i = 0; i < 12 && stagnant < 2; i += 1) {
    await scrollGameList(sessionId, 'up');
    await sleep(280);
    const harvested = await harvestSlateGames(sessionId);
    const first = harvested[0]?.eventId
      || ((await source(sessionId)).match(/resource-id="event-card-\d+"/) || [])[0]
      || '';
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

const GAME_DESC_SELECTORS = [
  'new UiSelector().descriptionContains("Scheduled game")',
  'new UiSelector().descriptionContains("Live game")',
  'new UiSelector().descriptionContains("In-play game")',
  'new UiSelector().descriptionContains("In play game")',
  'new UiSelector().descriptionContains("Final game")',
];

export async function harvestSlateGames(sessionId) {
  const byId = new Map();
  for (const selector of GAME_DESC_SELECTORS) {
    for (const id of await findAllUi(sessionId, selector)) {
      const desc = String(await elementAttr(sessionId, id, 'content-desc') || '');
      const rid = String(await elementAttr(sessionId, id, 'resource-id') || '');
      const fragment = `content-desc="${desc.replace(/"/g, '')}" resource-id="${rid.replace(/"/g, '')}"`;
      mergeGames(byId, parseGames(fragment, { value: null }));
    }
  }
  return [...byId.values()];
}

async function slateXml(sessionId, sessionXml = null) {
  const xml = sessionXml || await source(sessionId);
  if (parseGames(xml, { value: null }).length) return xml;
  const listed = listXml(xml);
  if (listed !== xml && parseGames(listed, { value: null }).length) return listed;
  const harvested = await harvestSlateGames(sessionId);
  if (!harvested.length) return xml;
  return harvested.map((g) => {
    const desc = [
      g.live ? 'Live game' : g.final ? 'Final game' : 'Scheduled game',
      g.away,
      'versus',
      g.home,
      g.start ? `start at ${g.start}` : '',
    ].filter(Boolean).join(' ');
    return `content-desc="${desc}" resource-id="event-card-${g.eventId || ''}"`;
  }).join('\n');
}

export async function openNcaafList(sessionId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const xml = await slateXml(sessionId);
    const games = parseGames(xml, { value: null });
    if (games.length) {
      await scrollToTop(sessionId);
      return slateXml(sessionId);
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
  if (!byId.size) mergeGames(byId, await harvestSlateGames(sessionId));
  onProgress?.(byId.size, 0);
  let stagnant = 0;
  for (let i = 0; i < 50 && stagnant < 4; i += 1) {
    await scrollGameList(sessionId, 'down');
    await sleep(450);
    xml = await slateXml(sessionId);
    const added = mergeGames(byId, parseGames(xml, dateState));
    onProgress?.(byId.size, i + 1);
    stagnant = added === 0 ? stagnant + 1 : 0;
  }
  await scrollToTop(sessionId);
  return [...byId.values()].filter((g) => g.eventId);
}

export async function ensureListOpen(sessionId) {
  let xml = await slateXml(sessionId);
  if (parseGames(xml, { value: null }).length) return xml;
  const appiumXml = await source(sessionId);
  if (await tapDesc(sessionId, appiumXml, 'NCAA Football Games')) {
    await sleep(1600);
    xml = await slateXml(sessionId);
    if (parseGames(xml, { value: null }).length) return xml;
  }
  return openNcaafList(sessionId);
}

function cardTag(xml, eventId) {
  const re = new RegExp(`<[^>]*resource-id="event-card-${escapeRe(eventId)}"[^>]*>`);
  return xml.match(re)?.[0] || null;
}

function cardBounds(xml, eventId) {
  const tag = cardTag(xml, eventId);
  return tag ? parseBounds(tag) : null;
}

export function isGameListOpen(xml) {
  return /content-desc="Close modal window"/.test(xml)
    || ((xml.match(/Scheduled game/g) || []).length >= 2);
}

export function foldTeamText(s) {
  return decodeXml(s)
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/\./g, '')
    .replace(/\bst\b/g, 'state')
    .replace(/\s+/g, ' ')
    .trim();
}

export function namesOnPage(xml, game) {
  if (!game?.away || !game?.home) return false;
  const blob = foldTeamText(xml);
  const has = (name) => {
    const n = foldTeamText(name);
    if (!n) return false;
    if (blob.includes(n)) return true;
    const words = n.split(' ').filter((w) => w.length > 2);
    return words.length && words.every((w) => blob.includes(w));
  };
  return has(game.away) && has(game.home);
}

export function pageLooksLikeGame(xml, game) {
  if (!game?.away || !game?.home) return false;
  if (isGameListOpen(xml)) return false;
  if (!namesOnPage(xml, game)) return false;
  return /content-desc="Navigate up"/.test(xml)
    || /tab-Quick Bets|tab-Drive|tab-Same Game/i.test(xml)
    || /Drive\s+\d+\s*-+\s*Result/i.test(xml);
}

export function pageMatchesGame(xml, game) {
  return pageLooksLikeGame(xml, game) && /Drive\s+\d+\s*-+\s*Result/i.test(xml);
}

export function isOnEventPage(xml) {
  if (isGameListOpen(xml)) return false;
  return /Drive\s+\d+\s*-+\s*Result/i.test(xml)
    || /tab-Quick Bets|tab-Drive/i.test(xml)
    || /content-desc="Navigate up"/.test(xml);
}

function cardIsSelected(xml, eventId) {
  const tag = cardTag(xml, eventId);
  return Boolean(tag && /selected="true"/.test(tag));
}

async function slateModalOpen(sessionId, xml = '') {
  if (isGameListOpen(xml)) return true;
  return Boolean(await findUi(sessionId, 'new UiSelector().description("Close modal window")'));
}

async function closeGameList(sessionId, xml) {
  if (await tapDesc(sessionId, xml || '', 'Close modal window')) {
    await sleep(1200);
    return source(sessionId);
  }
  if (await clickUi(sessionId, 'new UiSelector().description("Close modal window")')) {
    await sleep(1200);
  }
  return source(sessionId);
}

async function cardSelectedNow(sessionId, eventId, xml = '') {
  if (eventId && cardIsSelected(xml, eventId)) return true;
  if (!eventId) return false;
  const id = await findUi(sessionId, `new UiSelector().resourceId("event-card-${eventId}")`);
  const selected = String(await elementAttr(sessionId, id, 'selected') || '');
  return selected === 'true';
}

const HEADER_SAFE_Y = 520;

async function elementRect(sessionId, id) {
  if (!id) return null;
  try {
    return await wd('GET', `/session/${sessionId}/element/${id}/rect`);
  } catch {
    return null;
  }
}

async function findEventCard(sessionId, eventId, game = null) {
  const selectors = [
    eventId ? `new UiSelector().resourceId("event-card-${eventId}")` : null,
    game?.away && game?.home
      ? `new UiSelector().descriptionContains("${game.away} versus ${game.home}")`
      : null,
  ].filter(Boolean);
  for (const selector of selectors) {
    const id = await findUi(sessionId, selector);
    if (id) return id;
  }
  return null;
}

async function tapEventCard(sessionId, eventId, game = null) {
  const id = await findEventCard(sessionId, eventId, game);
  if (!id) return false;
  const rect = await elementRect(sessionId, id);
  if (rect && rect.height) {
    const bottom = rect.y + rect.height;
    const x = Math.round(rect.x + rect.width * 0.5);
    let y = Math.round(rect.y + rect.height * 0.75);
    if (y < HEADER_SAFE_Y && bottom > HEADER_SAFE_Y + 28) y = HEADER_SAFE_Y + 28;
    if (bottom > y) {
      await tap(sessionId, x, Math.min(y, bottom - 24));
      return true;
    }
  }
  try {
    await wd('POST', `/session/${sessionId}/element/${id}/click`);
    return true;
  } catch {
    return false;
  }
}

function onRequestedGame(xml, game) {
  if (game) return pageLooksLikeGame(xml, game);
  return isOnEventPage(xml);
}

async function waitLanded(sessionId, eventId, game, firstXml = null) {
  for (let i = 0; i < 5; i += 1) {
    const page = firstXml && i === 0 ? firstXml : await source(sessionId);
    if (await slateModalOpen(sessionId, page)) {
      if (await cardSelectedNow(sessionId, eventId, page)) {
        const closed = await closeGameList(sessionId, page);
        if (onRequestedGame(closed, game)) return true;
      }
    } else if (onRequestedGame(page, game)) {
      return true;
    }
    await sleep(400);
  }
  return false;
}

export async function openGame(sessionId, eventId, game = null) {
  const current = await source(sessionId);
  if (onRequestedGame(current, game) && !(await slateModalOpen(sessionId, current))) {
    return true;
  }

  let xml = await ensureListOpen(sessionId);

  if (await cardSelectedNow(sessionId, eventId, xml)) {
    xml = await closeGameList(sessionId, xml);
    if (await waitLanded(sessionId, eventId, game, xml)) return true;
  }

  const tryFind = async (direction) => {
    for (let i = 0; i < 20; i += 1) {
      if (await cardSelectedNow(sessionId, eventId)) {
        xml = await closeGameList(sessionId, await source(sessionId));
        if (await waitLanded(sessionId, eventId, game, xml)) return true;
      }
      if (await tapEventCard(sessionId, eventId, game)) {
        await sleep(1100);
        if (await waitLanded(sessionId, eventId, game)) return true;
        continue;
      }
      await scrollGameList(sessionId, direction);
      await sleep(350);
    }
    return false;
  };

  if (await tryFind('up')) return true;
  if (await tryFind('down')) return true;
  await scrollToTop(sessionId);
  return tryFind('down');
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
  let xml = await source(sessionId);
  if (await slateModalOpen(sessionId, xml)) {
    xml = await closeGameList(sessionId, xml);
  }
  xml = await revealDriveTab(sessionId);
  await scrollMarketsToTop(sessionId);
  xml = await source(sessionId);
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
