// Data layer for the FredDuel exchange.
//
// Two interchangeable clients behind one interface:
//   - createTestClient(getActor): localStorage-backed "test data DB", seeded
//     with sample offers/bets. Lets you act as any of the 10 teams.
//   - createRemoteClient(getToken): real backend at /api/exchange (Neon).
//
// Interface (all async):
//   listAll()            -> { offers, bets }
//   createOffer(input)   -> offer     input: { marketKind, market, title,
//                                     description, line, maxExposure,
//                                     maxExposurePerPerson (null = off),
//                                     minTake, expiresAt }
//   takeOffer(offerId, stake) -> { bet, offer }
//   updateOfferExposure(offerId, newRemaining) -> offer
//   cancelOffer(offerId) -> offer
//   resetTestData()      -> void (test client only)

import {
  isValidLine, roundCents, takerWinAmount, validateTake, isEffectivelyFilled,
  maxStakeForExposure, exposureUsedByTaker,
} from './oddsMath';
import { buildTestSeed } from './testSeed';

export const TEST_MODE_KEY = 'fredduel_test_mode';
export const TEST_ACTOR_KEY = 'fredduel_test_actor';
const TEST_DB_KEY = 'fredduel_test_db_v5';

export function isTestMode() {
  try {
    return localStorage.getItem(TEST_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setTestMode(on) {
  try {
    if (on) localStorage.setItem(TEST_MODE_KEY, '1');
    else localStorage.removeItem(TEST_MODE_KEY);
  } catch {}
}

// ---------------------------------------------------------------------------
// Shared validation (used by the test client; the API re-validates server-side)
// ---------------------------------------------------------------------------

/**
 * Optional per-account ceiling. Off / omitted → null. Invalid number →
 * undefined so callers can distinguish "not set" from "bad input".
 */
export function normalizePerPersonCap(value) {
  if (value == null || value === '' || value === false) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return roundCents(n);
}

export function validateOfferInput(input) {
  const title = String(input.title || '').trim();
  if (!title) return 'Offer needs a title.';
  if (title.length > 200) return 'Title is too long (max 200 chars).';
  if (String(input.description || '').length > 2000) return 'Description is too long (max 2000 chars).';
  if (!isValidLine(Number(input.line))) return 'Line must be a whole number ≥ +100 or ≤ -100.';
  const exposure = Number(input.maxExposure);
  if (!Number.isFinite(exposure) || exposure < 1) return 'Max exposure must be at least $1.';
  if (exposure > 100000) return 'Max exposure is capped at $100,000.';
  const minTake = Number(input.minTake ?? 1);
  if (!Number.isFinite(minTake) || minTake < 1) return 'Minimum take must be at least $1.';
  // An offer nobody can take is invalid: the largest stake the exposure can
  // cover at this line must be at least the minimum take.
  const maxStake = maxStakeForExposure(exposure, Number(input.line));
  if (minTake > maxStake) {
    return `Min take is too high: at ${Number(input.line) > 0 ? '+' : ''}${Number(input.line)} `
      + `a $${exposure} exposure covers at most a $${maxStake} take.`;
  }
  const perPerson = normalizePerPersonCap(input.maxExposurePerPerson);
  if (perPerson === undefined) {
    return 'Max exposure per person must be at least $1.';
  }
  if (perPerson != null) {
    if (perPerson > 100000) return 'Max exposure per person is capped at $100,000.';
    if (perPerson > exposure) {
      return 'Max exposure per person cannot exceed your total max exposure.';
    }
    const perPersonStake = maxStakeForExposure(perPerson, Number(input.line));
    if (minTake > perPersonStake) {
      return `Per-person cap is too low: at this line it covers at most a $${perPersonStake} take.`;
    }
  }
  const expires = new Date(input.expiresAt).getTime();
  if (!Number.isFinite(expires)) return 'Pick an expiry time.';
  if (expires <= Date.now()) return 'Expiry must be in the future.';
  if (expires > Date.now() + 366 * 24 * 60 * 60 * 1000) return 'Expiry must be within a year.';
  return null;
}

/**
 * Validate changing an open offer's unfilled exposure to `newRemaining`.
 * Matched action is untouched; the ceiling becomes matched + newRemaining.
 */
export function validateExposureUpdate(offer, newRemaining) {
  const val = Number(newRemaining);
  if (!Number.isFinite(val) || val < 1) return 'Unfilled exposure must be at least $1.';
  const matched = roundCents(Number(offer.maxExposure) - Number(offer.remainingExposure));
  if (matched + val > 100000) return 'Total exposure is capped at $100,000.';
  if (Number(offer.minTake) > maxStakeForExposure(val, Number(offer.line))) {
    const needed = takerWinAmount(Number(offer.minTake), Number(offer.line));
    return `Too low for your $${offer.minTake} min take — it needs at least $${needed} of exposure at this line.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test client (localStorage)
// ---------------------------------------------------------------------------

function loadTestDb() {
  try {
    const raw = localStorage.getItem(TEST_DB_KEY);
    if (raw) {
      const db = JSON.parse(raw);
      if (db && Array.isArray(db.offers) && Array.isArray(db.bets)) return db;
    }
  } catch {}
  const db = buildTestSeed();
  saveTestDb(db);
  return db;
}

function saveTestDb(db) {
  try {
    localStorage.setItem(TEST_DB_KEY, JSON.stringify(db));
  } catch {}
}

/** Flip open offers past their expiry to 'expired'. Mutates db. */
function applyExpiry(db) {
  const now = Date.now();
  let changed = false;
  for (const offer of db.offers) {
    if (offer.status === 'open' && new Date(offer.expiresAt).getTime() <= now) {
      offer.status = 'expired';
      changed = true;
    }
  }
  return changed;
}

function byNewest(a, b) {
  return new Date(b.createdAt) - new Date(a.createdAt);
}

export function createTestClient(getActor) {
  const requireActor = () => {
    const actor = getActor();
    if (!actor || !actor.id) throw new Error('No test identity selected.');
    return actor;
  };

  return {
    isTest: true,

    async listAll() {
      const db = loadTestDb();
      if (applyExpiry(db)) saveTestDb(db);
      return {
        offers: [...db.offers].sort(byNewest),
        bets: [...db.bets].sort(byNewest),
      };
    },

    async createOffer(input) {
      const actor = requireActor();
      const error = validateOfferInput(input);
      if (error) throw new Error(error);

      const db = loadTestDb();
      const offer = {
        id: `o${db.nextId++}`,
        creatorId: actor.id,
        creatorName: actor.name,
        marketKind: input.marketKind,
        market: input.market || null,
        title: String(input.title).trim(),
        description: String(input.description || '').trim(),
        line: Number(input.line),
        maxExposure: roundCents(input.maxExposure),
        remainingExposure: roundCents(input.maxExposure),
        maxExposurePerPerson: normalizePerPersonCap(input.maxExposurePerPerson) ?? null,
        minTake: roundCents(input.minTake ?? 1),
        status: 'open',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(input.expiresAt).toISOString(),
      };
      db.offers.unshift(offer);
      saveTestDb(db);
      return offer;
    },

    async takeOffer(offerId, stakeInput) {
      const actor = requireActor();
      const db = loadTestDb();
      applyExpiry(db);

      const offer = db.offers.find((o) => o.id === offerId);
      if (!offer) throw new Error('Offer not found.');
      if (offer.status !== 'open') throw new Error(`Offer is ${offer.status}.`);
      if (offer.creatorId === actor.id) throw new Error("You can't take your own offer.");

      const usedByTaker = exposureUsedByTaker(db.bets, offer.id, actor.id);
      const check = validateTake(offer, stakeInput, { usedByTaker });
      if (!check.ok) throw new Error(check.error);

      const creatorRisk = check.takerWin;
      offer.remainingExposure = roundCents(offer.remainingExposure - creatorRisk);
      if (isEffectivelyFilled(offer)) offer.status = 'filled';

      const bet = {
        id: `b${db.nextId++}`,
        offerId: offer.id,
        offerTitle: offer.title,
        line: offer.line,
        creatorId: offer.creatorId,
        creatorName: offer.creatorName,
        takerId: actor.id,
        takerName: actor.name,
        takerStake: check.stake,
        creatorRisk,
        status: 'live',
        createdAt: new Date().toISOString(),
      };
      db.bets.unshift(bet);
      saveTestDb(db);
      return { bet, offer };
    },

    async updateOfferExposure(offerId, newRemaining) {
      const actor = requireActor();
      const db = loadTestDb();
      applyExpiry(db);
      const offer = db.offers.find((o) => o.id === offerId);
      if (!offer) throw new Error('Offer not found.');
      if (offer.creatorId !== actor.id) throw new Error('Not your offer.');
      if (offer.status !== 'open') throw new Error(`Offer is ${offer.status}.`);
      const error = validateExposureUpdate(offer, newRemaining);
      if (error) throw new Error(error);
      const matched = roundCents(offer.maxExposure - offer.remainingExposure);
      offer.remainingExposure = roundCents(newRemaining);
      offer.maxExposure = roundCents(matched + Number(newRemaining));
      saveTestDb(db);
      return offer;
    },

    async cancelOffer(offerId) {
      const actor = requireActor();
      const db = loadTestDb();
      const offer = db.offers.find((o) => o.id === offerId);
      if (!offer) throw new Error('Offer not found.');
      if (offer.creatorId !== actor.id) throw new Error('Not your offer.');
      if (offer.status !== 'open') throw new Error(`Offer is already ${offer.status}.`);
      offer.status = 'cancelled';
      saveTestDb(db);
      return offer;
    },

    async resetTestData() {
      saveTestDb(buildTestSeed());
    },
  };
}

// ---------------------------------------------------------------------------
// Remote client (/api/exchange, Neon-backed)
// ---------------------------------------------------------------------------

async function apiFetch(path, { token, body } = {}) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function createRemoteClient(getToken) {
  const authed = async (body) => apiFetch('/api/exchange', { token: await getToken(), body });

  return {
    isTest: false,

    async listAll() {
      const data = await apiFetch('/api/exchange');
      return { offers: data.offers || [], bets: data.bets || [] };
    },

    async createOffer(input) {
      const error = validateOfferInput(input);
      if (error) throw new Error(error);
      const data = await authed({
        action: 'create',
        marketKind: input.marketKind,
        market: input.market || null,
        title: String(input.title).trim(),
        description: String(input.description || '').trim(),
        line: Number(input.line),
        maxExposure: roundCents(input.maxExposure),
        maxExposurePerPerson: normalizePerPersonCap(input.maxExposurePerPerson) ?? null,
        minTake: roundCents(input.minTake ?? 1),
        expiresAt: new Date(input.expiresAt).toISOString(),
      });
      return data.offer;
    },

    async takeOffer(offerId, stake) {
      const data = await authed({ action: 'take', offerId, stake: roundCents(stake) });
      return { bet: data.bet, offer: data.offer };
    },

    async updateOfferExposure(offerId, newRemaining) {
      const data = await authed({
        action: 'updateExposure', offerId, remainingExposure: roundCents(newRemaining),
      });
      return data.offer;
    },

    async cancelOffer(offerId) {
      const data = await authed({ action: 'cancel', offerId });
      return data.offer;
    },
  };
}

// Re-export for convenience where the UI shows payout previews.
export { takerWinAmount };
