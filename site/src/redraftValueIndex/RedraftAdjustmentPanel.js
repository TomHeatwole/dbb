import React, { useMemo } from 'react';
import PositionBadge from '../PositionBadge';
import { formatKtcValue } from '../lookups/KtcLookup';
import { interpolateRedraftLookup } from './redraftRankLookupLoader';
import {
  REBUILD_BETA,
  REBUILD_GAP_SCALE,
  computeRebuilderAdjusted,
} from './rebuilderAdjustedValue';

function fmtSigned(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const n = Math.round(value);
  return `${n >= 0 ? '+' : ''}${n.toLocaleString()}`;
}

function fmtPct(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function StatBlock({ label, value, sub }) {
  return (
    <div className="ktc-rc-stat">
      <span className="ktc-rc-stat-label">{label}</span>
      <span className="ktc-rc-stat-value">{value}</span>
      {sub && <span className="ktc-rc-stat-sub">{sub}</span>}
    </div>
  );
}

function rankLabel(position, rank) {
  if (!position || rank == null) return '—';
  return `${position}${rank}`;
}

export function buildRedraftAdjustmentBreakdown(row, lookupMap) {
  if (!row || !lookupMap) return null;

  const {
    position, adpPosRank, adpEffRank, ktcValue, value, redraftValueIndex,
  } = row;
  if (!position || adpPosRank == null || ktcValue == null) {
    return null;
  }

  const effRank = adpEffRank ?? adpPosRank;
  const interp = interpolateRedraftLookup(lookupMap, position, effRank);
  if (!interp || interp.interpolated == null) return null;

  const adjustedValue = value ?? Math.round(interp.interpolated);
  const index = redraftValueIndex ?? (adjustedValue / ktcValue);
  const rebuilder = computeRebuilderAdjusted(
    { ...row, value: adjustedValue },
    lookupMap,
  );

  return {
    row,
    adpSlot: rankLabel(position, adpPosRank),
    effSlot: `${position}${effRank.toFixed(2)}`,
    ktcSlot: rankLabel(position, row.ktcPosRank),
    interp,
    ktcValue,
    adjustedValue,
    vsDynasty: adjustedValue - ktcValue,
    redraftValueIndex: index,
    rebuilder,
  };
}

function RedraftAdjustmentPanel({ row, lookupMap }) {
  const breakdown = useMemo(
    () => buildRedraftAdjustmentBreakdown(row, lookupMap),
    [row, lookupMap],
  );

  if (!row) {
    return (
      <aside className="ktc-rc-panel rv-redraft-panel">
        <h3 className="ktc-rc-panel-title">Rank lookup math</h3>
        <p className="ktc-rc-panel-empty">Select a player from the list.</p>
      </aside>
    );
  }

  if (!breakdown) {
    const message = lookupMap == null
      ? 'Loading rank lookup data…'
      : 'Rank lookup data unavailable for this player.';
    return (
      <aside className="ktc-rc-panel rv-redraft-panel">
        <h3 className="ktc-rc-panel-title">Rank lookup math</h3>
        <p className="ktc-rc-panel-empty">{message}</p>
      </aside>
    );
  }

  const {
    adpSlot,
    effSlot,
    interp,
    ktcValue,
    adjustedValue,
    vsDynasty,
    redraftValueIndex,
    rebuilder,
  } = breakdown;

  const betterSlot = rankLabel(row.position, interp.rankLow);
  const worseSlot = rankLabel(row.position, interp.rankHigh);

  const interpolationSub = interp.rankLow === interp.rankHigh
    ? 'Integer rank — no interpolation'
    : `${worseSlot} lookup + ${fmtPct(interp.frac)} × (${betterSlot} − ${worseSlot}) lookup`;

  return (
    <aside className="ktc-rc-panel rv-redraft-panel">
      <h3 className="ktc-rc-panel-title">Rank lookup math</h3>
      <div className="ktc-rc-panel-body">
        <div className="ktc-rc-player-head">
          <span className="ktc-rc-player-name">{row.name}</span>
          <PositionBadge position={row.position} />
        </div>

        <StatBlock
          label="Pos ADP (integer stack rank)"
          value={adpSlot}
        />
        <StatBlock
          label="Adjusted Pos ADP (ApproachB peer exchange)"
          value={effSlot}
          sub="Skews toward peers with similar OVR avg ADP"
        />

        <StatBlock
          label="Year-weighted historical avg"
          value={formatKtcValue(
            interp.rankLow === interp.rankHigh
              ? interp.weightedLow
              : (interp.weightedLow != null && interp.weightedHigh != null
                ? interp.weightedLow + interp.frac * (interp.weightedHigh - interp.weightedLow)
                : null),
          )}
          sub="2021 13% · 2022 17% · 2023 20% · 2024 23.5% · 2025 26.5%"
        />

        {interp.rankLow !== interp.rankHigh ? (
          <>
            <StatBlock
              label={`At ${betterSlot}: 65% hist + 35% current`}
              value={formatKtcValue(interp.blendedLow)}
              sub={`Hist ${formatKtcValue(interp.weightedLow)} · Current ${formatKtcValue(interp.currentLow)}`}
            />
            <StatBlock
              label={`At ${worseSlot}: 65% hist + 35% current`}
              value={formatKtcValue(interp.blendedHigh)}
              sub={`Hist ${formatKtcValue(interp.weightedHigh)} · Current ${formatKtcValue(interp.currentHigh)}`}
            />
          </>
        ) : (
          <StatBlock
            label={`Rank-slot lookup at ${betterSlot}`}
            value={formatKtcValue(interp.blendedLow)}
            sub={`65% year-weighted hist + 35% current ${betterSlot} KTC`}
          />
        )}

        <StatBlock
          label={`Lookup value at ${effSlot}`}
          value={formatKtcValue(interp.interpolated)}
          sub={interpolationSub}
        />

        <StatBlock
          label="Dynasty KTC value (this player)"
          value={formatKtcValue(ktcValue)}
        />

        <StatBlock
          label="Competitor adjusted value"
          value={formatKtcValue(adjustedValue)}
          sub="Rounded lookup at adjusted Pos ADP"
        />

        <StatBlock
          label="Change vs dynasty"
          value={fmtSigned(vsDynasty)}
        />

        <StatBlock
          label="Redraft Value Index"
          value={`${redraftValueIndex.toFixed(2)}×`}
          sub="Competitor adjusted ÷ dynasty value"
        />

        {rebuilder && (
          <>
            <StatBlock
              label={`Lookup at ${breakdown.ktcSlot} (dynasty rank slot)`}
              value={formatKtcValue(rebuilder.histAtKtcValue)}
            />
            <StatBlock
              label="KTC vs ADP rank gap"
              value={rebuilder.rankGap.toFixed(2)}
              sub={`Adjusted ADP − KTC rank · γ scale ${REBUILD_GAP_SCALE}`}
            />
            <StatBlock
              label="Dynasty premium retention (γ)"
              value={fmtPct(rebuilder.gamma)}
              sub={`1 ÷ (1 + (max(0, gap) ÷ ${REBUILD_GAP_SCALE})²)`}
            />
            <StatBlock
              label="Rebuild core"
              value={formatKtcValue(Math.round(rebuilder.rebuildCore))}
              sub={`Hist@${breakdown.ktcSlot} + γ × (dynasty − hist)`}
            />
            <StatBlock
              label={`Damped redraft flip (−${(REBUILD_BETA * 100).toFixed(0)}% × Δ)`}
              value={fmtSigned(-Math.round(rebuilder.dampedFlip))}
              sub={`Δ = competitor adjusted − dynasty (${fmtSigned(rebuilder.redraftDelta)})`}
            />
            <StatBlock
              label="Rebuilder adjusted value"
              value={formatKtcValue(
                row.rebuilderAdjustedValue ?? rebuilder.rebuilderAdjustedValue,
              )}
              sub="Rebuild core − β × redraft delta"
            />
            <StatBlock
              label="Rebuild Value Index"
              value={`${(row.rebuildValueIndex ?? rebuilder.rebuildValueIndex ?? 0).toFixed(2)}×`}
              sub="Rebuilder adjusted ÷ dynasty value"
            />
          </>
        )}
      </div>
    </aside>
  );
}

export default RedraftAdjustmentPanel;
