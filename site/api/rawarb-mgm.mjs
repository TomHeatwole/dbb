/**
 * BetMGM main lines via the public CDS fixtures feed.
 */

import { extractMgmContracts, extractMgmFixtures } from '../src/rawarb/mgmExtract.js';

const CDS = 'https://cf-us1-cds-api.itsfogo.com/bettingoffer';
const FALLBACK_ACCESS_ID = 'ZTllNjllODUtOWQwNS00YmU4LWE4NTEtZGZjOTkzMGM5OWU4';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SPORTS = [11, 7, 23, 12, 4, 5, 45, 24, 22, 29, 32];

async function accessId() {
  try {
    const res = await fetch(
      'https://www.nj.betmgm.com/en/api/clientconfig?browserUrl=http%3A%2F%2Fwww.nj.betmgm.com%2Fen%2Fsports&x-from-product=host-app',
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': UA,
          'x-bwin-browser-url': 'http%3A%2F%2Fwww.nj.betmgm.com%2Fen%2Fsports',
          'x-from-product': 'host-app',
          'x-bwin-sports-api': 'prod',
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return FALLBACK_ACCESS_ID;
    const json = await res.json();
    return json?.msConnection?.pushAccessId || FALLBACK_ACCESS_ID;
  } catch {
    return FALLBACK_ACCESS_ID;
  }
}

async function fetchPage(id, sportId, skip, state) {
  const params = new URLSearchParams({
    'x-bwin-accessid': id,
    lang: 'en-us',
    country: 'US',
    userCountry: 'US',
    subdivision: 'US-New Jersey',
    fixtureTypes: 'Standard',
    state,
    offerMapping: 'Filtered',
    offerCategories: 'Gridable',
    fixtureCategories: 'Gridable,NonGridable,Other',
    sportIds: String(sportId),
    isPriceBoost: 'false',
    statisticsModes: 'None',
    skip: String(skip),
    take: '100',
  });
  const res = await fetch(`${CDS}/fixtures?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`BetMGM sport ${sportId} returned ${res.status}`);
  return res.json();
}

async function fetchSport(id, sportId) {
  const games = [];
  const seen = new Set();
  for (const state of ['Latest', 'Live']) {
    let skip = 0;
    let total = Infinity;
    const pageCap = state === 'Live' ? 3 : 8;
    for (let page = 0; page < pageCap && skip < total; page += 1) {
      let payload;
      try {
        payload = await fetchPage(id, sportId, skip, state);
      } catch (err) {
        if (state === 'Live') break;
        throw err;
      }
      total = Number(payload?.totalCount) || 0;
      for (const game of extractMgmFixtures(payload)) {
        if (seen.has(game.eventId)) continue;
        seen.add(game.eventId);
        games.push(game);
      }
      const batch = payload?.fixtures?.length || 0;
      if (!batch) break;
      skip += batch;
    }
  }
  return games;
}

/** Full option board for one fixture (alts, periods, player O/U, team totals). */
export async function fetchMgmFixture(fixtureId) {
  if (!fixtureId) return null;
  const id = await accessId();
  const params = new URLSearchParams({
    'x-bwin-accessid': id,
    lang: 'en-us',
    country: 'US',
    userCountry: 'US',
    subdivision: 'US-New Jersey',
    offerMapping: 'All',
    scoreboardMode: 'Full',
    fixtureIds: String(fixtureId),
    state: 'Latest',
    includePrecreatedBetBuilder: 'false',
    supportVirtual: 'false',
  });
  const res = await fetch(`${CDS}/fixture-view?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const payload = await res.json();
  return payload?.fixture || null;
}

export async function fetchMgmContracts(fixtureId, teams) {
  const fixture = await fetchMgmFixture(fixtureId);
  if (!fixture) return [];
  return extractMgmContracts(fixture, teams);
}

export async function fetchMgmGames() {
  const id = await accessId();
  const batches = await Promise.all(SPORTS.map(async (sportId) => {
    try {
      return { ok: true, games: await fetchSport(id, sportId) };
    } catch (err) {
      return { ok: false, sportId, error: String(err?.message || err).slice(0, 160) };
    }
  }));
  const notices = batches.filter((row) => !row.ok).map((row) => `BetMGM ${row.sportId}: ${row.error}`);
  const games = batches.flatMap((row) => row.games || []);
  if (!games.length && notices.length) {
    throw new Error(notices[0]);
  }
  return { games, notices };
}
