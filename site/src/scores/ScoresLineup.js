import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';
import { getInjuryAbbreviation } from '../lookups/InjuryLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import useIsMobile from '../hooks/useIsMobile';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import PositionBadge from '../PositionBadge';
import { starterScoreSplit, benchScoreSplit } from './ScoreSplit';
import HprojHint from './HprojHint';
import { rankPtsForMode } from './projectionScoring';
import { hprojPercentile } from './hprojVarianceBuckets';
import { HPROJ_SKILL_POS } from './hprojTeamSim';

function formatPlayerNameForDisplay(nameOrId, compact) {
  const raw = nameOrId;
  if (!compact) {
    return raw;
  }
  if (typeof raw !== 'string') {
    return raw;
  }
  const name = raw.trim();
  if (!name) {
    return raw;
  }
  const parts = name.split(/\s+/);
  const first = parts[0] || '';
  const last = parts.slice(1).join(' ') || '';
  if (!first && !last) {
    return raw;
  }
  const firstInitial = first ? `${first[0].toUpperCase()}.` : '';
  let lastShort = last;
  if (last && last.length > 15) {
    const hyphenIdx = last.indexOf('-');
    if (hyphenIdx > 0) {
      lastShort = `${last.slice(0, Math.min(hyphenIdx + 3, last.length))}...`;
    } else {
      lastShort = `${last.slice(0, 12)}...`;
    }
  }
  return `${firstInitial} ${lastShort || ''}`.trim();
}

function GameLabel({ gameObj, isActiveWeek }) {
  const classes = ['scores-lineup-game'];
  if (isActiveWeek && gameObj.live) {
    classes.push('scores-lineup-game--live');
  } else if (isActiveWeek && gameObj.completed) {
    classes.push('scores-lineup-game--done');
  } else if (gameObj.text === 'BYE') {
    classes.push('scores-lineup-game--bye');
  }
  const text = gameObj.text || '';
  return (
    <div className={classes.join(' ')}>
      {isActiveWeek && gameObj.live ? (
        <span className="hproj-hint-live-dot" aria-hidden="true" />
      ) : null}
      {gameObj.eventId ? (
        <a
          href={`https://www.espn.com/nfl/game/_/gameId/${gameObj.eventId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="scores-lineup-game-link"
          onClick={(e) => e.stopPropagation()}
        >
          {text}
        </a>
      ) : (
        text
      )}
    </div>
  );
}

function slotBadgeClass(slot) {
  const s = String(slot || '').toUpperCase();
  if (s.startsWith('QB')) return 'pos-badge--qb';
  if (s.startsWith('RB')) return 'pos-badge--rb';
  if (s.startsWith('WR')) return 'pos-badge--wr';
  if (s.startsWith('TE')) return 'pos-badge--te';
  if (s.startsWith('K')) return 'pos-badge--k';
  if (s.includes('DEF') || s === 'DST') return 'pos-badge--def';
  if (s.startsWith('FLEX')) return 'pos-badge--flex';
  if (s.startsWith('SUPER')) return 'pos-badge--super';
  return 'pos-badge--other';
}

function SlotBadge({ slot }) {
  const label = slot || '—';
  return (
    <span className={`pos-badge scores-lineup-slot-badge ${slotBadgeClass(label)}`}>
      {label}
    </span>
  );
}

function scoreDisplay(player) {
  if (player && typeof player.actualPts === 'number') {
    return player.actualPts.toFixed(1);
  }
  return '—';
}

function projDisplay(player) {
  if (player && typeof player.currentExpected === 'number' && Number.isFinite(player.currentExpected)) {
    return player.currentExpected.toFixed(1);
  }
  if (player && typeof player.projPts === 'number') {
    return player.projPts.toFixed(1);
  }
  return '—';
}

function skillPos(info) {
  const raw = info && (info.position || (info.fantasy_positions && info.fantasy_positions[0]));
  if (raw === 'FB') return 'RB';
  if (HPROJ_SKILL_POS.includes(raw)) return raw;
  return null;
}

function sleeperProj(player) {
  if (player && typeof player.projPts === 'number' && Number.isFinite(player.projPts)) {
    return player.projPts;
  }
  return null;
}

export default function ScoresLineup({
  weekBreakdown,
  playersData,
  playerIdMap,
  playerGameLabels = {},
  isActiveWeek = false,
  injuriesMap = {},
  showCurrentInjury = false,
  playerHighlightMap = {},
  playersTeamMap = {},
  benchOpen = false,
  onToggleBench,
  ownerName,
  ownerAvatar,
  teamLink,
  pfTotal,
  hprojHref = null,
  hprojValue = null,
  liveProjValue = null,
  gamesStarted = false,
  weekComplete = false,
}) {
  const isMobileView = useIsMobile();
  const [searchParams] = useSearchParams();
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const modalSeason = searchParams.get('year') || undefined;

  if (!weekBreakdown) {
    return <div>No data for this week/team.</div>;
  }

  const starterSplit = starterScoreSplit(weekBreakdown, { weekComplete });
  const benchSplit = benchScoreSplit(weekBreakdown);
  const lineupMode = weekBreakdown.lineupMode === 'projections' ? 'projections' : 'scores';
  const showScoreCol = true;
  const showProjCol = true;
  const showHprojCol = Boolean(hprojHref);
  const numsClass = `scores-lineup-nums${showScoreCol && showProjCol ? '' : ' scores-lineup-nums--single'}`;
  const hasPf = Number(pfTotal) > 0;
  const hasMeta = Boolean(ownerName || hasPf);

  const InjuryBadge = ({ playerId, info }) => {
    let status = null;
    if (!isActiveWeek && injuriesMap && playerId && injuriesMap[String(playerId)]) {
      status = injuriesMap[String(playerId)];
    } else if (showCurrentInjury && info) {
      status = info.injury_status || info.injury_notes || (info.status && /out|pup|questionable|doubtful|suspended|ir|injured reserve/i.test(info.status) ? info.status : null);
    }
    const ab = status ? getInjuryAbbreviation(status) : null;
    if (!ab) {
      return null;
    }
    const isRetired = ab === 'NA';
    return (
      <span className={isRetired ? 'injury-badge injury-badge--retired' : 'injury-badge'} title={status}>
        {isRetired ? 'Retired 😂' : ab}
      </span>
    );
  };

  const renderRow = (p, i, { bench = false } = {}) => {
    if (!p || p.id == null || String(p.id) === '0') {
      return (
        <div key={`empty-${i}`} className="scores-lineup-row scores-lineup-row--empty">
          <div className="scores-lineup-slot">
            <SlotBadge slot={bench ? 'BN' : (STARTER_POSITION_NAMES[i] || '—')} />
          </div>
          <div className="scores-lineup-player">
            <div className="scores-lineup-name-row">
              <span className="scores-lineup-empty">—</span>
            </div>
          </div>
          <div className="scores-lineup-game-col" />
          <div className={numsClass}>
            {showScoreCol ? <span className="scores-lineup-pts-actual">—</span> : null}
            {showProjCol ? <span className="scores-lineup-pts-proj">—</span> : null}
          </div>
        </div>
      );
    }
    const info = getPlayerInfo(p.id, playersData, playerIdMap);
    const gameObj = (playerGameLabels && playerGameLabels[p.id]) || { text: '', live: false, completed: false, eventId: null, team: null };
    const snapshotTeam = playersTeamMap && playersTeamMap[String(p.id)];
    const teamAbbr = snapshotTeam || gameObj.team || (info && (info.team || info.team_abbr)) || null;
    const rawName = info && info.name ? info.name : String(p.id);
    const highlight = playerHighlightMap && playerHighlightMap[String(p.id)];
    const slot = bench ? 'BN' : (STARTER_POSITION_NAMES[i] || `S${i + 1}`);
    const isLive = Boolean(isActiveWeek && gameObj.live && p.ptsSource !== 'actual' && p.ptsSource !== 'bye');
    const isFinal = Boolean(
      (gameObj.completed || p.ptsSource === 'actual')
      && p.ptsSource !== 'bye'
      && gameObj.text !== 'BYE'
    );
    const liveHproj = isLive && typeof p.currentExpected === 'number' && Number.isFinite(p.currentExpected)
      ? p.currentExpected
      : null;
    const sleeper = sleeperProj(p);
    const outcomePct = isFinal && !isLive
      ? hprojPercentile(skillPos(info), sleeper, p.actualPts)
      : null;
    const highlightClass = highlight === 'up' ? ' text-up text-bold' : (highlight === 'down' ? ' text-down text-bold' : '');
    const scoreHint = !bench && p.bestBenchScore ? p.bestBenchScore : null;
    const projHintRaw = !bench && p.higherBenchProj ? p.higherBenchProj : null;
    const projHintLabel = projHintRaw
      ? (playerGameLabels[projHintRaw.id] || playerGameLabels[String(projHintRaw.id)] || null)
      : null;
    const projHint = projHintRaw && !(projHintLabel && (projHintLabel.completed || projHintLabel.text === 'BYE'))
      ? projHintRaw
      : null;
    const hint = scoreHint || projHint;
    return (
      <div
        key={p.id}
        className={`scores-lineup-row${bench ? ' scores-lineup-row--bench' : ''}${isLive ? ' scores-lineup-row--live' : ''}${info ? ' player-clickable' : ''}`}
        onClick={() => info && setSelectedPlayer(info)}
      >
        <div className="scores-lineup-slot">
          <SlotBadge slot={slot} />
        </div>
        <div className="scores-lineup-player">
          <div className="scores-lineup-name-row">
            <img
              src={getPlayerLogoUrl(info && info.espn_photo_url)}
              alt={info && info.name ? info.name : ''}
              className="player-avatar player-avatar-style scores-lineup-avatar"
            />
            <span className="player-name scores-lineup-name">
              {formatPlayerNameForDisplay(rawName, isMobileView)}
            </span>
            {info && info.position ? <PositionBadge position={info.position} /> : null}
            {teamAbbr ? <span className="team-scores-team-abbr">{teamAbbr}</span> : null}
            <InjuryBadge playerId={p.id} info={info} />
          </div>
        </div>
        <div className="scores-lineup-game-col">
          <GameLabel gameObj={gameObj} isActiveWeek={isActiveWeek} />
        </div>
        <div className={numsClass}>
          {showScoreCol ? <span className={`scores-lineup-pts-actual${highlightClass}`}>{scoreDisplay(p)}</span> : null}
          {showProjCol ? (
            liveHproj != null && hprojHref ? (
              <HprojHint
                href={hprojHref}
                value={liveHproj}
                variant="live"
                showTag={false}
                showDot={false}
                className={`scores-lineup-pts-proj scores-lineup-pts-proj--live scores-lineup-live-hproj${highlightClass}`}
              />
            ) : isFinal && sleeper != null ? (
              <HprojHint
                href={hprojHref}
                value={sleeper}
                variant="final"
                showTag={false}
                actual={p.actualPts}
                sleeper={sleeper}
                outcomePct={outcomePct}
                className={`scores-lineup-pts-proj scores-lineup-final-hproj${highlightClass}`}
              />
            ) : sleeper != null ? (
              <HprojHint
                value={sleeper}
                variant="sleeper"
                showTag={false}
                className={`scores-lineup-pts-proj scores-lineup-sleeper-hproj${highlightClass}`}
              />
            ) : (
              <span className={`scores-lineup-pts-proj${highlightClass}`}>
                {projDisplay(p)}
              </span>
            )
          ) : null}
        </div>
        {hint ? (
          <div
            className="scores-lineup-bench-hint"
            title={scoreHint
              ? `${scoreHint.name} · ${Number(scoreHint.pts).toFixed(1)}`
              : `${projHint.name} · ${Number(projHint.expected).toFixed(1)}`}
          >
            {scoreHint
              ? `Score so far: ${formatPlayerNameForDisplay(scoreHint.name, isMobileView)} ${Number(scoreHint.pts).toFixed(1)}`
              : `Higher Projection: ${formatPlayerNameForDisplay(projHint.name, isMobileView)} ${Number(projHint.expected).toFixed(1)}`}
          </div>
        ) : null}
      </div>
    );
  };

  const benchRows = [...(weekBreakdown.bench || [])].map((p) => {
    const info = getPlayerInfo(p.id, playersData, playerIdMap);
    const status = showCurrentInjury && info
      ? (info.injury_status || info.injury_notes || (info.status && /out|pup|questionable|doubtful|suspended|ir|injured reserve/i.test(info.status) ? info.status : null))
      : null;
    const ab = status ? getInjuryAbbreviation(status) : null;
    const isDeprioritized = ab === 'O' || ab === 'P' || ab === 'PUP' || ab === 'IR';
    return { p, isDeprioritized };
  }).sort((a, b) => {
    const aExp = rankPtsForMode(a.p, lineupMode);
    const bExp = rankPtsForMode(b.p, lineupMode);
    if (bExp !== aExp) {
      return bExp - aExp;
    }
    if (a.isDeprioritized !== b.isDeprioritized) {
      return a.isDeprioritized ? 1 : -1;
    }
    return 0;
  });

  const playerModal = selectedPlayer ? createPortal(
    <div className="player-modal-overlay" onClick={() => setSelectedPlayer(null)}>
      <div className="player-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <PlayerWeeklyScores
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          initialSeason={modalSeason}
        />
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="scores-lineup">
      {hasMeta ? (
        <div className="scores-lineup-meta">
          {ownerName ? (
            teamLink ? (
              <Link className="scores-lineup-owner" to={teamLink}>
                {ownerAvatar ? <img className="scores-lineup-owner-avatar" src={ownerAvatar} alt="" /> : null}
                <span>{ownerName}</span>
              </Link>
            ) : (
              <span className="scores-lineup-owner">
                {ownerAvatar ? <img className="scores-lineup-owner-avatar" src={ownerAvatar} alt="" /> : null}
                <span>{ownerName}</span>
              </span>
            )
          ) : <span />}
          {hasPf ? (
            <span className="scores-lineup-pf">{Number(pfTotal).toFixed(1)} PF</span>
          ) : null}
        </div>
      ) : null}

      <div className="scores-lineup-head">
        <span className="scores-lineup-kicker">Starters</span>
        <div className="scores-lineup-head-stats">
          {showScoreCol ? (
            <div className="scores-lineup-head-col">
              <span className="scores-lineup-col-label">Score</span>
              <span className="scores-lineup-pts-actual">
                {starterSplit.actual.toFixed(1)}
              </span>
            </div>
          ) : null}
          {!weekComplete && showHprojCol && gamesStarted ? (
            <div className="scores-lineup-head-col">
              <span className="scores-lineup-col-label scores-lineup-col-label--live">Live Proj</span>
              <HprojHint
                href={hprojHref}
                value={Number.isFinite(liveProjValue) ? liveProjValue : hprojValue}
                size="lg"
                showTag={false}
                variant="live"
              />
            </div>
          ) : null}
          {!weekComplete && showHprojCol ? (
            <div className="scores-lineup-head-col">
              <span className="scores-lineup-col-label scores-lineup-col-label--hproj">HProj</span>
              <HprojHint href={hprojHref} value={hprojValue} size="lg" showTag={false} />
            </div>
          ) : !weekComplete && showProjCol ? (
            <div
              className="scores-lineup-head-col"
              title="Finished scores plus the highest remaining projections, even if that mix is not the lineup below"
            >
              <span className="scores-lineup-col-label">Proj</span>
              <span className="scores-lineup-pts-proj">
                {starterSplit.hasProj ? starterSplit.proj.toFixed(1) : '—'}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="scores-lineup-list">
        {(weekBreakdown.starters || []).map((p, i) => renderRow(p, i))}
      </div>

      <button type="button" className="scores-lineup-bench-toggle" onClick={onToggleBench}>
        <span className="scores-lineup-bench-chevron" aria-hidden="true">{benchOpen ? '▾' : '▸'}</span>
        <span className="scores-lineup-bench-label">{benchOpen ? 'Hide bench' : 'Show bench'}</span>
        <span className="scores-lineup-game-col" aria-hidden="true" />
        <div className={numsClass}>
          {showScoreCol ? (
            <span className="scores-lineup-pts-actual">
              {benchSplit.hasActual ? benchSplit.actual.toFixed(1) : '—'}
            </span>
          ) : null}
          {showProjCol ? (
            <span className="scores-lineup-pts-proj">
              {benchSplit.hasProj ? benchSplit.proj.toFixed(1) : '—'}
            </span>
          ) : null}
        </div>
      </button>

      {benchOpen ? (
        <div className="scores-lineup-list scores-lineup-list--bench">
          {benchRows.map(({ p }, i) => renderRow(p, i, { bench: true }))}
        </div>
      ) : null}

      {playerModal}
    </div>
  );
}
