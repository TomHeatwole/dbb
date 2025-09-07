import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { getWeekScoreBreakdown } from './ScoresParser';
import { getPlayerInfo } from './PlayerLookup';
import { STARTER_POSITION_NAMES } from './global_constants';
import { getDefaultDisplayWeek, CURRENT_YEAR, getCurrentNFLWeek } from './DateHelper';
import WeekSelector from './WeekSelector';
import { getInjuryAbbreviation } from './InjuryLookup';
import PlayerHover from './PlayerHover';
import { fetchNflScoreboard } from './GamesLookup';
import { mapPlayersToGames, getGameDisplayForTeam } from './GamesParser';

function formatPoints(value) {
  const num = Number(value);
  if (!isFinite(num)) { return String(value); }
  return num.toFixed(1);
}

const NUM_WEEKS = 17;

const TeamScores = forwardRef(function TeamScores({ weeksParsedData, playersData, playerIdMap }, ref) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlWeek = parseInt(searchParams.get('week'), 10);
  const initialWeek = !isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= NUM_WEEKS ? urlWeek : getDefaultDisplayWeek(searchParams.get('year'));
  const [week, setWeek] = useState(initialWeek);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const { id } = useParams();
  const rosterId = Number(id);

  const season = searchParams.get('year') ? String(searchParams.get('year')) : String(CURRENT_YEAR);
  const currentWeek = getCurrentNFLWeek(CURRENT_YEAR);
  const showCurrentInjury = String(season) === String(CURRENT_YEAR) && week >= currentWeek;

  const [playerGameLabels, setPlayerGameLabels] = useState({});

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  // Close dropdown on week change (arrow, dropdown, or query param)
  useEffect(() => {
    setDropdownOpen(false);
  }, [week]);
;
  // Update query param when week changes
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('week', week);
    newParams.set('tab', 'Scores');
    setSearchParams(newParams, { replace: true });
    // eslint-disable-next-line
  }, [week]);

  // Update week if query param changes (browser nav)
  useEffect(() => {
    if (!isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= NUM_WEEKS && week !== urlWeek)  {
      setWeek(urlWeek);
    }
    // eslint-disable-next-line
  }, [urlWeek]);

  useImperativeHandle(ref, () => ({
    resetWeek: (season) => {
      const newParams = new URLSearchParams(searchParams);
      const week = getDefaultDisplayWeek(season);
      newParams.set('week', week);
      if (season === CURRENT_YEAR) {
        newParams.delete('year');
        setSearchParams(searchParams, { replace: true });
      } else {
        newParams.set('year', season);
      }
      setSearchParams(newParams, { replace: true });
      setWeek(week);
    }
  }));

  const handleSelect = w => setWeek(w);

  // Get week breakdown for this roster
  const weekBreakdown = weeksParsedData ? getWeekScoreBreakdown(weeksParsedData, week)[rosterId] : null;

  // Compute player->game labels for this roster and week
  useEffect(() => {
    if (!playersData || !playerIdMap || !weekBreakdown) { setPlayerGameLabels({}); return; }
    const playerIds = [];
    for (const p of (weekBreakdown.starters || [])) { if (p && p.id) { playerIds.push(p.id); } }
    for (const p of (weekBreakdown.bench || [])) { if (p && p.id) { playerIds.push(p.id); } }
    if (playerIds.length === 0) { setPlayerGameLabels({}); return; }
    const seasonYear = Number(season);
    let cancelled = false;
    fetchNflScoreboard(seasonYear, week)
      .then(async (json) => {
        if (cancelled) { return; }
        const mapping = await mapPlayersToGames(playerIds, playersData, playerIdMap, json);
        const labels = {};
        for (const pid of playerIds) {
          const item = mapping[pid];
          const ev = item && item.event;
          const teamForWeek = item && item.team;
          const d = ev ? getGameDisplayForTeam(ev, teamForWeek) : { text: 'BYE', live: false };
          labels[pid] = { ...d, team: teamForWeek || null };
        }
        if (!cancelled) { setPlayerGameLabels(labels); }
      })
      .catch(() => { if (!cancelled) { setPlayerGameLabels({}); } });
    return () => { cancelled = true; };
  }, [season, week, playersData, playerIdMap, weekBreakdown]);

  const InjuryBadge = ({ info }) => {
    if (!showCurrentInjury || !info) { return null; }
    const status = info.injury_status || info.injury_notes || (info.status && /out|pup|questionable|doubtful|suspended/i.test(info.status) ? info.status : null);
    const ab = status ? getInjuryAbbreviation(status) : null;
    if (!ab) { return null; }
    return <span className="injury-badge" title={status}>{ab}</span>;
  };

  const benchRows = weekBreakdown ? [...weekBreakdown.bench].map((p) => {
    const info = getPlayerInfo(p.id, playersData, playerIdMap);
    const status = showCurrentInjury && info ? (info.injury_status || info.injury_notes || (info.status && /out|pup|questionable|doubtful|suspended|ir|injured reserve/i.test(info.status) ? info.status : null)) : null;
    const ab = status ? getInjuryAbbreviation(status) : null;
    const isDeprioritized = ab === 'O' || ab === 'P' || ab === 'PUP' || ab === 'IR';
    return { p, info, isDeprioritized };
  }).sort((a, b) => {
    if (b.p.pts !== a.p.pts) { return b.p.pts - a.p.pts; }
    if (a.isDeprioritized !== b.isDeprioritized) {
      return a.isDeprioritized ? 1 : -1; // push OUT/PUP/IR below on ties
    }
    return 0;
  }) : [];

  return (
    <div className="team-scores-container">
      <WeekSelector week={week} onChange={handleSelect} />
      {/* Week content */}
      {weekBreakdown ? (
        <div className="team-scores-tables-flex">
          <div className="team-scores-tables-col">
            <div className="team-scores-starters-bench-title">Starters</div>
            <table className="team-scores-table team-scores-table-starters-simple">
              <tbody>
                {weekBreakdown.starters.map((p, i) => {
                  const info = getPlayerInfo(p.id, playersData, playerIdMap);
                  const posLabel = STARTER_POSITION_NAMES[i] || `S${i + 1}`;
                  const gameObj = playerGameLabels && playerGameLabels[p.id] ? playerGameLabels[p.id] : { text: '' };
                  return (
                    <tr key={p.id}>
                      <td className="team-scores-pos-cell">{posLabel}</td>
                      <td className="team-scores-player-cell">
                        {info && info.espn_photo_url && (
                          <img src={info.espn_photo_url} alt={info.name} className="player-avatar player-avatar-style team-scores-player-img-margin" />
                        )}
                        <span className="player-name">
                          {info && info.name ? info.name : (p.id === '0' ? '\u00A0' : p.id)}
                          {info && info.position ? ` (${info.position})` : ''}
                          <InjuryBadge info={info} />
                        </span>
                      </td>
                      <td className="team-scores-pts-cell">{(() => {
                        const gameObj = playerGameLabels && playerGameLabels[p.id] ? playerGameLabels[p.id] : { text: '', live: false, completed: false };
                        const hasStarted = !!gameObj.live || !!gameObj.completed;
                        const displayPts = hasStarted ? formatPoints(p.pts) : '--';
                        return displayPts;
                      })()}
                        {(() => {
                          const gameObj = playerGameLabels && playerGameLabels[p.id] ? playerGameLabels[p.id] : { text: '', live: false, completed: false };
                          const hasStarted = !!gameObj.live || !!gameObj.completed;
                          return hasStarted && info && info.espn_id ? (
                            <PlayerHover info={info} season={season} week={week} gameText={gameObj.text} position={info && info.position} trigger={<span className="player-info-icon" title="Show stats">ℹ️</span>} />
                          ) : null;
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="team-scores-total-row">
                    <div className="team-scores-total-inner">Total: {weekBreakdown.starterTotal}</div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="team-scores-tables-col">
            <div className="team-scores-starters-bench-title">Bench</div>
            <table className="team-scores-table team-scores-table-bench">
              <tbody>
                {benchRows.map(({ p, info }) => {
                  const gameObj = playerGameLabels && playerGameLabels[p.id] ? playerGameLabels[p.id] : { text: '' };
                  return (
                    <tr key={p.id}>
                      <td className="team-scores-player-cell">
                        {info && info.espn_photo_url && (
                          <img src={info.espn_photo_url} alt={info.name} className="player-avatar player-avatar-style team-scores-player-img-margin" />
                        )}
                        <span className="player-name">
                          {info && info.name ? info.name : (p.id === '0' ? '\u00A0' : p.id)}
                          {info && info.position ? ` (${info.position})` : ''}
                          <InjuryBadge info={info} />
                        </span>
                      </td>
                      <td className="team-scores-pts-cell">{(() => {
                        const gameObj = playerGameLabels && playerGameLabels[p.id] ? playerGameLabels[p.id] : { text: '', live: false, completed: false };
                        const hasStarted = !!gameObj.live || !!gameObj.completed;
                        const displayPts = hasStarted ? formatPoints(p.pts) : '--';
                        return displayPts;
                      })()}
                        {(() => {
                          const gameObj = playerGameLabels && playerGameLabels[p.id] ? playerGameLabels[p.id] : { text: '', live: false, completed: false };
                          const hasStarted = !!gameObj.live || !!gameObj.completed;
                          return hasStarted && info && info.espn_id ? (
                            <PlayerHover info={info} season={season} week={week} gameText={gameObj.text} position={info && info.position} trigger={<span className="player-info-icon" title="Show stats">ℹ️</span>} />
                          ) : null;
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="team-scores-total-row">
                    <div className="team-scores-total-inner">Total: {weekBreakdown.benchTotal}</div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div>No data for this week/team.</div>
      )}
    </div>
  );
});

export default TeamScores; 