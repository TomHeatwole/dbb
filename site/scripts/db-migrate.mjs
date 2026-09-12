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

  // Settlement columns. The resolver lives in src/fredduel/settlement.js;
  // nothing writes these yet except a future auto/manual settle action.
  `ALTER TABLE fd_bets
     ADD COLUMN IF NOT EXISTS result TEXT
       CHECK (result IS NULL OR result IN ('taker', 'creator'))`,
  `ALTER TABLE fd_bets
     ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ`,
  `ALTER TABLE fd_bets
     ADD COLUMN IF NOT EXISTS settled_by TEXT
       CHECK (settled_by IS NULL OR settled_by IN ('auto', 'manual'))`,
  `ALTER TABLE fd_bets
     ADD COLUMN IF NOT EXISTS settlement_note TEXT NOT NULL DEFAULT ''`,
  `CREATE INDEX IF NOT EXISTS idx_fd_bets_status
     ON fd_bets (status, settled_at DESC)`,

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

  // NCAAF /drives: FanDuel drive-result odds. The live FD APIs do not expose
  // these reliably, so a scraper upserts rows here and the book trusts them.
  // One row per game + offense side + drive number (1 = opening drive).
  // Writer contract: UPSERT on (home_team, away_team, offense_side, drive_n)
  // with American integers for the four-way (OTD / FGA / Punt / Other).
  `CREATE TABLE IF NOT EXISTS fd_drive_odds (
    id              SERIAL PRIMARY KEY,
    event_id        TEXT,
    home_team       TEXT NOT NULL,
    away_team       TEXT NOT NULL,
    kickoff_at      TIMESTAMPTZ,
    offense_side    TEXT NOT NULL CHECK (offense_side IN ('home', 'away')),
    offense_name    TEXT,
    drive_n         INTEGER NOT NULL DEFAULT 1 CHECK (drive_n >= 1),
    market_name     TEXT,
    market_status   TEXT NOT NULL DEFAULT 'OPEN',
    td_american     INTEGER,
    fg_american     INTEGER,
    punt_american   INTEGER,
    other_american  INTEGER,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
      td_american IS NOT NULL
      OR fg_american IS NOT NULL
      OR punt_american IS NOT NULL
      OR other_american IS NOT NULL
    ),
    UNIQUE (home_team, away_team, offense_side, drive_n)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_fd_drive_odds_event
     ON fd_drive_odds (event_id)`,

  `CREATE INDEX IF NOT EXISTS idx_fd_drive_odds_kickoff
     ON fd_drive_odds (kickoff_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_fd_drive_odds_fetched
     ON fd_drive_odds (fetched_at DESC)`,

  // Live FanDuel clock / down-and-distance, duplicated onto each odds row
  // for the game. Writer replaces the snapshot as a unit when any of
  // period, clock_seconds, or down is present.
  `ALTER TABLE fd_drive_odds ADD COLUMN IF NOT EXISTS period INTEGER`,
  `ALTER TABLE fd_drive_odds ADD COLUMN IF NOT EXISTS clock_seconds INTEGER`,
  `ALTER TABLE fd_drive_odds ADD COLUMN IF NOT EXISTS clock_text TEXT`,
  `ALTER TABLE fd_drive_odds ADD COLUMN IF NOT EXISTS down INTEGER`,
  `ALTER TABLE fd_drive_odds ADD COLUMN IF NOT EXISTS distance INTEGER`,
  `ALTER TABLE fd_drive_odds ADD COLUMN IF NOT EXISTS yards_to_endzone INTEGER`,
  `ALTER TABLE fd_drive_odds ADD COLUMN IF NOT EXISTS possession_text TEXT`,
  `ALTER TABLE fd_drive_odds ADD COLUMN IF NOT EXISTS home_score INTEGER`,
  `ALTER TABLE fd_drive_odds ADD COLUMN IF NOT EXISTS away_score INTEGER`,
  `ALTER TABLE fd_drive_odds ADD COLUMN IF NOT EXISTS situation_text TEXT`,
  `ALTER TABLE fd_drive_odds ADD COLUMN IF NOT EXISTS possession_side TEXT`,

  // SOP live goals: ESPN play classified once by Gemini, then cached.
  // Rows are deleted when the match is no longer live.
  `CREATE TABLE IF NOT EXISTS espn_sop_goals (
    espn_play_id   TEXT PRIMARY KEY,
    espn_game_id   TEXT NOT NULL,
    clock_text     TEXT,
    scorer         TEXT,
    team_name      TEXT,
    description    TEXT NOT NULL,
    goal_type      TEXT NOT NULL CHECK (goal_type IN ('sop', 'header', 'pk', 'fk', 'og')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_espn_sop_goals_game
     ON espn_sop_goals (espn_game_id)`,
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
