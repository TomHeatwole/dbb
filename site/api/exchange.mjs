// Exchange API — buy/sell order book backed by Neon Postgres.
//
// GET  /api/exchange                 → all open orders + recent fills
// GET  /api/exchange?asset=X         → order book for one asset
// GET  /api/exchange?username=Y      → one user's orders (any status)
// POST /api/exchange { action: 'place', username, side, asset, price, quantity }
// POST /api/exchange { action: 'cancel', username, orderId }
//
// Identity is honor-system for now (username string); orders are keyed by
// user_id so real auth can be added later without a schema change.

import { getSql } from '../lib/db.mjs';

const MAX_NAME_LEN = 64;
const MAX_ASSET_LEN = 128;

async function handleGet(req, res, sql) {
  const { asset, username } = req.query || {};

  if (username) {
    const orders = await sql`
      SELECT o.id, u.username, o.side, o.asset, o.price, o.quantity,
             o.quantity_filled, o.status, o.created_at
      FROM exchange_orders o JOIN exchange_users u ON u.id = o.user_id
      WHERE u.username = ${username}
      ORDER BY o.created_at DESC
      LIMIT 200
    `;
    return res.status(200).json({ orders });
  }

  const orders = asset
    ? await sql`
        SELECT o.id, u.username, o.side, o.asset, o.price, o.quantity,
               o.quantity_filled, o.status, o.created_at
        FROM exchange_orders o JOIN exchange_users u ON u.id = o.user_id
        WHERE o.status = 'open' AND o.asset = ${asset}
        ORDER BY o.side, CASE WHEN o.side = 'buy' THEN -o.price ELSE o.price END
      `
    : await sql`
        SELECT o.id, u.username, o.side, o.asset, o.price, o.quantity,
               o.quantity_filled, o.status, o.created_at
        FROM exchange_orders o JOIN exchange_users u ON u.id = o.user_id
        WHERE o.status = 'open'
        ORDER BY o.asset, o.side, o.created_at DESC
        LIMIT 500
      `;

  const fills = asset
    ? await sql`
        SELECT id, asset, price, quantity, created_at FROM exchange_fills
        WHERE asset = ${asset} ORDER BY created_at DESC LIMIT 50
      `
    : await sql`
        SELECT id, asset, price, quantity, created_at FROM exchange_fills
        ORDER BY created_at DESC LIMIT 50
      `;

  return res.status(200).json({ orders, fills });
}

async function handlePlace(req, res, sql) {
  const { username, side, asset, price, quantity } = req.body || {};

  const name = typeof username === 'string' ? username.trim() : '';
  const assetName = typeof asset === 'string' ? asset.trim() : '';
  const priceNum = Number(price);
  const qtyNum = Number(quantity);

  if (!name || name.length > MAX_NAME_LEN) {
    return res.status(400).json({ error: 'username is required (max 64 chars)' });
  }
  if (side !== 'buy' && side !== 'sell') {
    return res.status(400).json({ error: "side must be 'buy' or 'sell'" });
  }
  if (!assetName || assetName.length > MAX_ASSET_LEN) {
    return res.status(400).json({ error: 'asset is required (max 128 chars)' });
  }
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    return res.status(400).json({ error: 'price must be a positive number' });
  }
  if (!Number.isInteger(qtyNum) || qtyNum <= 0) {
    return res.status(400).json({ error: 'quantity must be a positive integer' });
  }

  const [user] = await sql`
    INSERT INTO exchange_users (username) VALUES (${name})
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
    RETURNING id, username
  `;

  const [order] = await sql`
    INSERT INTO exchange_orders (user_id, side, asset, price, quantity)
    VALUES (${user.id}, ${side}, ${assetName}, ${priceNum}, ${qtyNum})
    RETURNING id, side, asset, price, quantity, quantity_filled, status, created_at
  `;

  return res.status(200).json({ order: { ...order, username: user.username } });
}

async function handleCancel(req, res, sql) {
  const { username, orderId } = req.body || {};
  const idNum = Number(orderId);
  if (!Number.isInteger(idNum)) {
    return res.status(400).json({ error: 'orderId must be an integer' });
  }

  const [cancelled] = await sql`
    UPDATE exchange_orders o SET status = 'cancelled'
    FROM exchange_users u
    WHERE o.id = ${idNum} AND o.user_id = u.id
      AND u.username = ${String(username || '')}
      AND o.status = 'open'
    RETURNING o.id, o.side, o.asset, o.price, o.quantity, o.status
  `;

  if (!cancelled) {
    return res.status(404).json({ error: 'No open order with that id belonging to that user' });
  }
  return res.status(200).json({ order: cancelled });
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
      const action = req.body?.action;
      if (action === 'place') return await handlePlace(req, res, sql);
      if (action === 'cancel') return await handleCancel(req, res, sql);
      return res.status(400).json({ error: "action must be 'place' or 'cancel'" });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('Exchange API error:', e);
    return res.status(500).json({ error: 'Database error', details: e.message });
  }
}
