/**
 * NCAAF drive book — FanDuel/DK drive result vs joint LightGBM.
 */

import React, { useMemo, useState } from 'react';
import LoadingState from '../LoadingState';
import {
  LGBM_HOLDOUT,
  extractHomeSpread,
  evaluateDriveGame,
  formatAmericanOdds,
  formatEdgePoints,
  formatSharePct,
  hasDriveLine,
  listDriveMarkets,
  possessiveTeam,
  resolveOffenseTeam,
} from '../drives/driveModel';
import { predictDriveSituation } from '../drives/driveSituation';
import { formatKellyFractionLabel, formatKellyStake } from '../sop/sopModel';
import { useSOPKellySettings } from '../sop/useSOPKellySettings';
import { buildDrivesMonitorRows, maxDriveEdgePoints } from '../drives/gameSnapshot';
import { gameAnchorId } from '../sop/gameSnapshot';
import GameMonitorTable from './GameMonitorTable';

const REFRESH_MS = 60_000;
const TEAM_SEARCH_LIST_ID = 'drives-book-team-search';
const SHOW_WORK_KEY = 'drives-show-work';
const SORT_EDGE_KEY = 'drives-sort-edge';
const DK_GRANULAR_KEY = 'drives-dk-granular';

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

function periodLabel(period) {
  if (!Number.isFinite(period) || period <= 0) return null;
  if (period <= 4) return `Q${period}`;
  return `OT${period - 4}`;
}

function gameMatchesQuery(game, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const parts = [
    game.name,
    game.teams?.home,
    game.teams?.away,
    game.live?.possessionName,
    ...(String(game.name ?? '').split(/\s+@\s+/i)),
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
    for (const part of String(game.name ?? '').split(/\s+@\s+|\s+v\s+/i)) {
      const trimmed = part.trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function formatHandicap(n) {
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? `+${n}` : String(n);
}

function lineSummary(game) {
  const favorite = [...(game.lines?.spread?.runners ?? [])]
    .filter((r) => Number.isFinite(r.handicap))
    .sort((a, b) => a.handicap - b.handicap)[0];
  const total = game.lines?.total?.runners?.find((r) => /over/i.test(r.runnerName ?? ''));
  const bits = [];
  if (favorite?.runnerName && Number.isFinite(favorite.handicap)) {
    bits.push(`${favorite.runnerName} ${formatHandicap(favorite.handicap)}`);
  }
  if (total && Number.isFinite(total.handicap)) {
    bits.push(`O/U ${total.handicap}`);
  }
  return bits.join(' · ');
}

function liveSummary(game) {
  const live = game.live;
  if (!live) return null;
  if (live.state === 'pre' && !game.inPlay) return null;
  let spot = live.possessionText;
  if (spot && /^\d+$/.test(String(spot))) spot = `at ${spot}`;
  const bits = [
    periodLabel(live.period),
    live.clock && live.clock !== '0:00' ? live.clock : null,
    live.downDistance,
    spot,
  ].filter(Boolean);
  return bits.join(' · ') || null;
}

function possessionHeadline(game, market, model) {
  const name = model?.offenseName || resolveOffenseTeam(game, market).name;
  if (name && game.inPlay) return `${name} on offense`;
  return null;
}

function shortBookLeg(name) {
  const n = String(name ?? '');
  if (/passing touchdown/i.test(n)) return 'Pass TD';
  if (/rushing touchdown/i.test(n)) return 'Rush TD';
  if (/field goal made/i.test(n)) return 'FG made';
  if (/field goal missed/i.test(n)) return 'FG miss';
  if (/interception/i.test(n)) return 'INT';
  if (/fumble/i.test(n)) return 'Fumble';
  if (/turnover on downs/i.test(n)) return 'Downs';
  return n;
}

function driveHeading(game, market, model) {
  const name = model?.offenseName || resolveOffenseTeam(game, market).name;
  const whose = name ? possessiveTeam(name) : '';
  if (game.inPlay && whose) return `Betting ${whose} next drive`;
  if (whose) return `Betting ${whose} 1st drive`;
  if (game.inPlay) return 'Next drive · possession unknown';
  return market?.marketName ?? 'Drive result (no team line)';
}

function opponentStartSummary(game) {
  const live = game.live;
  if (!live) return null;
  if (live.down == null || live.yardsToEndzone == null || live.period == null) return null;
  const sit = {
    down: live.down,
    distance: live.distance ?? 10,
    yardsToEndzone: live.yardsToEndzone,
    period: live.period,
    clockSeconds: live.clockSeconds ?? 0,
  };
  const pred = predictDriveSituation(sit);
  if (!pred?.n) return null;
  const pts = (pred.points || [])
    .filter((row) => row.p >= 0.015)
    .map((row) => `${row.value} ${(row.p * 100).toFixed(0)}%`)
    .join(' · ');
  const next = [...(pred.nextStart || [])].sort((a, b) => b.p - a.p)[0];
  return {
    pred,
    line: [
      pts ? `This drive ${pts}` : null,
      next ? `Opp next ${next.label} ${(next.p * 100).toFixed(0)}%` : null,
      pred.n != null ? `n=${pred.n}` : null,
      pred.layer && pred.layer !== 'full' ? pred.layer : null,
    ].filter(Boolean).join(' · '),
  };
}

function teamOnSide(game, side) {
  if (side === 'home') return game.teams?.home ?? null;
  if (side === 'away') return game.teams?.away ?? null;
  return null;
}

function yardLineLabel(ytg) {
  const y = Number(ytg);
  if (!Number.isFinite(y) || y < 1 || y > 99) return null;
  if (y === 50) return 'midfield';
  if (y > 50) return `own ${100 - y}`;
  return `opp ${y}`;
}

function downDistanceLabel(down, distance) {
  const d = Number(down);
  if (!Number.isFinite(d) || d < 1) return null;
  const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
  const dist = Number.isFinite(Number(distance)) ? Number(distance) : 10;
  return `${d}${suffix} & ${dist}`;
}

function clockLabel(secLeft, period, assumed) {
  if (assumed || secLeft === 3600) return 'Opening kickoff';
  const s = Number(secLeft);
  if (!Number.isFinite(s)) return null;
  const q = periodLabel(period);
  const mins = Math.floor(s / 60);
  const secs = Math.round(s % 60);
  const left = `${mins}:${String(secs).padStart(2, '0')} left`;
  return q ? `${q} · ${left}` : left;
}

function reasoningRows(game, pred) {
  if (!pred?.features) return [];
  const f = pred.features;
  const offense = teamOnSide(game, pred.side);
  const rows = [];

  if (offense) {
    rows.push(['Offense', `${offense}${pred.side === 'away' ? ', away' : pred.side === 'home' ? ', home' : ''}`]);
  }

  const spot = yardLineLabel(f.ytg);
  const downDist = downDistanceLabel(f.down, f.distance);
  if (pred.assumed) {
    rows.push(['Spot', 'Own 25 · opening kickoff (assumed)']);
  } else if (downDist && spot) {
    rows.push(['Spot', `${downDist} · ${spot}`]);
  } else if (spot) {
    rows.push(['Spot', spot]);
  }

  const clock = clockLabel(f.sec_left, f.period, pred.assumed);
  if (clock && !pred.assumed) rows.push(['Clock', clock]);

  if (Number.isFinite(f.score_diff)) {
    const board = game.scoreDisplay ?? '0-0';
    if (f.score_diff === 0) rows.push(['Score', `Tied ${board}`]);
    else if (offense && f.score_diff > 0) rows.push(['Score', `${offense} leads by ${f.score_diff} · ${board}`]);
    else if (offense) rows.push(['Score', `${offense} trails by ${Math.abs(f.score_diff)} · ${board}`]);
    else rows.push(['Score', board]);
  }

  if (Number.isFinite(f.offense_spread) && offense) {
    if (f.offense_spread < 0) {
      rows.push(['Spread', `${offense} favored by ${Math.abs(f.offense_spread)}`]);
    } else if (f.offense_spread > 0) {
      rows.push(['Spread', `${offense} +${f.offense_spread} underdog`]);
    } else {
      rows.push(['Spread', 'Pick ’em']);
    }
  } else {
    const homeSpread = extractHomeSpread(game);
    if (Number.isFinite(homeSpread) && homeSpread !== 0) {
      const fav = homeSpread < 0 ? game.teams?.home : game.teams?.away;
      if (fav) rows.push(['Spread', `${fav} favored by ${Math.abs(homeSpread)}`]);
    }
  }

  if (Number.isFinite(f.over_under)) {
    let total = `O/U ${f.over_under}`;
    if (Number.isFinite(f.exp_off) && offense) {
      total += ` · ${offense} expected ${f.exp_off.toFixed(1)} pts`;
    }
    rows.push(['Total', total]);
  }

  if (pred.layer === 'driveStart' && f.drive_n === 1) {
    rows.push(['Drive', 'First possession']);
  }

  return rows;
}

function ModelReasoning({ game, pred, mix, heading, highlightKey }) {
  const rows = reasoningRows(game, pred);
  const mixRows = (mix ?? []).filter((row) => Number.isFinite(row.p));
  if (!rows.length && !mixRows.length) return null;
  return (
    <section className="drives-reason" aria-label="Model reasoning" id={`drives-why-${game.eventId}`}>
      <div className="sop-exp-section-label">{heading ?? 'Why this price'}</div>
      <div className="drives-reason-grid">
        {rows.length > 0 && (
          <ul className="drives-reason-list">
            {rows.map(([label, value]) => (
              <li key={label}>
                <strong>{label}</strong>
                {value}
              </li>
            ))}
          </ul>
        )}
        {mixRows.length > 0 && (
          <ul className="drives-reason-mix">
            {mixRows.map((row) => (
              <li
                key={row.key}
                className={row.key === highlightKey ? 'drives-reason-mix-item--on' : undefined}
              >
                <span>{row.label}</span>
                <span className="drives-reason-mix-pct">{formatSharePct(row.p)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Toggle({ label, checked, onChange, hint }) {
  return (
    <label className="sop-kelly-toggle" title={hint}>
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

function DriveSide({
  game,
  market,
  model,
  showWork,
  kellyEnabled,
  kellyFraction,
  selectedKey,
  onSelectLine,
}) {
  const dual = model.rows.some((row) => row.dualBooks);
  const book = market?.source === 'dk' ? 'DK' : 'FD';
  return (
    <div className="drives-side">
      <section className="sop-exp-goals">
        <div className="sop-exp-section-label">{driveHeading(game, market, model)}</div>
        {market?.marketName && (
          <p className="drives-situation">{market.marketName}</p>
        )}
        {market?.granular && (
          <p className="drives-situation">
            DK Granular — pass/rush TD are separate tickets. Edge is versus the model bucket if you bet every split in that row.
          </p>
        )}
        {!model.hasBook && (
          <p className="sop-exp-status drives-missing-line">
            No drive-result line for this team yet.
          </p>
        )}
        <ul className="sop-exp-goal-list">
          {model.rows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                className={`sop-exp-goal-row drives-line-btn${dual ? ' sop-exp-goal-row--dual' : ''}${selectedKey === row.key ? ' drives-line-btn--open' : ''}`}
                onClick={() => onSelectLine(row.key)}
                aria-expanded={selectedKey === row.key}
                aria-controls={`drives-why-${game.eventId}`}
              >
              <div className="sop-exp-goal-label">
                {row.legs?.length > 1 ? `${row.label} · bet all` : row.label}
                {row.legs?.length > 1 ? (
                  <span className="drives-book-sel">
                    {row.legs.map((leg) => (
                      `${shortBookLeg(leg.runnerName)} ${formatAmericanOdds(leg.american)}`
                    )).join(' · ')}
                  </span>
                ) : row.runnerName && row.runnerName !== row.label ? (
                  <span className="drives-book-sel">{row.runnerName}</span>
                ) : null}
              </div>
              <div className={dual ? 'sop-exp-goal-books-pair' : 'sop-exp-goal-books-single'}>
                {(dual || book === 'FD') && (
                  <div
                    className={`sop-exp-goal-odds-box sop-exp-goal-odds-box--fd${row.fdAnalysis?.profitable ? ' sop-exp-goal-odds-box--ev' : ''}`}
                  >
                    <span className="sop-exp-goal-odds-book">FD</span>
                    <span className="sop-exp-goal-odds-val">
                      {row.fdAmerican != null ? formatAmericanOdds(row.fdAmerican) : '—'}
                    </span>
                  </div>
                )}
                {(dual || book === 'DK') && (
                  <div
                    className={`sop-exp-goal-odds-box sop-exp-goal-odds-box--dk${row.dkAnalysis?.profitable ? ' sop-exp-goal-odds-box--ev' : ''}`}
                  >
                    <span className="sop-exp-goal-odds-book">DK</span>
                    <span className="sop-exp-goal-odds-val">
                      {row.dkAmerican != null ? formatAmericanOdds(row.dkAmerican) : '—'}
                    </span>
                  </div>
                )}
                {!dual && book !== 'FD' && book !== 'DK' && (
                  <div
                    className={`sop-exp-goal-odds-box sop-exp-goal-odds-box--fd${row.profitable ? ' sop-exp-goal-odds-box--ev' : ''}`}
                  >
                    <span className="sop-exp-goal-odds-book">{book}</span>
                    <span className="sop-exp-goal-odds-val">
                      {row.american != null ? formatAmericanOdds(row.american) : '—'}
                    </span>
                  </div>
                )}
              </div>
              <div className="sop-exp-goal-breakeven">
                {row.fairAmerican != null ? (
                  <>
                    <span>{formatAmericanOdds(row.fairAmerican)}</span>
                    <span className="sop-exp-goal-be-tag">model</span>
                  </>
                ) : (
                  '—'
                )}
              </div>
              <div className="sop-exp-goal-edge">
                {row.profitable && row.edgePoints != null ? (
                  <>
                    <span className="sop-exp-edge-plus">
                      {formatEdgePoints(row.edgePoints)} edge
                    </span>
                    {kellyEnabled && row.kellyStake != null && (
                      <span
                        className="sop-kelly-stake"
                        title={`${formatKellyFractionLabel(kellyFraction)} stake`}
                      >
                        Kelly Bet Size: {formatKellyStake(row.kellyStake)}
                      </span>
                    )}
                  </>
                ) : row.edgePoints != null ? (
                  <span className="sop-exp-edge-minus">
                    {formatEdgePoints(row.edgePoints)}
                  </span>
                ) : (
                  '—'
                )}
              </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {showWork && (
        <section className="drives-work" aria-label="Model work">
          <div className="sop-exp-section-label">Show work · {model.model?.label ?? 'model'}</div>
          <p className="drives-work-note">
            Trained 2023–24, held out 2025.
            {model.pred?.layer === 'snap'
              ? ` Snap log-loss ${LGBM_HOLDOUT.snap.logloss} vs raw ${LGBM_HOLDOUT.snap.raw} (n=${LGBM_HOLDOUT.snap.n.toLocaleString()}).`
              : ` Drive-start log-loss ${LGBM_HOLDOUT.driveStart.logloss} vs raw ${LGBM_HOLDOUT.driveStart.raw} (n=${LGBM_HOLDOUT.driveStart.n.toLocaleString()}).`}
            {model.pred?.assumed ? ' Pregame card assumes own-25 opening kickoff.' : ''}
            {model.vigPct != null ? ` Book vig ${model.vigPct.toFixed(1)}%.` : ''}
          </p>
          <ul className="drives-work-list">
            {model.rows.map((row) => (
              <li key={row.key}>
                <strong>{row.label}</strong>
                {' '}
                model {formatSharePct(row.p)}
                {' → '}
                {formatAmericanOdds(row.fairAmerican)}
                {row.marketP != null ? ` · destig ${formatSharePct(row.marketP)}` : ''}
                {' · raw '}
                {formatSharePct(row.rawP)}
                {' → '}
                {formatAmericanOdds(row.rawFairAmerican)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function GameCard({
  game,
  defaultOpen,
  showWork,
  kellyEnabled,
  kellyBudget,
  kellyFraction,
  dkGranular = false,
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const [openLine, setOpenLine] = useState(null);
  const markets = useMemo(() => listDriveMarkets(game, { granular: dkGranular }), [game, dkGranular]);
  const models = useMemo(() => {
    const opts = { kellyEnabled, kellyBudget, kellyFraction };
    if (!markets.length) return [evaluateDriveGame(game, opts)];
    return markets.map((market) => evaluateDriveGame(game, { ...opts, market }));
  }, [game, markets, kellyEnabled, kellyBudget, kellyFraction]);
  const evCount = models.reduce((sum, model) => sum + model.evCount, 0);
  const situation = liveSummary(game);
  const lines = lineSummary(game);
  const nextStart = useMemo(() => opponentStartSummary(game), [game]);
  const paired = markets.length > 1;
  const ballOn = possessionHeadline(game, markets[0], models[0]);
  const cardKicker = paired
    ? '1st-drive result · both teams'
    : (ballOn || models[0]?.marketName || (game.inPlay ? 'Next drive · possession unknown' : 'First / next drive'));
  const openModel = openLine ? models[openLine.sideIndex] : null;
  const openMarket = openLine ? (markets[openLine.sideIndex] ?? openModel?.market) : null;

  return (
    <article
      id={gameAnchorId(game.eventId)}
      className={`sop-exp-game${expanded ? ' sop-exp-game--open' : ''}`}
    >
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
              {situation && <span className="sop-exp-time">{situation}</span>}
              {!game.inPlay && game.openDate && (
                <span className="sop-exp-time">{formatKickoff(game.openDate)}</span>
              )}
              {!expanded && evCount > 0 && (
                <span className="sop-exp-ev-badge">{evCount} +EV</span>
              )}
            </span>
          </span>
        </button>
      </header>

      {expanded && (
        <div className="sop-exp-game-body">
          <section className="sop-exp-no-goal">
            <div className={`sop-exp-section-label${ballOn ? ' drives-possession-label' : ''}`}>
              {cardKicker}
            </div>
            {situation && <p className="drives-situation">{situation}</p>}
            {nextStart?.line && <p className="drives-situation drives-situation--next">{nextStart.line}</p>}
            {lines && <p className="drives-situation drives-situation--lines">{lines}</p>}
            {!markets.length && (
              <p className="sop-exp-status drives-missing-line">
                {game.inPlay
                  ? 'No FanDuel next-drive line. Drive Result is a live Quick Bet, and FanDuel is not posting it on this game right now. DraftKings 1st-drive is pregame only.'
                  : 'No drive-result line yet. FanDuel posts next-drive only after kickoff (Quick Bets). DraftKings 1st-drive is used when they hang it.'}
              </p>
            )}
            {game.error && <p className="sop-exp-error">{game.error}</p>}
          </section>

          <div className={`drives-sides${paired ? ' drives-sides--pair' : ''}`}>
            {models.map((model, i) => (
              <DriveSide
                key={markets[i]?.marketName ?? model.offenseName ?? i}
                game={game}
                market={markets[i] ?? model.market}
                model={model}
                showWork={showWork}
                kellyEnabled={kellyEnabled}
                kellyFraction={kellyFraction}
                selectedKey={openLine?.sideIndex === i ? openLine.key : null}
                onSelectLine={(key) => setOpenLine((prev) => (
                  prev?.sideIndex === i && prev.key === key
                    ? null
                    : { sideIndex: i, key }
                ))}
              />
            ))}
          </div>
          {openModel && (
            <ModelReasoning
              game={game}
              pred={openModel.pred}
              mix={openModel.rows}
              highlightKey={openLine.key}
              heading={`Why this price · ${driveHeading(game, openMarket, openModel)}`}
            />
          )}
        </div>
      )}
    </article>
  );
}

function DrivesBookPanel({
  games,
  fetchedAt,
  stats,
  error,
  notice,
  refreshing,
  loading = false,
  onRefresh,
}) {
  const [teamQuery, setTeamQuery] = useState('');
  const [liveOnly, setLiveOnly] = useState(false);
  const [linesOnly, setLinesOnly] = useState(false);
  const [showWork, setShowWork] = useState(() => readFlag(SHOW_WORK_KEY, false));
  const [sortByEdge, setSortByEdge] = useState(() => readFlag(SORT_EDGE_KEY, false));
  const [dkGranular, setDkGranular] = useState(() => readFlag(DK_GRANULAR_KEY, false));
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
    const list = games.filter((game) => {
      if (liveOnly && !game.inPlay) return false;
      if (linesOnly && !hasDriveLine(game)) return false;
      return gameMatchesQuery(game, teamQuery);
    });
    if (!sortByEdge) return list;
    const live = [];
    const upcoming = [];
    for (const game of list) {
      if (game.inPlay) live.push(game);
      else upcoming.push(game);
    }
    upcoming.sort((a, b) => {
      const ae = maxDriveEdgePoints(a, { granular: dkGranular });
      const be = maxDriveEdgePoints(b, { granular: dkGranular });
      const aEdge = Number.isFinite(ae) ? ae : -Infinity;
      const bEdge = Number.isFinite(be) ? be : -Infinity;
      if (bEdge !== aEdge) return bEdge - aEdge;
      return (Date.parse(a.openDate) || 0) - (Date.parse(b.openDate) || 0);
    });
    return [...live, ...upcoming];
  }, [games, liveOnly, linesOnly, teamQuery, sortByEdge, dkGranular]);

  if (loading) {
    return (
      <LoadingState
        label="Loading NCAAF drive odds…"
        ariaLabel="Loading NCAAF drive odds"
        className="sop-book-loading"
      />
    );
  }

  return (
    <div className="sop-exp-content">
      <header className="sop-exp-header">
        <h1 className="sop-exp-title">NCAAF Drive Book</h1>
        <p className="sop-exp-subtitle">
          FanDuel live next-drive · DK 1st-drive · joint LightGBM
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

      {!error && games.length > 0 && (
        <GameMonitorTable
          rows={buildDrivesMonitorRows(filteredGames, Date.now(), { granular: dkGranular })}
          marketHeader="Play"
          caption="Best drive result vs model"
          showMarket
        />
      )}

      <section className="sop-book-settings" aria-label="Scanner settings">
        <Toggle
          label="Show work"
          checked={showWork}
          onChange={(v) => {
            setShowWork(v);
            writeFlag(SHOW_WORK_KEY, v);
          }}
          hint="Model probability vs destigged book and the raw league mix"
        />
        <Toggle
          label="Live only"
          checked={liveOnly}
          onChange={setLiveOnly}
        />
        <Toggle
          label="Has drive line"
          checked={linesOnly}
          onChange={setLinesOnly}
        />
        <Toggle
          label="Largest edge first"
          checked={sortByEdge}
          onChange={(v) => {
            setSortByEdge(v);
            writeFlag(SORT_EDGE_KEY, v);
          }}
          hint="Keep live games on top; sort pregame by the biggest model edge"
        />
        <Toggle
          label="DK granular"
          checked={dkGranular}
          onChange={(v) => {
            setDkGranular(v);
            writeFlag(DK_GRANULAR_KEY, v);
          }}
          hint="DraftKings pass/rush TD and FG made/missed instead of the 4-way menu"
        />
        <Toggle
          label="Show Kelly Criterion"
          checked={kellyEnabled}
          onChange={setKellyEnabled}
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
                />
              </span>
            </label>
            <div className="sop-kelly-fraction">
              <label className="sop-kelly-fraction-label" htmlFor="drives-kelly-fraction">
                Fraction
              </label>
              <div className="sop-kelly-fraction-row">
                <input
                  id="drives-kelly-fraction"
                  type="range"
                  min="1"
                  max="100"
                  className="sop-kelly-fraction-slider"
                  value={Math.round((kellyFraction || 1) * 100)}
                  onChange={(e) => setKellyFraction(Number(e.target.value) / 100)}
                />
                <span className="sop-kelly-fraction-value">{formatKellyFractionLabel(kellyFraction)}</span>
              </div>
            </div>
          </>
        )}
      </section>

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
              defaultOpen={Boolean(g.inPlay || hasDriveLine(g))}
              showWork={showWork}
              kellyEnabled={kellyEnabled}
              kellyBudget={kellyBudget}
              kellyFraction={kellyFraction}
              dkGranular={dkGranular}
            />
          ))}
        </div>
      )}

      {!error && games.length > 0 && filteredGames.length === 0 && (
        <p className="sop-exp-status">
          {teamQuery.trim()
            ? `No games match “${teamQuery.trim()}”.`
            : 'No games match the current filters.'}
        </p>
      )}

      {!error && games.length === 0 && (
        <p className="sop-exp-status">No NCAAF games found on FanDuel.</p>
      )}

      <footer className="sop-exp-footer">
        Auto-refreshes every {REFRESH_MS / 1000}s · model is joint LightGBM (train 2023–24, hold out 2025) ·
        FanDuel Drive Result is a live Quick Bet, not the web Popular tab
        {stats ? ` · ${stats.games} games` : ''}
      </footer>
    </div>
  );
}

export default DrivesBookPanel;
