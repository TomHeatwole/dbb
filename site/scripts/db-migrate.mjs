// One-shot, idempotent schema migration for the Neon database.
// Run with: npm run db:migrate --prefix site
// Every statement uses IF NOT EXISTS so re-running is always safe.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';

const siteDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Load .env.local the same way server.js / chat-dev-server.js do
try {
  const envContent = fs.readFileSync(path.join(siteDir, '.env.local'), 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch (_) {}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not found in environment or site/.env.local');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const statements = [
  `CREATE TABLE IF NOT EXISTS exchange_users (
    id         SERIAL PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS exchange_orders (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES exchange_users(id),
    side            TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    asset           TEXT NOT NULL,
    price           NUMERIC(12,2) NOT NULL CHECK (price > 0),
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    quantity_filled INTEGER NOT NULL DEFAULT 0
                    CHECK (quantity_filled >= 0 AND quantity_filled <= quantity),
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'filled', 'cancelled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_exchange_orders_book
     ON exchange_orders (asset, status, side)`,

  `CREATE INDEX IF NOT EXISTS idx_exchange_orders_user
     ON exchange_orders (user_id, status)`,

  // Records each match between a buy and a sell order (for when matching is added)
  `CREATE TABLE IF NOT EXISTS exchange_fills (
    id            SERIAL PRIMARY KEY,
    buy_order_id  INTEGER NOT NULL REFERENCES exchange_orders(id),
    sell_order_id INTEGER NOT NULL REFERENCES exchange_orders(id),
    asset         TEXT NOT NULL,
    price         NUMERIC(12,2) NOT NULL,
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_exchange_fills_asset
     ON exchange_fills (asset, created_at DESC)`,
];

for (const stmt of statements) {
  const summary = stmt.replace(/\s+/g, ' ').slice(0, 72);
  await sql.query(stmt);
  console.log(`ok: ${summary}...`);
}

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name
`;
console.log('\nTables now in database:', tables.map((t) => t.table_name).join(', '));
