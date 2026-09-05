/**
 * NCAAF drive book: FanDuel live next-drive + DraftKings pregame 1st-drive.
 *
 * FanDuel Next Drive Result is a live Quick Bets / play-by-play market on
 * fdx-api, not a coupon-tab market on sbapi. Prices hydrate via AppSync
 * getMarketPrices. Pregame, FDX returns 400 "Event is scheduled".
 * DraftKings posts 1st Drive Result on Nash before kickoff.
 */

const FD_BASE = 'https://sbapi.nj.sportsbook.fanduel.com/api';
const FD_QUERY =
  'currencyCode=USD&exchangeLocale=en_US&includePrices=true&language=en&regionCode=NAMERICA&timezone=America%2FNew_York&_ak=FhMFpcPWXMeyZxOx';
const NCAAF_COMPETITION_ID = 12529073;

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

const FD_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; HwangDynasty-Drives/1.0)',
};

const FD_AK = 'FhMFpcPWXMeyZxOx';
const FDX_BASE = 'https://fdx-api.sportsbook.fanduel.com/api/v1';
const FDX_HEADERS = {
  Accept: 'application/json',
  'User-Agent': FD_HEADERS['User-Agent'],
  'x-sportsbook-region': 'NJ',
};
const PIR_GQL = 'https://pir.nj.sportsbook.fanduel.com/graphql';
const PIR_AUTH = 'NfxZUKb5R+do8pGKXq27wPTO3JHUlUmn';
const GET_MARKET_PRICES = `query GetMarketPrices($ids: [String]!) {
  getMarketPrices(ids: $ids) {
    id marketId marketStatus inplay
    runnerDetails {
      selectionId runnerStatus
      winRunnerOdds { americanDisplayOdds { americanOdds } }
    }
  }
}`;

const DK_NASH_BASE = 'https://sportsbook-nash.draftkings.com/sites/US-NY-SB/api';
const DK_NCAAF_LEAGUE_ID = '87637';
const DK_FIRST_DRIVE_RESULT_SUB = '13561';
const DK_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://sportsbook.draftkings.com',
  Referer: 'https://sportsbook.draftkings.com/leagues/football/ncaaf',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
  'x-client-feature': 'cms',
  'x-client-name': 'web',
  'x-client-page': 'event',
  'x-client-version': '1.14.0',
  'x-pe-cn': 'web',
  'x-pe-cv': '1.14.0',
  'x-pe-ep': 'SB',
  'x-pe-loc': 'US-NY',
};

const EVENT_POOL = 10;
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

const MASCOT_STOP = new Set([
  'aggies', 'bears', 'bison', 'broncos', 'bruins', 'buckeyes', 'bulldogs',
  'cardinal', 'cavaliers', 'cougars', 'cowboys', 'eagles', 'falcons',
  'gamecocks', 'gators', 'hawkeyes', 'hornets', 'hurricanes', 'jayhawks',
  'longhorns', 'lions', 'mountaineers', 'rebels', 'seminoles', 'spartans',
  'tigers', 'trojans', 'warriors', 'wildcats', 'wolfpack', 'wolverines',
  'university', 'univ', 'the', 'football',
]);

const TEAM_ALIASES = [
  ['jacksonville state', "j'ville st", 'jville st', 'jville state', 'jsu'],
  ['north dakota state', 'nd st', 'ndsu', 'n dakota st'],
  ['eastern michigan', 'e michigan', 'e mich', 'emu'],
  ['sacramento state', 'sac', 'sac state', 'sac st'],
  ['new mexico state', 'nmsu', 'nm state', 'n mexico st'],
  ['florida state', 'florida st', 'fsu'],
  ['hawaii', "hawai'i", 'hawaii rainbow warriors'],
  ['miami florida', 'miami fl', 'miami (fl)', 'miami'],
  ['miami ohio', 'miami oh', 'miami (oh)'],
  ['ole miss', 'mississippi'],
  ['southern california', 'usc', 's california'],
  ['san jose state', 'san josé state', 'sj su', 'sjsu'],
  ['appalachian state', 'app state', 'app st'],
  ['ohio state', 'ohio st'],
  ['penn state', 'penn st', 'psu'],
  ['oklahoma state', 'oklahoma st', 'okst'],
  ['michigan state', 'michigan st', 'msu'],
  ['oregon state', 'oregon st'],
  ['washington state', 'washington st', 'wsu'],
  ['arizona state', 'arizona st', 'asu'],
  ['kansas state', 'kansas st', 'k-state', 'kstate'],
  ['iowa state', 'iowa st'],
  ['utah state', 'utah st'],
  ['fresno state', 'fresno st'],
  ['boise state', 'boise st'],
  ['colorado state', 'colorado st'],
  ['san diego state', 'san diego st', 'sdsu'],
  ['georgia state', 'georgia st'],
  ['georgia southern', 'ga southern'],
  ['georgia tech', 'ga tech'],
  ['texas a&m', 'texas am', 'tamu'],
  ['texas state', 'texas st'],
  ['texas tech', 'tx tech'],
  ['ul monroe', 'ulm', 'louisiana monroe'],
  ['ul lafayette', 'ull', 'louisiana'],
  ['southern miss', 's miss'],
  ['middle tennessee', 'mtsu', 'middle tenn'],
  ['western kentucky', 'w kentucky', 'wku'],
  ['western michigan', 'w michigan', 'wmu'],
  ['central michigan', 'c michigan', 'cmu'],
  ['northern illinois', 'n illinois', 'niu'],
  ['bowling green', 'b green'],
  ['coastal carolina', 'coastal caro'],
  ['south carolina', 's carolina'],
  ['north carolina', 'n carolina', 'unc'],
  ['nc state', 'n carolina st', 'north carolina state'],
  ['virginia tech', 'va tech'],
  ['west virginia', 'w virginia', 'wvu', 'wv'],
  ['notre dame', 'n dame'],
  ['boston college', 'boston col', 'bc'],
  ['mississippi state', 'mississippi st', 'miss st'],
  ['louisiana tech', 'la tech'],
  ['florida international', 'fiu'],
  ['florida atlantic', 'fau'],
  ['utsa', 'ut san antonio', 'texas san antonio'],
  ['utep', 'texas el paso'],
  ['utep', 'utep miners'],
  ['smu', 'southern methodist'],
  ['tcu', 'texas christian'],
  ['ucf', 'central florida'],
  ['usf', 'south florida'],
  ['unlv', 'nevada las vegas'],
  ['byu', 'brigham young'],
  ['lsu', 'louisiana state'],
  ['long island', 'liu', 'long island university'],
];

function runnersList(market) {
  const runners = market?.runners;
  if (!runners) return [];
  if (Array.isArray(runners)) return runners;
  return Object.values(runners);
}

function parseSignedAmerican(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const n = Number(String(raw).trim().replace(/\u2212/g, '-').replace(/^\+/, ''));
  return Number.isFinite(n) ? n : null;
}

function americanOdds(runner) {
  const raw = runner?.winRunnerOdds?.americanDisplayOdds?.americanOdds;
  return parseSignedAmerican(raw);
}

function runnerQuote(runner) {
  if (!runner) return null;
  const american = americanOdds(runner);
  if (american == null) return null;
  return {
    american,
    status: runner.runnerStatus ?? null,
    runnerName: runner.runnerName ?? null,
  };
}

async function fdFetch(path) {
  const res = await fetch(`${FD_BASE}${path}`, { headers: FD_HEADERS });
  if (!res.ok) {
    throw new Error(`FanDuel ${path} returned ${res.status}`);
  }
  return res.json();
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

async function fdxFetch(path) {
  const res = await fetch(`${FDX_BASE}${path}`, { headers: FDX_HEADERS });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, snippet: text.slice(0, 280) };
}

function catalogRunnerName(runner) {
  return runner?.runnerName || runner?.selectionName || runner?.name || runner?.label || runner?.title || null;
}

function catalogSelectionId(runner) {
  const id = runner?.selectionId ?? runner?.id;
  return id == null ? null : String(id);
}

function collectCatalogMarkets(node, acc = new Map(), depth = 0) {
  if (!node || depth > 12 || acc.size > 120) return acc;
  if (Array.isArray(node)) {
    for (const child of node) collectCatalogMarkets(child, acc, depth + 1);
    return acc;
  }
  if (typeof node !== 'object') return acc;

  const marketId = node.marketId ?? node.marketID ?? (typeof node.id === 'string' && /^\d+\.\d+$/.test(node.id) ? node.id : null);
  const marketName = node.marketName || node.name || node.title || node.displayName || null;
  const runnerSource = node.runners || node.selections || node.outcomes || node.runnerDetails;
  if (marketId && (marketName || runnerSource)) {
    const prev = acc.get(String(marketId)) || {
      marketId: String(marketId),
      marketName: null,
      runners: [],
    };
    if (marketName && !prev.marketName) prev.marketName = marketName;
    if (runnerSource) {
      const list = Array.isArray(runnerSource) ? runnerSource : Object.values(runnerSource);
      for (const runner of list) {
        const selectionId = catalogSelectionId(runner);
        const runnerName = catalogRunnerName(runner);
        if (!selectionId && !runnerName) continue;
        const existing = prev.runners.find((row) => (
          (selectionId && row.selectionId === selectionId) || (runnerName && row.runnerName === runnerName)
        ));
        if (existing) {
          if (!existing.runnerName && runnerName) existing.runnerName = runnerName;
          if (!existing.selectionId && selectionId) existing.selectionId = selectionId;
          if (existing.american == null) existing.american = parseSignedAmerican(americanOdds(runner) ?? runner?.americanOdds);
        } else {
          prev.runners.push({
            selectionId,
            runnerName,
            runnerStatus: runner?.runnerStatus ?? runner?.status ?? null,
            american: parseSignedAmerican(americanOdds(runner) ?? runner?.americanOdds ?? runner?.displayOdds?.american),
          });
        }
      }
    }
    acc.set(String(marketId), prev);
  }

  for (const value of Object.values(node)) collectCatalogMarkets(value, acc, depth + 1);
  return acc;
}

function extractFdxDriveMarket(markets) {
  const names = [...new Set(markets.map((m) => m.marketName).filter(Boolean))];
  const driveNames = names.filter((n) => /drive/i.test(n));
  return {
    driveNames: driveNames.slice(0, 12),
    resultNames: driveNames.filter((n) => /result|outcome/i.test(n)).slice(0, 8),
  };
}

function catalogToFdMarket(row) {
  return {
    marketName: row.marketName,
    marketStatus: row.marketStatus ?? 'OPEN',
    runners: (row.runners || []).map((runner) => ({
      runnerName: runner.runnerName,
      runnerStatus: runner.runnerStatus,
      selectionId: runner.selectionId,
      winRunnerOdds: {
        americanDisplayOdds: { americanOdds: runner.american },
      },
    })),
  };
}

function fdxToNextDrive(markets) {
  let best = null;
  for (const row of markets) {
    if (!isDriveResultMarket(row.marketName)) continue;
    const ranked = scoreDriveMarket(catalogToFdMarket(row), { inPlay: true });
    if (!best || ranked.score > best.score) best = ranked;
  }
  if (!best || !Object.keys(best.outcomes).length) return null;
  return { marketName: best.name, marketStatus: 'OPEN', outcomes: best.outcomes, source: 'fdx' };
}

async function fetchFdMarketPrices(ids) {
  const unique = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
  if (!unique.length) return new Map();
  const byId = new Map();
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const res = await fetch(PIR_GQL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: PIR_AUTH,
        'User-Agent': FD_HEADERS['User-Agent'],
      },
      body: JSON.stringify({ query: GET_MARKET_PRICES, variables: { ids: chunk } }),
    });
    const json = await res.json().catch(() => null);
    for (const market of json?.data?.getMarketPrices ?? []) {
      const id = String(market?.marketId || market?.id || '');
      if (!id) continue;
      byId.set(id, market);
    }
  }
  return byId;
}

function hydrateCatalogWithPrices(catalog, priced) {
  return catalog.map((row) => {
    const live = priced.get(String(row.marketId));
    if (!live) return row;
    const details = Array.isArray(live.runnerDetails) ? live.runnerDetails : [];
    const runners = row.runners.length ? row.runners.map((runner) => {
      const hit = details.find((d) => String(d.selectionId) === String(runner.selectionId));
      const american = parseSignedAmerican(hit?.winRunnerOdds?.americanDisplayOdds?.americanOdds);
      return {
        ...runner,
        runnerStatus: hit?.runnerStatus ?? runner.runnerStatus,
        american: american ?? runner.american,
      };
    }) : details.map((hit) => ({
      selectionId: hit.selectionId != null ? String(hit.selectionId) : null,
      runnerName: catalogRunnerName(hit),
      runnerStatus: hit.runnerStatus ?? null,
      american: parseSignedAmerican(hit.winRunnerOdds?.americanDisplayOdds?.americanOdds),
    }));
    return {
      ...row,
      marketStatus: live.marketStatus ?? row.marketStatus,
      inplay: live.inplay,
      runners,
    };
  });
}

async function fetchFdxDebug(eventId, { inPlay = false, openDate = null } = {}) {
  const soon = openDate && Number.isFinite(Date.parse(openDate))
    ? Date.parse(openDate) - Date.now() < 18 * 60 * 60 * 1000
    : false;
  if (!inPlay && !soon) return null;
  try {
    const status = await fdxFetch(`/live/event/${eventId}/status/football`);
    const body = status.json || {};
    const liveish = Boolean(body.isQuickBetsAvailable)
      || /in[- ]?play|inprogress|live/i.test(String(body.status ?? ''));
    const payloads = [];
    let quick = null;
    if (liveish || inPlay) {
      quick = await fdxFetch(`/live/event/${eventId}/quick-bets/football/${FD_AK}`);
      if (quick?.json) payloads.push(quick.json);
    }
    let pbp = null;
    if (body.isPbpAvailable || inPlay) {
      pbp = await fdxFetch(`/live/event/${eventId}/pbp/current`);
      if (pbp?.json) payloads.push(pbp.json);
    }
    const catalogMap = new Map();
    for (const payload of payloads) collectCatalogMarkets(payload, catalogMap);
    let catalog = [...catalogMap.values()];
    const needPrices = catalog.some((row) => (
      isDriveResultMarket(row.marketName) && row.runners.some((r) => r.american == null)
    )) || catalog.some((row) => isDriveResultMarket(row.marketName) && !row.runners.length);
    if (needPrices && catalog.length) {
      const priced = await fetchFdMarketPrices(catalog.map((row) => row.marketId));
      catalog = hydrateCatalogWithPrices(catalog, priced);
    }
    const extracted = extractFdxDriveMarket(catalog);
    return {
      fdxStatus: status.status,
      fdxState: body.status ?? null,
      scheduled: body.scheduled ?? null,
      isQuickBetsAvailable: body.isQuickBetsAvailable ?? null,
      isPbpAvailable: body.isPbpAvailable ?? null,
      comp: body.comp ?? null,
      quickBetsHttp: quick?.status ?? null,
      quickBetsSnippet: quick && !quick.json ? quick.snippet : (quick?.json?.message || null),
      pbpHttp: pbp?.status ?? null,
      fdxDriveNames: extracted.driveNames,
      fdxResultNames: extracted.resultNames,
      fdxMarketCount: catalog.length,
      nextDrive: fdxToNextDrive(catalog),
    };
  } catch (err) {
    return { fdxError: compactProviderError(err.message || err) };
  }
}

function summarizeSbapiMarkets(markets) {
  const names = Object.values(markets ?? {})
    .map((m) => String(m?.marketName ?? '').trim())
    .filter(Boolean);
  const driveNames = [...new Set(names.filter((n) => /drive/i.test(n)))];
  return {
    marketCount: names.length,
    driveMarketNames: driveNames.slice(0, 12),
  };
}

function parseTeams(eventName) {
  const raw = String(eventName ?? '');
  if (raw.includes(' @ ')) {
    const [away, home] = raw.split(' @ ').map((s) => s.trim());
    return { home: home || null, away: away || null };
  }
  if (/\s+v\s+/i.test(raw)) {
    const parts = raw.split(/\s+v\s+/i);
    return { home: parts[0]?.trim() || null, away: parts[1]?.trim() || null };
  }
  return { home: null, away: null };
}

function parseEventScore(event) {
  const candidates = [
    event?.score,
    event?.scores,
    event?.currentScore,
    event?.matchScore,
  ];

  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === 'object') {
      const home = Number(c.home ?? c.homeScore ?? c.team1 ?? c[0]);
      const away = Number(c.away ?? c.awayScore ?? c.team2 ?? c[1]);
      if (Number.isFinite(home) && Number.isFinite(away)) {
        return { home, away };
      }
    }
    if (typeof c === 'string') {
      const m = c.match(/^(\d+)\s*[-:]\s*(\d+)$/);
      if (m) return { home: Number(m[1]), away: Number(m[2]) };
    }
  }

  return null;
}

function scoreDisplay(score) {
  if (!score) return '0-0';
  return `${score.home}-${score.away}`;
}

function ncaafEvents(payload) {
  const events = payload?.attachments?.events ?? {};
  return Object.entries(events)
    .filter(([, ev]) => ev.competitionId === NCAAF_COMPETITION_ID)
    .map(([id, ev]) => ({
      eventId: Number(id),
      name: ev.name,
      openDate: ev.openDate ?? null,
      inPlay: Boolean(ev.inPlay),
    }));
}

function mergeMarkets(payloads) {
  const merged = {};
  for (const payload of payloads) {
    Object.assign(merged, payload?.attachments?.markets ?? {});
  }
  return merged;
}

function mergeEvent(payloads) {
  for (const payload of payloads) {
    const values = Object.values(payload?.attachments?.events ?? {});
    if (values.length) return values[0];
  }
  return null;
}

function isDriveResultMarket(name) {
  const n = String(name ?? '').toLowerCase();
  if (!n.includes('drive')) return false;
  // FanDuel live: "Drive 7 - Result" inside the Drive SGP tab.
  // Also house-rules "Next Drive Result" / "First Drive Result".
  if (/\bdrive\s+\d+\s*[-–:]\s*result\b/.test(n)) return true;
  if (n.includes('drive sgp') && n.includes('result')) return true;
  return n.includes('result') || n.includes('outcome');
}

function bucketFromRunnerName(runnerName) {
  const n = String(runnerName ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (n === 'punt' || n.startsWith('punt')) return 'punt';
  if (n.includes('field goal attempt') || n === 'fg attempt') return 'fg';
  if (n.includes('offensive touchdown') || n === 'offensive td') return 'td';
  if (n.includes('turnover') || n.includes('safety')) return 'other';
  if (n === 'other' || n === 'any other') return 'other';
  if (n === 'touchdown' || n === 'td') return 'td';
  if (n === 'field goal' || n === 'fg') return 'fg';
  return null;
}

function extractDriveOutcomes(market) {
  const outcomes = {};
  for (const runner of runnersList(market)) {
    const key = bucketFromRunnerName(runner.runnerName);
    if (!key || outcomes[key]) continue;
    const quote = runnerQuote(runner);
    if (quote) outcomes[key] = quote;
  }
  return outcomes;
}

function scoreDriveMarket(market, { inPlay, possessionName }) {
  const name = String(market?.marketName ?? '');
  const n = name.toLowerCase();
  let score = 0;
  const driveNum = n.match(/\bdrive\s+(\d+)\b/);
  if (driveNum) score += 40 + Number(driveNum[1]);
  if (n.includes('next')) score += 30;
  if (n.includes('first') || n.includes('1st') || n.includes('opening')) score += 18;
  if (possessionName && n.includes(String(possessionName).toLowerCase())) score += 12;
  if (String(market?.marketStatus ?? '').toUpperCase() === 'OPEN') score += 4;
  const outcomes = extractDriveOutcomes(market);
  score += Object.keys(outcomes).length * 3;
  if (inPlay && n.includes('first')) score -= 8;
  return { score, outcomes, name };
}

function pickDriveMarket(markets, { inPlay, possessionName } = {}) {
  let best = null;
  for (const market of Object.values(markets ?? {})) {
    if (!isDriveResultMarket(market?.marketName)) continue;
    const ranked = scoreDriveMarket(market, { inPlay, possessionName });
    if (!best || ranked.score > best.score) {
      best = { ...ranked, marketStatus: market.marketStatus ?? null };
    }
  }
  if (!best) return null;
  return {
    marketName: best.name,
    marketStatus: best.marketStatus,
    outcomes: best.outcomes,
  };
}

function shouldFetchDkFirstDrive(ev) {
  if (ev.inPlay) return true;
  const t = Date.parse(ev.openDate);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t >= now - 6 * 60 * 60 * 1000 && t <= now + 72 * 60 * 60 * 1000;
}

async function dkFetch(path, { page = 'event' } = {}) {
  const res = await fetch(`${DK_NASH_BASE}${path}`, {
    headers: { ...DK_HEADERS, 'x-client-page': page },
  });
  if (!res.ok) {
    throw new Error(`DraftKings ${path} returned ${res.status}`);
  }
  return res.json();
}

async function fetchDkLeagueEvents() {
  const payload = await dkFetch(`/sportscontent/dkusny/v1/leagues/${DK_NCAAF_LEAGUE_ID}`, { page: 'league' });
  return (payload.events ?? [])
    .filter((event) => event?.id && event?.name)
    .map((event) => ({
      eventId: String(event.id),
      name: String(event.name).replace(/\s+vs\.?\s+/i, ' @ '),
      teams: parseTeams(String(event.name).replace(/\s+vs\.?\s+/i, ' @ ')),
      openDate: event.startEventDate ?? null,
      inPlay: String(event.status ?? '').toUpperCase() === 'STARTED',
    }));
}

function matchDkEvent(fdGame, dkEvents) {
  const home = fdGame.teams?.home;
  const away = fdGame.teams?.away;
  if (!home || !away) return null;
  return dkEvents.find((row) => namesMatch(home, row.teams?.home) && namesMatch(away, row.teams?.away)) ?? null;
}

function dkSelectionsForMarket(market, selections) {
  const id = String(market?.id ?? '');
  return (selections ?? []).filter((row) => String(row.marketId) === id);
}

function dkMarketToNextDrive(market, selections) {
  const fake = {
    marketName: market?.name,
    marketStatus: market?.status ?? 'OPEN',
    runners: dkSelectionsForMarket(market, selections).map((row) => ({
      runnerName: row.label,
      runnerStatus: row.status ?? null,
      winRunnerOdds: {
        americanDisplayOdds: {
          americanOdds: parseSignedAmerican(row.displayOdds?.american ?? row.oddsAmerican),
        },
      },
    })),
  };
  const outcomes = extractDriveOutcomes(fake);
  if (Object.keys(outcomes).length < 3) return null;
  return {
    marketName: fake.marketName,
    marketStatus: fake.marketStatus,
    outcomes,
    source: 'dk',
  };
}

function teamFromDkDriveName(name) {
  return String(name ?? '')
    .replace(/^1st\s+/i, '')
    .replace(/\s+drive result(?:\s+grouped)?$/i, '')
    .trim();
}

function sideFromTeamName(team, teams) {
  if (team && teams?.away && namesMatch(team, teams.away)) return 'away';
  if (team && teams?.home && namesMatch(team, teams.home)) return 'home';
  return null;
}

function annotateDriveMarket(market, teams, live = null) {
  if (!market) return null;
  const fromName = teamFromDkDriveName(market.marketName);
  let side = sideFromTeamName(fromName, teams);
  if (!side && (live?.possession === 'home' || live?.possession === 'away')) {
    side = live.possession;
  }
  const offenseName = side === 'away'
    ? (teams?.away ?? fromName ?? live?.possessionName ?? null)
    : side === 'home'
      ? (teams?.home ?? fromName ?? live?.possessionName ?? null)
      : (fromName && !/^drive\b/i.test(fromName) ? fromName : (live?.possessionName ?? null));
  return { ...market, offenseSide: side, offenseName };
}

function pickDkFirstDrive(markets, selections, teams) {
  const converted = [];
  for (const market of markets ?? []) {
    const row = dkMarketToNextDrive(market, selections);
    if (!row) continue;
    converted.push(annotateDriveMarket(row, teams));
  }
  converted.sort((a, b) => {
    const rank = (s) => (s === 'away' ? 0 : s === 'home' ? 1 : 2);
    return rank(a.offenseSide) - rank(b.offenseSide);
  });
  return {
    drives: converted,
    nextDrive: converted[0] ?? null,
    names: converted.map((row) => row.marketName),
  };
}

async function fetchDkFirstDrive(dkEventId) {
  const marketsQuery = `$filter=eventId eq '${dkEventId}' AND clientMetadata/subCategoryId eq '${DK_FIRST_DRIVE_RESULT_SUB}' AND tags/all(t: t ne 'SportcastBetBuilder')`;
  const qs = new URLSearchParams({
    isBatchable: 'false',
    templateVars: `${dkEventId},${DK_FIRST_DRIVE_RESULT_SUB}`,
    marketsQuery,
    entity: 'markets',
  });
  const payload = await dkFetch(`/sportscontent/controldata/event/eventSubcategory/v1/markets?${qs}`);
  return {
    markets: payload.markets ?? [],
    selections: payload.selections ?? [],
  };
}

function findNamedMarket(markets, names) {
  const want = names.map((n) => n.toLowerCase());
  return Object.values(markets ?? {}).find((m) => want.includes(String(m.marketName ?? '').toLowerCase())) ?? null;
}

function extractMainLines(markets) {
  const ml = findNamedMarket(markets, ['Moneyline']);
  const spread = findNamedMarket(markets, ['Spread']);
  const total = findNamedMarket(markets, ['Total Points', 'Total']);
  const pickTwoWay = (market) => {
    if (!market) return null;
    const runners = runnersList(market).map((runner) => {
      const handicap = Number(runner.handicap);
      return {
        runnerName: runner.runnerName ?? null,
        handicap: Number.isFinite(handicap) ? handicap : null,
        ...runnerQuote(runner),
      };
    }).filter((r) => r.american != null);
    return runners.length ? { marketName: market.marketName, runners } : null;
  };
  return {
    moneyline: pickTwoWay(ml),
    spread: pickTwoWay(spread),
    total: pickTwoWay(total),
  };
}

function shouldFetchEvent(ev) {
  if (ev.inPlay) return true;
  if (!ev.openDate) return true;
  const t = Date.parse(ev.openDate);
  if (!Number.isFinite(t)) return true;
  const now = Date.now();
  return t >= now - 6 * 60 * 60 * 1000 && t <= now + TEN_DAYS_MS;
}

async function fetchEventBundle(eventId, { inPlayHint = false } = {}) {
  const payloads = [await fdFetch(`/event-page?${FD_QUERY}&eventId=${eventId}&tab=popular`)];
  const event = mergeEvent(payloads);
  const inPlay = Boolean(event?.inPlay ?? inPlayHint);
  const extra = inPlay
    ? ['live-sgp', 'live', 'quick-bets', 'game-specials', 'scoring', 'drive-sgp', 'drive', 'same-game-parlay']
    : ['same-game-parlay', 'game-specials', 'scoring'];
  const extraPayloads = await Promise.all(
    extra.map((tab) => fdFetch(`/event-page?${FD_QUERY}&eventId=${eventId}&tab=${tab}`).catch(() => null)),
  );
  for (const payload of extraPayloads) {
    if (payload) payloads.push(payload);
  }
  return {
    event: mergeEvent(payloads) ?? event,
    markets: mergeMarkets(payloads),
    tabs: ['popular', ...extra.filter((_, i) => extraPayloads[i])],
  };
}

function parseClockSeconds(display) {
  const m = String(display ?? '').trim().match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function ytgFromSituation(situation, possessionText) {
  const ytg = Number(situation?.yardsToEndzone);
  if (Number.isFinite(ytg) && ytg >= 1 && ytg <= 99) return ytg;
  const m = String(possessionText ?? '').trim().match(/(\d+)\s*$/);
  if (!m) return null;
  const yl = Number(m[1]);
  if (!Number.isFinite(yl) || yl < 1 || yl > 99) return null;
  if (yl === 50) return 50;
  if (yl <= 49) return 100 - yl;
  return yl;
}

function compactProviderError(err) {
  const s = String(err ?? '');
  if (/Access Denied/i.test(s) || /\b403\b/.test(s)) return '403 from ESPN';
  if (/401/.test(s)) return '401 unauthorized';
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function yyyymmddFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function yyyymmddInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) return null;
  return `${year}${month}${day}`;
}

function uniqueScoreboardDates(openDates) {
  const dates = new Set();
  const now = new Date();
  dates.add(yyyymmddInTimeZone(now, 'UTC'));
  dates.add(yyyymmddInTimeZone(now, 'America/New_York'));
  dates.add(yyyymmddInTimeZone(new Date(now.getTime() + 24 * 60 * 60 * 1000), 'America/New_York'));
  for (const iso of openDates) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    if (Math.abs(t - now.getTime()) > TEN_DAYS_MS) continue;
    const key = yyyymmddFromIso(iso);
    if (key) dates.add(key);
  }
  return [...dates].filter(Boolean).slice(0, 8);
}

function expandAlias(raw) {
  const n = normalizeTeam(raw);
  if (!n) return '';
  for (const [canon, ...alts] of TEAM_ALIASES) {
    if (n === canon || alts.includes(n)) return canon;
  }
  return n.replace(/\bst\b/g, 'state').replace(/\s+/g, ' ').trim();
}

function normalizeTeam(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’`]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamTokens(name) {
  return expandAlias(name)
    .split(' ')
    .filter((w) => w && !MASCOT_STOP.has(w) && w.length > 1);
}

function namesMatch(a, b) {
  const ca = expandAlias(a);
  const cb = expandAlias(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;
  const ta = teamTokens(a);
  const tb = teamTokens(b);
  if (!ta.length || !tb.length) return false;
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return shorter.every((tok) => longer.includes(tok));
}

function parseEspnEvent(event) {
  const competition = event?.competitions?.[0] ?? {};
  const competitors = competition.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home') ?? competitors[0];
  const away = competitors.find((c) => c.homeAway === 'away') ?? competitors[1];
  const num = (row) => {
    const n = Number(row?.score);
    return Number.isFinite(n) ? n : null;
  };
  const status = competition.status ?? event?.status ?? {};
  const situation = competition.situation ?? {};
  const possessionId = situation.possession != null ? String(situation.possession) : null;
  let possession = null;
  if (possessionId) {
    if (String(home?.team?.id) === possessionId || String(home?.id) === possessionId) {
      possession = 'home';
    } else if (String(away?.team?.id) === possessionId || String(away?.id) === possessionId) {
      possession = 'away';
    }
  }
  const state = String(status?.type?.state ?? '').toLowerCase();
  const possessionText = situation.possessionText ?? null;
  const down = Number(situation.down);
  const distance = Number(situation.distance);
  return {
    id: String(event?.id ?? ''),
    home: home?.team?.displayName ?? home?.team?.name ?? null,
    away: away?.team?.displayName ?? away?.team?.name ?? null,
    homeAbbr: home?.team?.abbreviation ?? null,
    awayAbbr: away?.team?.abbreviation ?? null,
    homeScore: num(home),
    awayScore: num(away),
    state,
    inPlay: state === 'in',
    period: Number(status?.period) || null,
    clock: status?.displayClock ?? null,
    clockSeconds: parseClockSeconds(status?.displayClock),
    statusText: status?.type?.shortDetail ?? status?.type?.detail ?? null,
    down: Number.isFinite(down) && down > 0 ? down : null,
    distance: Number.isFinite(distance) ? distance : null,
    yardLine: Number.isFinite(Number(situation.yardLine)) ? Number(situation.yardLine) : null,
    yardsToEndzone: ytgFromSituation(situation, possessionText),
    downDistance: situation.shortDownDistanceText ?? null,
    possessionText,
    possession,
    lastPlay: situation.lastPlay?.text ?? null,
  };
}

async function espnGetJson(url) {
  const res = await fetch(url, { headers: ESPN_HEADERS });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ESPN ${url} returned ${res.status}${body ? `: ${body.slice(0, 180)}` : ''}`);
  }
  return res.json();
}

async function fetchEspnGames(openDates) {
  const dates = uniqueScoreboardDates(openDates);
  const matches = [];
  const seen = new Set();
  let ok = false;
  let error = null;

  for (const date of dates) {
    let payload = null;
    for (const base of ESPN_SCOREBOARD_URLS) {
      try {
        payload = await espnGetJson(`${base}?dates=${date}&limit=300`);
        ok = true;
        break;
      } catch (err) {
        error = err;
      }
    }
    if (!payload) continue;
    for (const event of payload.events ?? []) {
      const parsed = parseEspnEvent(event);
      if (!parsed.id || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      matches.push(parsed);
    }
  }

  return { ok, error, matches };
}

function attachEspn(game, espnGames) {
  const hit = espnGames.find((row) => (
    namesMatch(game.teams?.home, row.home) && namesMatch(game.teams?.away, row.away)
  ));
  if (!hit) {
    return {
      ...game,
      debug: { ...(game.debug ?? {}), espnMatched: false },
    };
  }

  const score = hit.homeScore != null && hit.awayScore != null
    ? { home: hit.homeScore, away: hit.awayScore }
    : game.score;
  const possessionName = hit.possession === 'home'
    ? (game.teams?.home ?? hit.home)
    : hit.possession === 'away'
      ? (game.teams?.away ?? hit.away)
      : null;

  return {
    ...game,
    espnId: hit.id,
    inPlay: game.inPlay || hit.inPlay,
    score,
    scoreDisplay: scoreDisplay(score),
    debug: {
      ...(game.debug ?? {}),
      espnMatched: true,
      espnId: hit.id,
      espnState: hit.state,
      espnInPlay: hit.inPlay,
    },
    live: {
      period: hit.period,
      clock: hit.clock,
      clockSeconds: hit.clockSeconds ?? null,
      statusText: hit.statusText,
      down: hit.down ?? null,
      distance: hit.distance ?? null,
      yardLine: hit.yardLine ?? null,
      yardsToEndzone: hit.yardsToEndzone ?? null,
      downDistance: hit.downDistance,
      possessionText: hit.possessionText,
      possession: hit.possession,
      possessionName,
      lastPlay: hit.lastPlay,
      state: hit.state,
    },
  };
}

function buildGame(ev, bundle, fdx = null) {
  const event = bundle?.event;
  const markets = bundle?.markets ?? {};
  const teams = parseTeams(event?.name ?? ev.name);
  const inPlay = Boolean(event?.inPlay ?? ev.inPlay);
  const score = parseEventScore(event) ?? { home: 0, away: 0 };
  const sbapi = summarizeSbapiMarkets(markets);
  let nextDrive = pickDriveMarket(markets, { inPlay });
  if (nextDrive) nextDrive = { ...nextDrive, source: 'sbapi' };
  if (!nextDrive && fdx?.nextDrive) nextDrive = fdx.nextDrive;
  return {
    ...ev,
    inPlay,
    name: event?.name ?? ev.name,
    teams,
    score,
    scoreDisplay: scoreDisplay(score),
    lines: extractMainLines(markets),
    nextDrive,
    live: null,
    debug: {
      tabs: bundle?.tabs ?? null,
      ...sbapi,
      fdxStatus: fdx?.fdxStatus ?? null,
      fdxState: fdx?.fdxState ?? null,
      isQuickBetsAvailable: fdx?.isQuickBetsAvailable ?? null,
      isPbpAvailable: fdx?.isPbpAvailable ?? null,
      quickBetsHttp: fdx?.quickBetsHttp ?? null,
      quickBetsSnippet: fdx?.quickBetsSnippet ?? null,
      pbpHttp: fdx?.pbpHttp ?? null,
      fdxMarketCount: fdx?.fdxMarketCount ?? null,
      fdxDriveNames: fdx?.fdxDriveNames ?? [],
      fdxResultNames: fdx?.fdxResultNames ?? [],
      fdxError: fdx?.fdxError ?? null,
      nextDriveSource: nextDrive?.source || (nextDrive ? 'sbapi' : null),
    },
  };
}

async function fetchNcaafDriveBook() {
  const sportPage = await fdFetch(`/content-managed-page?${FD_QUERY}&page=SPORT&eventTypeId=6423`);
  const events = ncaafEvents(sportPage);
  const sportMarkets = sportPage?.attachments?.markets ?? {};

  const [fdGames, espn, dkEvents] = await Promise.all([
    mapPool(events, EVENT_POOL, async (ev) => {
      try {
        if (!shouldFetchEvent(ev)) {
          const markets = Object.fromEntries(
            Object.entries(sportMarkets).filter(([, m]) => Number(m.eventId) === ev.eventId),
          );
          return buildGame(ev, { event: { name: ev.name, inPlay: ev.inPlay, openDate: ev.openDate }, markets });
        }
        const kickedOff = Number.isFinite(Date.parse(ev.openDate))
          && Date.parse(ev.openDate) < Date.now() - 30_000;
        const inPlayHint = Boolean(ev.inPlay || kickedOff);
        const bundle = await fetchEventBundle(ev.eventId, { inPlayHint });
        const fdx = await fetchFdxDebug(ev.eventId, {
          inPlay: Boolean(bundle.event?.inPlay ?? inPlayHint),
          openDate: ev.openDate,
        });
        return buildGame(ev, bundle, fdx);
      } catch (err) {
        return { ...ev, teams: parseTeams(ev.name), error: err.message, nextDrive: null, driveMarkets: [], lines: null, live: null };
      }
    }),
    fetchEspnGames(events.map((ev) => ev.openDate)).catch((err) => ({
      ok: false,
      error: err,
      matches: [],
    })),
    fetchDkLeagueEvents().catch(() => []),
  ]);

  const needsDk = fdGames.filter((game) => !game.nextDrive && shouldFetchDkFirstDrive(game));
  const dkByFdId = new Map();
  if (dkEvents.length && needsDk.length) {
    await mapPool(needsDk, EVENT_POOL, async (game) => {
      const match = matchDkEvent(game, dkEvents);
      if (!match) {
        dkByFdId.set(game.eventId, { dkMatched: false });
        return;
      }
      try {
        const payload = await fetchDkFirstDrive(match.eventId);
        const picked = pickDkFirstDrive(payload.markets, payload.selections, game.teams);
        dkByFdId.set(game.eventId, {
          dkMatched: true,
          dkEventId: match.eventId,
          dkMarketNames: picked.names,
          nextDrive: picked.nextDrive,
          drives: picked.drives,
        });
      } catch (err) {
        dkByFdId.set(game.eventId, {
          dkMatched: true,
          dkEventId: match.eventId,
          dkError: compactProviderError(err.message || err),
        });
      }
    });
  }

  const games = fdGames
    .map((game) => {
      const dk = dkByFdId.get(game.eventId);
      let driveMarkets = [];
      if (game.nextDrive) driveMarkets = [game.nextDrive];
      else if (dk?.drives?.length) driveMarkets = dk.drives;
      else if (dk?.nextDrive) driveMarkets = [dk.nextDrive];
      const nextDrive = driveMarkets[0] ?? null;
      const withEspn = attachEspn({
        ...game,
        nextDrive,
        driveMarkets,
        debug: {
          ...(game.debug ?? {}),
          dkMatched: dk?.dkMatched ?? null,
          dkEventId: dk?.dkEventId ?? null,
          dkMarketNames: dk?.dkMarketNames ?? [],
          dkError: dk?.dkError ?? null,
          nextDriveSource: nextDrive?.source || (nextDrive ? 'sbapi' : null),
        },
      }, espn.matches ?? []);
      const annotated = (withEspn.driveMarkets ?? []).map((m) => (
        annotateDriveMarket(m, withEspn.teams, withEspn.live)
      ));
      return {
        ...withEspn,
        driveMarkets: annotated,
        nextDrive: annotated[0] ?? null,
      };
    })
    .sort((a, b) => {
      if (a.inPlay !== b.inPlay) return a.inPlay ? -1 : 1;
      if (!a.openDate) return 1;
      if (!b.openDate) return -1;
      return new Date(a.openDate) - new Date(b.openDate);
    });

  return {
    fetchedAt: new Date().toISOString(),
    games,
    stats: {
      games: games.length,
      live: games.filter((g) => g.inPlay).length,
      withDriveLine: games.filter((g) => g.nextDrive || g.driveMarkets?.length).length,
      withFdDriveLine: games.filter((g) => (
        (g.driveMarkets ?? []).some((m) => m.source !== 'dk')
        || (g.nextDrive && g.nextDrive.source !== 'dk')
      )).length,
      withDkFirstDrive: games.filter((g) => (
        (g.driveMarkets ?? []).some((m) => m.source === 'dk')
        || g.nextDrive?.source === 'dk'
      )).length,
      espnMatched: games.filter((g) => g.espnId).length,
      fdxProbed: games.filter((g) => g.debug?.fdxStatus != null || g.debug?.fdxError).length,
      fdxQuickBets: games.filter((g) => g.debug?.isQuickBetsAvailable).length,
      dkMatched: games.filter((g) => g.debug?.dkMatched).length,
    },
    espn: {
      ok: Boolean(espn.ok),
      error: espn.error ? compactProviderError(espn.error) : null,
      matched: games.filter((g) => g.espnId).length,
    },
  };
}

export { fetchNcaafDriveBook };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = await fetchNcaafDriveBook();
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ncaaf-drives]', err);
    return res.status(502).json({ error: err.message || 'NCAAF drives fetch failed' });
  }
}
