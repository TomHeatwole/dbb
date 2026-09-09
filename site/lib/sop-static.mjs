/**
 * Scrapeable SOP +EV dump. Served at /sop-static.txt via /api/fanduel-sop?format=static
 * so we do not add a 13th Hobby-plan serverless function.
 */

import { pickExport } from './named-export.mjs';
import * as mergeDkGames from '../src/sop/mergeDkGames.js';
import * as mergeKalshiGames from '../src/sop/mergeKalshiGames.js';
import * as sopStaticText from '../src/sop/sopStaticText.js';

const keepSopDisplayGames = pickExport(mergeDkGames, 'keepSopDisplayGames');
const mergeDkIntoFdGames = pickExport(mergeDkGames, 'mergeDkIntoFdGames');
const mergeKalshiIntoFdGames = pickExport(mergeKalshiGames, 'mergeKalshiIntoFdGames');
const formatSopStaticText = pickExport(sopStaticText, 'formatSopStaticText');

const NO_STORE_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

function applyNoStoreHeaders(res) {
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
    res.setHeader(key, value);
  }
}

function getOrigin(req) {
  const hostHeader = req.headers?.['x-forwarded-host'] || req.headers?.host || '';
  const host = String(Array.isArray(hostHeader) ? hostHeader[0] : hostHeader)
    .split(',')[0]
    .trim();
  const protoHeader = req.headers?.['x-forwarded-proto'] || (process.env.VERCEL ? 'https' : 'http');
  const protocol = String(Array.isArray(protoHeader) ? protoHeader[0] : protoHeader)
    .split(',')[0]
    .trim();
  if (host) return `${protocol}://${host}`.replace(/\/+$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`.replace(/\/+$/, '');
  return 'http://127.0.0.1:3001';
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function buildSopStaticPayload(req) {
  const origin = getOrigin(req);
  const [fdData, dkData, kalshiData] = await Promise.all([
    fetchJson(`${origin}/api/fanduel-sop`),
    fetchJson(`${origin}/api/draftkings-goal-method`),
    fetchJson(`${origin}/api/kalshi-sop`),
  ]);

  if (!fdData?.games) {
    throw new Error(fdData?.error || 'FanDuel SOP fetch failed');
  }

  const games = keepSopDisplayGames(
    mergeKalshiIntoFdGames(mergeDkIntoFdGames(fdData.games ?? [], dkData), kalshiData),
  );

  const notices = [];
  const hasMergedDk = (dkData?.games ?? []).some(
    (g) => g.goalTypes
      || Object.values(g.noGoalMarkets ?? {}).some((q) => q?.american != null),
  );
  if (!dkData || !hasMergedDk) {
    notices.push('notice: DraftKings odds unavailable — FanDuel / Kalshi only');
  }
  if (!kalshiData) {
    notices.push('notice: Kalshi odds unavailable');
  }

  return {
    text: formatSopStaticText({
      games,
      fetchedAt: fdData?.fetchedAt ?? new Date().toISOString(),
      notices,
    }),
  };
}

function sendText(res, statusCode, body = '') {
  res.statusCode = statusCode;
  if (typeof res.status === 'function') res.status(statusCode);
  res.end(body);
}

export default async function handler(req, res) {
  applyNoStoreHeaders(res);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, 'Method not allowed\n');
  }

  try {
    const { text } = await buildSopStaticPayload(req);
    if (req.method === 'HEAD') {
      return sendText(res, 200);
    }
    return sendText(res, 200, text);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sop-static]', err);
    return sendText(res, 502, `SOP fetch failed: ${err.message || 'unknown error'}\n`);
  }
}
