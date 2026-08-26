import React from 'react';
import { CUSTOM_BOARD_SOURCES } from './redraftDashLoader';
import { DEFAULT_ADP_MODE, resolveMarketAdp } from './redraftDashJamlAdp';
import {
  SIGNAL_COHORT_LABELS,
  deltaClass,
  formatEqRank,
  valueSignal,
} from './redraftDashValueSignals';

/**
 * Market cost vs our board: ADP (JAML-adjusted by default) with the gap from
 * cohort smash/fade analysis when a precomputed signal is provided.
 */
export function AdpCell({ player, adpMode = DEFAULT_ADP_MODE, signal: signalProp = null }) {
  const signal = signalProp || valueSignal(player, adpMode);
  const marketAdp = signal.marketAdp ?? resolveMarketAdp(player, adpMode);
  if (signal.kind === 'missing' || marketAdp == null) {
    return <span className="rddt-adp rddt-adp--missing">ADP —</span>;
  }
  const { cls, rounded } = signal;
  const modeLabel = adpMode === 'yafsb'
    ? 'YAFSB SF ADP'
    : adpMode === 'fp'
      ? 'FP Half ADP'
      : 'JAML ADP';
  const rawYafsb = player.rawAdp ?? player.adp;
  const cohortLabel = signal.cohort ? SIGNAL_COHORT_LABELS[signal.cohort] : null;
  const compareLine = signal.cohort && signal.ourCohortRank != null && signal.marketCohortRank != null
    ? `${cohortLabel}: market #${signal.marketCohortRank} vs our #${signal.ourCohortRank}`
    : `vs our #${player.rank}`;
  return (
    <span
      className={`rddt-adp rddt-adp--${cls}`}
      title={
        `${modeLabel} ${marketAdp.toFixed(1)}`
        + (adpMode === 'jaml' && rawYafsb != null ? ` (YAFSB ${rawYafsb.toFixed(1)})` : '')
        + ` — ${compareLine}: `
        + (rounded === 0
          ? 'market agrees with us.'
          : rounded > 0
            ? `market drafts them ~${rounded} spots later in-cohort — likely still available.`
            : `market drafts them ~${Math.abs(rounded)} spots earlier in-cohort — expect to reach.`)
      }
    >
      <span className="rddt-adp-label">{adpMode === 'jaml' ? 'JAML' : 'ADP'}</span>
      <span className="rddt-adp-num">{marketAdp.toFixed(1)}</span>
      <span className="rddt-adp-delta">
        {rounded === 0 ? '±0' : rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`}
      </span>
    </span>
  );
}

export function SourceChips({ player, format = 'superflex' }) {
  const sources = CUSTOM_BOARD_SOURCES[format] || CUSTOM_BOARD_SOURCES.superflex;
  const chips = sources.map((source) => {
    const srcRank = player.sourceRanks?.[source.id];
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

  const rankLabel = format === '1qb' ? 'rank' : 'equivalent SF rank';

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
                : `${source.label} (${source.weight}% of blend): ${rankLabel} ${formatEqRank(srcRank)} — `
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
