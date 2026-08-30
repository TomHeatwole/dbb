/**
 * Kalshi Premier League total-corners ladder (KXEPLCORNERS).
 * Markets are N+ yes/no contracts on match totals — no 1H / next-5/10 series.
 */

import {
  fetchAllKalshiEvents,
  fetchKalshiOrderbook,
  fetchMarketsForEvent,
  kalshiAskToAmerican,
  parseKalshiFixture,
  pickKalshiEvent,
} from '../api/kalshi-sop.mjs';

const CORNERS_SERIES = 'KXEPLCORNERS';

function plusNFromMarket(market) {
  const fields = [
    market?.yes_sub_title,
    market?.no_sub_title,
    market?.subtitle,
    market?.title,
    market?.custom_strike,
  ];
  for (const field of fields) {
    const m = String(field ?? '').match(/(\d+)\s*\+/);
    if (m) return Number(m[1]);
  }
  const strike = Number(market?.floor_strike ?? market?.floor_strike_value);
  if (Number.isFinite(strike) && strike > 0) return Math.round(strike);
  const ticker = String(market?.ticker ?? '').match(/-(\d+)$/);
  return ticker ? Number(ticker[1]) : null;
}

function displayNameFromTitle(title) {
  const m = String(title ?? '').match(/^(.+?)\s+vs\s+(.+?)(?::|$)/i);
  if (!m) return String(title ?? '').replace(/:.*$/, '').trim();
  return `${m[1].trim()} v ${m[2].trim()}`;
}

function numFp(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundPrice(value) {
  return Math.round(value * 10000) / 10000;
}

function parseBookLevels(fpLevels, intLevels) {
  if (Array.isArray(fpLevels) && fpLevels.length) {
    return fpLevels
      .map(([price, count]) => ({ price: numFp(price), contracts: numFp(count) }))
      .filter((row) => row.price > 0 && row.contracts > 0);
  }
  if (Array.isArray(intLevels) && intLevels.length) {
    return intLevels
      .map(([cents, count]) => ({ price: numFp(cents) / 100, contracts: numFp(count) }))
      .filter((row) => row.price > 0 && row.contracts > 0);
  }
  return [];
}

/** Opposite-side bids become the take ladder (best ask first). */
function asksFromOppositeBids(bids) {
  return bids
    .map((row) => ({ price: roundPrice(1 - row.price), contracts: row.contracts }))
    .filter((row) => row.price > 0 && row.price < 1)
    .sort((a, b) => a.price - b.price);
}

function topDollars(price, contracts) {
  if (!Number.isFinite(price) || !Number.isFinite(contracts) || price <= 0 || contracts <= 0) {
    return null;
  }
  return Math.round(price * contracts * 100) / 100;
}

function attachOrderbook(plusRow, book) {
  if (!plusRow || !book) return plusRow;
  const fp = book.orderbook_fp ?? book;
  const raw = book.orderbook ?? {};
  const noBids = parseBookLevels(fp.no_dollars, raw.no);
  const yesBids = parseBookLevels(fp.yes_dollars, raw.yes);
  const yesTake = asksFromOppositeBids(noBids);
  const noTake = asksFromOppositeBids(yesBids);
  return {
    ...plusRow,
    yesTake: yesTake.length ? yesTake : plusRow.yesTake,
    noTake: noTake.length ? noTake : plusRow.noTake,
  };
}

function extractPlusLadder(markets) {
  const plus = [];
  for (const market of markets ?? []) {
    if (String(market.status ?? '').toLowerCase() === 'closed') continue;
    const n = plusNFromMarket(market);
    if (!Number.isFinite(n) || n < 1) continue;
    const yesAsk = numFp(market.yes_ask_dollars);
    const noAsk = numFp(market.no_ask_dollars);
    const american = kalshiAskToAmerican(market.yes_ask_dollars);
    if (american == null) continue;
    const yesAskSize = numFp(market.yes_ask_size_fp);
    const yesBidSize = numFp(market.yes_bid_size_fp);
    const yesAskDollars = topDollars(yesAsk, yesAskSize);
    const noAskDollars = topDollars(noAsk, yesBidSize);
    plus.push({
      n,
      american,
      noAmerican: kalshiAskToAmerican(market.no_ask_dollars),
      ticker: market.ticker ?? null,
      title: market.title ?? `${n}+`,
      yesAsk,
      noAsk,
      yesAskSize,
      noAskSize: yesBidSize,
      yesAskDollars,
      noAskDollars,
      volume: numFp(market.volume_fp),
      openInterest: numFp(market.open_interest_fp),
      liquidityDollars: numFp(market.liquidity_dollars),
      yesTake: yesAsk != null && yesAskSize > 0
        ? [{ price: yesAsk, contracts: yesAskSize }]
        : [],
      noTake: noAsk != null && yesBidSize > 0
        ? [{ price: noAsk, contracts: yesBidSize }]
        : [],
    });
  }
  plus.sort((a, b) => a.n - b.n);
  const seen = new Set();
  return plus.filter((row) => {
    if (seen.has(row.n)) return false;
    seen.add(row.n);
    return true;
  });
}

async function attachOrderbooks(plus) {
  return mapPool(plus, 1, async (row) => {
    if (!row.ticker) return row;
    try {
      const book = await fetchKalshiOrderbook(row.ticker, 40);
      return attachOrderbook(row, book);
    } catch {
      return row;
    }
  });
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export async function fetchKalshiCornerOdds() {
  const events = await fetchAllKalshiEvents(CORNERS_SERIES);
  const byFixture = new Map();
  for (const event of events ?? []) {
    const key = parseKalshiFixture(event.title || event.sub_title);
    if (!key) continue;
    const list = byFixture.get(key) ?? [];
    list.push(event);
    byFixture.set(key, list);
  }

  const fixtures = [...byFixture.entries()];
  const games = await mapPool(fixtures, 3, async ([, list]) => {
    const event = pickKalshiEvent(list, null);
    if (!event?.event_ticker) return null;
    const markets = await fetchMarketsForEvent(event.event_ticker);
    const plus = await attachOrderbooks(extractPlusLadder(markets));
    if (!plus.length) return null;
    return {
      name: displayNameFromTitle(event.title || event.sub_title),
      eventTicker: event.event_ticker,
      plus,
    };
  });

  const sorted = games.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  return {
    fetchedAt: new Date().toISOString(),
    stats: {
      events: events?.length ?? 0,
      fixtures: sorted.length,
      withOdds: sorted.length,
    },
    games: sorted,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = await fetchKalshiCornerOdds();
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[kalshi-corners]', err);
    return res.status(502).json({ error: err.message || 'Kalshi corners fetch failed' });
  }
}
