// FredDuel exchange API — offers + live bets backed by Neon Postgres.
//
// GET  /api/exchange
//        → { offers, bets } (latest 300 each; stale open offers are expired
//          lazily on read)
// POST /api/exchange { action: 'create', marketKind, market, title,
//                      description, line, maxExposure, minTake, expiresAt }
// POST /api/exchange { action: 'take', offerId, stake }
// POST /api/exchange { action: 'cancel', offerId }
//
// POSTs require a signed-in, onboarded user (Authorization: Bearer <jwt>,
// same as /api/me). Money is dollars (NUMERIC 12,2).
//
// Odds semantics: an offer's `line` is quoted from the TAKER's perspective;
// the creator is laying the bet. The creator's loss on a take (creator_risk)
// equals the taker's potential win, and the sum of creator_risk across takes
// can never exceed the offer's max_exposure.

import { getSql } from '../lib/db.mjs';
import { getSessionUser, getAppProfile } from '../lib/authServer.mjs';

// --- odds math (mirror of site/src/fredduel/oddsMath.js) ---

const roundCents = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const floorCents = (x) => Math.floor((Number(x) + 1e-9) * 100) / 100;
const isValidLine = (line) => Number.isInteger(line) && (line >= 100 || line <= -100);
const takerWinAmount = (stake, line) =>
  line > 0 ? roundCents(stake * (line / 100)) : roundCents(stake * (100 / -line));
const maxStakeForExposure = (exposure, line) => {
  if (exposure <= 0) return 0;
  return line > 0 ? floorCents(exposure * (100 / line)) : floorCents(exposure * (-line / 100));
};

// --- row mapping ---

function mapOffer(row) {
  return {
    id: row.id,
    creatorId: row.creator_user_id,
    creatorName: row.creator_name,
    marketKind: row.market_kind,
    market: row.market || null,
    title: row.title,
    description: row.description || '',
    line: Number(row.line),
    maxExposure: Number(row.max_exposure),
    remainingExposure: Number(row.remaining_exposure),
    minTake: Number(row.min_take),
    status: row.status,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapBet(row) {
  return {
    id: row.id,
    offerId: row.offer_id,
    offerTitle: row.offer_title,
    creatorId: row.creator_user_id,
    creatorName: row.creator_name,
    takerId: row.taker_user_id,
    takerName: row.taker_name,
    line: Number(row.line),
    takerStake: Number(row.taker_stake),
    creatorRisk: Number(row.creator_risk),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function requireBettor(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Sign in to use the exchange.' });
    return null;
  }
  const profile = await getAppProfile(user.userId);
  if (!profile) {
    res.status(403).json({ error: 'Finish account setup before betting.' });
    return null;
  }
  return {
    id: user.userId,
    name: profile.sleeper_display_name || profile.sleeper_username,
  };
}

async function expireStaleOffers(sql) {
  await sql`
    UPDATE fd_offers SET status = 'expired'
    WHERE status = 'open' AND expires_at <= now()
  `;
}

// --- handlers ---

async function handleGet(req, res, sql) {
  await expireStaleOffers(sql);

  const offers = await sql`
    SELECT * FROM fd_offers ORDER BY created_at DESC LIMIT 300
  `;
  const bets = await sql`
    SELECT b.*, o.title AS offer_title
    FROM fd_bets b JOIN fd_offers o ON o.id = b.offer_id
    ORDER BY b.created_at DESC LIMIT 300
  `;

  return res.status(200).json({
    offers: offers.map(mapOffer),
    bets: bets.map(mapBet),
  });
}

async function handleCreate(req, res, sql, bettor) {
  const { marketKind, market, title, description, line, maxExposure, minTake, expiresAt } =
    req.body || {};

  const titleStr = String(title || '').trim();
  const descStr = String(description || '').trim();
  const lineNum = Number(line);
  const exposure = roundCents(maxExposure);
  const minTakeNum = roundCents(minTake ?? 1);
  const expiresMs = new Date(expiresAt).getTime();

  if (!['season', 'weekly', 'custom'].includes(marketKind)) {
    return res.status(400).json({ error: 'marketKind must be season, weekly, or custom' });
  }
  if (!titleStr || titleStr.length > 200) {
    return res.status(400).json({ error: 'title is required (max 200 chars)' });
  }
  if (descStr.length > 2000) {
    return res.status(400).json({ error: 'description is too long (max 2000 chars)' });
  }
  if (!isValidLine(lineNum)) {
    return res.status(400).json({ error: 'line must be an integer >= +100 or <= -100' });
  }
  if (!Number.isFinite(exposure) || exposure < 1 || exposure > 100000) {
    return res.status(400).json({ error: 'maxExposure must be between $1 and $100,000' });
  }
  if (!Number.isFinite(minTakeNum) || minTakeNum < 1) {
    return res.status(400).json({ error: 'minTake must be at least $1' });
  }
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    return res.status(400).json({ error: 'expiresAt must be in the future' });
  }
  if (expiresMs > Date.now() + 366 * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ error: 'expiresAt must be within a year' });
  }
  const marketJson = market == null ? null : JSON.stringify(market);
  if (marketJson && marketJson.length > 4000) {
    return res.status(400).json({ error: 'market spec is too large' });
  }

  const [row] = await sql`
    INSERT INTO fd_offers (
      creator_user_id, creator_name, market_kind, market, title, description,
      line, max_exposure, remaining_exposure, min_take, expires_at
    ) VALUES (
      ${bettor.id}, ${bettor.name}, ${marketKind}, ${marketJson}, ${titleStr},
      ${descStr}, ${lineNum}, ${exposure}, ${exposure}, ${minTakeNum},
      ${new Date(expiresMs).toISOString()}
    )
    RETURNING *
  `;
  return res.status(200).json({ offer: mapOffer(row) });
}

async function handleTake(req, res, sql, bettor) {
  const { offerId, stake } = req.body || {};
  const idNum = Number(offerId);
  const stakeNum = roundCents(stake);
  if (!Number.isInteger(idNum)) {
    return res.status(400).json({ error: 'offerId must be an integer' });
  }
  if (!Number.isFinite(stakeNum) || stakeNum <= 0) {
    return res.status(400).json({ error: 'stake must be a positive amount' });
  }

  await expireStaleOffers(sql);

  const [offerRow] = await sql`SELECT * FROM fd_offers WHERE id = ${idNum}`;
  if (!offerRow) return res.status(404).json({ error: 'Offer not found' });
  const offer = mapOffer(offerRow);

  if (offer.status !== 'open') {
    return res.status(409).json({ error: `Offer is ${offer.status}` });
  }
  if (offer.creatorId === bettor.id) {
    return res.status(400).json({ error: "You can't take your own offer" });
  }

  const minStake = Math.max(1, offer.minTake);
  const maxStake = maxStakeForExposure(offer.remainingExposure, offer.line);
  if (stakeNum < minStake) {
    return res.status(400).json({ error: `Minimum stake for this offer is $${minStake}` });
  }
  if (stakeNum > maxStake) {
    return res.status(400).json({ error: `Maximum stake left on this offer is $${maxStake}` });
  }

  const creatorRisk = takerWinAmount(stakeNum, offer.line);

  // Guarded decrement: the WHERE clause re-checks state so concurrent takes
  // can't push exposure below zero.
  const [updated] = await sql`
    UPDATE fd_offers
    SET remaining_exposure = remaining_exposure - ${creatorRisk}
    WHERE id = ${idNum} AND status = 'open' AND expires_at > now()
      AND remaining_exposure >= ${creatorRisk}
    RETURNING *
  `;
  if (!updated) {
    return res.status(409).json({ error: 'Offer changed while you were taking it — refresh and retry' });
  }

  const [betRow] = await sql`
    INSERT INTO fd_bets (
      offer_id, creator_user_id, creator_name, taker_user_id, taker_name,
      line, taker_stake, creator_risk
    ) VALUES (
      ${idNum}, ${offer.creatorId}, ${offer.creatorName}, ${bettor.id},
      ${bettor.name}, ${offer.line}, ${stakeNum}, ${creatorRisk}
    )
    RETURNING *
  `;

  // Leftover exposure too small to cover the offer's minimum take → filled.
  let finalOffer = mapOffer(updated);
  const leftoverMaxStake = maxStakeForExposure(finalOffer.remainingExposure, finalOffer.line);
  if (leftoverMaxStake < Math.max(1, finalOffer.minTake)) {
    const [closed] = await sql`
      UPDATE fd_offers SET status = 'filled'
      WHERE id = ${idNum} AND status = 'open'
      RETURNING *
    `;
    if (closed) finalOffer = mapOffer(closed);
  }

  return res.status(200).json({
    bet: mapBet({ ...betRow, offer_title: offer.title }),
    offer: finalOffer,
  });
}

async function handleCancel(req, res, sql, bettor) {
  const idNum = Number(req.body?.offerId);
  if (!Number.isInteger(idNum)) {
    return res.status(400).json({ error: 'offerId must be an integer' });
  }

  const [cancelled] = await sql`
    UPDATE fd_offers SET status = 'cancelled'
    WHERE id = ${idNum} AND creator_user_id = ${bettor.id} AND status = 'open'
    RETURNING *
  `;
  if (!cancelled) {
    return res.status(404).json({ error: 'No open offer of yours with that id' });
  }
  return res.status(200).json({ offer: mapOffer(cancelled) });
}

export default async function handler(req, res) {
  let sql;
  try {
    sql = getSql();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    if (req.method === 'GET') {
      return await handleGet(req, res, sql);
    }
    if (req.method === 'POST') {
      const bettor = await requireBettor(req, res);
      if (!bettor) return undefined;
      const action = req.body?.action;
      if (action === 'create') return await handleCreate(req, res, sql, bettor);
      if (action === 'take') return await handleTake(req, res, sql, bettor);
      if (action === 'cancel') return await handleCancel(req, res, sql, bettor);
      return res.status(400).json({ error: "action must be 'create', 'take', or 'cancel'" });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('Exchange API error:', e);
    return res.status(500).json({ error: 'Database error', details: e.message });
  }
}
