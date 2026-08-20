/**
 * Shared ADP-vs-rank helpers for Redraft Dash tier and ADP views.
 *
 * Smash / fade is cohort-relative (not overall SF board vs overall ADP):
 *   - QBs are ranked only against other QBs
 *   - RB / WR / TE are ranked against the skill pool (all three, QBs excluded)
 *   - Kickers are ranked only against other kickers
 *
 * Within a cohort: delta = marketCohortRank − ourCohortRank.
 * Positive = market drafts them later in-cohort → smash; negative → fade.
 *
 * Market ADP defaults to JAML-adjusted (see redraftDashJamlAdp.js).
 */

import { DEFAULT_ADP_MODE, resolveMarketAdp } from './redraftDashJamlAdp';

export function formatEqRank(rank) {
  if (rank == null) return '—';
  return Number.isInteger(rank) ? String(rank) : rank.toFixed(1);
}

/** Delta significance relative to board depth: ±3 spots at pick 10 is huge, at pick 250 it's noise. */
export function deltaClass(delta, rank) {
  const rel = delta / Math.max(rank, 8);
  const abs = Math.abs(delta);
  if (abs < 2 || Math.abs(rel) < 0.12) return 'neutral';
  const side = delta > 0 ? 'high' : 'low';
  return Math.abs(rel) >= 0.3 ? `${side}-strong` : side;
}

export function playerSignalKey(player) {
  if (!player) return '';
  if (player.sleeperId) return `id:${player.sleeperId}`;
  return `${player.position || ''}:${player.name || ''}:${player.rank ?? ''}`;
}

/** Cohort used for smash/fade — QBs excluded from skill-position analysis. */
export function signalCohortId(position) {
  const pos = String(position || '').toUpperCase();
  if (pos === 'QB') return 'qb';
  if (pos === 'RB' || pos === 'WR' || pos === 'TE') return 'skill';
  if (pos === 'K') return 'k';
  return null;
}

export const SIGNAL_COHORT_LABELS = {
  qb: 'QB vs QB',
  skill: 'RB/WR/TE (QBs excluded)',
  k: 'K vs K',
};

function missingSignal(marketAdp = null) {
  return {
    kind: 'missing',
    cls: 'neutral',
    delta: null,
    rounded: null,
    marketAdp,
    cohort: null,
    ourCohortRank: null,
    marketCohortRank: null,
  };
}

function signalFromDelta(delta, ourCohortRank, extras) {
  const cls = deltaClass(delta, ourCohortRank);
  const rounded = Math.round(delta);
  const kind = cls === 'neutral' ? 'fair' : cls.startsWith('high') ? 'smash' : 'fade';
  return { kind, cls, delta, rounded, ...extras };
}

/**
 * Build smash/fade signals for a full board using cohort ranks.
 * Returns a Map keyed by playerSignalKey(player).
 */
export function buildCohortValueSignals(players, adpMode = DEFAULT_ADP_MODE) {
  const map = new Map();
  if (!players?.length) return map;

  const cohorts = {
    qb: [],
    skill: [],
    k: [],
  };

  for (const player of players) {
    const cohort = signalCohortId(player.position);
    if (!cohort) {
      map.set(playerSignalKey(player), missingSignal(resolveMarketAdp(player, adpMode)));
      continue;
    }
    cohorts[cohort].push(player);
  }

  for (const [cohort, members] of Object.entries(cohorts)) {
    const withBoard = members
      .filter((p) => p.rank != null)
      .sort((a, b) => a.rank - b.rank || String(a.name).localeCompare(String(b.name)));

    const ourRankByKey = new Map();
    withBoard.forEach((p, i) => {
      ourRankByKey.set(playerSignalKey(p), i + 1);
    });

    const withMarket = members
      .map((p) => ({ player: p, marketAdp: resolveMarketAdp(p, adpMode) }))
      .filter((row) => row.marketAdp != null)
      .sort((a, b) => (
        a.marketAdp - b.marketAdp
        || (a.player.rank ?? 9999) - (b.player.rank ?? 9999)
        || String(a.player.name).localeCompare(String(b.player.name))
      ));

    const marketRankByKey = new Map();
    withMarket.forEach((row, i) => {
      marketRankByKey.set(playerSignalKey(row.player), i + 1);
    });

    for (const player of members) {
      const key = playerSignalKey(player);
      const marketAdp = resolveMarketAdp(player, adpMode);
      const ourCohortRank = ourRankByKey.get(key);
      const marketCohortRank = marketRankByKey.get(key);
      if (ourCohortRank == null || marketCohortRank == null) {
        map.set(key, missingSignal(marketAdp));
        continue;
      }
      const delta = marketCohortRank - ourCohortRank;
      map.set(key, signalFromDelta(delta, ourCohortRank, {
        marketAdp,
        cohort,
        ourCohortRank,
        marketCohortRank,
      }));
    }
  }

  return map;
}

/**
 * Lookup a precomputed cohort signal, or fall back to overall ADP − rank
 * when no board index is provided (single-player contexts).
 */
export function valueSignal(player, adpMode = DEFAULT_ADP_MODE, signalsByKey = null) {
  if (signalsByKey) {
    return signalsByKey.get(playerSignalKey(player)) || missingSignal(resolveMarketAdp(player, adpMode));
  }

  const marketAdp = resolveMarketAdp(player, adpMode);
  if (marketAdp == null || player.rank == null) {
    return missingSignal(marketAdp);
  }
  const delta = marketAdp - player.rank;
  return signalFromDelta(delta, player.rank, {
    marketAdp,
    cohort: null,
    ourCohortRank: player.rank,
    marketCohortRank: marketAdp,
  });
}
