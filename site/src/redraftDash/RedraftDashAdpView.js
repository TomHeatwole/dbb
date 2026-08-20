import React, { useMemo, useState } from 'react';
import PositionBadge from '../PositionBadge';
import { DEFAULT_ADP_MODE, JAML_QB_FACTOR, resolveMarketAdp } from './redraftDashJamlAdp';
import { SourceChips } from './redraftDashShared';
import {
  SIGNAL_COHORT_LABELS,
  buildCohortValueSignals,
  playerSignalKey,
} from './redraftDashValueSignals';

/** 12-team draft round from overall ADP pick. */
function adpRound(adp) {
  if (adp == null) return null;
  return Math.max(1, Math.ceil(adp / 12));
}

function SignalBadge({ signal }) {
  if (signal.kind === 'missing') {
    return <span className="rdda-signal rdda-signal--missing">—</span>;
  }
  if (signal.kind === 'fair') {
    return (
      <span
        className="rdda-signal rdda-signal--fair"
        title={
          signal.cohort
            ? `${SIGNAL_COHORT_LABELS[signal.cohort]}: market agrees within noise`
            : 'ADP and our rank agree within noise'
        }
      >
        Fair
      </span>
    );
  }
  const label = signal.kind === 'smash' ? 'Smash' : 'Fade';
  const rounded = signal.rounded;
  const gap = rounded == null
    ? ''
    : rounded > 0
      ? `+${rounded}`
      : `−${Math.abs(rounded)}`;
  const cohortBit = signal.cohort ? `${SIGNAL_COHORT_LABELS[signal.cohort]} — ` : '';
  return (
    <span
      className={`rdda-signal rdda-signal--${signal.kind}${signal.cls.endsWith('strong') ? ' rdda-signal--strong' : ''}`}
      title={
        signal.kind === 'smash'
          ? `${cohortBit}we rank them ~${Math.abs(rounded)} spots higher in-cohort than market — value at that cost.`
          : `${cohortBit}we rank them ~${Math.abs(rounded)} spots lower in-cohort than market — fade at that cost.`
      }
    >
      {label}
      {gap && <span className="rdda-signal-gap">{gap}</span>}
    </span>
  );
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'smash', label: 'Smashes' },
  { id: 'fade', label: 'Fades' },
  { id: 'fair', label: 'Fair' },
];

/**
 * ADP-first board: players sorted by market ADP (JAML-adjusted by default),
 * with smash / fade labels from cohort ranks (QB vs QB; RB/WR/TE together).
 */
function RedraftDashAdpView({
  players,
  positionFilter,
  publicMode = false,
  adpMode = DEFAULT_ADP_MODE,
}) {
  const [signalFilter, setSignalFilter] = useState('all');
  const byPosition = positionFilter !== 'ALL';
  const marketLabel = adpMode === 'jaml' ? 'JAML ADP' : 'YAFSB SF ADP';

  const signalsByKey = useMemo(
    () => buildCohortValueSignals(players, adpMode),
    [players, adpMode],
  );

  const roundGroups = useMemo(() => {
    const subset = byPosition
      ? players.filter((p) => p.position === positionFilter)
      : players;

    const withSignal = subset.map((p) => {
      const signal = signalsByKey.get(playerSignalKey(p)) || { kind: 'missing', cls: 'neutral' };
      return {
        player: p,
        signal,
        marketAdp: signal.marketAdp ?? resolveMarketAdp(p, adpMode),
      };
    });
    const filtered = signalFilter === 'all'
      ? withSignal
      : withSignal.filter(({ signal }) => signal.kind === signalFilter);

    const sorted = [...filtered].sort((a, b) => {
      const aa = a.marketAdp;
      const ba = b.marketAdp;
      if (aa == null && ba == null) return (a.player.rank ?? 9999) - (b.player.rank ?? 9999);
      if (aa == null) return 1;
      if (ba == null) return -1;
      if (aa !== ba) return aa - ba;
      return (a.player.rank ?? 9999) - (b.player.rank ?? 9999);
    });

    const groups = new Map();
    for (const row of sorted) {
      const round = adpRound(row.marketAdp);
      const key = round == null ? 'none' : round;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    return [...groups.entries()].sort((a, b) => {
      if (a[0] === 'none') return 1;
      if (b[0] === 'none') return -1;
      return a[0] - b[0];
    });
  }, [players, positionFilter, byPosition, signalFilter, adpMode, signalsByKey]);

  const counts = useMemo(() => {
    const subset = byPosition
      ? players.filter((p) => p.position === positionFilter)
      : players;
    const tallies = { all: subset.length, smash: 0, fade: 0, fair: 0, missing: 0 };
    for (const p of subset) {
      const kind = (signalsByKey.get(playerSignalKey(p)) || {}).kind || 'missing';
      if (kind in tallies) tallies[kind] += 1;
    }
    return tallies;
  }, [players, positionFilter, byPosition, signalsByKey]);

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

  return (
    <div className="rddt-root rdda-root">
      <p className="rddt-legend">
        Sorted by {marketLabel} (12-team rounds)
        {adpMode === 'jaml' && (
          <>
            {' '}— QBs compressed by ×{JAML_QB_FACTOR} with Allen/Lamar pinned 1–2
            (~5–6 QBs in R1; both slots mostly filled by R5)
          </>
        )}
        . Smash/fade is cohort-relative: QB vs QB, and RB/WR/TE together (QBs excluded from skill analysis).{' '}
        <span className="rdda-signal rdda-signal--smash rdda-legend-chip">Smash</span>
        {' '}means we rank them higher in-cohort than market.{' '}
        <span className="rdda-signal rdda-signal--fade rdda-legend-chip">Fade</span>
        {' '}means the market is ahead in-cohort.
      </p>

      <div className="rdda-filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`rdda-filter-btn${signalFilter === f.id ? ' rdda-filter-btn--active' : ''}`}
            onClick={() => setSignalFilter(f.id)}
          >
            {f.label}
            <span className="rdda-filter-count">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {roundGroups.length === 0 ? (
        <p className="rddt-legend">No players match this filter.</p>
      ) : roundGroups.map(([round, rows]) => {
        const smashN = rows.filter((r) => r.signal.kind === 'smash').length;
        const fadeN = rows.filter((r) => r.signal.kind === 'fade').length;
        return (
          <section key={round} className="rddt-tier">
            <header className="rddt-tier-head">
              <span className="rddt-tier-badge">
                {round === 'none' ? 'No ADP' : `Round ${round}`}
              </span>
              <span className="rddt-tier-meta">
                {round !== 'none' && (
                  <>picks {(round - 1) * 12 + 1}–{round * 12} · </>
                )}
                {rows.length} player{rows.length === 1 ? '' : 's'}
                {smashN > 0 && <> · {smashN} smash{smashN === 1 ? '' : 'es'}</>}
                {fadeN > 0 && <> · {fadeN} fade{fadeN === 1 ? '' : 's'}</>}
              </span>
            </header>
            <div className="rddt-tier-body">
              {rows.map(({ player: p, signal, marketAdp }) => {
                const tier = byPosition ? p.posTier : p.tier;
                return (
                  <div
                    key={p.sleeperId || p.rank || p.name}
                    className={`rddt-player rdda-player${publicMode ? ' rddt-player--public rdda-player--public' : ''} rdda-player--${signal.kind}`}
                  >
                    <span
                      className="rdda-adp-rank"
                      title={
                        adpMode === 'jaml' && p.adp != null
                          ? `${marketLabel} ${marketAdp?.toFixed(1)} (YAFSB ${p.adp.toFixed(1)})`
                          : marketLabel
                      }
                    >
                      {marketAdp == null ? '—' : marketAdp.toFixed(1)}
                    </span>
                    <span className="rddt-player-id">
                      <span className="rddt-player-name">{p.name}</span>
                      <span className="rddt-player-sub">
                        <PositionBadge position={p.position} />
                        <span className="rddt-player-team">{p.team || '—'}</span>
                        {!byPosition && p.posRank != null && (
                          <span className="rddt-player-posrank">{p.position}{p.posRank}</span>
                        )}
                        {tier != null && (
                          <span className="rdda-our-tier">T{tier}</span>
                        )}
                        {adpMode === 'jaml' && p.adp != null && p.position === 'QB' && (
                          <span className="rdda-raw-adp" title="Unadjusted YAFSB SF ADP">
                            YAFSB {p.adp.toFixed(1)}
                          </span>
                        )}
                      </span>
                    </span>
                    <span
                      className="rdda-our-rank"
                      title={byPosition ? `Our ${positionFilter} rank` : 'Our overall rank'}
                    >
                      <span className="rdda-our-label">Ours</span>
                      <span className="rdda-our-num">{byPosition ? p.posRank : p.rank}</span>
                    </span>
                    <SignalBadge signal={signal} />
                    {!publicMode && <SourceChips player={p} />}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default RedraftDashAdpView;
