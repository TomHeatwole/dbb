import React, { useEffect, useState, useRef } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { trackPageLoad } from './UsageTracker';
import { fetchScoresData } from './ScoresLookup';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from './TeamLookup';
import { getStandings } from './ScoresParser';
import { CURRENT_YEAR } from './DateHelper';
import { PREVIOUS_YEARS } from './global_constants';

function YoffsPage() {
  const [season, setSeason] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topTeams, setTopTeams] = useState([]);
  const [yearDropdownOpen, setYearDropdownOpen] = useState(false);
  const yearDropdownRef = useRef(null);

  const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

  useEffect(() => {
    trackPageLoad();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [weeksParsedData, teamData] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season)
        ]);

        if (!weeksParsedData || !Array.isArray(weeksParsedData)) {
          throw new Error('No scores data');
        }
        if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
          throw new Error('No team data');
        }

        const standings = getStandings(weeksParsedData) || [];
        const rosterIdToTeamInfo = buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users);

        const top4 = standings
          .slice(0, 4)
          .map((row) => {
            const rid = row.roster_id;
            const info = rosterIdToTeamInfo[rid] || {};
            return {
              rosterId: rid,
              teamName: info.teamName || `Team ${rid}`,
              ownerName: info.ownerName || null,
              pointsScored: row.points_scored
            };
          });

        if (!cancelled) {
          setTopTeams(top4);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError('Failed to load top teams');
          setTopTeams([]);
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [season]);

  useEffect(() => {
    if (!yearDropdownOpen) {
      return;
    }
    const handleClickOutside = (e) => {
      if (yearDropdownRef.current && !yearDropdownRef.current.contains(e.target)) {
        setYearDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [yearDropdownOpen]);

  const leftHeader = (
    <div className="yoffs-header-filters">
      <div
        ref={yearDropdownRef}
        className="team-season-dropdown"
        onClick={() => setYearDropdownOpen(open => !open)}
      >
        {season}
        <span className="team-season-dropdown-arrow">{yearDropdownOpen ? '▲' : '▼'}</span>
        {yearDropdownOpen && (
          <div className="team-season-dropdown-list" onClick={(e) => e.stopPropagation()}>
            {allYears.map(opt => (
              <div
                key={opt}
                className={'team-season-dropdown-option' + (opt === season ? ' team-season-dropdown-option-active' : '')}
                onClick={() => {
                  setSeason(opt);
                  setYearDropdownOpen(false);
                }}
              >
                {opt}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="team-season-dropdown yoffs-mode-dropdown">
        <span>(bracket 2024 rules)</span>
        <span className="team-season-dropdown-arrow">▼</span>
      </div>
    </div>
  );

  let content = null;
  if (loading) {
    content = (
      <div className="loading-center">
        <div className="spinner" aria-label="Loading" />
        <div className="loading-text">Loading top teams…</div>
      </div>
    );
  } else if (error) {
    content = <div>{error}</div>;
  } else if (!topTeams.length) {
    content = <div>No teams found.</div>;
  } else {
    content = (
      <ol className="yoffs-top4-list">
        {topTeams.map((t) => (
          <li key={t.rosterId} className="yoffs-top4-item">
            <span className="yoffs-top4-name">{t.teamName}</span>
            {t.ownerName ? (
              <span className="yoffs-top4-owner"> ({t.ownerName})</span>
            ) : null}
            <span className="yoffs-top4-points">
              {' '}
              – {t.pointsScored.toFixed(1)} pts
            </span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <InfoPageWrapper title="Yoffs" subtitle="Top 4 teams by points scored" leftHeader={leftHeader}>
      {content}
    </InfoPageWrapper>
  );
}

export default YoffsPage;

