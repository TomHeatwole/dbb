import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { getWeekScoreBreakdown } from './ScoresParser';
import { getPlayerInfo } from './PlayerLookup';
import { STARTER_POSITION_NAMES } from './global_constants';

const NUM_WEEKS = 17;

function TeamScores({ weeksParsedData, playersData, playerIdMap }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlWeek = parseInt(searchParams.get('week'), 10);
  const initialWeek = !isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= NUM_WEEKS ? urlWeek : 1;
  const [week, setWeek] = useState(initialWeek);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const { id } = useParams();
  const rosterId = Number(id);

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
    if (!isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= NUM_WEEKS && week !== urlWeek) setWeek(urlWeek);
    if ((isNaN(urlWeek) || urlWeek < 1 || urlWeek > NUM_WEEKS) && week !== 1) setWeek(1);
    // eslint-disable-next-line
  }, [urlWeek]);

  const handleArrow = dir => {
    setWeek(w => Math.max(1, Math.min(NUM_WEEKS, w + dir)));
  };

  const handleSelect = w => {
    setWeek(w);
    setDropdownOpen(false);
  };

  // Get week breakdown for this roster
  const weekBreakdown = weeksParsedData ? getWeekScoreBreakdown(weeksParsedData, week)[rosterId] : null;

  return (
    <div className="team-scores-container">
      <div className="team-scores-week-bar">
        <button
          className="team-scores-arrow"
          onClick={() => handleArrow(-1)}
          disabled={week === 1}
          aria-label="Previous Week"
        >
          &#8592;
        </button>
        <div
          className="team-scores-week-dropdown"
          onClick={() => setDropdownOpen(open => !open)}
          ref={dropdownRef}
        >
          Week {week}
          <span className="team-scores-week-dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
          {dropdownOpen && (
            <div className="team-scores-week-dropdown-list">
              {[...Array(NUM_WEEKS)].map((_, i) => (
                <div
                  key={i + 1}
                  className={
                    'team-scores-week-dropdown-option' +
                    (week === i + 1 ? ' team-scores-week-dropdown-option-active' : '')
                  }
                  onClick={() => handleSelect(i + 1)}
                >
                  Week {i + 1}
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          className="team-scores-arrow"
          onClick={() => handleArrow(1)}
          disabled={week === NUM_WEEKS}
          aria-label="Next Week"
        >
          &#8594;
        </button>
      </div>
      {/* Week content */}
      {weekBreakdown ? (
        <div className="team-scores-tables-flex">
          <div className="team-scores-tables-col">
            <div style={{ fontWeight: 600, fontSize: '1.1em', marginBottom: 8 }}>Starters</div>
            <table className="team-scores-table">
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Player</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {weekBreakdown.starters.map((p, i) => {
                  const info = getPlayerInfo(p.id, playersData, playerIdMap);
                  const posLabel = STARTER_POSITION_NAMES[i] || `S${i + 1}`;
                  return (
                    <tr key={p.id}>
                      <td className="team-scores-pos-cell">{posLabel}</td>
                      <td className="team-scores-player-cell">
                        {info && info.espn_photo_url && (
                          <img src={info.espn_photo_url} alt={info.name} className="player-avatar player-avatar-style" style={{ marginRight: 8 }} />
                        )}
                        <span className="player-name">{info && info.name ? info.name : (p.id === '0' ? '\u00A0' : p.id)}</span>
                      </td>
                      <td className="team-scores-pts-cell">{p.pts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="team-scores-total">Total: {weekBreakdown.starterTotal}</div>
          </div>
          <div className="team-scores-tables-col">
            <div style={{ fontWeight: 600, fontSize: '1.1em', marginBottom: 8 }}>Bench</div>
            <table className="team-scores-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {weekBreakdown.bench.map((p, i) => {
                  const info = getPlayerInfo(p.id, playersData, playerIdMap);
                  return (
                    <tr key={p.id}>
                      <td className="team-scores-player-cell">
                        {info && info.espn_photo_url && (
                          <img src={info.espn_photo_url} alt={info.name} className="player-avatar player-avatar-style" style={{ marginRight: 8 }} />
                        )}
                        <span className="player-name">{info && info.name ? info.name : (p.id === 0 ? '' : p.id)}</span>
                      </td>
                      <td className="team-scores-pts-cell">{p.pts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="team-scores-total">Total: {weekBreakdown.benchTotal}</div>
          </div>
        </div>
      ) : (
        <div>No data for this week/team.</div>
      )}
    </div>
  );
}

export default TeamScores; 