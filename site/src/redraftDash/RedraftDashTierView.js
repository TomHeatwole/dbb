import React, { useMemo } from 'react';
import PositionBadge from '../PositionBadge';
import { DEFAULT_ADP_MODE } from './redraftDashJamlAdp';
import { AdpCell, SourceChips } from './redraftDashShared';
import { buildCohortValueSignals, playerSignalKey } from './redraftDashValueSignals';

/**
 * "View by tier" for the DBB Custom board. Groups players into tier cards
 * (overall tiers, or positional tiers when a position filter is active) and
 * shows, per player, where the blend's confidence comes from: one chip per
 * source with its equivalent-SF rank, coloured by how far above/below our
 * blended rank that source sits. ▲ marks the most bullish source, ▼ the most
 * bearish.
 */

function RedraftDashTierView({
  players,
  positionFilter,
  publicMode = false,
  adpMode = DEFAULT_ADP_MODE,
  format = 'superflex',
}) {
  const byPosition = positionFilter !== 'ALL';
  const marketLabel = adpMode === 'jaml'
    ? 'JAML-adjusted ADP'
    : adpMode === 'fp'
      ? 'FantasyPros half ADP'
      : 'Sleeper superflex ADP';
  const isSf = format !== '1qb';
  const rankChipLabel = isSf ? 'equivalent-SF rank' : '1QB source rank';

  const signalsByKey = useMemo(
    () => buildCohortValueSignals(players, adpMode),
    [players, adpMode],
  );

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
        {publicMode
          ? <>The public snapshot isn&apos;t available — run <code> node scripts/build_redraft_dash_snapshot.js</code>.</>
          : <>The DBB Custom board isn&apos;t available — run
            <code> node dbbp/scripts/build_custom_rankings.js</code> and restart the dev server.</>}
      </div>
    );
  }

  const legend = publicMode
    ? (
      <>
        {byPosition
          ? `${positionFilter} positional tiers from the DBB custom board.`
          : 'Overall tiers from the DBB custom board.'}
        {' '}
        Each row shows our overall rank and {marketLabel}
        {' '}(market cost, not an input to the board). ADP deltas are cohort-relative
        (QB vs QB; RB/WR/TE together, QBs excluded):{' '}
        <span className="rddt-adp rddt-adp--high rddt-legend-chip">+later</span> means later
        in-cohort than we rank them, <span className="rddt-adp rddt-adp--low rddt-legend-chip">−earlier</span> means
        the market takes them first in-cohort.
      </>
    )
    : (
      <>
        {byPosition && positionFilter === 'K'
          ? `Kicker positional tiers from ETR ${isSf ? 'superflex' : 'half-PPR'} ranks, spliced into the custom board by value. Only ETR ranks kickers — other source chips will be empty.`
          : byPosition
            ? `${positionFilter} positional tiers from the DBB Custom blend.`
            : `Overall tiers from the DBB Custom blend (kickers inserted at ETR ${isSf ? 'superflex' : 'half-PPR'} values).`}
        {' '}
        Chips show each source&apos;s {rankChipLabel} —{' '}
        <span className="rddt-chip rddt-chip--high rddt-legend-chip">higher</span> /{' '}
        <span className="rddt-chip rddt-chip--low rddt-legend-chip">lower</span> than our blended rank,
        with ▲/▼ marking the most bullish and most bearish source on that player.
        {' '}{marketLabel} deltas are cohort-relative (QB vs QB; RB/WR/TE together):{' '}
        <span className="rddt-adp rddt-adp--high rddt-legend-chip">+later</span> /{' '}
        <span className="rddt-adp rddt-adp--low rddt-legend-chip">−earlier</span> in-cohort.
      </>
    );

  return (
    <div className="rddt-root">
      <p className="rddt-legend">
        {legend}
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
                {!publicMode && hi != null && lo != null && (
                  <> · value {hi.toFixed(1)}{hi !== lo && <> – {lo.toFixed(1)}</>}</>
                )}
              </span>
            </header>
            <div className="rddt-tier-body">
              {tierPlayers.map((p) => (
                <div
                  key={p.rank}
                  className={`rddt-player${publicMode ? ' rddt-player--public' : ''}`}
                >
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
                  {!publicMode && (
                    <span className="rddt-player-value" title="Blended value score (top player = 100)">
                      <span className="rddt-value-bar">
                        <span
                          className="rddt-value-fill"
                          style={{ width: `${Math.max(1, Math.min(100, p.value ?? 0))}%` }}
                        />
                      </span>
                      <span className="rddt-value-num">{p.value == null ? '—' : p.value.toFixed(1)}</span>
                    </span>
                  )}
                  <AdpCell
                    player={p}
                    adpMode={adpMode}
                    signal={signalsByKey.get(playerSignalKey(p))}
                  />
                  {!publicMode && <SourceChips player={p} format={format} />}
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
