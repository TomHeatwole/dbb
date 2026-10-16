/**
 * Corners paper-line cron for /corners (PL+UCL) and /mlscorner.
 * Same idle gating as SOP: ESPN listings off-hours, books while live.
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
import { collectCornersPaperSnapshots } from '../src/corners/paperSnapshots.js';
import {
  keepCornersDisplayGames,
  mergeDkCornersIntoFdGames,
  mergeKalshiCornersIntoFdGames,
} from '../src/corners/mergeCornerBooks.js';
import { dkLeagueEntries } from '../src/sop/soccerLeagues.js';
import {
  shouldFetchBooks,
  shouldFetchEspn,
  summarizeListing,
} from '../src/paperTrack/gating.js';

const SPORT = 'corners';

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
    inPlay: Boolean(game.inPlay) || game.stoppage?.status === 'in' || Boolean(game.stoppage?.halfTime),
    halfTime: Boolean(game.stoppage?.halfTime),
    finished: Boolean(game.stoppage?.finished) || game.stoppage?.status === 'post',
  }));
}

async function fetchEspnListing() {
  const board = await fetchEspnSoccerScoreboards([], ['pl', 'ucl', 'mls']);
  return summarizeListing(soccerListing(board.matches ?? []));
}

async function fetchCornerBooks() {
  const { fetchCornerBook, PL_BOOK_CONFIG, MLS_BOOK_CONFIG } = await import('../api/pl-corners.mjs');
  const { fetchDkCornerOdds } = await import('./dk-corners.mjs');
  const { fetchKalshiCornerOdds } = await import('./kalshi-corners.mjs');
  const mlsLeagues = dkLeagueEntries('all').filter((row) => row.competition === 'mls');

  const [plFd, mlsFd, dkPl, dkMls, klsh] = await Promise.allSettled([
    fetchCornerBook(PL_BOOK_CONFIG),
    fetchCornerBook(MLS_BOOK_CONFIG),
    fetchDkCornerOdds(),
    fetchDkCornerOdds({ leagues: mlsLeagues }),
    fetchKalshiCornerOdds(),
  ]);

  const plFdVal = plFd.status === 'fulfilled' ? plFd.value : { games: [] };
  const mlsFdVal = mlsFd.status === 'fulfilled' ? mlsFd.value : { games: [] };
  const dkPlVal = dkPl.status === 'fulfilled' ? dkPl.value : { games: [] };
  const dkMlsVal = dkMls.status === 'fulfilled' ? dkMls.value : { games: [] };
  const klshVal = klsh.status === 'fulfilled' ? klsh.value : { games: [] };

  const plGames = keepCornersDisplayGames(
    mergeKalshiCornersIntoFdGames(mergeDkCornersIntoFdGames(plFdVal.games ?? [], dkPlVal), klshVal),
  );
  const mlsGames = mergeDkCornersIntoFdGames(mlsFdVal.games ?? [], dkMlsVal);

  return {
    plGames,
    mlsGames,
    errors: {
      plFd: plFd.status === 'rejected' ? plFd.reason?.message || 'pl fd failed' : null,
      mlsFd: mlsFd.status === 'rejected' ? mlsFd.reason?.message || 'mls fd failed' : null,
      dkPl: dkPl.status === 'rejected' ? dkPl.reason?.message || 'dk pl failed' : null,
      dkMls: dkMls.status === 'rejected' ? dkMls.reason?.message || 'dk mls failed' : null,
      klsh: klsh.status === 'rejected' ? klsh.reason?.message || 'kalshi failed' : null,
    },
  };
}

export async function runCornersTrackTick(now = Date.now()) {
  const started = Date.now();
  const meta = await readTrackMeta(SPORT);
  if (!shouldFetchEspn(meta, now)) {
    return {
      ok: true,
      sport: SPORT,
      skipped: 'idle',
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
    await writeTrackMeta(SPORT, espnPatch);
    return {
      ok: true,
      sport: SPORT,
      skipped: 'espn-only',
      ...listing,
      nextKickoffAt: listing.nextKickoffAt
        ? new Date(listing.nextKickoffAt).toISOString()
        : null,
      elapsedMs: Date.now() - started,
    };
  }

  const books = await fetchCornerBooks();
  const games = [...books.plGames, ...books.mlsGames];
  const bookListing = summarizeListing(gamesListing(games), now);
  const pregameByEvent = await latestPregamePayloads(SPORT);
  const snapshots = [
    ...collectCornersPaperSnapshots(books.plGames, { league: 'pl', pregameByEvent, capturedAt: new Date(now) }),
    ...collectCornersPaperSnapshots(books.mlsGames, { league: 'mls', pregameByEvent, capturedAt: new Date(now) }),
  ];
  const fingerprints = await latestFingerprints(SPORT);
  const wrote = await insertNewSnapshots(snapshots, { fingerprints });
  await writeTrackMeta(SPORT, {
    ...listingToMetaPatch(bookListing.liveCount || bookListing.upcomingCount ? bookListing : listing),
    lastEspnAt: new Date(now).toISOString(),
    lastBooksAt: new Date(now).toISOString(),
  });

  return {
    ok: true,
    sport: SPORT,
    skipped: null,
    inserted: wrote.inserted,
    skippedDupes: wrote.skipped,
    games: games.length,
    errors: books.errors,
    ...bookListing,
    nextKickoffAt: (bookListing.nextKickoffAt || listing.nextKickoffAt)
      ? new Date(bookListing.nextKickoffAt || listing.nextKickoffAt).toISOString()
      : null,
    elapsedMs: Date.now() - started,
  };
}

export async function handleCornersTrack(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const data = await runCornersTrackTick();
    setNoStore(res);
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[paper-track-corners]', err);
    setNoStore(res);
    return res.status(502).json({ error: err.message || 'Corners track failed' });
  }
}
