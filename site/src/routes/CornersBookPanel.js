/**
 * Corners book tab — FanDuel Premier League totals, next 5/10 min, stoppage.
 */

import React, { useEffect, useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import {
  arbKindLabel,
  assessArbFill,
  baselineBookLabel,
  evaluateGameCorners,
  formatAmericanOdds,
  formatEdgePct,
  formatExpected,
  formatSharePct,
  breakevenStoppageForBet,
  TYPICAL_FT_STOPPAGE_MIN,
  TYPICAL_HT_STOPPAGE_MIN,
} from '../corners/cornerModel';
import { computeKellyStake, formatKellyFractionLabel, formatKellyStake } from '../sop/sopModel';
import { DEFAULT_KELLY_FRACTION, MIN_KELLY_FRACTION, useSOPKellySettings } from '../sop/useSOPKellySettings';

const REFRESH_MS = 60_000;
const TEAM_SEARCH_LIST_ID = 'corners-book-team-search';
const BUCKETED_KEY = 'corners-bucketed';
const SHOW_WORK_KEY = 'corners-show-work';
const DK_BOTH_SIZE_KEY = 'corners-dk-both-size';
const DEFAULT_DK_BOTH_SIZE = '100';

function readFlag(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    if (v == null) return fallback;
    return v === '1' || v === 'true';
  } catch {
    return fallback;
  }
}

function writeFlag(key, value) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function formatKickoff(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatMatchStatus(status) {
  if (!status) return null;
  return String(status).replace(/_/g, ' ');
}

function gameMatchesQuery(game, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const parts = [
    game.name,
    game.teams?.home,
    game.teams?.away,
    ...(String(game.name ?? '').split(/\s+v\s+/i)),
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  return parts.some((part) => part.includes(q));
}

function collectTeamNames(games) {
  const names = new Set();
  for (const game of games) {
    if (game.teams?.home) names.add(game.teams.home);
    if (game.teams?.away) names.add(game.teams.away);
    for (const part of String(game.name ?? '').split(/\s+v\s+/i)) {
      const trimmed = part.trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function Toggle({ label, checked, onChange, hint, compact }) {
  return (
    <label className={`sop-kelly-toggle${compact ? ' corners-toggle--compact' : ''}`} title={hint}>
      <span className="sop-kelly-toggle-label">{label}</span>
      <span className="sop-kelly-switch">
        <input
          type="checkbox"
          className="sop-kelly-switch-input"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="sop-kelly-switch-track" aria-hidden="true">
          <span className="sop-kelly-switch-thumb" />
        </span>
      </span>
    </label>
  );
}

function kellyStakeForBet(bet, kellyEnabled, kellyBudget, kellyFraction) {
  if (!kellyEnabled || bet?.baseline || !bet?.profitable) return null;
  if (isDkBoth(bet)) {
    let total = 0;
    let any = false;
    for (const leg of bet.meta?.legs ?? []) {
      const stake = computeKellyStake({
        winProb: leg.pModel ?? bet.pModel,
        offeredAmerican: leg.american,
        bankroll: kellyBudget,
        kellyFraction,
      });
      if (stake == null) continue;
      total += stake;
      any = true;
    }
    return any ? total : null;
  }
  if (bet.pModel == null || bet.american == null) return null;
  return computeKellyStake({
    winProb: bet.pModel,
    offeredAmerican: bet.american,
    bankroll: kellyBudget,
    kellyFraction,
  });
}

function bookShort(book) {
  if (book === 'klsh') return 'KLSH';
  if (book === 'dk') return 'DK';
  return 'FD';
}

function formatArbRoi(roi) {
  if (!Number.isFinite(roi)) return '—';
  return formatEdgePct(roi * 100);
}

function arbLegPercents(legs) {
  const raw = (legs ?? []).map((leg) => Math.round((leg.share ?? 0) * 100));
  if (!raw.length) return [];
  const drift = raw.reduce((s, n) => s + n, 0) - 100;
  raw[raw.length - 1] -= drift;
  return raw;
}

function formatKalshiDecimal(decimal) {
  if (!Number.isFinite(decimal) || decimal <= 0) return null;
  return `${decimal.toFixed(2)}x`;
}

function formatAskBook(leg) {
  if (leg?.book !== 'klsh') return null;
  if (Number.isFinite(leg.askDollars)) {
    const cts = Number.isFinite(leg.askContracts) ? `${Math.round(leg.askContracts)} cts` : null;
    return cts ? `${formatSplitStake(leg.askDollars)} · ${cts}` : formatSplitStake(leg.askDollars);
  }
  return null;
}

function arbKindChip(kind) {
  if (kind === '3way') return '3-way';
  if (kind === 'uu' || kind === 'oo') return 'H+A';
  return null;
}

function pickHeadlineArb(arbs, sizeInput) {
  const list = arbs ?? [];
  if (!list.length) return null;
  const total = parseStakeInput(sizeInput);
  const ranked = list.map((arb) => ({ arb, fill: assessArbFill(arb, total) }));
  ranked.sort((a, b) => {
    const aLock = Boolean(a.fill?.allFilled && a.fill.roi >= 0.001);
    const bLock = Boolean(b.fill?.allFilled && b.fill.roi >= 0.001);
    if (aLock !== bLock) return aLock ? -1 : 1;
    const aRoi = aLock ? a.fill.roi : a.arb.roi;
    const bRoi = bLock ? b.fill.roi : b.arb.roi;
    return (bRoi ?? -1) - (aRoi ?? -1);
  });
  return ranked[0];
}

function TotalArbChip({ arb, extraCount, selected, onSelect, sizeInput }) {
  const legs = arb.legs ?? [arb.over, arb.under].filter(Boolean);
  const percents = arbLegPercents(legs);
  const fill = assessArbFill(arb, parseStakeInput(sizeInput));
  const sized = fill ?? sizeArbLegs(legs, parseStakeInput(sizeInput));
  const takeable = Boolean(fill?.allFilled && fill.roi >= 0.001);
  const thin = !takeable;
  const shownRoi = takeable ? fill.roi : arb.roi;
  const kindLabel = arbKindLabel(arb.kind);
  const title = [
    `${kindLabel}: ${legs.map((leg) => leg.label).join(' + ')}`,
    thin
      ? `printed ${formatArbRoi(arb.roi)} but Kalshi has no size at that price`
      : `implied ${((fill?.pSum ?? arb.pSum) * 100).toFixed(1)}% · lock ${formatArbRoi(shownRoi)}`,
    extraCount > 0 ? `${extraCount} more cover${extraCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className={`corners-arb-chip${selected ? ' corners-arb-chip--selected' : ''}${thin ? ' corners-arb-chip--thin' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(arb.id);
      }}
      aria-pressed={selected}
      title={title}
    >
      <span className="corners-arb-kicker">
        {thin ? 'THIN BOOK' : `ARB ${formatArbRoi(shownRoi)}`}{arbKindChip(arb.kind) ? ` · ${arbKindChip(arb.kind)}` : ''}
      </span>
      {legs.map((leg, i) => {
        const row = fill?.rows?.[i];
        const walked = row?.book === 'klsh' && row.fill && !row.fill.filled;
        const vwap = row?.book === 'klsh' && row.fill?.filled && row.fillAmerican !== leg.american
          ? formatKalshiDecimal(row.fill.decimal)
          : null;
        const book = formatAskBook(leg);
        return (
          <span key={`${leg.book}-${leg.side}-${leg.line}`} className="corners-arb-leg">
            {leg.label} {formatAmericanOdds(leg.american)}
            {sized ? ` · ${formatSplitStake(sized.rows[i].amount)}` : ''}
            {walked && book ? ` · book ${book}` : ''}
            {vwap ? ` · vw ${vwap}` : ''}
          </span>
        );
      })}
      <span className="corners-arb-split">
        {thin
          ? (fill && !fill.allFilled
            ? 'no size'
            : `print ${formatArbRoi(arb.roi)}`)
          : sized
            ? `lock ${formatSplitStake(sized.lockProfit)}`
            : percents.join('/')}
        {extraCount > 0 ? ` · +${extraCount}` : ''}
      </span>
    </button>
  );
}

function BaselineBookButton({ row, selected, onSelect }) {
  const short = bookShort(row.book);
  const className = [
    'corners-baseline-book',
    `corners-baseline-book--${row.book}`,
    selected ? 'corners-baseline-book--selected' : '',
  ].filter(Boolean).join(' ');
  const title = selected
    ? `${baselineBookLabel(row.book)} is the expected-total baseline`
    : `Use ${baselineBookLabel(row.book)} as the expected-total baseline`;

  return (
    <button
      type="button"
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(row.book);
      }}
      aria-pressed={selected}
      title={title}
    >
      <span className={`sop-exp-book-label sop-exp-book-label--${row.book}`}>{short}</span>
      {row.kind === 'plus' ? (
        <>
          <span className="corners-bet-label">{row.n}+</span>
          <span className="corners-bet-odds">{formatAmericanOdds(row.american)}</span>
          {Number.isFinite(row.yesAskDollars) && (
            <span className="corners-bet-need">
              {formatSplitStake(row.yesAskDollars)}
              {Number.isFinite(row.yesAskSize) ? ` · ${Math.round(row.yesAskSize)} cts` : ''}
            </span>
          )}
        </>
      ) : (
        <>
          <span className="corners-bet-label">O/U {row.line}</span>
          <span className="corners-baseline-odds">
            {row.over?.american != null ? formatAmericanOdds(row.over.american) : '—'}
            {' / '}
            {row.under?.american != null ? formatAmericanOdds(row.under.american) : '—'}
          </span>
        </>
      )}
      {selected && <span className="corners-bet-tag">line</span>}
    </button>
  );
}

function formatNeedOdds(fairAmerican) {
  if (!Number.isFinite(fairAmerican)) return null;
  return `need ${formatAmericanOdds(Math.round(fairAmerican))}`;
}

function BetButton({ bet, selected, onSelect, kellyEnabled, kellyBudget, kellyFraction }) {
  const hasOdds = bet.american != null;
  const baseline = Boolean(bet.baseline);
  const profitable = !baseline && Boolean(bet.profitable);
  const edge = baseline ? null : bet.analysis?.edgePoints;
  const book = bet.meta?.book;
  const needOdds = !baseline && !profitable && !bet.meta?.quoteOnly
    ? formatNeedOdds(bet.fairAmerican)
    : null;
  const kellyStake = kellyStakeForBet(bet, kellyEnabled, kellyBudget, kellyFraction);
  const className = [
    'corners-bet',
    profitable ? 'corners-bet--ev' : '',
    selected ? 'corners-bet--selected' : '',
    baseline ? 'corners-bet--baseline' : '',
    book === 'dk' ? 'corners-bet--dk' : '',
    book === 'klsh' ? 'corners-bet--klsh' : '',
    !hasOdds ? 'corners-bet--empty' : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={className}
      title="Show my work"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(bet.id);
      }}
      aria-pressed={selected}
    >
      <span className="corners-bet-label">{bet.label}</span>
      <span className="corners-bet-odds">
        {hasOdds ? formatAmericanOdds(bet.american) : '—'}
      </span>
      {baseline && (
        <span className="corners-bet-tag">line</span>
      )}
      {book && !baseline && (
        <span className={`corners-bet-tag corners-bet-tag--${book}`}>
          {book === 'klsh' ? 'KLSH' : book.toUpperCase()}
        </span>
      )}
      {profitable && edge != null && (
        <span className="sop-exp-edge-plus">
          {formatEdgePct(edge)}
        </span>
      )}
      {needOdds && (
        <span className="corners-bet-need">{needOdds}</span>
      )}
      {kellyEnabled && kellyStake != null && (
        <span
          className="sop-kelly-stake"
          title={`${formatKellyFractionLabel(kellyFraction)} stake`}
        >
          Kelly Bet Size: {formatKellyStake(kellyStake)}
        </span>
      )}
    </button>
  );
}

function isDkBoth(bet) {
  return bet?.kind === 'dk-both-yes' || bet?.kind === 'dk-both-no';
}

function readDkBothSizeInput() {
  try {
    const value = window.sessionStorage.getItem(DK_BOTH_SIZE_KEY);
    if (value != null && String(value).trim() !== '') return value;
  } catch {
    /* ignore */
  }
  return DEFAULT_DK_BOTH_SIZE;
}

function persistDkBothSizeInput(value) {
  try {
    window.sessionStorage.setItem(DK_BOTH_SIZE_KEY, value);
  } catch {
    /* ignore */
  }
}

function parseStakeInput(value) {
  const parsed = Number(String(value ?? '').replace(/[,$]/g, '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatSplitStake(amount) {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return '—';
  const cents = Math.round(amount * 100);
  if (cents % 100 === 0) return `$${(cents / 100).toLocaleString('en-US')}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function splitStakeByShares(legs, total) {
  if (!Number.isFinite(total) || total <= 0 || !legs?.length) return null;
  const shares = legs.map((leg) => (Number.isFinite(leg.share) ? leg.share : 0));
  const sum = shares.reduce((acc, share) => acc + share, 0);
  if (sum <= 0) return null;
  const rounded = shares.map((share) => Math.round((share / sum) * total * 100));
  const target = Math.round(total * 100);
  rounded[rounded.length - 1] += target - rounded.reduce((acc, cents) => acc + cents, 0);
  return legs.map((leg, i) => ({
    ...leg,
    key: leg.key ?? `${leg.book ?? ''}-${leg.side ?? ''}-${leg.line ?? i}`,
    team: leg.team,
    label: leg.label ?? leg.team ?? `Leg ${i + 1}`,
    amount: rounded[i] / 100,
    share: shares[i] / sum,
  }));
}

function sizeArbLegs(legs, total) {
  const split = splitStakeByShares(legs, total);
  if (!split) return null;
  const rows = split.map((row) => {
    const implied = Number(row.implied);
    const payout = implied > 0 ? row.amount / implied : 0;
    return {
      ...row,
      payout,
      profit: payout - total,
    };
  });
  const lockPayout = Math.min(...rows.map((row) => row.payout));
  return {
    rows,
    total,
    lockPayout,
    lockProfit: lockPayout - total,
  };
}

function StakeSplitAllocator({
  legs,
  sizeInput,
  onSizeInputChange,
  ariaLabel = 'Total stake to split',
  footer = null,
}) {
  const split = splitStakeByShares(legs, parseStakeInput(sizeInput));
  return (
    <div className="corners-split-size">
      <label className="corners-split-size-field">
        <span className="sop-kelly-budget-label">Size</span>
        <span className="sop-kelly-budget-wrap corners-split-size-wrap">
          <span className="sop-kelly-budget-prefix" aria-hidden="true">$</span>
          <input
            type="text"
            inputMode="decimal"
            className="sop-kelly-budget-input corners-split-size-input"
            value={sizeInput}
            onChange={(e) => onSizeInputChange(e.target.value)}
            placeholder={DEFAULT_DK_BOTH_SIZE}
            autoComplete="off"
            aria-label={ariaLabel}
          />
        </span>
      </label>
      {split ? (
        <div className="corners-split-size-legs" aria-live="polite">
          {split.map((leg) => (
            <span key={leg.key} className="corners-split-size-leg">
              {formatSplitStake(leg.amount)}
              {' '}
              <span className="corners-split-size-team">{leg.label}</span>
            </span>
          ))}
          {footer}
        </div>
      ) : (
        <p className="corners-split-size-hint">Enter a size to split</p>
      )}
    </div>
  );
}

function dkBothEventLabel(bet) {
  return bet?.kind === 'dk-both-no' ? 'team blank' : 'team 1+';
}

function dkBothVerdict(bet) {
  const noSide = bet.kind === 'dk-both-no';
  if (bet.profitable) {
    return noSide
      ? 'Both No is +EV as two bets — neither-corners is extra, not required'
      : 'Both Yes is +EV as two bets — both-corner is extra, not required';
  }
  return noSide
    ? 'The two No prices are worse than the two team-blank probs'
    : 'The two Yes prices are worse than the two team-1+ probs';
}

function formatDkBothOdds(bet) {
  const legs = bet.meta?.legs ?? [];
  if (legs.length >= 2 && legs[0].american != null && legs[1].american != null) {
    return `${formatAmericanOdds(legs[0].american)} / ${formatAmericanOdds(legs[1].american)}`;
  }
  if (bet.american != null) return formatAmericanOdds(bet.american);
  return '—';
}

function DkBothPackageButton({ bet, selected, onSelect, kellyEnabled, kellyBudget, kellyFraction }) {
  const profitable = Boolean(bet.profitable);
  const edge = bet.analysis?.edgePoints;
  const legs = bet.meta?.legs ?? [];
  const noSide = bet.kind === 'dk-both-no';
  const kellyStakes = kellyEnabled && profitable
    ? legs.map((leg) => computeKellyStake({
      winProb: leg.pModel ?? bet.pModel,
      offeredAmerican: leg.american,
      bankroll: kellyBudget,
      kellyFraction,
    }))
    : [];
  const className = [
    'corners-bet',
    'corners-bet--package',
    profitable ? 'corners-bet--ev' : '',
    selected ? 'corners-bet--selected' : '',
    'corners-bet--dk',
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={className}
      title="Show my work"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(bet.id);
      }}
      aria-pressed={selected}
    >
      <span className="corners-bet-label">{bet.label}</span>
      <span className="corners-bet-odds">
        {formatDkBothOdds(bet)}
      </span>
      <span className={`corners-bet-tag corners-bet-tag--dk${noSide ? ' corners-bet-tag--dk-no' : ''}`}>
        {noSide ? 'DK no' : 'DK both'}
      </span>
      {edge != null && (
        <span className={profitable ? 'sop-exp-edge-plus' : 'corners-bet-need'}>
          {formatEdgePct(edge)}
        </span>
      )}
      {legs.map((leg, i) => {
        const stake = kellyStakes[i];
        return (
          <span key={leg.team} className="corners-package-leg">
            {leg.team}
            {' · '}
            {stake != null
              ? formatKellyStake(stake)
              : `${Math.round((leg.share ?? 0) * 100)}%`}
          </span>
        );
      })}
    </button>
  );
}

function bucketLabel(id, kind) {
  if (kind === 'ht+' || id === '45+') return '45+ HT extra';
  if (kind === 'ft+' || id === '90+') return '90+ FT extra';
  return id;
}

function WindowSection({ title, packed, selectedId, onSelect, bucketed, kellyEnabled, kellyBudget, kellyFraction }) {
  const windowMarket = packed?.windowMarket;
  const win = packed?.win;
  const plus = windowMarket?.plus ?? [];
  const overUnder = windowMarket?.overUnder ?? [];
  const other = windowMarket?.other ?? [];
  const hasLines = plus.length + overUnder.length + other.length > 0;
  const bets = packed?.bets ?? [];
  const byLabel = new Map(bets.map((b) => [b.label, b]));

  const histPct = win ? formatSharePct(win.histWindowShare) : null;
  const uniPct = win ? formatSharePct(win.uniformWindowShare) : null;

  return (
    <section className="corners-window">
      <div className="sop-exp-section-label">
        {title}
        {windowMarket?.window && (
          <span className="corners-window-range"> {windowMarket.window}</span>
        )}
        {packed && Number.isFinite(packed.lambda) && (
          <span className="corners-window-lambda">
            E[win] {formatExpected(packed.lambda)}
          </span>
        )}
      </div>
      {histPct && (
        <p className="corners-bucket-share">
          This window is usually <strong>{histPct}</strong> of corners
          {' '}vs <strong>{uniPct}</strong> uniform
          {bucketed ? ' · using bucketed rates' : ' · using uniform per minute'}
        </p>
      )}
      {!hasLines && (
        <p className="corners-empty-hint">
          No Match Outcomes 5/10-min window on FanDuel Quick Bets yet.
        </p>
      )}
      {plus.length > 0 && (
        <div className="corners-plus-grid">
          {plus.map((row) => {
            const bet = byLabel.get(`${row.n}+`);
            if (!bet) return null;
            return (
              <BetButton
                key={bet.id}
                bet={bet}
                selected={selectedId === bet.id}
                onSelect={onSelect}
                kellyEnabled={kellyEnabled}
                kellyBudget={kellyBudget}
                kellyFraction={kellyFraction}
              />
            );
          })}
        </div>
      )}
      {overUnder.length > 0 && (
        <div className="corners-ou-row">
          {overUnder.map((row) => {
            const label = `${row.side === 'over' ? 'O' : 'U'} ${row.line}`;
            const bet = byLabel.get(label);
            if (!bet) return null;
            return (
              <BetButton
                key={bet.id}
                bet={bet}
                selected={selectedId === bet.id}
                onSelect={onSelect}
                kellyEnabled={kellyEnabled}
                kellyBudget={kellyBudget}
                kellyFraction={kellyFraction}
              />
            );
          })}
        </div>
      )}
      {other.length > 0 && bets.length === 0 && (
        <p className="corners-empty-hint">Non-total corner runners are not priced by the model.</p>
      )}
    </section>
  );
}

function ArbWorkPanel({ arb, extras, sizeInput, onSizeInputChange }) {
  const legs = arb.legs ?? [arb.over, arb.under].filter(Boolean);
  const percents = arbLegPercents(legs);
  const fill = assessArbFill(arb, parseStakeInput(sizeInput));
  const sized = fill ?? sizeArbLegs(legs, parseStakeInput(sizeInput));
  const takeable = Boolean(fill?.allFilled && fill.roi >= 0.001);
  const kindLabel = arbKindLabel(arb.kind);
  return (
    <div className="corners-work">
      <div className="corners-work-head corners-work-head--split">
        <div className="sop-exp-section-label">Show my work · {kindLabel}</div>
        <StakeSplitAllocator
          legs={legs}
          sizeInput={sizeInput}
          onSizeInputChange={onSizeInputChange}
          ariaLabel="Total exposure to split across arb books"
          footer={sized && takeable ? (
            <span className="corners-split-size-leg corners-split-size-lock">
              lock {formatSplitStake(sized.lockProfit)}
            </span>
          ) : null}
        />
      </div>
      <p className={`corners-work-verdict${takeable ? ' corners-work-verdict--ev' : ''}`}>
        {takeable
          ? `${kindLabel} · lock ${formatArbRoi(fill.roi)}`
          : `Printed ${formatArbRoi(arb.roi)} — not fillable at this size`}
        {takeable && sized ? ` · ${formatSplitStake(sized.lockProfit)} on ${formatSplitStake(sized.total)}` : ''}
      </p>
      <ul className="corners-work-list">
        {legs.map((leg, i) => {
          const row = fill?.rows?.[i];
          const book = formatAskBook(leg);
          const vwap = row?.fill?.decimal != null ? formatKalshiDecimal(row.fill.decimal) : null;
          return (
            <li key={`${leg.ticket ?? `${leg.book}-${leg.side}-${leg.line}-${i}`}`}>
              {leg.label}
              {' · '}{formatAmericanOdds(leg.american)}
              {row?.fillAmerican != null && row.fillAmerican !== leg.american
                && ` · fill ${formatAmericanOdds(row.fillAmerican)}${vwap ? ` / ${vwap}` : ''}`}
              {' · implied '}{formatSharePct(leg.implied)}
              {' · '}{percents[i]}% of stake
              {sized ? ` · bet ${formatSplitStake(sized.rows[i].amount)}` : ''}
              {takeable && sized ? ` · pays ${formatSplitStake(sized.rows[i].payout)}` : ''}
              {leg.book === 'klsh' && book ? ` · top ${book}` : ''}
              {row?.fill && !row.fill.filled && Number.isFinite(row.fill.spent)
                && ` · walks ${formatSplitStake(row.fill.spent)} then empty`}
              {leg.cover ? ` · ${leg.cover}` : ''}
              {!leg.cover && leg.side === 'under' && Number.isFinite(leg.line) && ` · total ≤ ${Math.floor(leg.line)}`}
              {!leg.cover && leg.side === 'over' && Number.isFinite(leg.line) && ` · total ≥ ${Math.floor(leg.line) + 1}`}
              {leg.side === 'exact' && ` · total = ${leg.n ?? arb.line}`}
            </li>
          );
        })}
        <li>
          Combined implied {formatSharePct(arb.pSum)}
          {takeable
            ? ` < 100% · guaranteed ${formatArbRoi(fill.roi)}`
            : ` printed lock ${formatArbRoi(arb.roi)} — Kalshi size does not hold`}
          {` · ${kindLabel} (one ticket wins)`}
          {takeable && sized ? ` · lock ${formatSplitStake(sized.lockProfit)}` : ''}
        </li>
      </ul>
      {extras.length > 0 && (
        <>
          <div className="corners-work-sub">Other covers</div>
          <ul className="corners-work-list">
            {extras.map((row) => (
              <li key={row.id}>
                {row.thin ? 'thin · ' : ''}{formatArbRoi(row.roi)}
                {row.kind !== '2way' ? ` · ${arbKindLabel(row.kind)}` : ''}
                {' · '}{(row.legs ?? []).map((leg) => (
                  `${leg.label} ${formatAmericanOdds(leg.american)}${formatAskBook(leg) ? ` (${formatAskBook(leg)})` : ''}`
                )).join(' / ')}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function WorkPanel({
  model,
  selectedId,
  kellyEnabled,
  kellyBudget,
  kellyFraction,
  sizeInput,
  onSizeInputChange,
}) {
  const arb = (model.totalArbs ?? []).find((row) => row.id === selectedId);
  if (arb) {
    return (
      <ArbWorkPanel
        arb={arb}
        extras={(model.totalArbs ?? []).filter((row) => row.id !== arb.id)}
        sizeInput={sizeInput}
        onSizeInputChange={onSizeInputChange}
      />
    );
  }
  const bet = model.bets.find((b) => b.id === selectedId);
  if (!bet) return null;
  const kellyStake = kellyStakeForBet(bet, kellyEnabled, kellyBudget, kellyFraction);
  const dkBothSplit = isDkBoth(bet)
    ? splitStakeByShares(bet.meta?.legs ?? [], parseStakeInput(sizeInput))
    : null;
  const h1Scope = bet.meta?.scope === 'h1' || bet.kind.startsWith('h1');
  const sourceRows = h1Scope ? model.h1Breakdown.rows : model.breakdown.rows;
  const futureRows = sourceRows.filter((r) => r.minutes > 0.02 && (!h1Scope || r.half === 1));
  const winBits = bet.kind.startsWith('next5')
    ? model.next5?.win?.bits
    : bet.kind.startsWith('next10')
      ? model.next10?.win?.bits
      : isDkBoth(bet)
        ? bet.meta?.bits
        : null;
  const lambdaWin = bet.meta?.lambda
    ?? (bet.kind.startsWith('next5') ? model.next5?.lambda : model.next10?.lambda);
  const need = bet.meta?.need;
  const implied = h1Scope ? model.halfImplied : model.fullImplied;
  const ourLambda = h1Scope ? model.ourH1Remaining : model.ourRemaining;
  const scale = model.ourRemaining > 0
    ? (model.lineRemaining ?? model.ourRemaining) / model.ourRemaining
    : 1;
  const beStoppage = breakevenStoppageForBet(model, bet);

  return (
    <div className="corners-work">
      <div className={`corners-work-head${isDkBoth(bet) ? ' corners-work-head--split' : ''}`}>
        <div className="sop-exp-section-label">Show my work · {bet.label}</div>
        {isDkBoth(bet) && (
          <StakeSplitAllocator
            legs={bet.meta?.legs ?? []}
            sizeInput={sizeInput}
            onSizeInputChange={onSizeInputChange}
            ariaLabel="Total stake to split across both teams"
          />
        )}
      </div>
      <p className={`corners-work-verdict${bet.profitable ? ' corners-work-verdict--ev' : ''}`}>
        {bet.baseline
          ? 'Game line · baseline, not a bet'
          : isDkBoth(bet)
            ? dkBothVerdict(bet)
            : bet.profitable
              ? 'Good bet'
              : 'No edge'}
        {!bet.baseline && !isDkBoth(bet) && bet.analysis?.edgePoints != null
          && ` · ${formatEdgePct(bet.analysis.edgePoints)} vs implied remaining`}
        {isDkBoth(bet) && bet.analysis?.edgePoints != null
          && ` · ${formatEdgePct(bet.analysis.edgePoints)} on the two bets`}
        {!bet.profitable && !bet.baseline && bet.fairAmerican != null
          && ` · need ${formatAmericanOdds(Math.round(bet.fairAmerican))}`}
      </p>
      {beStoppage?.label && (
        <p className="corners-work-be-stoppage">
          <strong>{beStoppage.label}</strong>
        </p>
      )}
      {kellyEnabled && kellyStake != null && (
        <p className="sop-kelly-stake corners-work-kelly">
          Kelly Bet Size: {formatKellyStake(kellyStake)}
          <span> · {formatKellyFractionLabel(kellyFraction)}</span>
        </p>
      )}
      <ul className="corners-work-list">
        <li>
          {h1Scope
            ? `FanDuel H1 ${implied?.line}`
            : implied?.kind === 'plus'
              ? `Kalshi ${implied.n}+`
              : `${baselineBookLabel(model.baselineBook)} total ${implied?.line}`}
          {implied && ` · vig-removed P(${implied.kind === 'plus' ? `${implied.n}+` : 'over'}) ${formatSharePct(implied.pOver)}`}
          {' → implies '}
          <strong>{formatExpected(implied?.impliedTotal)}</strong>
          {' total ('}
          {formatExpected(h1Scope ? (implied?.cornersSoFar ?? 0) : model.cornersSoFar, 0)} already
          {implied?.remaining != null && ` · ${formatExpected(implied.remaining)} more from the line`}
          )
        </li>
        {!bet.baseline && Number.isFinite(bet.meta?.fracOfRemaining) && (
          <li>
            This window is <strong>{formatSharePct(bet.meta.fracOfRemaining)}</strong> of remaining
            {' '}× line remaining {formatExpected(bet.meta.lineRemaining ?? model.lineRemaining)}
            {' → '}E[win] <strong>{formatExpected(lambdaWin)}</strong>
          </li>
        )}
        <li>
          Our remaining <strong>{formatExpected(ourLambda)}</strong>
          {' '}({model.mode}, kickoff mean {formatExpected(model.meanKickoff)})
          {Number.isFinite(need) && ` · need ${need} more for the over`}
        </li>
        <li>
          Stoppage · 1st half {stoppageHalfView(1, h1Scope ? model.h1Plan : model.plan, model.clock).display}
          {' · 2nd half '}{h1Scope ? 'ignored (H1 line)' : stoppageHalfView(2, model.plan, model.clock).display}
        </li>
        {isDkBoth(bet) && (bet.meta?.legs ?? []).length > 0 && (
          <li>
            Each team {dkBothEventLabel(bet)} is {formatSharePct(bet.pModel)} (even split of E[win] {formatExpected(bet.meta.lambda)}).
            {' '}Those are two bets. EV does not add the implieds into one event — it adds the two expected values.
            {(bet.meta.legs).map((leg) => (
              <span key={leg.team}>
                {' · '}{leg.team} {formatAmericanOdds(leg.american)}
                {' book '}{formatSharePct(leg.implied)}
                {' vs model '}{formatSharePct(leg.pModel ?? bet.pModel)}
              </span>
            ))}
          </li>
        )}
        {isDkBoth(bet) && Number.isFinite(bet.meta?.expectedTickets) && (
          <li>
            Model expects {formatExpected(bet.meta.expectedTickets)} winning tickets
            {' · books charge '}{formatExpected(bet.meta.ticketCost)}
            {' for $1 back if only one hits → '}{formatEdgePct(bet.analysis?.edgePoints)}
            {' on the combined stake. Split is only so a one-team hit pays the same'}
            {(bet.meta.legs).map((leg) => {
              const sized = dkBothSplit?.find((row) => row.team === leg.team);
              return (
                <span key={`split-${leg.team}`}>
                  {' · '}{leg.team}{' '}
                  {sized
                    ? formatSplitStake(sized.amount)
                    : `${Math.round((leg.share ?? 0) * 100)}%`}
                </span>
              );
            })}
            {kellyEnabled && kellyStake != null && (
              <>
                {' · Kelly '}
                {bet.meta.legs.map((leg) => {
                  const stake = computeKellyStake({
                    winProb: leg.pModel ?? bet.pModel,
                    offeredAmerican: leg.american,
                    bankroll: kellyBudget,
                    kellyFraction,
                  });
                  return `${leg.team} ${stake != null ? formatKellyStake(stake) : '—'}`;
                }).join(' / ')}
              </>
            )}
          </li>
        )}
        {!bet.baseline && !isDkBoth(bet) && (
          <li>
            Model P({bet.label}) {formatSharePct(bet.pModel)}
            {' · '}fair {bet.fairAmerican != null ? formatAmericanOdds(bet.fairAmerican) : '—'}
            {' · '}{bet.american != null ? formatAmericanOdds(bet.american) : '—'}
            {' · '}implied {formatSharePct(bet.pMarket)}
            {!bet.profitable && bet.fairAmerican != null && ` · need ${formatAmericanOdds(Math.round(bet.fairAmerican))}`}
          </li>
        )}
      </ul>
      {winBits?.length > 0 && (
        <>
          <div className="corners-work-sub">This window (incl. extra time)</div>
          <table className="corners-work-table">
            <thead>
              <tr>
                <th>Bucket</th>
                <th>Min left</th>
                <th>E[corners]</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {winBits.map((b) => (
                <tr key={b.id}>
                  <td>{bucketLabel(b.id, b.extra ? (b.id === '45+' ? 'ht+' : 'ft+') : 'regular')}</td>
                  <td>{formatExpected(b.minutes, 1)}</td>
                  <td>{formatExpected((b.expected ?? 0) * scale)}</td>
                  <td>{formatSharePct(b.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="corners-work-sub">Remaining buckets (incl. extra time)</div>
      <table className="corners-work-table">
        <thead>
          <tr>
            <th>Bucket</th>
            <th>Min left</th>
            <th>E[corners]</th>
            <th>P(≥1)</th>
            <th>Usual %</th>
          </tr>
        </thead>
        <tbody>
          {futureRows.map((r) => (
            <tr key={r.id}>
              <td>{bucketLabel(r.id, r.kind)}</td>
              <td>{formatExpected(r.minutes, 1)}</td>
              <td>{formatExpected((r.expected ?? 0) * scale)}</td>
              <td>{formatSharePct(1 - Math.exp(-((r.expected ?? 0) * scale)))}</td>
              <td>{formatSharePct(r.histShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatStoppageMinutes(minutes) {
  return Number.isFinite(minutes) ? `${minutes.toFixed(1)}′` : '—';
}

function stoppageHalfView(half, plan, clock) {
  const blend = half === 1 ? plan?.htBlend : plan?.ftBlend;
  const typical = half === 1 ? TYPICAL_HT_STOPPAGE_MIN : TYPICAL_FT_STOPPAGE_MIN;
  const label = half === 1 ? '1st half' : '2nd half';
  const finished = Boolean(
    clock?.finished
    || clock?.phase === 'post'
    || (half === 1 && (clock?.phase === 'ht' || clock?.period === 2)),
  );
  const active = Boolean(
    !finished
    && clock?.phase === 'live'
    && clock?.period === half,
  );
  if (finished) {
    return {
      half,
      label,
      display: 'done',
      detail: 'extra finished',
      active: false,
      done: true,
    };
  }
  const minutes = blend?.expected;
  const detail = active && blend && blend.future > 0.05
    ? `${blend.earned.toFixed(1)}′ earned + ${blend.future.toFixed(1)}′ still (${blend.regularLeft.toFixed(0)}′ of half)`
    : active && blend
      ? `${blend.remaining.toFixed(1)}′ left`
      : `typical ${typical.toFixed(1)}′`;
  return {
    half,
    label,
    display: formatStoppageMinutes(minutes),
    detail,
    active,
    done: false,
  };
}

function stoppageHeadline(stoppage, clock, plan) {
  if (!plan) return null;
  const ht = stoppageHalfView(1, plan, clock);
  const ft = stoppageHalfView(2, plan, clock);
  return `HT ${ht.display} · FT ${ft.display}`;
}

function GameCard({ game, bucketed, showWork, onEnableShowWork, kellyEnabled, kellyBudget, kellyFraction }) {
  const [expanded, setExpanded] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [baselineBook, setBaselineBook] = useState('fd');
  const [actionSizeInput, setActionSizeInput] = useState(readDkBothSizeInput);
  const setActionSize = (value) => {
    setActionSizeInput(value);
    persistDkBothSizeInput(value);
  };
  const model = useMemo(
    () => evaluateGameCorners(game, { bucketed, baselineBook }),
    [game, bucketed, baselineBook],
  );
  const stoppageText = stoppageHeadline(game.stoppage, model.clock, model.plan);
  const h1Bets = model.bets.filter((b) => b.kind === 'h1-over' || b.kind === 'h1-under');
  const dkBothBets = model.bets.filter(isDkBoth);
  const atHalf = Boolean(model.clock.halftime || game.stoppage?.halfTime);
  const stoppageHalves = [
    stoppageHalfView(1, model.plan, model.clock),
    stoppageHalfView(2, model.plan, model.clock),
  ];
  const baselines = model.baselines ?? [];
  const headlineArb = pickHeadlineArb(model.totalArbs, actionSizeInput);
  const activeBook = model.baselineBook;
  const baselineCopy = model.fullImplied?.kind === 'plus'
    ? `${baselineBookLabel(activeBook)} ${model.fullImplied.n}+`
    : `${baselineBookLabel(activeBook)} total ${model.baselineRow?.line ?? model.fullImplied?.line}`;

  const selectBet = (id) => {
    if (!showWork) onEnableShowWork?.();
    setSelectedId((cur) => (cur === id ? null : id));
  };

  useEffect(() => {
    setSelectedId(null);
    setBaselineBook('fd');
  }, [game.eventId]);

  return (
    <article className={`sop-exp-game${expanded ? ' sop-exp-game--open' : ''}`}>
      <header className="sop-exp-game-header">
        <button
          type="button"
          className="sop-exp-game-toggle"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
        >
          <span className="sop-exp-game-chevron" aria-hidden="true">
            {expanded ? '▼' : '▶'}
          </span>
          <span className="sop-exp-game-toggle-main">
            <span className="sop-exp-game-title">{game.name}</span>
            <span className="sop-exp-game-meta">
              {game.inPlay && <span className="sop-exp-live">LIVE</span>}
              <span className="sop-exp-score">{game.scoreDisplay ?? '0-0'}</span>
              {(atHalf || game.stoppage?.clock) && (
                <span className="corners-clock">{atHalf ? 'HT' : game.stoppage.clock}</span>
              )}
              {game.openDate && (
                <span className="sop-exp-time">{formatKickoff(game.openDate)}</span>
              )}
              {model.evCount > 0 && (
                <span className="sop-exp-ev-badge">{model.evCount} +EV</span>
              )}
              {!expanded && stoppageText && (
                <span className="corners-stoppage-chip">{stoppageText}</span>
              )}
            </span>
          </span>
        </button>
      </header>

      {expanded && (
        <div className="sop-exp-game-body">
          {game.error && <p className="sop-exp-error">{game.error}</p>}

          <section className="corners-implied">
            <div className="sop-exp-section-label">Expected corners from the line</div>
            <div className="corners-implied-main">
              {model.marketImpliedTotal != null ? (
                <>
                  <span className="corners-implied-lambda">
                    {formatExpected(model.marketImpliedTotal)}
                  </span>
                  <span className="corners-implied-copy">
                    {baselineCopy}
                    {model.baselineRow?.kind !== 'plus' && model.baselineRow?.over?.american != null && (
                      <> · Over {formatAmericanOdds(model.baselineRow.over.american)}</>
                    )}
                    {model.baselineRow?.kind !== 'plus' && model.baselineRow?.under?.american != null && (
                      <> / Under {formatAmericanOdds(model.baselineRow.under.american)}</>
                    )}
                    {model.baselineRow?.kind === 'plus' && model.baselineRow?.american != null && (
                      <> · {formatAmericanOdds(model.baselineRow.american)}</>
                    )}
                    {model.fullImplied && ` · P(over) ${formatSharePct(model.fullImplied.pOver)} vig-removed`}
                    {' · '}{formatExpected(model.cornersSoFar, 0)} already
                    {model.lineRemaining != null && ` · ${formatExpected(model.lineRemaining)} more from the line`}
                  </span>
                </>
              ) : (
                <p className="corners-empty-hint">No total corners line to invert.</p>
              )}
            </div>
            {model.halfImplied && (
              <p className="corners-implied-copy">
                H1 line {game.firstHalfTotal?.line} implies{' '}
                <strong>{formatExpected(model.halfImplied.impliedTotal)}</strong>
                {game.firstHalfTotal?.over?.american != null && (
                  <> · Over {formatAmericanOdds(game.firstHalfTotal.over.american)}</>
                )}
                {game.firstHalfTotal?.under?.american != null && (
                  <> / Under {formatAmericanOdds(game.firstHalfTotal.under.american)}</>
                )}
              </p>
            )}
            <p className="corners-implied-ours">
              Next 5/10 use the line remaining, split by {model.mode} timing
              {' · '}{formatExpected(model.breakdown.remainingMinutes, 1)} min left incl. extra time
            </p>
          </section>

          <section className="corners-total">
            <div className="sop-exp-section-label">Game line (baseline)</div>
            {baselines.length > 0 ? (
              <div className="corners-baseline-row">
                {baselines.map((row) => (
                  <BaselineBookButton
                    key={row.book}
                    row={row}
                    selected={activeBook === row.book}
                    onSelect={setBaselineBook}
                  />
                ))}
                {headlineArb && (
                  <TotalArbChip
                    arb={headlineArb.arb}
                    extraCount={Math.max(0, (model.totalArbs?.length ?? 0) - 1)}
                    selected={selectedId === headlineArb.arb.id}
                    onSelect={selectBet}
                    sizeInput={actionSizeInput}
                  />
                )}
              </div>
            ) : (
              <p className="corners-empty-hint">No total corners line on FanDuel, DraftKings, or Kalshi.</p>
            )}
          </section>

          {h1Bets.length > 0 && (
            <section className="corners-total">
              <div className="sop-exp-section-label">1st half line (baseline)</div>
              <div className="corners-ou-row">
                {h1Bets.map((bet) => (
                  <BetButton
                    key={bet.id}
                    bet={bet}
                    selected={selectedId === bet.id}
                    onSelect={selectBet}
                    kellyEnabled={kellyEnabled}
                    kellyBudget={kellyBudget}
                    kellyFraction={kellyFraction}
                  />
                ))}
              </div>
            </section>
          )}

          <WindowSection
            title="Next 5 min"
            packed={model.next5}
            selectedId={selectedId}
            onSelect={selectBet}
            bucketed={bucketed}
            kellyEnabled={kellyEnabled}
            kellyBudget={kellyBudget}
            kellyFraction={kellyFraction}
          />
          <WindowSection
            title="Next 10 min"
            packed={model.next10}
            selectedId={selectedId}
            onSelect={selectBet}
            bucketed={bucketed}
            kellyEnabled={kellyEnabled}
            kellyBudget={kellyBudget}
            kellyFraction={kellyFraction}
          />

          {dkBothBets.length > 0 && (
            <section className="corners-total">
              <div className="sop-exp-section-label">DraftKings both</div>
              <p className="corners-empty-hint">
                Yes on both teams, or No on both. Edge is the two bets added — whether they hit together does not change EV.
              </p>
              <div className="corners-plus-grid corners-plus-grid--packages">
                {dkBothBets.map((bet) => (
                  <DkBothPackageButton
                    key={bet.id}
                    bet={bet}
                    selected={selectedId === bet.id}
                    onSelect={selectBet}
                    kellyEnabled={kellyEnabled}
                    kellyBudget={kellyBudget}
                    kellyFraction={kellyFraction}
                  />
                ))}
              </div>
            </section>
          )}

          {selectedId && (
            <WorkPanel
              model={model}
              selectedId={selectedId}
              kellyEnabled={kellyEnabled}
              kellyBudget={kellyBudget}
              kellyFraction={kellyFraction}
              sizeInput={actionSizeInput}
              onSizeInputChange={setActionSize}
            />
          )}

          <section className="corners-stoppage">
            <div className="sop-exp-section-label">Expected stoppage</div>
            <div className="corners-stoppage-halves">
              {stoppageHalves.map((half) => {
                const liveHalf = half.active;
                return (
                  <div
                    key={half.half}
                    className={[
                      'corners-stoppage-card',
                      'corners-stoppage-half',
                      half.active ? 'corners-stoppage-half--active' : '',
                      half.done ? 'corners-stoppage-half--done' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <div className="corners-stoppage-half-label">{half.label}</div>
                    <div className="corners-stoppage-main">{half.display}</div>
                    <div className="corners-stoppage-meta">
                      {half.detail}
                      {liveHalf && game.stoppage?.matchStatus && ` · ${formatMatchStatus(game.stoppage.matchStatus)}`}
                      {liveHalf && game.stoppage?.clock && !atHalf && ` · ${game.stoppage.clock}`}
                      {liveHalf && game.stoppage?.announced && ` · announced ${game.stoppage.announced}`}
                      {liveHalf && game.stoppage?.played && ` · played ${game.stoppage.played}`}
                    </div>
                    {liveHalf && game.stoppage?.breakdownLabel && (
                      <p className="corners-empty-hint">{game.stoppage.breakdownLabel}</p>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="corners-empty-hint">
              {game.inPlay && !game.stoppage
                ? 'No ESPN play-by-play yet · extra is typical × time left in the current half'
                : 'Each half: delay already earned + typical extra × share of that half still left'}
            </p>
          </section>
        </div>
      )}
    </article>
  );
}

function CornersBookPanel({
  games,
  fetchedAt,
  error,
  notice,
  refreshing,
  loading = false,
  onRefresh,
}) {
  const [teamQuery, setTeamQuery] = useState('');
  const [bucketed, setBucketed] = useState(() => readFlag(BUCKETED_KEY, true));
  const [showWork, setShowWork] = useState(() => readFlag(SHOW_WORK_KEY, true));
  const {
    enabled: kellyEnabled,
    setEnabled: setKellyEnabled,
    budget: kellyBudget,
    budgetInput: kellyBudgetInput,
    setBudgetInput: setKellyBudgetInput,
    commitBudget: commitKellyBudget,
    kellyFraction,
    setKellyFraction,
  } = useSOPKellySettings();
  const teamNames = useMemo(() => collectTeamNames(games), [games]);
  const filteredGames = useMemo(() => {
    if (!teamQuery.trim()) return games;
    return games.filter((g) => gameMatchesQuery(g, teamQuery));
  }, [games, teamQuery]);

  const setBucketedPersist = (v) => {
    setBucketed(v);
    writeFlag(BUCKETED_KEY, v);
  };
  const setShowWorkPersist = (v) => {
    setShowWork(v);
    writeFlag(SHOW_WORK_KEY, v);
  };

  if (loading) {
    return (
      <LoadingState
        label="Loading Premier League corners…"
        ariaLabel="Loading Premier League corners"
        className="sop-book-loading"
      />
    );
  }

  return (
    <div className="sop-exp-content">
      <header className="sop-exp-header">
        <h1 className="sop-exp-title">PL Corners</h1>
        <p className="sop-exp-subtitle">
          Premier League · FanDuel + DraftKings + Kalshi
          {fetchedAt && (
            <span className="sop-exp-updated">
              {' '}
              · updated {new Date(fetchedAt).toLocaleTimeString()}
            </span>
          )}
        </p>
      </header>

      {notice && (
        <p className="sop-exp-dk-notice" role="status">
          {notice}
        </p>
      )}

      <section className="sop-book-settings corners-settings" aria-label="Corners model settings">
        <Toggle
          label="Bucketed timing"
          checked={bucketed}
          onChange={setBucketedPersist}
          hint="On: ESPN 5-minute histogram. Off: uniform per minute including typical stoppage."
        />
        <Toggle
          label="Show my work"
          checked={showWork}
          onChange={setShowWorkPersist}
          compact
          hint="Click a line to see remaining buckets, extra time, and the Poisson math."
        />
        <Toggle
          label="Show Kelly Criterion"
          checked={kellyEnabled}
          onChange={setKellyEnabled}
          hint="Stake size from model win probability vs FanDuel odds."
        />
        {kellyEnabled && (
          <>
            <label className="sop-kelly-budget">
              <span className="sop-kelly-budget-label">Budget</span>
              <span className="sop-kelly-budget-wrap">
                <span className="sop-kelly-budget-prefix" aria-hidden="true">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="sop-kelly-budget-input"
                  value={kellyBudgetInput}
                  onChange={(e) => setKellyBudgetInput(e.target.value)}
                  onBlur={(e) => commitKellyBudget(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitKellyBudget(e.currentTarget.value);
                      e.currentTarget.blur();
                    }
                  }}
                  autoComplete="off"
                />
              </span>
            </label>
            <div className="sop-kelly-fraction">
              <label className="sop-kelly-fraction-label" htmlFor="corners-kelly-fraction">
                Kelly sizing
              </label>
              <div className="sop-kelly-fraction-row">
                <input
                  id="corners-kelly-fraction"
                  type="range"
                  className="sop-kelly-fraction-slider"
                  min={MIN_KELLY_FRACTION}
                  max={DEFAULT_KELLY_FRACTION}
                  step={0.01}
                  value={kellyFraction}
                  onChange={(e) => setKellyFraction(Number(e.target.value))}
                />
                <span className="sop-kelly-fraction-value">{formatKellyFractionLabel(kellyFraction)}</span>
              </div>
            </div>
          </>
        )}
      </section>
      <p className="corners-bucket-legend">
        5-min slice is usually vs uniform on each window below.
        {' '}90+ is <strong>7.42%</strong> of corners vs <strong>4.89%</strong> uniform
        (4.8′ / 98.1′). HT extra is <strong>3.57%</strong> vs <strong>3.36%</strong>.
      </p>

      <div className="sop-exp-toolbar">
        <button
          type="button"
          className="sop-exp-refresh-btn"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh odds'}
        </button>
        <label className="sop-exp-search-wrap">
          <span className="sop-exp-search-label">Find game</span>
          <input
            type="search"
            className="sop-exp-search-input"
            list={TEAM_SEARCH_LIST_ID}
            value={teamQuery}
            onChange={(e) => setTeamQuery(e.target.value)}
            placeholder="Team name…"
            autoComplete="off"
          />
          <datalist id={TEAM_SEARCH_LIST_ID}>
            {teamNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
      </div>

      {teamQuery.trim() && (
        <p className="sop-exp-search-hint">
          {filteredGames.length} match{filteredGames.length === 1 ? '' : 'es'}
        </p>
      )}

      {error && <p className="sop-exp-error">{error}</p>}

      {!error && filteredGames.length > 0 && (
        <div className="sop-exp-games">
          {filteredGames.map((g) => (
            <GameCard
              key={g.eventId}
              game={g}
              bucketed={bucketed}
              showWork={showWork}
              onEnableShowWork={() => setShowWorkPersist(true)}
              kellyEnabled={kellyEnabled}
              kellyBudget={kellyBudget}
              kellyFraction={kellyFraction}
            />
          ))}
        </div>
      )}

      {!error && games.length > 0 && teamQuery.trim() && filteredGames.length === 0 && (
        <p className="sop-exp-status">No games match “{teamQuery.trim()}”.</p>
      )}

      {!error && games.length === 0 && (
        <p className="sop-exp-status">No Premier League games found on FanDuel.</p>
      )}

      <p className="sop-exp-footer">
        Auto-refreshes every {REFRESH_MS / 1000}s · 5/10-min corners are FanDuel Quick Bets
        Match Outcomes · stoppage estimated from ESPN play-by-play
      </p>
    </div>
  );
}

export default CornersBookPanel;
