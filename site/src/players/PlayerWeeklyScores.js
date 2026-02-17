import React, { useEffect, useState, useRef } from 'react';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';
import LoadingState from '../LoadingState';

function PlayerWeeklyScores({ player, onClose }) {
  const [season, setSeason] = useState(CURRENT_YEAR);
  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const availableYears = ['2025', '2024'];
  const hasPhoto = Boolean(player && player.espn_photo_url);
  const name = player && player.name ? player.name : '';
  const position = player && player.position ? player.position : '';
  const team = player && (player.team || player.team_abbr) ? (player.team || player.team_abbr) : null;
  const playerId = player && player.player_id ? player.player_id : null;
  const age = player && player.age ? player.age : null;
  const birthday = player && player.birth_date ? player.birth_date : null;
  const injury = player && player.injury_status ? player.injury_status : null;
  const yearsExp = player && player.years_exp ? player.years_exp : null;
  const rookieYear = player && player.metadata && player.metadata.rookie_year ? player.metadata.rookie_year : null;
  const college = player && player.college ? player.college : null;
  const highSchool = player && player.high_school ? player.high_school : null;

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchScoresData(season)
      .then((weeksData) => {
        setWeeksParsedData(weeksData);
      })
      .catch(() => {
        setError('Failed to load scoring data');
      })
      .finally(() => setLoading(false));
  }, [season]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [dropdownOpen]);

  // Extract weekly points for this player
  const weeklyScores = [];
  const currentWeek = getCurrentNFLWeek(season);
  const totalWeeks = season === CURRENT_YEAR ? Math.min(17, currentWeek) : 17;

  if (weeksParsedData && playerId) {
    for (let week = 1; week <= totalWeeks; week++) {
      const weekData = weeksParsedData[week - 1];
      let points = 0;
      
      if (weekData && Array.isArray(weekData)) {
        for (const entry of weekData) {
          if (entry && entry.players_points && entry.players_points[playerId] != null) {
            points = entry.players_points[playerId];
            break;
          }
        }
      }
      
      weeklyScores.push({
        week,
        points: Math.round(points * 10) / 10
      });
    }
  }

  const totalPoints = weeklyScores.reduce((sum, w) => sum + w.points, 0);
  const gamesPlayed = weeklyScores.filter(w => w.points > 0).length;
  const avgPoints = gamesPlayed > 0 ? Math.round((totalPoints / gamesPlayed) * 10) / 10 : 0;

  return (
    <div className="player-card player-weekly-card">
      {typeof onClose === 'function' && (
        <button
          className="player-card-close"
          type="button"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      )}
      
      <div className="player-card-content player-card-content-expanded">
        {hasPhoto && (
          <img src={player.espn_photo_url} alt={name} className="player-card-photo" />
        )}
        <div className="player-card-info-wrapper">
          <div className="player-card-text">
            <div className="player-card-name">{name}</div>
            <div className="player-card-position">
              {position}
              {team && ` • ${team}`}
            </div>
          </div>
          
          <div className="player-card-details-inline">
            {age && <span className="player-detail-inline">Age {age}</span>}
            {birthday && <span className="player-detail-inline">{birthday}</span>}
            {yearsExp && <span className="player-detail-inline">{yearsExp} yr{yearsExp !== 1 ? 's' : ''} exp</span>}
            {rookieYear && <span className="player-detail-inline">Rookie {rookieYear}</span>}
            {college && <span className="player-detail-inline">{college}</span>}
            {highSchool && <span className="player-detail-inline">{highSchool}</span>}
            {injury && <span className="player-detail-inline player-injury-status">{injury}</span>}
          </div>
        </div>
      </div>

      <div className="player-weekly-header">
        <div
          ref={dropdownRef}
          className="player-season-dropdown"
          onClick={() => setDropdownOpen(open => !open)}
        >
          {season} Season
          <span className="player-season-dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
          {dropdownOpen && (
            <div className="player-season-dropdown-list" onClick={(e) => e.stopPropagation()}>
              {availableYears.map(year => (
                <div
                  key={year}
                  className={'player-season-dropdown-option' + (year === season ? ' player-season-dropdown-option-active' : '')}
                  onClick={() => {
                    setSeason(year);
                    setDropdownOpen(false);
                  }}
                >
                  {year}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '20px' }}>
          <LoadingState label="Loading scores…" />
        </div>
      ) : error ? (
        <div style={{ padding: '20px', color: '#ff6b6b' }}>{error}</div>
      ) : (
        <>
          <div className="player-weekly-summary">
            <div className="player-weekly-stat">
              <div className="player-weekly-stat-label">Total</div>
              <div className="player-weekly-stat-value">{Math.round(totalPoints * 10) / 10}</div>
            </div>
            <div className="player-weekly-stat">
              <div className="player-weekly-stat-label">Avg</div>
              <div className="player-weekly-stat-value">{avgPoints}</div>
            </div>
            <div className="player-weekly-stat">
              <div className="player-weekly-stat-label">Games</div>
              <div className="player-weekly-stat-value">{gamesPlayed}</div>
            </div>
          </div>

          <div className="player-weekly-table-container">
            <table className="player-weekly-table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {weeklyScores.map(({ week, points }) => (
                  <tr key={week} className={points > 0 ? '' : 'player-weekly-zero'}>
                    <td>Week {week}</td>
                    <td className="player-weekly-points">
                      {points > 0 ? points.toFixed(1) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default PlayerWeeklyScores;
