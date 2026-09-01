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
  // FredDuel exchange: offers are sportsbook-style lays. The creator quotes an
  // American line (from the taker's perspective) and caps their own loss with
  // max_exposure. Takes decrement remaining_exposure; the offer row survives
  // partial fills so linked bets show as "action" on it.
  `CREATE TABLE IF NOT EXISTS fd_offers (
    id                 SERIAL PRIMARY KEY,
    creator_user_id    UUID NOT NULL,
    creator_name       TEXT NOT NULL,
    market_kind        TEXT NOT NULL CHECK (market_kind IN ('season', 'weekly', 'custom')),
    market             JSONB,
    title              TEXT NOT NULL,
    description        TEXT NOT NULL DEFAULT '',
    line               INTEGER NOT NULL CHECK (line >= 100 OR line <= -100),
    max_exposure       NUMERIC(12,2) NOT NULL CHECK (max_exposure > 0),
    remaining_exposure NUMERIC(12,2) NOT NULL CHECK (remaining_exposure >= 0),
    max_exposure_per_person NUMERIC(12,2)
                       CHECK (max_exposure_per_person IS NULL OR max_exposure_per_person >= 1),
    min_take           NUMERIC(12,2) NOT NULL DEFAULT 1 CHECK (min_take >= 1),
    status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'filled', 'cancelled', 'expired')),
    expires_at         TIMESTAMPTZ NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_fd_offers_status
     ON fd_offers (status, expires_at)`,

  `CREATE INDEX IF NOT EXISTS idx_fd_offers_creator
     ON fd_offers (creator_user_id, created_at DESC)`,

  // A live bet = an accepted slice of an offer. creator_risk is what the
  // offerer loses (and the taker wins) if the bet hits; taker_stake is the
  // reverse. Names are denormalized so tickets render without joins.
  `CREATE TABLE IF NOT EXISTS fd_bets (
    id              SERIAL PRIMARY KEY,
    offer_id        INTEGER NOT NULL REFERENCES fd_offers(id),
    creator_user_id UUID NOT NULL,
    creator_name    TEXT NOT NULL,
    taker_user_id   UUID NOT NULL,
    taker_name      TEXT NOT NULL,
    line            INTEGER NOT NULL,
    taker_stake     NUMERIC(12,2) NOT NULL CHECK (taker_stake > 0),
    creator_risk    NUMERIC(12,2) NOT NULL CHECK (creator_risk > 0),
    status          TEXT NOT NULL DEFAULT 'live'
                    CHECK (status IN ('live', 'settled', 'void')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_fd_bets_offer
     ON fd_bets (offer_id)`,

  `CREATE INDEX IF NOT EXISTS idx_fd_bets_taker
     ON fd_bets (taker_user_id, created_at DESC)`,

  // Existing DBs created before per-person caps: add the column + lookup index.
  `ALTER TABLE fd_offers
     ADD COLUMN IF NOT EXISTS max_exposure_per_person NUMERIC(12,2)
     CHECK (max_exposure_per_person IS NULL OR max_exposure_per_person >= 1)`,

  `CREATE INDEX IF NOT EXISTS idx_fd_bets_offer_taker
     ON fd_bets (offer_id, taker_user_id)`,

  // App-level profile for authenticated users (auth accounts live in
  // neon_auth.user, managed by Neon). A row here means the user completed
  // onboarding with a Sleeper username verified against the Sleeper API.
  // No FK into neon_auth: that schema is managed by Neon's auth service.
  `CREATE TABLE IF NOT EXISTS app_users (
    auth_user_id         UUID PRIMARY KEY,
    sleeper_username     TEXT NOT NULL,
    sleeper_user_id      TEXT NOT NULL UNIQUE,
    sleeper_display_name TEXT,
    sleeper_avatar       TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_sleeper_username
     ON app_users (lower(sleeper_username))`,
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
