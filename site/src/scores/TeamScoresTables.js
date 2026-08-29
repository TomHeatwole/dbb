import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';
import { getInjuryAbbreviation } from '../lookups/InjuryLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import useIsMobile from '../hooks/useIsMobile';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import PositionBadge from '../PositionBadge';

export default function TeamScoresTables({ weekBreakdown, playersData, playerIdMap, renderOnly = null, totalsPlacement = 'bottom', playerGameLabels = {}, isActiveWeek = false, injuriesMap = {}, showCurrentInjury = false, playerHighlightMap = {}, playersTeamMap = {} }) {
  const isMobileView = useIsMobile();
  const [searchParams] = useSearchParams();
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const modalSeason = searchParams.get('year') || undefined;
  if (!weekBreakdown) {
    return <div>No data for this week/team.</div>;
  }
  const showTopTotals = totalsPlacement === 'top';

  function formatPlayerNameForDisplay(nameOrId) {
    const raw = nameOrId;
    if (!isMobileView) { return raw; }
    if (typeof raw !== 'string') { return raw; }
    const name = raw.trim();
    if (!name) { return raw; }
    const parts = name.split(/\s+/);
    const first = parts[0] || '';
    const last = parts.slice(1).join(' ') || '';
    if (!first && !last) { return raw; }
    const firstInitial = first ? `${first[0].toUpperCase()}.` : '';
    let lastShort = last;
    if (last && last.length > 15) {
      const hyphenIdx = last.indexOf('-');
      if (hyphenIdx > 0) {
        const prefix = last.slice(0, Math.min(hyphenIdx + 3, last.length));
        lastShort = `${prefix}...`;
      } else {
        lastShort = `${last.slice(0, 12)}...`;
      }
    }
    return `${firstInitial} ${lastShort || ''}`.trim();
  }

  function renderPlayerPts(p, gameObj, pHighlight) {
    const isProj = p && p.ptsSource === 'proj';
    const isUnplayed = !gameObj.live && !gameObj.completed && gameObj.text !== 'BYE';
    const highlightClass = pHighlight === 'up' ? ' text-up text-bold' : (pHighlight === 'down' ? ' text-down text-bold' : '');
    const showDash = !isProj && isUnplayed && Number(p.pts) === 0;
    return (
      <td className={`team-scores-pts-cell${isProj ? ' team-scores-pts-cell--proj' : ''}${highlightClass}`}>
        {showDash ? '-' : Number(p.pts || 0).toFixed(1)}
        {isProj ? <span className="proj-tag"> proj</span> : null}
      </td>
    );
  }

  function renderTotalLabel(total, isProj) {
    return (
      <>
        Total: {Number(total || 0).toFixed(1)}
        {isProj ? <span className="proj-tag"> proj</span> : ''}
      </>
    );
  }

  const startersIncludeProj = Array.isArray(weekBreakdown.starters) && weekBreakdown.starters.some((p) => p && p.ptsSource === 'proj');
  const benchIncludeProj = Array.isArray(weekBreakdown.bench) && weekBreakdown.bench.some((p) => p && p.ptsSource === 'proj');

  const InjuryBadge = ({ playerId, info }) => {
    let status = null;
    if (!isActiveWeek && injuriesMap && playerId && injuriesMap[String(playerId)]) {
      status = injuriesMap[String(playerId)];
    } else if (showCurrentInjury && info) {
      status = info.injury_status || info.injury_notes || (info.status && /out|pup|questionable|doubtful|suspended|ir|injured reserve/i.test(info.status) ? info.status : null);
    }
    const ab = status ? getInjuryAbbreviation(status) : null;
    if (!ab) { return null; }
    const isRetired = ab === 'NA';
    const label = isRetired ? 'Retired 😂' : ab;
    const cls = isRetired ? 'injury-badge injury-badge--retired' : 'injury-badge';
    return (
      <span className={cls} title={status}>{label}</span>
    );
  };

  const renderStarters = () => (
    <div className="team-scores-tables-col" style={{ width: '100%' }}>
      <div
        className={
          'team-scores-starters-bench-title' +
          (showTopTotals ? ' team-scores-starters-bench-title--with-total' : '')
        }
      >
        <span>Starters</span>
        {showTopTotals ? (
          <span className="team-scores-total-top">
            {renderTotalLabel(weekBreakdown.starterTotal, startersIncludeProj)}
          </span>
        ) : null}
      </div>
      <table className="team-scores-table team-scores-table-fixed-width" style={{ width: '100%' }}>
        <tbody>
          {weekBreakdown.starters.map((p, i) => {
            const info = getPlayerInfo(p.id, playersData, playerIdMap);
            const posLabel = STARTER_POSITION_NAMES[i] || `S${i + 1}`;
            const gameObj = playerGameLabels && playerGameLabels[p.id] ? playerGameLabels[p.id] : { text: '', live: false, team: null, completed: false, eventId: null };
            const snapshotTeam = playersTeamMap && playersTeamMap[String(p.id)];
            const teamAbbr = snapshotTeam || gameObj.team || (info && (info.team || info.team_abbr)) || null;
            const gameCellClasses = ['team-scores-game-cell'];
            const gamePillClasses = ['team-scores-game-pill'];
            if (isMobileView) {
              if (isActiveWeek && gameObj.live) {
                gameCellClasses.push('team-scores-game-live');
              } else if (isActiveWeek && gameObj.completed) {
                gameCellClasses.push('team-scores-game-completed');
              }
            } else {
              if (isActiveWeek && gameObj.live) {
                gamePillClasses.push('team-scores-game-pill--live');
              } else if (isActiveWeek && gameObj.completed) {
                gamePillClasses.push('team-scores-game-pill--completed');
              }
            }
            const pHighlight = playerHighlightMap && playerHighlightMap[String(p.id)];
            return (
              <tr
                key={p.id}
                className={info ? 'player-clickable' : undefined}
                onClick={() => info && setSelectedPlayer(info)}
              >
                <td className="team-scores-pos-cell">{posLabel}</td>
                <td className="team-scores-player-cell">
                  <img src={getPlayerLogoUrl(info && info.espn_photo_url)} alt={info && info.name ? info.name : ''} className="player-avatar player-avatar-style team-scores-player-img-margin" />
                  <span className="player-name">
                    {formatPlayerNameForDisplay(info && info.name ? info.name : (p.id === '0' ? '\u00A0' : p.id))}
                    {info && info.position ? <> <PositionBadge position={info.position} /></> : ''}
                    {teamAbbr ? <span className="team-scores-game-cell team-scores-team-abbr">{teamAbbr}</span> : null}
                    <InjuryBadge playerId={p.id} info={info} />
                  </span>
                </td>
                <td className={gameCellClasses.join(' ')}>
                  {isMobileView ? (
                    <div className="team-scores-game-text">{gameObj && gameObj.eventId ? (
                      <a href={`https://www.espn.com/nfl/game/_/gameId/${gameObj.eventId}`} target="_blank" rel="noopener noreferrer" className="team-scores-game-link">{gameObj.text}</a>
                    ) : gameObj.text}</div>
                  ) : (
                    <div className={gamePillClasses.join(' ')}>
                      <div className="team-scores-game-text">{gameObj && gameObj.eventId ? (
                        <a href={`https://www.espn.com/nfl/game/_/gameId/${gameObj.eventId}`} target="_blank" rel="noopener noreferrer" className="team-scores-game-link">{gameObj.text}</a>
                      ) : gameObj.text}</div>
                    </div>
                  )}
                </td>
                {renderPlayerPts(p, gameObj, pHighlight)}
              </tr>
            );
          })}
        </tbody>
        {!showTopTotals ? (
          <tfoot>
            <tr>
              <td colSpan={4} className={`team-scores-total-row${startersIncludeProj ? ' team-scores-total-row--proj' : ''}`}>
                <div className="team-scores-total-inner">
                  {renderTotalLabel(weekBreakdown.starterTotal, startersIncludeProj)}
                </div>
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );

  const renderBench = () => {
    const benchRows = [...weekBreakdown.bench].map((p) => {
      const info = getPlayerInfo(p.id, playersData, playerIdMap);
      const status = showCurrentInjury && info ? (info.injury_status || info.injury_notes || (info.status && /out|pup|questionable|doubtful|suspended|ir|injured reserve/i.test(info.status) ? info.status : null)) : null;
      const ab = status ? getInjuryAbbreviation(status) : null;
      const isDeprioritized = ab === 'O' || ab === 'P' || ab === 'PUP' || ab === 'IR';
      return { p, info, isDeprioritized };
    }).sort((a, b) => {
      if (b.p.pts !== a.p.pts) { return b.p.pts - a.p.pts; }
      if (a.isDeprioritized !== b.isDeprioritized) {
        return a.isDeprioritized ? 1 : -1;
      }
      return 0;
    });

    return (
      <div className="team-scores-tables-col" style={{ width: '100%' }}>
        <div
          className={
            'team-scores-starters-bench-title' +
            (showTopTotals ? ' team-scores-starters-bench-title--with-total' : '')
          }
        >
          <span>Bench</span>
          {showTopTotals ? (
            <span className="team-scores-total-top">
              {renderTotalLabel(weekBreakdown.benchTotal, benchIncludeProj)}
            </span>
          ) : null}
        </div>
        <table className="team-scores-table team-scores-table-bench" style={{ width: '100%' }}>
          <tbody>
            {benchRows.map(({ p, info }) => {
              const gameObj = playerGameLabels && playerGameLabels[p.id] ? playerGameLabels[p.id] : { text: '', live: false, team: null, completed: false, eventId: null };
              const snapshotTeam = playersTeamMap && playersTeamMap[String(p.id)];
              const teamAbbr = snapshotTeam || gameObj.team || (info && (info.team || info.team_abbr)) || null;
              const gameCellClasses = ['team-scores-game-cell'];
              const gamePillClasses = ['team-scores-game-pill'];
              if (isMobileView) {
                if (isActiveWeek && gameObj.live) {
                  gameCellClasses.push('team-scores-game-live');
                } else if (isActiveWeek && gameObj.completed) {
                  gameCellClasses.push('team-scores-game-completed');
                }
              } else {
                if (isActiveWeek && gameObj.live) {
                  gamePillClasses.push('team-scores-game-pill--live');
                } else if (isActiveWeek && gameObj.completed) {
                  gamePillClasses.push('team-scores-game-pill--completed');
                }
              }
              const pHighlight = playerHighlightMap && playerHighlightMap[String(p.id)];
              return (
                <tr
                  key={p.id}
                  className={info ? 'player-clickable' : undefined}
                  onClick={() => info && setSelectedPlayer(info)}
                >
                  <td className="team-scores-player-cell">
                    <img src={getPlayerLogoUrl(info && info.espn_photo_url)} alt={info && info.name ? info.name : ''} className="player-avatar player-avatar-style team-scores-player-img-margin" />
                    <span className="player-name">
                      {formatPlayerNameForDisplay(info && info.name ? info.name : (p.id === '0' ? '\u00A0' : p.id))}
                      {info && info.position ? <> <PositionBadge position={info.position} /></> : ''}
                      {teamAbbr ? <span className="team-scores-game-cell team-scores-team-abbr">{teamAbbr}</span> : null}
                      <InjuryBadge playerId={p.id} info={info} />
                    </span>
                  </td>
                  <td className={gameCellClasses.join(' ')}>
                    {isMobileView ? (
                      <div className="team-scores-game-text">{gameObj && gameObj.eventId ? (
                        <a href={`https://www.espn.com/nfl/game/_/gameId/${gameObj.eventId}`} target="_blank" rel="noopener noreferrer" className="team-scores-game-link">{gameObj.text}</a>
                      ) : gameObj.text}</div>
                    ) : (
                      <div className={gamePillClasses.join(' ')}>
                        <div className="team-scores-game-text">{gameObj && gameObj.eventId ? (
                          <a href={`https://www.espn.com/nfl/game/_/gameId/${gameObj.eventId}`} target="_blank" rel="noopener noreferrer" className="team-scores-game-link">{gameObj.text}</a>
                        ) : gameObj.text}</div>
                      </div>
                    )}
                  </td>
                  {renderPlayerPts(p, gameObj, pHighlight)}
                </tr>
              );
            })}
          </tbody>
          {!showTopTotals ? (
            <tfoot>
              <tr>
                <td colSpan={3} className={`team-scores-total-row${benchIncludeProj ? ' team-scores-total-row--proj' : ''}`}>
                  <div className="team-scores-total-inner">
                    {renderTotalLabel(weekBreakdown.benchTotal, benchIncludeProj)}
                  </div>
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    );
  };

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

  if (renderOnly === 'starters') {
    return <>{renderStarters()}{playerModal}</>;
  }
  if (renderOnly === 'bench') {
    return <>{renderBench()}{playerModal}</>;
  }

  return (
    <div className="team-scores-tables-flex">
      {renderStarters()}
      {renderBench()}
      {playerModal}
    </div>
  );
} 