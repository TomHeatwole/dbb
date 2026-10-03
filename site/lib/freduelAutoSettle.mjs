/**
 * Server-side FredDuel auto-settlement from Sleeper scores.
 * Called lazily on GET /api/exchange (and by manual admin refresh).
 */

import { buildSettlementSnapshot } from '../src/fredduel/settlementSnapshot.js';
import { applyAutoSettlementsToDb } from '../src/fredduel/settlement.js';

const SEASON_START_DAY = '09/09';

function parseSiteSettings() {
  try {
    return JSON.parse(process.env.REACT_APP_SITE_SETTINGS || '{}');
  } catch {
    return {};
  }
}

function getLeagueId() {
  return parseSiteSettings().LEAGUE_ID || null;
}

function getCurrentSeasonYear() {
  const prev = parseSiteSettings().PREVIOUS_YEARS || {};
  const years = Object.keys(prev)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n) && n > 1900);
  if (!years.length) return String(new Date().getFullYear());
  return String(Math.max(...years) + 1);
}

function parseSeasonStart(year) {
  const [month, day] = String(SEASON_START_DAY).split('/').map(Number);
  return new Date(Number(year), month - 1, day);
}

/** Mirror DateHelper.getCompletedWeeksCount for the active season. */
function getCompletedWeeksCount(season) {
  const currentSeason = getCurrentSeasonYear();
  const targetYear = season ? Number(season) : Number(currentSeason);
  const now = new Date();
  const seasonStart = parseSeasonStart(targetYear);
  const isPreviousSeason = season && String(season) !== String(currentSeason);
  if (!isPreviousSeason && now < seasonStart) return 0;
  const daysSinceStart = Math.floor((now - seasonStart) / (1000 * 60 * 60 * 24));
  const WEEK_COMPLETE_OFFSET_DAYS = 6;
  const raw = Math.floor((daysSinceStart - WEEK_COMPLETE_OFFSET_DAYS) / 7) + 1;
  return Math.max(0, Math.min(17, raw));
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
    id: row.offer_id ?? row.id,
    creatorId: row.creator_user_id,
    creatorName: row.creator_name,
    marketKind: row.market_kind,
    market: parseMarket(row.market ?? row.offer_market),
    title: row.title ?? row.offer_title,
    description: row.description || '',
    line: Number(row.line),
    maxExposure: Number(row.max_exposure),
    remainingExposure: Number(row.remaining_exposure),
    maxExposurePerPerson: row.max_exposure_per_person == null
      ? null
      : Number(row.max_exposure_per_person),
    minTake: Number(row.min_take),
    status: row.status,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
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
    result: row.result || null,
    settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : null,
    settledBy: row.settled_by || null,
    settlementNote: row.settlement_note || '',
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function fetchWeekMatchups(leagueId, week) {
  try {
    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

export async function buildScoreSnapshotForSettlement() {
  const season = getCurrentSeasonYear();
  const leagueId = getLeagueId();
  const completedWeeks = getCompletedWeeksCount(season);
  if (!completedWeeks || !leagueId) return null;

  const weeksParsed = [];
  for (let week = 1; week <= 17; week += 1) {
    if (week <= completedWeeks) {
      weeksParsed.push(await fetchWeekMatchups(leagueId, week));
    } else {
      weeksParsed.push(null);
    }
  }

  return buildSettlementSnapshot(weeksParsed, {
    completedWeeks,
    season,
  });
}

/**
 * Grade live bets whose structured markets are ready. Returns change summaries.
 */
export async function applyAutoSettlementsInDb(sql) {
  const snapshot = await buildScoreSnapshotForSettlement();
  if (!snapshot) return { changes: [] };

  const rows = await sql`
    SELECT b.*, o.title AS offer_title, o.market_kind, o.market AS offer_market
    FROM fd_bets b
    JOIN fd_offers o ON o.id = b.offer_id
    WHERE b.status = 'live'
  `;
  if (!rows.length) return { changes: [] };

  const offersById = new Map();
  for (const row of rows) {
    if (!offersById.has(row.offer_id)) {
      offersById.set(row.offer_id, mapOffer({
        ...row,
        id: row.offer_id,
        market: row.offer_market,
        title: row.offer_title,
      }));
    }
  }

  const bets = rows.map(mapBet);
  const { bets: graded, changes } = applyAutoSettlementsToDb(
    [...offersById.values()],
    bets,
    snapshot,
  );
  if (!changes.length) return { changes: [] };

  const gradedById = new Map(graded.map((b) => [b.id, b]));
  const applied = [];

  for (const change of changes) {
    const bet = gradedById.get(change.betId);
    if (!bet || bet.status === 'live') continue;

    const [updated] = await sql`
      UPDATE fd_bets
      SET status = ${bet.status},
          result = ${bet.result},
          settled_at = ${bet.settledAt},
          settled_by = ${bet.settledBy},
          settlement_note = ${bet.settlementNote || ''}
      WHERE id = ${bet.id} AND status = 'live'
      RETURNING id
    `;
    if (updated) applied.push(change);
  }

  return { changes: applied };
}
