import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import { getStandings, getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';
import { CURRENT_YEAR, getCurrentNFLWeek, getCompletedWeeksCount } from '../utils/DateHelper';
import { PREVIOUS_YEARS } from '../utils/global_constants';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import Teams2TeamCard from './Teams2TeamCard';
import { trackPageLoad } from '../utils/UsageTracker';

const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

function Teams2Hub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlYear = searchParams.get('year');
  const initialSeason = urlYear && allYears.includes(urlYear) ? urlYear : CURRENT_YEAR;
  const [season, setSeason] = useState(initialSeason);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trackPageLoad();
  }, []);

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

  useEffect(() => {
    if (season === CURRENT_YEAR) {
      searchParams.delete('year');
    } else {
      searchParams.set('year', season);
    }
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line
  }, [season]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchScoresData(season),
      fetchTeamData(season),
      fetchPlayersData(),
      fetchPlayerIdMap(),
    ])
      .then(([weeksData, teamData, players, idMap]) => {
        setWeeksParsedData(weeksData);
        setRosters(teamData.rosters);
        setUsers(teamData.users);
        setPlayersData(players);
        setPlayerIdMap(idMap);
      })
      .catch(() => {
        setWeeksParsedData(null);
        setRosters(null);
        setUsers(null);
      })
      .finally(() => setLoading(false));
  }, [season]);

  const playerSeasonTotalsMap = useMemo(() => {
    return getPlayerSeasonTotalsMap(weeksParsedData);
  }, [weeksParsedData]);

  const teamData = useMemo(() => {
    if (!weeksParsedData || !rosters || !users || !playersData || !playerIdMap) return [];

    const isCurrentSeason = season === CURRENT_YEAR;
    const completedWeeks = getCompletedWeeksCount(season);
    const currentWeek = getCurrentNFLWeek(season);

    const standings = getStandings(weeksParsedData) || [];

    // Compute live-adjusted totals for current season
    const liveTotals = {};
    for (const s of standings) {
      let total = s.points_scored || 0;
      if (isCurrentSeason && playersData && playerIdMap) {
        try {
          const breakdown = getWeekScoreBreakdown(weeksParsedData, currentWeek) || {};
          const raw = breakdown[s.roster_id];
          if (raw) {
            const computed = StartSitSort(raw, playersData, playerIdMap, null, null, playerSeasonTotalsMap);
            if (computed && typeof computed.starterTotal === 'number') {
              const priorWeeks = (weeksParsedData || []).slice(0, currentWeek - 1);
              const priorSum = priorWeeks.reduce((sum, wk) => {
                if (!Array.isArray(wk)) return sum;
                const e = wk.find(x => x && Number(x.roster_id) === Number(s.roster_id));
                return sum + (e && typeof e.points === 'number' ? e.points : 0);
              }, 0);
              total = Math.round((priorSum + computed.starterTotal) * 10) / 10;
            }
          }
        } catch (_) {}
      }
      liveTotals[s.roster_id] = total;
    }

    // Sort by live total descending
    const sorted = standings.slice().sort((a, b) => {
      return (liveTotals[b.roster_id] || 0) - (liveTotals[a.roster_id] || 0);
    });

    // Per-week scores for sparkline
    const weeklyScoresByRoster = {};
    const weeksToShow = isCurrentSeason ? Math.min(currentWeek, 17) : 17;
    for (let w = 1; w <= weeksToShow; w++) {
      const weekArr = weeksParsedData[w - 1];
      if (!Array.isArray(weekArr)) continue;
      for (const entry of weekArr) {
        if (!entry || entry.roster_id == null) continue;
        if (!weeklyScoresByRoster[entry.roster_id]) weeklyScoresByRoster[entry.roster_id] = [];
        weeklyScoresByRoster[entry.roster_id].push(
          typeof entry.points === 'number' ? Math.round(entry.points * 10) / 10 : 0
        );
      }
    }

    return sorted.map((s, idx) => {
      const roster = rosters.find(r => Number(r.roster_id) === Number(s.roster_id));
      const user = roster
        ? users.find(u => String(u.user_id) === String(roster.owner_id))
        : null;
      let teamName = `Team ${s.roster_id}`;
      if (user?.metadata?.team_name) teamName = user.metadata.team_name;
      else if (user?.display_name) teamName = `Team ${user.display_name}`;
      const ownerName = user?.display_name || 'Unknown';
      const avatarUrl = user?.team_avatar_url || user?.user_avatar_url || user?.avatar_url || null;

      const totalPF = liveTotals[s.roster_id] || 0;
      const weeksPlayed = completedWeeks > 0 ? completedWeeks : (isCurrentSeason ? Math.max(1, currentWeek - 1) : 17);
      const ppg = weeksPlayed > 0 ? (totalPF / weeksPlayed).toFixed(1) : '0.0';

      // Top 3 players by search_rank
      const playerIds = roster?.players || [];
      const topPlayers = playerIds
        .map(pid => getPlayerInfo(pid, playersData, playerIdMap))
        .filter(p => p && ['QB', 'RB', 'WR', 'TE'].includes(p.position))
        .sort((a, b) => (a.search_rank || 9999999) - (b.search_rank || 9999999))
        .slice(0, 3);

      return {
        rosterId: s.roster_id,
        teamName,
        ownerName,
        avatarUrl,
        rank: idx + 1,
        totalPF,
        ppg,
        recentScores: weeklyScoresByRoster[s.roster_id] || [],
        topPlayers,
      };
    });
  }, [weeksParsedData, rosters, users, playersData, playerIdMap, season, playerSeasonTotalsMap]);

  const leftHeader = (
    <div
      ref={dropdownRef}
      className="team-season-dropdown"
      onClick={() => setDropdownOpen(open => !open)}
    >
      {season}
      <span className="team-season-dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
      {dropdownOpen && (
        <div className="team-season-dropdown-list" onClick={(e) => e.stopPropagation()}>
          {allYears.map(opt => (
            <div
              key={opt}
              className={'team-season-dropdown-option' + (opt === season ? ' team-season-dropdown-option-active' : '')}
              onClick={() => {
                setSeason(opt);
                setDropdownOpen(false);
              }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      <PageMeta title="Teams - The Hwang Dynasty" />
      <InfoPageWrapper title="Teams" leftHeader={leftHeader}>
        {loading ? (
          <LoadingState label="Loading teams..." />
        ) : (
          <div className="teams2-grid">
            {teamData.map(t => (
              <Teams2TeamCard
                key={t.rosterId}
                rosterId={t.rosterId}
                teamName={t.teamName}
                ownerName={t.ownerName}
                avatarUrl={t.avatarUrl}
                rank={t.rank}
                totalPF={t.totalPF}
                ppg={t.ppg}
                recentScores={t.recentScores}
                topPlayers={t.topPlayers}
                season={season !== CURRENT_YEAR ? season : null}
              />
            ))}
          </div>
        )}
      </InfoPageWrapper>
    </>
  );
}

export default Teams2Hub;
