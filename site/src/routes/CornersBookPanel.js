/**
 * Corners book tab — FanDuel Premier League totals, next 5/10 min, stoppage.
 */

import React, { useEffect, useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import {
  baselineBookLabel,
  evaluateGameCorners,
  formatAmericanOdds,
  formatEdgePct,
  formatExpected,
  formatSharePct,
} from '../corners/cornerModel';
import { computeKellyStake, formatKellyFractionLabel, formatKellyStake } from '../sop/sopModel';
import { DEFAULT_KELLY_FRACTION, MIN_KELLY_FRACTION, useSOPKellySettings } from '../sop/useSOPKellySettings';

const REFRESH_MS = 60_000;
const TEAM_SEARCH_LIST_ID = 'corners-book-team-search';
const BUCKETED_KEY = 'corners-bucketed';
const SHOW_WORK_KEY = 'corners-show-work';

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

function TotalArbChip({ arb, extraCount, selected, onSelect }) {
  const legs = arb.legs ?? [arb.over, arb.under].filter(Boolean);
  const split = arbLegPercents(legs);
  const threeWay = arb.kind === '3way';
  const title = [
    threeWay
      ? `Integer cover of ${arb.line}: ${legs.map((leg) => leg.label).join(' + ')}`
      : `Same-line 2-way: ${arb.overLabel} vs ${arb.underLabel}`,
    `implied ${((arb.pSum) * 100).toFixed(1)}% · lock ${formatArbRoi(arb.roi)}`,
    extraCount > 0 ? `${extraCount} more cover${extraCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className={`corners-arb-chip${selected ? ' corners-arb-chip--selected' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(arb.id);
      }}
      aria-pressed={selected}
      title={title}
    >
      <span className="corners-arb-kicker">
        ARB {formatArbRoi(arb.roi)}{threeWay ? ' · 3-way' : ''}
      </span>
      {legs.map((leg) => (
        <span key={`${leg.book}-${leg.side}-${leg.line}`} className="corners-arb-leg">
          {leg.label} {formatAmericanOdds(leg.american)}
        </span>
      ))}
      <span className="corners-arb-split">
        {split.join('/')}
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

function formatDkBothOdds(bet) {
  const legs = bet.meta?.legs ?? [];
  if (legs.length >= 2 && legs[0].american != null && legs[1].american != null) {
    return `${formatAmericanOdds(legs[0].american)} / ${formatAmericanOdds(legs[1].american)}`;
  }
  if (bet.american != null) return formatAmericanOdds(bet.american);
  return '—';
}

function DkBothYesButton({ bet, selected, onSelect, kellyEnabled, kellyBudget, kellyFraction }) {
  const profitable = Boolean(bet.profitable);
  const edge = bet.analysis?.edgePoints;
  const needOdds = !profitable ? formatNeedOdds(bet.fairAmerican) : null;
  const kellyStake = kellyStakeForBet(bet, kellyEnabled, kellyBudget, kellyFraction);
  const legs = bet.meta?.legs ?? [];
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
      <span className="corners-bet-tag corners-bet-tag--dk">DK both</span>
      {profitable && edge != null && (
        <span className="sop-exp-edge-plus">{formatEdgePct(edge)}</span>
      )}
      {needOdds && (
        <span className="corners-bet-need">{needOdds}</span>
      )}
      {legs.map((leg) => {
        const split = kellyStake != null
          ? formatKellyStake(kellyStake * (leg.share ?? 0))
          : `${Math.round((leg.share ?? 0) * 100)}%`;
        return (
          <span key={leg.team} className="corners-package-leg">
            {leg.team}
            {' · '}
            {kellyEnabled && kellyStake != null ? split : `${Math.round((leg.share ?? 0) * 100)}%`}
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

function ArbWorkPanel({ arb, extras }) {
  const legs = arb.legs ?? [arb.over, arb.under].filter(Boolean);
  const percents = arbLegPercents(legs);
  const threeWay = arb.kind === '3way';
  return (
    <div className="corners-work">
      <div className="sop-exp-section-label">Show my work · total corners arb</div>
      <p className="corners-work-verdict corners-work-verdict--ev">
        {threeWay
          ? `Integer ${arb.line} cover, different books · lock ${formatArbRoi(arb.roi)}`
          : `Same line, different books · lock ${formatArbRoi(arb.roi)}`}
      </p>
      <ul className="corners-work-list">
        {legs.map((leg, i) => (
          <li key={`${leg.book}-${leg.side}-${leg.line}`}>
            {leg.label}
            {' · '}{formatAmericanOdds(leg.american)}
            {' · implied '}{formatSharePct(leg.implied)}
            {' · '}{percents[i]}% of stake
            {leg.side === 'under' && Number.isFinite(leg.line) && ` · total ≤ ${Math.floor(leg.line)}`}
            {leg.side === 'over' && Number.isFinite(leg.line) && ` · total ≥ ${Math.floor(leg.line) + 1}`}
            {leg.side === 'exact' && ` · total = ${leg.n ?? arb.line}`}
          </li>
        ))}
        <li>
          Combined implied {formatSharePct(arb.pSum)}
          {' < 100% · guaranteed '}{formatArbRoi(arb.roi)}
          {threeWay
            ? ' on the trio (Under / Exact / Over cover every total)'
            : ' on the pair (no middle — one side wins)'}
        </li>
      </ul>
      {extras.length > 0 && (
        <>
          <div className="corners-work-sub">Other covers</div>
          <ul className="corners-work-list">
            {extras.map((row) => (
              <li key={row.id}>
                {formatArbRoi(row.roi)}
                {row.kind === '3way' ? ' · 3-way' : ''}
                {' · '}{(row.legs ?? []).map((leg) => (
                  `${leg.label} ${formatAmericanOdds(leg.american)}`
                )).join(' / ')}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function WorkPanel({ model, selectedId, kellyEnabled, kellyBudget, kellyFraction }) {
  const arb = (model.totalArbs ?? []).find((row) => row.id === selectedId);
  if (arb) {
    return <ArbWorkPanel arb={arb} extras={(model.totalArbs ?? []).filter((row) => row.id !== arb.id)} />;
  }
  const bet = model.bets.find((b) => b.id === selectedId);
  if (!bet) return null;
  const kellyStake = kellyStakeForBet(bet, kellyEnabled, kellyBudget, kellyFraction);
  const h1Scope = bet.meta?.scope === 'h1' || bet.kind.startsWith('h1');
  const sourceRows = h1Scope ? model.h1Breakdown.rows : model.breakdown.rows;
  const futureRows = sourceRows.filter((r) => r.minutes > 0.02 && (!h1Scope || r.half === 1));
  const winBits = bet.kind.startsWith('next5')
    ? model.next5?.win?.bits
    : bet.kind.startsWith('next10')
      ? model.next10?.win?.bits
      : bet.kind === 'dk-both-yes'
        ? bet.meta?.bits
        : null;
  const lambdaWin = bet.meta?.lambda
    ?? (bet.kind.startsWith('next5') ? model.next5?.lambda : model.next10?.lambda);
  const need = bet.meta?.need;
  const implied = h1Scope ? model.halfImplied : model.fullImplied;
  const ourLambda = h1Scope ? model.ourH1Remaining : model.ourRemaining;
  const stoppageUsed = h1Scope ? model.h1Plan.used : model.plan.used;
  const scale = model.ourRemaining > 0
    ? (model.lineRemaining ?? model.ourRemaining) / model.ourRemaining
    : 1;

  return (
    <div className="corners-work">
      <div className="sop-exp-section-label">Show my work · {bet.label}</div>
      <p className={`corners-work-verdict${bet.profitable ? ' corners-work-verdict--ev' : ''}`}>
        {bet.baseline
          ? 'Game line · baseline, not a bet'
          : bet.kind === 'dk-both-yes'
            ? (bet.profitable
              ? 'Bet both Yes · covers 1+ even if only one team corners'
              : bet.meta?.coversOneTeam
                ? 'No edge as a 1+ cover'
                : 'Combined Yes prices are too short to cover 1+')
            : bet.profitable
              ? 'Good bet'
              : 'No edge'}
        {!bet.baseline && bet.kind !== 'dk-both-yes' && bet.analysis?.edgePoints != null
          && ` · ${formatEdgePct(bet.analysis.edgePoints)} vs implied remaining`}
        {bet.kind === 'dk-both-yes' && bet.analysis?.edgePoints != null
          && ` · ${formatEdgePct(bet.analysis.edgePoints)} vs 1+`}
        {!bet.profitable && !bet.baseline && bet.fairAmerican != null
          && ` · need ${formatAmericanOdds(Math.round(bet.fairAmerican))}`}
      </p>
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
        <li>Stoppage: {stoppageUsed}</li>
        {bet.kind === 'dk-both-yes' && (bet.meta?.legs ?? []).length > 0 && (
          <li>
            Dutch both Yes so one-team hit pays the same
            {' · '}combined implied {formatSharePct(bet.meta.combinedImplied)}
            {' vs model P(1+) '}{formatSharePct(bet.pModel)}
            {(bet.meta.legs).map((leg) => (
              <span key={leg.team}>
                {' · '}{leg.team} {formatAmericanOdds(leg.american)} ({formatSharePct(leg.share)} of stake)
              </span>
            ))}
            {kellyEnabled && kellyStake != null && (
              <>
                {' · '}{bet.meta.legs.map((leg) => (
                  `${leg.team} ${formatKellyStake(kellyStake * (leg.share ?? 0))}`
                )).join(' / ')}
              </>
            )}
          </li>
        )}
        {!bet.baseline && (
          <li>
            Model P({bet.kind === 'dk-both-yes' ? '1+' : bet.label}) {formatSharePct(bet.pModel)}
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

function stoppageHeadline(stoppage, clock) {
  if (clock?.halftime || stoppage?.halfTime) {
    return 'HT · typical SH stoppage 4.8′';
  }
  if (!stoppage) return null;
  if (stoppage.expectedLabel) {
    if (stoppage.remainingLabel && stoppage.played && stoppage.status === 'in') {
      const kind = stoppage.announced ? 'announced' : 'estimated';
      return `${stoppage.expectedLabel} ${kind} · ${stoppage.remainingLabel} left`;
    }
    if (stoppage.status === 'post') {
      return `${stoppage.played || stoppage.expectedLabel} played`;
    }
    return `${stoppage.expectedLabel} ${stoppage.announced ? 'announced' : 'estimated'}`;
  }
  if (stoppage.matchStatus && /half|live|started|in play/i.test(stoppage.matchStatus)) {
    return 'Estimating from play-by-play…';
  }
  return null;
}

function GameCard({ game, bucketed, showWork, onEnableShowWork, kellyEnabled, kellyBudget, kellyFraction }) {
  const [expanded, setExpanded] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [baselineBook, setBaselineBook] = useState('fd');
  const model = useMemo(
    () => evaluateGameCorners(game, { bucketed, baselineBook }),
    [game, bucketed, baselineBook],
  );
  const stoppageText = stoppageHeadline(game.stoppage, model.clock);
  const h1Bets = model.bets.filter((b) => b.kind === 'h1-over' || b.kind === 'h1-under');
  const dkBothBets = model.bets.filter((b) => b.kind === 'dk-both-yes');
  const atHalf = Boolean(model.clock.halftime || game.stoppage?.halfTime);
  const baselines = model.baselines ?? [];
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
                {model.totalArbs?.[0] && (
                  <TotalArbChip
                    arb={model.totalArbs[0]}
                    extraCount={Math.max(0, model.totalArbs.length - 1)}
                    selected={selectedId === model.totalArbs[0].id}
                    onSelect={selectBet}
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
              <div className="sop-exp-section-label">DraftKings both 1+</div>
              <p className="corners-empty-hint">
                Bet Yes on both teams, sized so one-team hit pays the same. Extra if both corner.
              </p>
              <div className="corners-plus-grid corners-plus-grid--packages">
                {dkBothBets.map((bet) => (
                  <DkBothYesButton
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
            />
          )}

          <section className="corners-stoppage">
            <div className="sop-exp-section-label">Expected stoppage</div>
            {!game.stoppage && (
              <p className="corners-empty-hint">
                {game.inPlay
                  ? 'No ESPN play-by-play matched this game yet. Using typical HT 3.3′ / FT 4.8′.'
                  : 'Estimated from ESPN play-by-play once the match is live. Pre-match uses typical HT 3.3′ + FT 4.8′.'}
              </p>
            )}
            {game.stoppage && (
              <div className="corners-stoppage-card">
                <div className="corners-stoppage-main">
                  {atHalf ? '4.8′' : (game.stoppage.expectedLabel ?? '—')}
                </div>
                <div className="corners-stoppage-meta">
                  {atHalf
                    ? 'Half-time · first-half extra is done · second-half stoppage resets to typical 4.8′'
                    : model.plan.used}
                  {!atHalf && formatMatchStatus(game.stoppage.matchStatus) && ` · ${formatMatchStatus(game.stoppage.matchStatus)}`}
                  {!atHalf && game.stoppage.clock && ` · ${game.stoppage.clock}`}
                  {!atHalf && game.stoppage.announced && ` · announced ${game.stoppage.announced}`}
                  {!atHalf && game.stoppage.played && ` · played ${game.stoppage.played}`}
                  {!atHalf && game.stoppage.status === 'in' && game.stoppage.remainingLabel && ` · ${game.stoppage.remainingLabel} remaining`}
                </div>
                {!atHalf && game.stoppage.breakdownLabel && (
                  <p className="corners-empty-hint">{game.stoppage.breakdownLabel}</p>
                )}
                {atHalf && (
                  <p className="corners-empty-hint">{game.stoppage.breakdownLabel || 'H1 extra finished'}</p>
                )}
              </div>
            )}
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
