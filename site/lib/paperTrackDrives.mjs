/**
 * /drives paper-line cron: ESPN every minute while college games are on.
 * FanDuel/DK while games are live (spread/total), at HT (next-drive), and
 * in the pregame first-drive windows.
 */

import { uniqueScoreboardDates } from '../src/drives/espnScoreboardDates.js';
import { isHalftimeLive } from '../src/drives/driveModel.js';
import { collectDrivesPaperSnapshots } from '../src/drives/paperSnapshots.js';
import { setNoStore } from './bookCache.mjs';
import {
  insertNewSnapshots,
  latestFingerprints,
  latestPregamePayloads,
  listingToMetaPatch,
  readTrackMeta,
  writeTrackMeta,
} from './paperTrackCore.mjs';
import {
  shouldFetchBooks,
  shouldFetchEspn,
  summarizeListing,
} from '../src/paperTrack/gating.js';

const SPORT = 'drives';
const ESPN_SCOREBOARD_URLS = [
  'https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
];
const ESPN_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: 'https://www.espn.com/college-football/scoreboard',
};

async function espnGetJson(url) {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${sep}_=${Date.now()}`, {
    headers: {
      ...ESPN_HEADERS,
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  if (!res.ok) throw new Error(`ESPN ${url} returned ${res.status}`);
  return res.json();
}

function parseListingEvent(event) {
  const competition = event?.competitions?.[0] ?? {};
  const status = competition.status ?? event?.status ?? {};
  const state = String(status?.type?.state ?? '').toLowerCase();
  const typeName = String(status?.type?.name ?? '');
  const statusText = status?.type?.shortDetail ?? status?.type?.detail ?? '';
  const halfTime = /HALFTIME/i.test(typeName) || /HALFTIME/i.test(String(statusText));
  return {
    startTime: event?.date ?? competition.date ?? null,
    inPlay: state === 'in' || halfTime,
    halfTime,
    finished: state === 'post',
  };
}

export async function fetchNcaafListing() {
  const dates = uniqueScoreboardDates([]);
  const seen = new Set();
  const matches = [];
  for (const date of dates) {
    let payload = null;
    for (const base of ESPN_SCOREBOARD_URLS) {
      try {
        payload = await espnGetJson(`${base}?dates=${date}&limit=300`);
        break;
      } catch {
        payload = null;
      }
    }
    if (!payload) continue;
    for (const event of payload.events ?? []) {
      const id = String(event?.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      matches.push(parseListingEvent(event));
    }
  }
  return summarizeListing(matches);
}

function gamesListing(games) {
  return (games ?? []).map((game) => ({
    startTime: game.openDate,
    inPlay: Boolean(game.inPlay) || isHalftimeLive(game.live),
    halfTime: isHalftimeLive(game.live),
    finished: Boolean(game.live?.state === 'post'),
  }));
}

async function fetchDriveBooks() {
  const { fetchNcaafDriveBook } = await import('../api/ncaaf-drives.mjs');
  return fetchNcaafDriveBook();
}

export async function runDrivesTrackTick(now = Date.now()) {
  const started = Date.now();
  const meta = await readTrackMeta(SPORT);
  if (!shouldFetchEspn(meta, now)) {
    return {
      ok: true,
      sport: SPORT,
      skipped: 'idle',
      nextKickoffAt: meta.nextKickoffAt,
      liveCount: meta.liveCount,
      halfTimeCount: meta.halfTimeCount,
      elapsedMs: Date.now() - started,
    };
  }

  const listing = await fetchNcaafListing();
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

  const book = await fetchDriveBooks();
  const games = book?.games ?? [];
  const bookListing = summarizeListing(gamesListing(games), now);
  const pregameByEvent = await latestPregamePayloads(SPORT);
  const snapshots = collectDrivesPaperSnapshots(games, {
    capturedAt: new Date(now),
    pregameByEvent,
  });
  const fingerprints = await latestFingerprints(SPORT);
  const wrote = await insertNewSnapshots(snapshots, { fingerprints });
  await writeTrackMeta(SPORT, {
    ...listingToMetaPatch(bookListing.liveCount || bookListing.upcomingCount || bookListing.halfTimeCount
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
    games: games.length,
    ...bookListing,
    nextKickoffAt: (bookListing.nextKickoffAt || listing.nextKickoffAt)
      ? new Date(bookListing.nextKickoffAt || listing.nextKickoffAt).toISOString()
      : null,
    elapsedMs: Date.now() - started,
  };
}

export async function handleDrivesTrack(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const data = await runDrivesTrackTick();
    setNoStore(res);
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[paper-track-drives]', err);
    setNoStore(res);
    return res.status(502).json({ error: err.message || 'Drives track failed' });
  }
}
