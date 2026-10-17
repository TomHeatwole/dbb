/**
 * SOP2 paper-line cron: ESPN listing when idle, FanDuel/DK/Kalshi only when
 * matches are live, about to kick off, or the 2h pregame window is due.
 * Every tick also scores unsettled snapshots against ESPN next-goal results.
 */

import { setNoStore } from './bookCache.mjs';
import { fetchEspnSoccerScoreboards } from './espn-pl-scoreboard.mjs';
import {
  insertNewSnapshots,
  latestFingerprints,
  latestPregamePayloads,
  listingToMetaPatch,
  readTrackMeta,
  writeTrackMeta,
} from './paperTrackCore.mjs';
import { countReadyUnsettled, settleSopSnapshots } from './paperTrackSettle.mjs';
import { espnLeagueKeys } from '../src/sop/soccerLeagues.js';
import { keepSopDisplayGames, mergeDkIntoFdGames } from '../src/sop/mergeDkGames.js';
import { mergeKalshiIntoFdGames } from '../src/sop/mergeKalshiGames.js';
import { collectSopPaperSnapshots } from '../src/sop/paperSnapshots.js';
import {
  shouldFetchBooks,
  shouldFetchEspn,
  summarizeListing,
} from '../src/paperTrack/gating.js';

const SPORT = 'sop';

function soccerListing(matches) {
  return (matches ?? []).map((match) => ({
    startTime: match.startTime,
    inPlay: match.clock?.status === 'in' || Boolean(match.clock?.halfTime),
    halfTime: Boolean(match.clock?.halfTime),
    finished: Boolean(match.clock?.finished) || match.clock?.status === 'post',
  }));
}

function gamesListing(games) {
  return (games ?? []).map((game) => ({
    startTime: game.openDate,
    inPlay: Boolean(game.inPlay) || game.espn?.status === 'in' || Boolean(game.espn?.halfTime),
    halfTime: Boolean(game.espn?.halfTime),
    finished: Boolean(game.espn?.finished),
  }));
}

async function fetchEspnListing() {
  const board = await fetchEspnSoccerScoreboards([], espnLeagueKeys('all'));
  return summarizeListing(soccerListing(board.matches ?? []));
}

async function fetchSop2Books() {
  const { fetchPremierLeagueSopOdds } = await import('../api/fanduel-sop.mjs');
  const { fetchWorldCupGoalMethodOdds } = await import('./draftkings-goal-method.mjs');
  const { fetchWorldCupKalshiOdds } = await import('./kalshi-sop.mjs');

  const [fdResult, dkResult, klshResult] = await Promise.allSettled([
    fetchPremierLeagueSopOdds({ includeEspn: true, soccerScope: 'all', fresh: true }),
    fetchWorldCupGoalMethodOdds({ soccerScope: 'all', upcomingOnly: true, fresh: true }),
    fetchWorldCupKalshiOdds({ upcomingOnly: true }),
  ]);

  const fd = fdResult.status === 'fulfilled' ? fdResult.value : { games: [] };
  const dk = dkResult.status === 'fulfilled' ? dkResult.value : { games: [] };
  const klsh = klshResult.status === 'fulfilled' ? klshResult.value : { games: [] };
  const games = keepSopDisplayGames(
    mergeKalshiIntoFdGames(mergeDkIntoFdGames(fd.games ?? [], dk), klsh),
    { requireNextGoalMethod: true },
  );
  return {
    games,
    errors: {
      fd: fdResult.status === 'rejected' ? fdResult.reason?.message || 'fd failed' : null,
      dk: dkResult.status === 'rejected' ? dkResult.reason?.message || 'dk failed' : null,
      klsh: klshResult.status === 'rejected' ? klshResult.reason?.message || 'kalshi failed' : null,
    },
  };
}

export async function runSopTrackTick(now = Date.now()) {
  const started = Date.now();
  const meta = await readTrackMeta(SPORT);
  const unsettled = await countReadyUnsettled(SPORT);
  if (!shouldFetchEspn(meta, now) && unsettled === 0) {
    return {
      ok: true,
      sport: SPORT,
      skipped: 'idle',
      nextKickoffAt: meta.nextKickoffAt,
      liveCount: meta.liveCount,
      elapsedMs: Date.now() - started,
    };
  }

  if (!shouldFetchEspn(meta, now) && unsettled > 0) {
    const scored = await settleSopSnapshots();
    return {
      ok: true,
      sport: SPORT,
      skipped: 'settle-only',
      scored: scored.scored,
      settleEvents: scored.events,
      nextKickoffAt: meta.nextKickoffAt,
      liveCount: meta.liveCount,
      elapsedMs: Date.now() - started,
    };
  }

  const listing = await fetchEspnListing();
  const espnPatch = {
    ...listingToMetaPatch(listing),
    lastEspnAt: new Date(now).toISOString(),
  };

  if (!shouldFetchBooks(SPORT, listing, meta, now)) {
    const scored = await settleSopSnapshots();
    await writeTrackMeta(SPORT, espnPatch);
    return {
      ok: true,
      sport: SPORT,
      skipped: 'espn-only',
      scored: scored.scored,
      settleEvents: scored.events,
      ...listing,
      nextKickoffAt: listing.nextKickoffAt
        ? new Date(listing.nextKickoffAt).toISOString()
        : null,
      elapsedMs: Date.now() - started,
    };
  }

  const books = await fetchSop2Books();
  const bookListing = summarizeListing(gamesListing(books.games), now);
  const pregameByEvent = await latestPregamePayloads(SPORT);
  const snapshots = collectSopPaperSnapshots(books.games, {
    pregameByEvent,
    capturedAt: new Date(now),
  });
  const fingerprints = await latestFingerprints(SPORT);
  const wrote = await insertNewSnapshots(snapshots, { fingerprints });
  const scored = await settleSopSnapshots({ games: books.games });
  await writeTrackMeta(SPORT, {
    ...listingToMetaPatch(bookListing.liveCount || bookListing.upcomingCount
      ? bookListing
      : listing),
    lastEspnAt: new Date(now).toISOString(),
    lastBooksAt: new Date(now).toISOString(),
  });

  return {
    ok: true,
    sport: SPORT,
    skipped: null,
    inserted: wrote.inserted,
    skippedDupes: wrote.skipped,
    scored: scored.scored,
    settleEvents: scored.events,
    games: books.games.length,
    errors: books.errors,
    ...bookListing,
    nextKickoffAt: (bookListing.nextKickoffAt || listing.nextKickoffAt)
      ? new Date(bookListing.nextKickoffAt || listing.nextKickoffAt).toISOString()
      : null,
    elapsedMs: Date.now() - started,
  };
}

export async function handleSopTrack(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const data = await runSopTrackTick();
    setNoStore(res);
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[paper-track-sop]', err);
    setNoStore(res);
    return res.status(502).json({ error: err.message || 'SOP track failed' });
  }
}
