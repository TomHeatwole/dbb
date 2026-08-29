/**
 * DraftKings Premier League corner totals (full, 1H, 2H) and live team intervals.
 */

import { americanToImpliedProb } from '../src/sop/sopModel.js';
import {
  discoverDkEventsFromLeaguePage,
  fetchSubcategoryQuiet,
  fdNameToSlug,
  listDkPremierLeagueEvents,
  mapPool,
  marketSelectionsFor,
  selectionQuote,
} from './draftkings-goal-method.mjs';

const TOTAL_PRE_ID = '17865';
const TOTAL_LIVE_ID = '12393';
const FIRST_HALF_ID = '17901';
const SECOND_HALF_ID = '17902';
const INTERVAL_ID = '19840';

const DK_FETCH_CONCURRENCY = Number(process.env.DK_FETCH_CONCURRENCY || 4);
const DK_HANDLER_TIMEOUT_MS = Number(process.env.DK_HANDLER_TIMEOUT_MS || 20000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nameFromSlug(slug) {
  return String(slug ?? '')
    .replace(/-vs-/g, ' v ')
    .replace(/-/g, ' ')
    .trim();
}

async function listDkCornerEvents() {
  const listed = await listDkPremierLeagueEvents();
  if (listed.length) return listed;

  const map = await discoverDkEventsFromLeaguePage();
  const byId = new Map();
  for (const [slug, id] of map.entries()) {
    if (!id || String(slug).includes('|')) continue;
    if (byId.has(id)) continue;
    byId.set(id, {
      eventId: String(id),
      name: nameFromSlug(slug),
      seoSlug: slug,
      openDate: null,
      inPlay: false,
    });
  }
  return [...byId.values()];
}

function lineFromSelection(selection, market) {
  const points = selection?.points ?? selection?.line ?? market?.points ?? market?.line;
  if (points != null && Number.isFinite(Number(points))) return Number(points);
  const m = String(selection?.label ?? '').match(/(\d+\.5)/);
  return m ? Number(m[1]) : null;
}

function isOverLabel(label) {
  return /^over\b/i.test(String(label ?? '').trim());
}

function isUnderLabel(label) {
  return /^under\b/i.test(String(label ?? '').trim());
}

function marketNameLooksLike(name, { half = null } = {}) {
  const n = String(name ?? '').toLowerCase();
  if (!n.includes('corner')) return false;
  if (/\b(team|asian|race|first corner|last corner|exact|odd\/even)\b/.test(n)) return false;
  if (/will .+\s+take a corner/i.test(n)) return false;
  const isH1 = /1st half|first half|half(?:\s+time)? total/.test(n) && !/2nd|second/.test(n);
  const isH2 = /2nd half|second half/.test(n);
  if (half === 1) return isH1;
  if (half === 2) return isH2;
  return !isH1 && !isH2 && /total corners|^corners\b/.test(n);
}

function extractOverUnderLines(markets, selections, half = null) {
  const byLine = new Map();
  for (const market of markets ?? []) {
    if (!marketNameLooksLike(market.name, { half })) continue;
    const rows = marketSelectionsFor(selections, market);
    for (const selection of rows) {
      const line = lineFromSelection(selection, market);
      if (!Number.isFinite(line)) continue;
      const quote = selectionQuote(selection);
      if (!quote || quote.american == null) continue;
      const entry = byLine.get(line) ?? { line, market: market.name, over: null, under: null };
      if (isOverLabel(selection.label)) entry.over = quote;
      else if (isUnderLabel(selection.label)) entry.under = quote;
      byLine.set(line, entry);
    }
  }
  return [...byLine.values()]
    .filter((row) => row.over?.american != null || row.under?.american != null)
    .sort((a, b) => a.line - b.line);
}

function pickClosestLine(lines) {
  if (!lines?.length) return null;
  const scored = lines
    .filter((row) => row.over?.american != null)
    .map((row) => ({
      row,
      closeness: Math.abs((americanToImpliedProb(row.over.american) ?? 1) - 0.5),
    }))
    .sort((a, b) => a.closeness - b.closeness);
  return (scored[0]?.row ?? lines[0]) ?? null;
}

function parseIntervalWindow(text) {
  const m = String(text ?? '').match(
    /(?:between|from)?\s*\(?(\d{1,3}:\d{2})\s*[-–]\s*(\d{1,3}:\d{2})\)?/i,
  );
  if (!m) return null;
  return { window: `${m[1]}–${m[2]}`, start: m[1], end: m[2] };
}

function parseIntervalTeam(text) {
  const m = String(text ?? '').match(/will\s+(.+?)\s+take a corner/i);
  return m ? m[1].trim() : null;
}

function extractIntervals(markets, selections) {
  const intervals = [];
  for (const market of markets ?? []) {
    const name = String(market.name ?? '');
    const rows = marketSelectionsFor(selections, market);
    const team = parseIntervalTeam(name);
    const window = parseIntervalWindow(name);
    if (!team || !window) continue;
    let yes = null;
    let no = null;
    for (const selection of rows) {
      const quote = selectionQuote(selection);
      if (!quote || quote.american == null) continue;
      const label = String(selection.label ?? '').toLowerCase();
      if (label === 'yes' || /^yes\b/.test(label)) yes = quote;
      else if (label === 'no' || /^no\b/.test(label)) no = quote;
    }
    if (!yes && !no) continue;
    intervals.push({
      team,
      ...window,
      market: name,
      yes,
      no,
    });
  }
  return intervals;
}

async function fetchCornerBundle(event) {
  const eventId = event.eventId;
  const seoSlug = event.seoSlug || fdNameToSlug(event.name) || 'premier-league';
  const inPlay = Boolean(event.inPlay);

  const cats = inPlay
    ? [TOTAL_LIVE_ID, TOTAL_PRE_ID, FIRST_HALF_ID, SECOND_HALF_ID, INTERVAL_ID]
    : [TOTAL_PRE_ID, FIRST_HALF_ID, SECOND_HALF_ID];

  const bundles = await Promise.all(
    cats.map((id) => fetchSubcategoryQuiet(eventId, id, seoSlug)),
  );
  const byId = Object.fromEntries(cats.map((id, i) => [id, bundles[i]]));

  const liveTotals = extractOverUnderLines(
    byId[TOTAL_LIVE_ID]?.markets,
    byId[TOTAL_LIVE_ID]?.selections,
  );
  const preTotals = extractOverUnderLines(
    byId[TOTAL_PRE_ID]?.markets,
    byId[TOTAL_PRE_ID]?.selections,
  );
  const totals = liveTotals.length ? liveTotals : preTotals;
  const h1 = extractOverUnderLines(
    byId[FIRST_HALF_ID]?.markets,
    byId[FIRST_HALF_ID]?.selections,
    1,
  );
  const h2 = extractOverUnderLines(
    byId[SECOND_HALF_ID]?.markets,
    byId[SECOND_HALF_ID]?.selections,
    2,
  );
  const intervals = inPlay
    ? extractIntervals(byId[INTERVAL_ID]?.markets, byId[INTERVAL_ID]?.selections)
    : [];

  return {
    name: event.name,
    openDate: event.openDate ?? null,
    inPlay,
    dkEventId: eventId,
    eventId,
    total: pickClosestLine(totals),
    totals,
    firstHalfTotal: pickClosestLine(h1),
    secondHalfTotal: pickClosestLine(h2),
    intervals,
  };
}

function emptyPayload({ timedOut = false, error = null } = {}) {
  return {
    fetchedAt: new Date().toISOString(),
    timedOut,
    error,
    stats: { total: 0, withOdds: 0 },
    games: [],
  };
}

export async function fetchDkCornerOdds({ timeoutMs = DK_HANDLER_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());

  const events = await listDkCornerEvents();
  if (remaining() <= 0) return emptyPayload({ timedOut: true });

  const results = await mapPool(events, DK_FETCH_CONCURRENCY, async (event) => {
    if (remaining() <= 0) {
      return {
        name: event.name,
        dkEventId: event.eventId,
        error: 'DraftKings timed out',
        total: null,
        totals: [],
        firstHalfTotal: null,
        secondHalfTotal: null,
        intervals: [],
      };
    }
    try {
      return await fetchCornerBundle(event);
    } catch (err) {
      return {
        name: event.name,
        dkEventId: event.eventId,
        error: err.message || 'DraftKings markets failed',
        total: null,
        totals: [],
        firstHalfTotal: null,
        secondHalfTotal: null,
        intervals: [],
      };
    }
  });

  const games = results.filter((g) => (
    g.total
    || (g.totals ?? []).length
    || g.firstHalfTotal
    || g.secondHalfTotal
    || (g.intervals ?? []).length
  ));

  return {
    fetchedAt: new Date().toISOString(),
    timedOut: remaining() <= 0,
    stats: {
      total: events.length,
      withOdds: games.length,
    },
    games,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = await Promise.race([
      fetchDkCornerOdds(),
      sleep(DK_HANDLER_TIMEOUT_MS + 250).then(() =>
        emptyPayload({ timedOut: true, error: 'DraftKings timed out' }),
      ),
    ]);
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dk-corners]', err);
    return res.status(200).json(
      emptyPayload({ timedOut: true, error: err.message || 'DraftKings corners fetch failed' }),
    );
  }
}
