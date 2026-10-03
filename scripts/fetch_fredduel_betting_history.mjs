#!/usr/bin/env node
/**
 * fetch_fredduel_betting_history.mjs
 *
 * Downloads the full FredDuel exchange (offers + bets) from Neon and keeps
 * change-only JSON snapshots under site/public/data/fredduel/betting_history/.
 *
 * Usage:
 *   node scripts/fetch_fredduel_betting_history.mjs
 *
 * Env: DATABASE_URL (loaded from site/.env.local when unset)
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getSql } from '../site/lib/db.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'site/public/data/fredduel/betting_history');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const LATEST_PATH = path.join(OUT_DIR, 'latest.json');

function loadSiteEnv() {
  const envPath = path.join(ROOT, 'site', '.env.local');
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      const val = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // optional locally; production callers should export DATABASE_URL
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function parseMarket(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mapOffer(row) {
  return {
    id: row.id,
    creatorId: row.creator_user_id,
    creatorName: row.creator_name,
    marketKind: row.market_kind,
    market: parseMarket(row.market),
    title: row.title,
    description: row.description || '',
    line: Number(row.line),
    maxExposure: Number(row.max_exposure),
    remainingExposure: Number(row.remaining_exposure),
    maxExposurePerPerson: row.max_exposure_per_person == null
      ? null
      : Number(row.max_exposure_per_person),
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
    offerTitle: row.offer_title ?? null,
    creatorId: row.creator_user_id,
    creatorName: row.creator_name,
    takerId: row.taker_user_id,
    takerName: row.taker_name,
    line: Number(row.line),
    takerStake: Number(row.taker_stake),
    creatorRisk: Number(row.creator_risk),
    status: row.status,
    result: row.result || null,
    settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : null,
    settledBy: row.settled_by || null,
    settlementNote: row.settlement_note || '',
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function canonicalBettingHistory({ offers, bets }) {
  return {
    offers: [...offers].sort((a, b) => a.id - b.id),
    bets: [...bets].sort((a, b) => a.id - b.id),
  };
}

export function bettingHistoryHash(payload) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalBettingHistory(payload)))
    .digest('hex');
}

function snapshotFileName(capturedAt) {
  return `${capturedAt.replace(/[:.]/g, '')}.json`;
}

async function fetchExchangeRows(sql) {
  await sql`
    UPDATE fd_offers SET status = 'expired'
    WHERE status = 'open' AND expires_at <= now()
  `;

  const offers = await sql`
    SELECT * FROM fd_offers ORDER BY id ASC
  `;
  const bets = await sql`
    SELECT b.*, o.title AS offer_title
    FROM fd_bets b
    JOIN fd_offers o ON o.id = b.offer_id
    ORDER BY b.id ASC
  `;

  return {
    offers: offers.map(mapOffer),
    bets: bets.map(mapBet),
  };
}

function loadLatestHash() {
  const manifest = readJson(MANIFEST_PATH, null);
  if (manifest?.latestHash) return manifest.latestHash;
  const latest = readJson(LATEST_PATH, null);
  if (latest?.contentHash) return latest.contentHash;
  return null;
}

function appendSnapshot({ capturedAt, contentHash, offerCount, betCount, fileName, payload }) {
  const manifest = readJson(MANIFEST_PATH, { snapshots: [] });
  const snapshots = Array.isArray(manifest.snapshots) ? manifest.snapshots : [];
  snapshots.push({
    capturedAt,
    file: fileName,
    offerCount,
    betCount,
    contentHash,
  });

  writeJson(path.join(OUT_DIR, fileName), payload);
  writeJson(LATEST_PATH, payload);
  writeJson(MANIFEST_PATH, {
    updatedAt: capturedAt,
    latestFile: fileName,
    latestHash: contentHash,
    snapshots,
  });
}

async function main() {
  loadSiteEnv();

  const sql = getSql();
  const fetched = await fetchExchangeRows(sql);
  const contentHash = bettingHistoryHash(fetched);
  const previousHash = loadLatestHash();

  if (previousHash === contentHash) {
    console.log(
      `[fredduel] No changes (${fetched.offers.length} offers, ${fetched.bets.length} bets; hash ${contentHash.slice(0, 12)}…)`,
    );
    return;
  }

  const capturedAt = new Date().toISOString();
  const fileName = snapshotFileName(capturedAt);
  const payload = {
    capturedAt,
    contentHash,
    ...canonicalBettingHistory(fetched),
  };

  appendSnapshot({
    capturedAt,
    contentHash,
    offerCount: fetched.offers.length,
    betCount: fetched.bets.length,
    fileName,
    payload,
  });

  console.log(
    `[fredduel] Saved snapshot ${fileName} `
    + `(${fetched.offers.length} offers, ${fetched.bets.length} bets; hash ${contentHash.slice(0, 12)}…)`,
  );
}

main().catch((err) => {
  console.error('[fredduel] fetch failed:', err.message || err);
  process.exit(1);
});
