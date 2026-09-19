/**
 * Pregame main-line snapshots + change-only JSONL logging for /api/ncaaf-drives.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lineDivergenceForGame,
  snapshotLinesFromGame,
} from '../src/drives/lineDivergence.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.join(ROOT, 'example_data', 'ncaaf_drive_results');
export const PREGAME_LINES_PATH = path.join(OUT_DIR, 'pregame_main_lines.json');
export const LIVE_LINES_LOG_PATH = path.join(OUT_DIR, 'live_main_lines.jsonl');

const DRIVE_KEYS = ['td', 'fg', 'punt', 'other'];

const lastLogKeys = new Map();

function canWriteDisk() {
  if (process.env.VERCEL || process.env.DISABLE_DRIVE_LINE_LOG === '1') return false;
  return true;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function appendJsonl(file, rec) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(rec)}\n`);
}

function gameKey(game) {
  return String(game?.eventId ?? '');
}

function compactDriveOdds(market) {
  if (!market) return null;
  const outcomes = {};
  for (const key of DRIVE_KEYS) {
    const quote = market.outcomes?.[key];
    if (!quote) continue;
    outcomes[key] = {
      fd: Number.isFinite(quote?.fd?.american) ? quote.fd.american : (
        market.source !== 'dk' && Number.isFinite(quote?.american) ? quote.american : null
      ),
      dk: Number.isFinite(quote?.dk?.american) ? quote.dk.american : (
        market.source === 'dk' && Number.isFinite(quote?.american) ? quote.american : null
      ),
    };
  }
  return {
    marketName: market.marketName ?? null,
    offenseSide: market.offenseSide ?? null,
    offenseName: market.offenseName ?? null,
    source: market.source ?? null,
    outcomes,
  };
}

function logChangeKey(game, divergence) {
  const nd = game?.nextDrive;
  const odds = DRIVE_KEYS.map((k) => {
    const q = nd?.outcomes?.[k];
    const fd = q?.fd?.american ?? (nd?.source !== 'dk' ? q?.american : null);
    const dk = q?.dk?.american ?? (nd?.source === 'dk' ? q?.american : null);
    return `${k}:${fd ?? '—'}/${dk ?? '—'}`;
  }).join('|');
  return [
    gameKey(game),
    game?.score?.home ?? '',
    game?.score?.away ?? '',
    game?.live?.period ?? '',
    game?.live?.clock ?? '',
    divergence?.liveTotal ?? '',
    divergence?.liveSpread ?? '',
    divergence?.totalMove ?? '',
    odds,
  ].join('::');
}

export function loadPregameLineSnapshots() {
  if (!canWriteDisk()) return {};
  return readJson(PREGAME_LINES_PATH, {});
}

export function savePregameLineSnapshots(store) {
  if (!canWriteDisk()) return;
  writeJson(PREGAME_LINES_PATH, store);
}

/**
 * Capture pregame FD main lines before kickoff; attach snapshot to live games.
 */
export function attachPregameLines(games, store = loadPregameLineSnapshots()) {
  let dirty = false;
  const nextStore = { ...store };

  for (const game of games) {
    const key = gameKey(game);
    if (!key) continue;

    const snap = snapshotLinesFromGame(game);
    if (!game.inPlay && snap) {
      const prev = nextStore[key];
      const changed = !prev
        || prev.spread !== snap.spread
        || prev.total !== snap.total;
      if (changed) {
        nextStore[key] = {
          eventId: game.eventId,
          home: game.teams?.home ?? null,
          away: game.teams?.away ?? null,
          openDate: game.openDate ?? null,
          spread: snap.spread,
          total: snap.total,
          capturedAt: snap.capturedAt,
          source: snap.source,
        };
        dirty = true;
      }
    }

    const stored = nextStore[key];
    if (stored) {
      game.pregameLines = {
        spread: stored.spread,
        total: stored.total,
        capturedAt: stored.capturedAt,
        source: stored.source ?? 'fd',
      };
    }
  }

  if (dirty) savePregameLineSnapshots(nextStore);
  return games;
}

export function logLiveMainLines(games, { fetchedAt } = {}) {
  if (!canWriteDisk()) return { logged: 0, skipped: games.length };

  let logged = 0;
  let skipped = 0;
  const ts = fetchedAt ?? new Date().toISOString();

  for (const game of games) {
    if (!game?.inPlay) {
      skipped += 1;
      continue;
    }

    const divergence = lineDivergenceForGame(game);
    const key = logChangeKey(game, divergence);
    if (lastLogKeys.get(gameKey(game)) === key) {
      skipped += 1;
      continue;
    }
    lastLogKeys.set(gameKey(game), key);

    appendJsonl(LIVE_LINES_LOG_PATH, {
      ts,
      eventId: game.eventId ?? null,
      espnId: game.espnId ?? null,
      matchup: game.name ?? null,
      teams: game.teams ?? null,
      inPlay: true,
      openDate: game.openDate ?? null,
      score: game.score ?? null,
      scoreDisplay: game.scoreDisplay ?? null,
      live: {
        spread: divergence.liveSpread,
        total: divergence.liveTotal,
        period: game.live?.period ?? null,
        clock: game.live?.clock ?? null,
        clockSeconds: game.live?.clockSeconds ?? null,
        state: game.live?.state ?? null,
      },
      pregame: game.pregameLines ?? null,
      lineDivergence: divergence,
      nextDrive: compactDriveOdds(game.nextDrive),
      driveMarkets: (game.driveMarkets ?? []).slice(0, 4).map(compactDriveOdds),
    });
    logged += 1;
  }

  return { logged, skipped };
}

export function annotateGamesWithLineLogging(games, { fetchedAt } = {}) {
  const withPregame = attachPregameLines(games);
  const stats = logLiveMainLines(withPregame, { fetchedAt });
  return { games: withPregame, lineLog: stats };
}
