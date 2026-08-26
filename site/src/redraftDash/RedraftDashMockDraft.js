import React, { useMemo, useState } from 'react';
import PositionBadge from '../PositionBadge';
import { DEFAULT_ADP_MODE } from './redraftDashJamlAdp';
import { AdpCell } from './redraftDashShared';
import { buildCohortValueSignals, playerSignalKey } from './redraftDashValueSignals';
import {
  TEAM_COUNT,
  ROSTER_SIZE,
  TOTAL_PICKS,
  PUNTER_RANKINGS,
  buildDraftPool,
  teamForPick,
  pickLabel,
  roundOfPick,
  runCpuUntilUserTurn,
  availableFromPool,
  rostersFromPicks,
  countPositions,
  starterHoles,
  playerKey,
} from './redraftDashMockDraftLogic';

const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'P', 'DST'];
const POS_TIER_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'P', 'DST'];

function teamLabel(teamIndex, userTeamIndex) {
  if (teamIndex === userTeamIndex) return 'You';
  return `T${teamIndex + 1}`;
}

function shortName(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${first.charAt(0)}. ${last}`;
}

function RedraftDashMockDraft({
  players = [],
  defenses = [],
  publicMode = false,
  adpMode = DEFAULT_ADP_MODE,
  format = 'superflex',
}) {
  const pool = useMemo(
    () => buildDraftPool(players, defenses, adpMode),
    [players, defenses, adpMode],
  );

  const signalsByKey = useMemo(
    () => buildCohortValueSignals(players, adpMode),
    [players, adpMode],
  );

  const [phase, setPhase] = useState('setup'); // setup | drafting | done
  const [userSlot, setUserSlot] = useState(1); // 1–10
  const [adpLean, setAdpLean] = useState(0.45);
  const [picks, setPicks] = useState([]);
  const [pickIndex, setPickIndex] = useState(0);
  const [posFilter, setPosFilter] = useState('ALL');
  const [listMode, setListMode] = useState('tiers'); // tiers | posTiers | board

  const userTeamIndex = userSlot - 1;

  const available = useMemo(() => availableFromPool(pool, picks), [pool, picks]);
  const rosters = useMemo(() => rostersFromPicks(picks), [picks]);
  const myRoster = rosters[userTeamIndex] || [];
  const myCounts = countPositions(myRoster);
  const myHoles = starterHoles(myCounts, format);

  const boardByRound = useMemo(() => {
    const grid = Array.from({ length: ROSTER_SIZE }, () => Array(TEAM_COUNT).fill(null));
    for (const pick of picks) {
      const round = Math.floor(pick.pickIndex / TEAM_COUNT);
      const team = pick.teamIndex;
      if (round >= 0 && round < ROSTER_SIZE) grid[round][team] = pick;
    }
    return grid;
  }, [picks]);

  const filteredAvailable = useMemo(() => {
    const list = posFilter === 'ALL'
      ? available
      : available.filter((p) => p.position === posFilter);
    return [...list].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  }, [available, posFilter]);

  const tierGroups = useMemo(() => {
    const usePosTiers = listMode === 'posTiers';
    const groups = new Map();

    for (const p of filteredAvailable) {
      if (usePosTiers) {
        const posTier = p.posTier ?? p.tier;
        const key = posFilter === 'ALL'
          ? `${p.position}:${posTier == null ? 99 : posTier}`
          : (posTier == null ? 99 : posTier);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
      } else {
        const tier = p.tier;
        const key = tier == null ? 99 : tier;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
      }
    }

    const entries = [...groups.entries()];
    if (usePosTiers && posFilter === 'ALL') {
      entries.sort((a, b) => {
        const [posA, tierA] = String(a[0]).split(':');
        const [posB, tierB] = String(b[0]).split(':');
        const oi = POS_TIER_ORDER.indexOf(posA);
        const oj = POS_TIER_ORDER.indexOf(posB);
        if (oi !== oj) return (oi === -1 ? 99 : oi) - (oj === -1 ? 99 : oj);
        return Number(tierA) - Number(tierB);
      });
      for (const [, players] of entries) {
        players.sort((a, b) => (a.posRank ?? a.rank ?? 999) - (b.posRank ?? b.rank ?? 999));
      }
    } else {
      entries.sort((a, b) => Number(a[0]) - Number(b[0]));
      if (usePosTiers) {
        for (const [, players] of entries) {
          players.sort((a, b) => (a.posRank ?? a.rank ?? 999) - (b.posRank ?? b.rank ?? 999));
        }
      }
    }
    return entries;
  }, [filteredAvailable, posFilter, listMode]);

  const tierBadgeLabel = (key) => {
    if (listMode === 'posTiers' && posFilter === 'ALL') {
      const [pos, tier] = String(key).split(':');
      if (Number(tier) === 99) return `${pos} · Unranked`;
      return `${pos} · Tier ${tier}`;
    }
    if (Number(key) === 99) return 'Unranked';
    return `Tier ${key}`;
  };

  const showPosRank = listMode === 'posTiers' || posFilter !== 'ALL';

  const isUserTurn = phase === 'drafting'
    && pickIndex < TOTAL_PICKS
    && teamForPick(pickIndex) === userTeamIndex;

  const advanceCpu = (fromIndex, existingPicks) => {
    const { newPicks, nextPickIndex } = runCpuUntilUserTurn({
      pool,
      picks: existingPicks,
      startPickIndex: fromIndex,
      userTeamIndex,
      adpLean,
      format,
    });
    const merged = newPicks.length ? [...existingPicks, ...newPicks] : existingPicks;
    setPicks(merged);
    setPickIndex(nextPickIndex);
    if (nextPickIndex >= TOTAL_PICKS) setPhase('done');
  };

  const startDraft = () => {
    setPicks([]);
    setPickIndex(0);
    setPhase('drafting');
    setPosFilter('ALL');
    const { newPicks, nextPickIndex } = runCpuUntilUserTurn({
      pool,
      picks: [],
      startPickIndex: 0,
      userTeamIndex,
      adpLean,
      format,
    });
    setPicks(newPicks);
    setPickIndex(nextPickIndex);
    if (nextPickIndex >= TOTAL_PICKS) setPhase('done');
  };

  const draftPlayer = (player) => {
    if (!isUserTurn) return;
    if (!available.some((p) => playerKey(p) === playerKey(player))) return;

    const entry = {
      pickIndex,
      teamIndex: userTeamIndex,
      player,
      byUser: true,
    };
    const next = [...picks, entry];
    setPicks(next);
    const following = pickIndex + 1;
    if (following >= TOTAL_PICKS) {
      setPickIndex(following);
      setPhase('done');
      return;
    }
    advanceCpu(following, next);
  };

  const resetToSetup = () => {
    setPhase('setup');
    setPicks([]);
    setPickIndex(0);
  };

  if (!pool.length) {
    return (
      <div className="rv-error">
        No players available for a mock draft
        {publicMode
          ? ' — the public snapshot is missing.'
          : ' — load the custom board first.'}
      </div>
    );
  }

  if (phase === 'setup') {
    return (
      <div className="rddm-root">
        <div className="rddm-setup">
          <h3 className="rddm-setup-title">Mock draft</h3>
          <p className="rddm-setup-copy">
            10-team snake · 19 rounds · {format === '1qb' ? '1QB' : '2QB'} / 2RB / 3WR / 1FLEX / K / P / DST.
            Opponents pick instantly; you only take your own turns.
          </p>

          <label className="rddm-field">
            <span className="rddm-field-label">Your draft slot</span>
            <select
              className="rv-select rv-select--narrow"
              value={userSlot}
              onChange={(e) => setUserSlot(Number(e.target.value))}
            >
              {Array.from({ length: TEAM_COUNT }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Pick {i + 1}
                </option>
              ))}
            </select>
          </label>

          <label className="rddm-field rddm-field--slider">
            <span className="rddm-field-label">
              Opponent lean
              <span className="rddm-slider-ends">
                <span>GTO (your tiers)</span>
                <span>ADP (exploitative)</span>
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(adpLean * 100)}
              onChange={(e) => setAdpLean(Number(e.target.value) / 100)}
              className="rddm-slider"
            />
            <span className="rddm-slider-value">
              {Math.round((1 - adpLean) * 100)}% tiers · {Math.round(adpLean * 100)}% ADP
              <span className="rddm-slider-hint"> (+5–10% noise)</span>
            </span>
          </label>

          <button type="button" className="rddm-start-btn" onClick={startDraft}>
            Start mock draft
          </button>

          {!defenses.length && (
            <p className="rddm-warn">
              No DST ranks loaded — defenses won&apos;t be in the pool
              {publicMode ? ' on this snapshot.' : ' (check ETR sync).'}
            </p>
          )}
          <p className="rddm-meta">
            Pool: {pool.length} players · {PUNTER_RANKINGS.length} punters
            {defenses.length ? ` · ${defenses.length} DST` : ''}
          </p>
        </div>
      </div>
    );
  }

  const onClockTeam = pickIndex < TOTAL_PICKS ? teamForPick(pickIndex) : null;

  return (
    <div className="rddm-root">
      <div className="rddm-toolbar">
        <div className="rddm-status">
          {phase === 'done' ? (
            <span className="rddm-status-done">Draft complete</span>
          ) : isUserTurn ? (
            <span className="rddm-status-you">
              Your pick — {pickLabel(pickIndex)} (R{roundOfPick(pickIndex)})
            </span>
          ) : (
            <span className="rddm-status-wait">
              On the clock: {teamLabel(onClockTeam, userTeamIndex)} · {pickLabel(pickIndex)}
            </span>
          )}
          <span className="rddm-status-meta">
            Slot {userSlot} · {Math.round((1 - adpLean) * 100)}/{Math.round(adpLean * 100)} GTO/ADP
          </span>
        </div>
        <div className="rddm-toolbar-actions">
          <button type="button" className="rddm-ghost-btn" onClick={startDraft}>
            Redraft
          </button>
          <button type="button" className="rddm-ghost-btn" onClick={resetToSetup}>
            Settings
          </button>
        </div>
      </div>

      <div className="rddm-needs">
        <span className="rddm-needs-label">Your holes</span>
        {['QB', 'RB', 'WR', 'FLEX', 'K', 'P', 'DST'].map((slot) => (
          <span
            key={slot}
            className={`rddm-need${myHoles[slot] > 0 ? ' rddm-need--open' : ' rddm-need--filled'}`}
          >
            {slot}{myHoles[slot] > 0 ? ` ${myHoles[slot]}` : ' ✓'}
          </span>
        ))}
        <span className="rddm-needs-counts">
          Roster {myRoster.length}/{ROSTER_SIZE}
          {' · '}
          QB{myCounts.QB} RB{myCounts.RB} WR{myCounts.WR} TE{myCounts.TE}
          {' · '}
          K{myCounts.K} P{myCounts.P} DST{myCounts.DST}
        </span>
      </div>

      <div className="rddm-board-wrap">
        <table className="rddm-board">
          <thead>
            <tr>
              <th className="rddm-board-round">Rd</th>
              {Array.from({ length: TEAM_COUNT }, (_, t) => (
                <th
                  key={t}
                  className={`rddm-board-team${t === userTeamIndex ? ' rddm-board-team--you' : ''}`}
                >
                  {teamLabel(t, userTeamIndex)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {boardByRound.map((row, round) => (
              <tr key={round}>
                <td className="rddm-board-round">{round + 1}</td>
                {row.map((pick, t) => {
                  const base = round * TEAM_COUNT;
                  const snakeSlot = round % 2 === 0 ? t : TEAM_COUNT - 1 - t;
                  const cellPickIndex = base + snakeSlot;
                  const isClock = !pick && phase === 'drafting' && cellPickIndex === pickIndex;
                  const isYou = t === userTeamIndex;
                  return (
                    <td
                      key={t}
                      className={[
                        'rddm-cell',
                        isYou ? 'rddm-cell--you' : '',
                        pick?.byUser ? 'rddm-cell--userpick' : '',
                        isClock ? 'rddm-cell--clock' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {pick ? (
                        <div className="rddm-cell-inner">
                          <span className="rddm-cell-name" title={pick.player.name}>
                            {shortName(pick.player.name)}
                          </span>
                          <span className="rddm-cell-pos">
                            <PositionBadge position={pick.player.position} />
                          </span>
                        </div>
                      ) : isClock ? (
                        <span className="rddm-cell-clock">●</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rddm-available">
        <div className="rddm-available-head">
          <h3 className="rddm-available-title">
            {isUserTurn ? 'Make your pick' : 'Available players'}
          </h3>
          <div className="rddm-available-controls">
            <div className="rdd-view-toggle">
              <button
                type="button"
                className={`rdd-view-btn${listMode === 'tiers' ? ' rdd-view-btn--active' : ''}`}
                onClick={() => setListMode('tiers')}
              >
                Overall tiers
              </button>
              <button
                type="button"
                className={`rdd-view-btn${listMode === 'posTiers' ? ' rdd-view-btn--active' : ''}`}
                onClick={() => setListMode('posTiers')}
              >
                Pos tiers
              </button>
              <button
                type="button"
                className={`rdd-view-btn${listMode === 'board' ? ' rdd-view-btn--active' : ''}`}
                onClick={() => setListMode('board')}
              >
                Board order
              </button>
            </div>
            <select
              className="rv-select rv-select--narrow"
              value={posFilter}
              onChange={(e) => setPosFilter(e.target.value)}
            >
              {POS_FILTERS.map((pos) => (
                <option key={pos} value={pos}>{pos === 'ALL' ? 'All' : pos}</option>
              ))}
            </select>
          </div>
        </div>

        {!isUserTurn && phase === 'drafting' && (
          <p className="rddm-available-hint">Waiting for your next turn — browse the board below.</p>
        )}
        {phase === 'done' && (
          <p className="rddm-available-hint">Draft finished. Redraft or tweak settings to run again.</p>
        )}

        {listMode === 'tiers' || listMode === 'posTiers' ? (
          <div className="rddm-tier-list">
            {tierGroups.map(([tier, tierPlayers]) => (
              <section key={String(tier)} className="rddt-tier">
                <header className="rddt-tier-head">
                  <span className="rddt-tier-badge">
                    {tierBadgeLabel(tier)}
                  </span>
                  <span className="rddt-tier-meta">
                    {tierPlayers.length} available
                  </span>
                </header>
                <div className="rddt-tier-body">
                  {tierPlayers.map((p) => {
                    const canPick = isUserTurn;
                    return (
                      <button
                        key={playerKey(p)}
                        type="button"
                        className={`rddm-player-row${canPick ? ' rddm-player-row--pickable' : ''}`}
                        disabled={!canPick}
                        onClick={() => draftPlayer(p)}
                      >
                        <span className="rddt-player-rank">
                          {showPosRank && p.posRank != null ? p.posRank : p.rank}
                        </span>
                        <span className="rddt-player-id">
                          <span className="rddt-player-name">{p.name}</span>
                          <span className="rddt-player-sub">
                            <PositionBadge position={p.position} />
                            <span className="rddt-player-team">{p.team || '—'}</span>
                            {!showPosRank && p.posRank != null && (
                              <span className="rddt-player-posrank">{p.position}{p.posRank}</span>
                            )}
                            {showPosRank && p.tier != null && posFilter === 'ALL' && (
                              <span className="rddt-player-posrank">ovr T{p.tier}</span>
                            )}
                          </span>
                        </span>
                        <AdpCell
                          player={p}
                          adpMode={adpMode}
                          signal={signalsByKey.get(playerSignalKey(p))}
                        />
                        {canPick && <span className="rddm-draft-cta">Draft</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {tierGroups.length === 0 && (
              <p className="rddm-available-hint">No players left at this filter.</p>
            )}
          </div>
        ) : (
          <div className="rddm-board-list">
            {filteredAvailable.map((p) => {
              const canPick = isUserTurn;
              return (
                <button
                  key={playerKey(p)}
                  type="button"
                  className={`rddm-player-row rddm-player-row--flat${canPick ? ' rddm-player-row--pickable' : ''}`}
                  disabled={!canPick}
                  onClick={() => draftPlayer(p)}
                >
                  <span className="rddt-player-rank">{p.rank}</span>
                  <span className="rddt-player-id">
                    <span className="rddt-player-name">{p.name}</span>
                    <span className="rddt-player-sub">
                      <PositionBadge position={p.position} />
                      <span className="rddt-player-team">{p.team || '—'}</span>
                      {p.tier != null && <span className="rddt-player-posrank">T{p.tier}</span>}
                    </span>
                  </span>
                  <AdpCell
                    player={p}
                    adpMode={adpMode}
                    signal={signalsByKey.get(playerSignalKey(p))}
                  />
                  {canPick && <span className="rddm-draft-cta">Draft</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default RedraftDashMockDraft;
