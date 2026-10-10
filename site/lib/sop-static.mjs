/**
 * Scrapeable SOP +EV dump. Served at /sop-static.txt via /api/fanduel-sop?format=static
 * so we do not add a 13th Hobby-plan serverless function.
 */

import { pickExport } from './named-export.mjs';
import {
  cachedBook,
  fillBookCache,
  requestIsFresh,
  setNoStore,
  setSharedCacheHeaders,
} from './bookCache.mjs';
import * as mergeDkGames from '../src/sop/mergeDkGames.js';
import * as mergeKalshiGames from '../src/sop/mergeKalshiGames.js';
import * as sopStaticText from '../src/sop/sopStaticText.js';

const keepSopDisplayGames = pickExport(mergeDkGames, 'keepSopDisplayGames');
const mergeDkIntoFdGames = pickExport(mergeDkGames, 'mergeDkIntoFdGames');
const mergeKalshiIntoFdGames = pickExport(mergeKalshiGames, 'mergeKalshiIntoFdGames');
const formatSopStaticText = pickExport(sopStaticText, 'formatSopStaticText');

const STATIC_TTL_MS = 12_000;

function applyTextHeaders(res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
}

export async function buildSopStaticPayload() {
  const [{ fetchPremierLeagueSopOdds }, { fetchWorldCupGoalMethodOdds }, { fetchWorldCupKalshiOdds }] = await Promise.all([
    import('../api/fanduel-sop.mjs'),
    import('./draftkings-goal-method.mjs'),
    import('./kalshi-sop.mjs'),
  ]);
  const [fdData, dkData, kalshiData] = await Promise.all([
    fetchPremierLeagueSopOdds({ includeEspn: true }),
    fetchWorldCupGoalMethodOdds({ soccerScope: 'core' }),
    fetchWorldCupKalshiOdds({ upcomingOnly: true }),
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
  applyTextHeaders(res);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    setNoStore(res);
    return sendText(res, 405, 'Method not allowed\n');
  }

  try {
    const fresh = requestIsFresh(req);
    const payload = fresh
      ? await buildSopStaticPayload()
      : await cachedBook('sop-static', buildSopStaticPayload, () => STATIC_TTL_MS, { persist: true });
    if (fresh) {
      await fillBookCache('sop-static', payload, STATIC_TTL_MS, { persist: true });
      setNoStore(res);
    } else {
      setSharedCacheHeaders(res, 12);
    }
    if (req.method === 'HEAD') {
      return sendText(res, 200);
    }
    return sendText(res, 200, payload.text);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sop-static]', err);
    setNoStore(res);
    return sendText(res, 502, `SOP fetch failed: ${err.message || 'unknown error'}\n`);
  }
}
