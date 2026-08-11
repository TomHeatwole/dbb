import React, { useMemo } from 'react';
import PositionBadge from '../PositionBadge';
import { CUSTOM_BOARD_SOURCES } from './redraftDashLoader';

/**
 * "View by tier" for the DBB Custom board. Groups players into tier cards
 * (overall tiers, or positional tiers when a position filter is active) and
 * shows, per player, where the blend's confidence comes from: one chip per
 * source with its equivalent-SF rank, coloured by how far above/below our
 * blended rank that source sits. ▲ marks the most bullish source, ▼ the most
 * bearish.
 */

function formatEqRank(rank) {
  if (rank == null) return '—';
  return Number.isInteger(rank) ? String(rank) : rank.toFixed(1);
}

/** Delta significance relative to board depth: ±3 spots at pick 10 is huge, at pick 250 it's noise. */
function deltaClass(delta, rank) {
  const rel = delta / Math.max(rank, 8);
  const abs = Math.abs(delta);
  if (abs < 2 || Math.abs(rel) < 0.12) return 'neutral';
  const side = delta > 0 ? 'high' : 'low';
  return Math.abs(rel) >= 0.3 ? `${side}-strong` : side;
}

/**
 * Market cost vs our board: Sleeper SF ADP with the gap to our blended rank.
 * Positive gap (green) = the market drafts them later than we rank them, so
 * they should still be there past our slot; negative (red) = the market takes
 * them earlier, so you have to reach to get them.
 */
function AdpCell({ player }) {
  if (player.adp == null) {
    return <span className="rddt-adp rddt-adp--missing">ADP —</span>;
  }
  const delta = player.adp - player.rank;
  const cls = deltaClass(delta, player.rank);
  const rounded = Math.round(delta);
  return (
    <span
      className={`rddt-adp rddt-adp--${cls}`}
      title={
        `Sleeper SF ADP ${player.adp.toFixed(1)} vs our #${player.rank}: `
        + (rounded === 0
          ? 'market agrees with us.'
          : rounded > 0
            ? `market drafts them ~${rounded} picks later — likely still available at our rank.`
            : `market drafts them ~${Math.abs(rounded)} picks earlier — expect to reach.`)
      }
    >
      <span className="rddt-adp-label">ADP</span>
      <span className="rddt-adp-num">{player.adp.toFixed(1)}</span>
      <span className="rddt-adp-delta">
        {rounded === 0 ? '±0' : rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`}
      </span>
    </span>
  );
}

function SourceChips({ player }) {
  const chips = CUSTOM_BOARD_SOURCES.map((source) => {
    const srcRank = player.sourceRanks[source.id];
    // Positive delta = this source is higher (better) on the player than our blend
    const delta = srcRank == null ? null : player.rank - srcRank;
    return { source, srcRank, delta };
  });

  const present = chips.filter((c) => c.delta != null);
  let bullish = null;
  let bearish = null;
  if (present.length >= 2) {
    const sorted = [...present].sort((a, b) => b.delta - a.delta);
    // Only mark extremes when the disagreement is meaningful
    if (deltaClass(sorted[0].delta, player.rank) !== 'neutral') bullish = sorted[0].source.id;
    const last = sorted[sorted.length - 1];
    if (deltaClass(last.delta, player.rank) !== 'neutral') bearish = last.source.id;
  }

  return (
    <div className="rddt-chips">
      {chips.map(({ source, srcRank, delta }) => {
        const cls = delta == null ? 'missing' : deltaClass(delta, player.rank);
        return (
          <span
            key={source.id}
            className={`rddt-chip rddt-chip--${cls}`}
            title={
              delta == null
                ? `${source.label} (${source.weight}%): not ranked`
                : `${source.label} (${source.weight}% of blend): equivalent SF rank ${formatEqRank(srcRank)} — `
                  + `${Math.abs(Math.round(delta))} spots ${delta >= 0 ? 'higher' : 'lower'} than our #${player.rank}`
            }
          >
            {source.id === bullish && <span className="rddt-chip-arrow rddt-chip-arrow--up">▲</span>}
            {source.id === bearish && <span className="rddt-chip-arrow rddt-chip-arrow--down">▼</span>}
            <span className="rddt-chip-label">{source.label}</span>
            <span className="rddt-chip-rank">{formatEqRank(srcRank)}</span>
          </span>
        );
      })}
    </div>
  );
}

function RedraftDashTierView({ players, positionFilter }) {
  const byPosition = positionFilter !== 'ALL';

  const tierGroups = useMemo(() => {
    const subset = byPosition ? players.filter((p) => p.position === positionFilter) : players;
    const groups = new Map();
    for (const p of subset) {
      const tier = byPosition ? p.posTier : p.tier;
      if (tier == null) continue;
      if (!groups.has(tier)) groups.set(tier, []);
      groups.get(tier).push(p);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [players, positionFilter, byPosition]);

  if (players.length === 0) {
    return (
      <div className="rv-error">
        The DBB Custom board isn't available — run
        <code> node dbbp/scripts/build_custom_rankings.js</code> and restart the dev server.
      </div>
    );
  }

  return (
    <div className="rddt-root">
      <p className="rddt-legend">
        {byPosition ? `${positionFilter} positional tiers` : 'Overall tiers'} from the DBB Custom blend.
        Chips show each source's equivalent-SF rank —{' '}
        <span className="rddt-chip rddt-chip--high rddt-legend-chip">higher</span> /{' '}
        <span className="rddt-chip rddt-chip--low rddt-legend-chip">lower</span> than our blended rank,
        with ▲/▼ marking the most bullish and most bearish source on that player.
        ADP is Sleeper superflex market cost (never a blend input):{' '}
        <span className="rddt-adp rddt-adp--high rddt-legend-chip">+later</span> means they should
        still be there past our rank, <span className="rddt-adp rddt-adp--low rddt-legend-chip">−earlier</span> means
        the market takes them first.
      </p>

      {tierGroups.map(([tier, tierPlayers]) => {
        const values = tierPlayers.map((p) => p.value).filter((v) => v != null);
        const hi = values.length ? Math.max(...values) : null;
        const lo = values.length ? Math.min(...values) : null;
        return (
          <section key={tier} className="rddt-tier">
            <header className="rddt-tier-head">
              <span className="rddt-tier-badge">Tier {tier}</span>
              <span className="rddt-tier-meta">
                {tierPlayers.length} player{tierPlayers.length === 1 ? '' : 's'}
                {hi != null && lo != null && (
                  <> · value {hi.toFixed(1)}{hi !== lo && <> – {lo.toFixed(1)}</>}</>
                )}
              </span>
            </header>
            <div className="rddt-tier-body">
              {tierPlayers.map((p) => (
                <div key={p.rank} className="rddt-player">
                  <span className="rddt-player-rank">{byPosition ? p.posRank : p.rank}</span>
                  <span className="rddt-player-id">
                    <span className="rddt-player-name">{p.name}</span>
                    <span className="rddt-player-sub">
                      <PositionBadge position={p.position} />
                      <span className="rddt-player-team">{p.team || '—'}</span>
                      {!byPosition && p.posRank != null && (
                        <span className="rddt-player-posrank">{p.position}{p.posRank}</span>
                      )}
                    </span>
                  </span>
                  <span className="rddt-player-value" title="Blended value score (top player = 100)">
                    <span className="rddt-value-bar">
                      <span
                        className="rddt-value-fill"
                        style={{ width: `${Math.max(1, Math.min(100, p.value ?? 0))}%` }}
                      />
                    </span>
                    <span className="rddt-value-num">{p.value == null ? '—' : p.value.toFixed(1)}</span>
                  </span>
                  <AdpCell player={p} />
                  <SourceChips player={p} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default RedraftDashTierView;
