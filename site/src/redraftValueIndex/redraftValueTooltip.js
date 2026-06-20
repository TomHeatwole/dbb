import React from 'react';
import { formatKtcValue } from '../lookups/KtcLookup';

export function formatPosRankLabel(position, rank) {
  if (!position || rank == null) return '—';
  return `${position}${rank}`;
}

export function formatAdjAdpLabel(position, adpEffRank, adpPosRank) {
  if (!position) return '—';
  if (adpEffRank != null && Number.isFinite(adpEffRank)) {
    return `${position}${adpEffRank.toFixed(2)}`;
  }
  if (adpPosRank != null) return `${position}${adpPosRank}`;
  return '—';
}

export function formatAdjustPct(index) {
  if (index == null || !Number.isFinite(index)) return '—';
  const pct = (index - 1) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}% (${index.toFixed(2)}×)`;
}

/** Normalize redraft rows from CSV, Player DB, Dynasty Roster, or Rankings Viewer. */
export function normalizeRedraftTooltipEntry(source) {
  if (!source) return null;
  return {
    position: source.position,
    ktcValue: source.ktcValue ?? source.redraftKtcValue ?? source.ktcValue_tep ?? null,
    ktcPosRank: source.ktcPosRank ?? source.redraftKtcPosRank ?? null,
    adpEffRank: source.adpEffRank ?? source.redraftAdpEffRank ?? null,
    adpPosRank: source.adpPosRank ?? source.redraftAdpPosRank ?? null,
    competitorAdjustedValue: source.competitorAdjustedValue ?? source.value ?? null,
    rebuilderAdjustedValue: source.rebuilderAdjustedValue ?? null,
    redraftValueIndex: source.redraftValueIndex ?? null,
    rebuildValueIndex: source.rebuildValueIndex ?? null,
  };
}

const KIND_LABELS = {
  comp: 'Competitor adjusted',
  rebuild: 'Rebuilder adjusted',
};

export function buildRedraftAdjTooltipLines(entry, kind, { usesHwangAdp = false } = {}) {
  const normalized = normalizeRedraftTooltipEntry(entry);
  if (!normalized) return null;

  const index = kind === 'comp'
    ? normalized.redraftValueIndex
    : normalized.rebuildValueIndex;
  const adjusted = kind === 'comp'
    ? normalized.competitorAdjustedValue
    : normalized.rebuilderAdjustedValue;

  if (adjusted == null && index == null && normalized.ktcValue == null) {
    return null;
  }

  const adpLabel = usesHwangAdp ? 'Hwang ADP' : 'Adj ADP';

  return [
    KIND_LABELS[kind],
    `KTC TE+: ${formatKtcValue(normalized.ktcValue)}`,
    `KTC rank: ${formatPosRankLabel(normalized.position, normalized.ktcPosRank)}`,
    `${adpLabel}: ${formatAdjAdpLabel(
      normalized.position,
      normalized.adpEffRank,
      normalized.adpPosRank,
    )}`,
    ...(usesHwangAdp && entry?.bbAvgAdp != null
      ? [`Best Ball ADP: ${entry.bbAvgAdp.toFixed(1)}`]
      : []),
    `Adjust: ${formatAdjustPct(index)}`,
  ];
}

export function buildRedraftAdjTooltipText(entry, kind, options) {
  const lines = buildRedraftAdjTooltipLines(entry, kind, options);
  return lines ? lines.join('\n') : null;
}

/**
 * Hover tooltip for comp / rebuild adjusted values and ranks.
 * kind: 'comp' | 'rebuild'
 */
export function RedraftAdjTooltip({
  kind,
  entry,
  children,
  className = '',
  as = 'span',
  usesHwangAdp = false,
}) {
  const lines = buildRedraftAdjTooltipLines(entry, kind, { usesHwangAdp });
  const title = lines ? lines.join('\n') : undefined;
  const Tag = as;

  if (!lines) {
    return children ?? null;
  }

  return (
    <Tag
      className={`redraft-adj-tooltip-wrap${className ? ` ${className}` : ''}`}
      title={title}
    >
      {children}
      <span className="redraft-adj-tooltip" role="tooltip" aria-hidden="true">
        {lines.map((line, idx) => (
          <span
            key={idx}
            className={
              idx === 0
                ? 'redraft-adj-tooltip-line redraft-adj-tooltip-line--title'
                : 'redraft-adj-tooltip-line'
            }
          >
            {line}
          </span>
        ))}
      </span>
    </Tag>
  );
}
