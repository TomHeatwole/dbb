import { LEAGUE_ID } from '../utils/global_constants';
import { recordRateLimitHit } from '../utils/database';

/**
 * Fetch transactions for a given round from the Sleeper API.
 *
 * @param {number} round   - The NFL week / leg number (1 for off-season trades).
 * @param {string} leagueId - League to query; defaults to the current LEAGUE_ID.
 *
 * Each transaction object has the shape:
 *   {
 *     transaction_id, type, status, created, roster_ids,
 *     adds:   { playerId: rosterId, … }  – players moved TO that roster
 *     drops:  { playerId: rosterId, … }  – players moved FROM that roster
 *     draft_picks: [{ round, season, roster_id, owner_id, previous_owner_id }]
 *     waiver_budget: [{ amount, receiver, sender }]
 *   }
 */
export async function fetchTransactions(round = 1, leagueId = LEAGUE_ID) {
  const res = await fetch(
    `https://api.sleeper.app/v1/league/${leagueId}/transactions/${round}`
  );
  if (res.status === 429) {
    try { await recordRateLimitHit('sleeper'); } catch (_) {}
  }
  if (!res.ok) throw new Error('Failed to fetch transactions');

  const raw = await res.json();
  return Array.isArray(raw) ? raw : [];
}

/**
 * Given a single trade transaction, return a per-team breakdown of what each
 * team received.
 *
 * Returns an object keyed by rosterId:
 *   {
 *     [rosterId]: {
 *       playerIds: string[],     // player IDs received by this team
 *       picks: Array<{ round, season }>,  // picks received
 *       faab: number,            // FAAB dollars received (0 if none)
 *     }
 *   }
 */
export function buildTradeSides(trade) {
  const sides = {};

  const ensureTeam = (rid) => {
    const key = Number(rid);
    if (!sides[key]) {
      sides[key] = { playerIds: [], picks: [], faab: 0 };
    }
    return key;
  };

  // Seed both sides so teams with nothing received still appear
  for (const rid of (trade.roster_ids || [])) {
    ensureTeam(rid);
  }

  // Players added → receiving team
  const adds = trade.adds || {};
  for (const [playerId, rosterId] of Object.entries(adds)) {
    const key = ensureTeam(rosterId);
    sides[key].playerIds.push(String(playerId));
  }

  // Draft picks → receiving team (owner_id is the new owner)
  // roster_id identifies the ORIGINAL team whose pick slot this is (needed for "1.05" formatting)
  for (const pick of (trade.draft_picks || [])) {
    if (pick && pick.owner_id != null) {
      const key = ensureTeam(pick.owner_id);
      sides[key].picks.push({
        round: pick.round,
        season: pick.season ? String(pick.season) : null,
        roster_id: pick.roster_id != null ? Number(pick.roster_id) : null,
      });
    }
  }

  // FAAB budget
  for (const wb of (trade.waiver_budget || [])) {
    if (wb && wb.receiver != null && wb.amount) {
      const key = ensureTeam(wb.receiver);
      sides[key].faab += Number(wb.amount) || 0;
    }
  }

  return sides;
}
