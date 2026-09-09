/**
 * Scrapeable SOP +EV dump at /sop-static.txt (and /api/sop-static).
 * Server-rendered, not cached.
 */

import { fetchPremierLeagueSopOdds } from './fanduel-sop.mjs';
import { fetchWorldCupGoalMethodOdds } from './draftkings-goal-method.mjs';
import { fetchWorldCupKalshiOdds } from './kalshi-sop.mjs';
import { keepSopDisplayGames, mergeDkIntoFdGames } from '../src/sop/mergeDkGames.js';
import { mergeKalshiIntoFdGames } from '../src/sop/mergeKalshiGames.js';
import { formatSopStaticText } from '../src/sop/sopStaticText.js';

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

async function settledValue(promise, fallback = null) {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export async function buildSopStaticPayload() {
  const [fdData, dkData, kalshiData] = await Promise.all([
    fetchPremierLeagueSopOdds({ includeEspn: true }),
    settledValue(fetchWorldCupGoalMethodOdds()),
    settledValue(fetchWorldCupKalshiOdds()),
  ]);

  const fdGames = fdData?.games ?? [];
  const games = keepSopDisplayGames(
    mergeKalshiIntoFdGames(mergeDkIntoFdGames(fdGames, dkData), kalshiData),
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
    const { text } = await buildSopStaticPayload();
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
