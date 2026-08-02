import React, { useMemo } from 'react';
import PositionBadge from '../PositionBadge';
import { formatKtcValue } from '../lookups/KtcLookup';
import { interpolateRedraftLookup } from './redraftRankLookupLoader';
import {
  COMP_KTC_PREMIUM_RETENTION,
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

  const compCurveValue = interp.interpolatedComp ?? interp.interpolated;

  // Own-KTC premium retention: part of (KTC value − blended lookup at KTC rank).
  let retainedPremium = null;
  if (row.ktcPosRank != null) {
    const slotAtKtc = interpolateRedraftLookup(lookupMap, position, row.ktcPosRank);
    if (slotAtKtc && slotAtKtc.interpolated != null) {
      retainedPremium = COMP_KTC_PREMIUM_RETENTION * (ktcValue - slotAtKtc.interpolated);
    }
  }

  const computedValue = Math.round(compCurveValue + (retainedPremium ?? 0));
  const adjustedValue = value ?? computedValue;
  const index = redraftValueIndex ?? (adjustedValue / ktcValue);
  // Rebuild math mirrors the backend: it runs on the undecayed competitor
  // value (blended lookup + retained premium), not the published decayed one.
  const undecayedComp = Math.max(
    0,
    Math.round(interp.interpolated + (retainedPremium ?? 0)),
  );
  const rebuilder = computeRebuilderAdjusted(
    { ...row, value: undecayedComp },
    lookupMap,
  );

  return {
    row,
    adpSlot: rankLabel(position, adpPosRank),
    effSlot: `${position}${effRank.toFixed(2)}`,
    ktcSlot: rankLabel(position, row.ktcPosRank),
    interp,
    compCurveValue,
    retainedPremium,
    ktcValue,
    adjustedValue,
    vsDynasty: adjustedValue - ktcValue,
    redraftValueIndex: index,
    rebuilder,
  };
}

function RedraftAdjustmentPanel({
  row,
  lookupMap,
  usesHwangAdp = false,
  lookupBlend = { histWeight: 0.4, seasonWeight: 0.6, seasonLabel: 'Current KTC' },
}) {
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
    compCurveValue,
    retainedPremium,
    ktcValue,
    adjustedValue,
    vsDynasty,
    redraftValueIndex,
    rebuilder,
  } = breakdown;

  const hasTailDecay = compCurveValue != null
    && interp.interpolated != null
    && Math.abs(compCurveValue - interp.interpolated) >= 1;

  const histPct = Math.round(lookupBlend.histWeight * 100);
  const seasonPct = Math.round(lookupBlend.seasonWeight * 100);
  const seasonLabel = lookupBlend.seasonLabel || 'Current KTC';
  const blendLabel = `${histPct}% hist + ${seasonPct}% ${seasonLabel.toLowerCase()}`;

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
          label="Adjusted Pos ADP (ApproachH OVR-ADP geometry)"
          value={effSlot}
          sub="Stack rank + λ × (OVR-ADP-implied rank − stack); λ=0.40"
        />
        {usesHwangAdp && row.bbAvgAdp != null && (
          <StatBlock
            label="Best Ball ADP (raw input)"
            value={row.bbAvgAdp.toFixed(1)}
          />
        )}
        {usesHwangAdp && row.adpAvg != null && (
          <StatBlock
            label="Hwang ADP (scoring-adjusted input)"
            value={row.adpAvg.toFixed(1)}
            sub={
              row.bbAvgAdp != null && row.adpAvg !== row.bbAvgAdp
                ? `Half→std RB/WR correction: ${row.bbAvgAdp.toFixed(1)} → ${row.adpAvg.toFixed(1)}`
                : 'No half→std positional shift for this player'
            }
          />
        )}

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
              label={`At ${betterSlot}: ${blendLabel}`}
              value={formatKtcValue(interp.blendedLow)}
              sub={`Hist ${formatKtcValue(interp.weightedLow)} · ${seasonLabel} ${formatKtcValue(interp.currentLow)}`}
            />
            <StatBlock
              label={`At ${worseSlot}: ${blendLabel}`}
              value={formatKtcValue(interp.blendedHigh)}
              sub={`Hist ${formatKtcValue(interp.weightedHigh)} · ${seasonLabel} ${formatKtcValue(interp.currentHigh)}`}
            />
          </>
        ) : (
          <StatBlock
            label={`Rank-slot lookup at ${betterSlot}`}
            value={formatKtcValue(interp.blendedLow)}
            sub={`${blendLabel} at ${betterSlot}`}
          />
        )}

        <StatBlock
          label={`Lookup value at ${effSlot}`}
          value={formatKtcValue(interp.interpolated)}
          sub={interpolationSub}
        />

        {hasTailDecay && (
          <StatBlock
            label={`Competitor curve at ${effSlot} (tail decay)`}
            value={formatKtcValue(compCurveValue)}
            sub="Blended lookup decayed toward replacement past the overall top-100 slots"
          />
        )}

        <StatBlock
          label="Dynasty KTC value (this player)"
          value={formatKtcValue(ktcValue)}
        />

        {retainedPremium != null && (
          <StatBlock
            label={`Own-KTC premium retained (${Math.round(COMP_KTC_PREMIUM_RETENTION * 100)}%)`}
            value={fmtSigned(retainedPremium)}
            sub={`${Math.round(COMP_KTC_PREMIUM_RETENTION * 100)}% × (KTC value − lookup at ${breakdown.ktcSlot})`}
          />
        )}

        <StatBlock
          label="Competitor adjusted value"
          value={formatKtcValue(adjustedValue)}
          sub="Competitor curve at adjusted Pos ADP + retained own-KTC premium"
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
              label={`Damped redraft flip (−${(rebuilder.flipBeta * 100).toFixed(0)}% × Δ)`}
              value={fmtSigned(-Math.round(rebuilder.dampedFlip))}
              sub={`Δ = undecayed competitor value − dynasty (${fmtSigned(rebuilder.redraftDelta)}) · β↑ on gains (+depth boost on severe tax), β↓+ on cuts`}
            />
            <StatBlock
              label="Rebuilder adjusted value"
              value={formatKtcValue(
                row.rebuilderAdjustedValue ?? rebuilder.rebuilderAdjustedValue,
              )}
              sub="Rebuild core − β_eff × redraft delta"
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
