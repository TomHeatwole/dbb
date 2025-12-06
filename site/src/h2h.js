import React, { useEffect, useState, useMemo } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { trackPageLoad } from './UsageTracker';
import { useSearchParams } from 'react-router-dom';
import { PREVIOUS_YEARS } from './global_constants';
import { CURRENT_YEAR, getCurrentNFLWeek } from './DateHelper';
import { fetchScoresData } from './ScoresLookup';
import { fetchTeamData } from './TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from './PlayerLookup';
import { getStandings } from './ScoresParser';
import HeadToHeadView from './HeadToHeadView';

const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

function H2hPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlYear = searchParams.get('year');
  const urlTeamA = searchParams.get('a');
  const urlTeamB = searchParams.get('b');
  const initialSeason = urlYear && allYears.includes(urlYear) ? urlYear : CURRENT_YEAR;

  const [season, setSeason] = useState(initialSeason);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [teamsForSelector, setTeamsForSelector] = useState([]);
  const [h2hSelectedIds, setH2hSelectedIds] = useState([null, null]);

  useEffect(() => {
    trackPageLoad();
  }, []);

  useEffect(() => {
    if (urlYear && allYears.includes(urlYear) && season !== urlYear) {
      setSeason(urlYear);
      setDropdownOpen(false);
    }
    if (!urlYear && season !== CURRENT_YEAR) {
      setSeason(CURRENT_YEAR);
      setDropdownOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlYear]);

  useEffect(() => {
    if (season === CURRENT_YEAR) {
      searchParams.delete('year');
      setSearchParams(searchParams, { replace: true });
    } else if (allYears.includes(season)) {
      searchParams.set('year', season);
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  useEffect(() => {
    const nextA = urlTeamA ? Number(urlTeamA) : null;
    const nextB = urlTeamB ? Number(urlTeamB) : null;
    setH2hSelectedIds((prev) => {
      if (prev[0] === nextA && prev[1] === nextB) {
        return prev;
      }
      return [nextA, nextB];
    });
  }, [urlTeamA, urlTeamB]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [weeksData, teamData, idMap] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season),
          fetchPlayerIdMap()
        ]);

        if (!weeksData || !Array.isArray(weeksData)) {
          throw new Error('No scores data');
        }
        if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
          throw new Error('No team data');
        }

        let players = null;
        try {
          const useRosters =
            String(season) === String(CURRENT_YEAR) && Array.isArray(teamData.rosters)
              ? teamData.rosters
              : String(season);
          players = await fetchPlayersData(useRosters);
        } catch (_) {
          players = null;
        }

        if (cancelled) {
          return;
        }

        setWeeksParsedData(weeksData);
        setRosters(teamData.rosters);
        setUsers(teamData.users);
        setPlayersData(players);
        setPlayerIdMap(idMap);

        const standings = getStandings(weeksData) || [];
        const seedByRosterId = {};
        standings.forEach((row) => {
          if (row && row.roster_id != null && row.place != null) {
            seedByRosterId[String(row.roster_id)] = row.place;
          }
        });

        const teams = (teamData.rosters || []).map((roster) => {
          const rid = roster && roster.roster_id != null ? Number(roster.roster_id) : null;
          if (rid == null) {
            return null;
          }
          const user = (teamData.users || []).find(
            (u) => roster && String(u.user_id) === String(roster.owner_id)
          );
          let teamName = `Team ${rid}`;
          if (user && user.metadata && user.metadata.team_name) {
            teamName = user.metadata.team_name;
          } else if (user && user.display_name) {
            teamName = `Team ${user.display_name}`;
          }
          const avatarUrl =
            (user &&
              (user.team_avatar_url || user.user_avatar_url || user.avatar_url)) ||
            null;
          const seed = seedByRosterId[String(rid)] != null ? seedByRosterId[String(rid)] : null;
          return {
            rosterId: rid,
            teamName,
            avatarUrl,
            seed,
            displaySeed: seed
          };
        }).filter(Boolean);

        setTeamsForSelector(teams);
      } catch (e) {
        if (!cancelled) {
          setWeeksParsedData(null);
          setRosters(null);
          setUsers(null);
          setPlayersData(null);
          setPlayerIdMap(null);
          setTeamsForSelector([]);
          setError('Failed to load head to head data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [season]);

  const isCurrentSeason = String(season) === String(CURRENT_YEAR);
  const lastWeek = isCurrentSeason ? getCurrentNFLWeek() : 17;
  const matchupWeeks = useMemo(() => {
    if (!lastWeek || !Number.isFinite(lastWeek) || lastWeek < 1) {
      return [];
    }
    const capped = isCurrentSeason ? Math.min(17, lastWeek) : 17;
    return Array.from({ length: capped }, (_, idx) => idx + 1);
  }, [lastWeek, isCurrentSeason]);

  const seedByRosterId = useMemo(() => {
    const map = {};
    (teamsForSelector || []).forEach((t) => {
      if (!t || t.rosterId == null) {
        return;
      }
      if (t.seed != null) {
        map[String(t.rosterId)] = t.seed;
      }
    });
    return map;
  }, [teamsForSelector]);

  const handleHeadToHeadSelectionChange = (nextSlots) => {
    const safe = Array.isArray(nextSlots) ? nextSlots.slice(0, 2) : [null, null];
    while (safe.length < 2) {
      safe.push(null);
    }
    setH2hSelectedIds(safe);
    const [teamA, teamB] = safe;
    const newParams = new URLSearchParams(searchParams);
    if (teamA == null) {
      newParams.delete('a');
    } else {
      newParams.set('a', String(teamA));
    }
    if (teamB == null) {
      newParams.delete('b');
    } else {
      newParams.set('b', String(teamB));
    }
    setSearchParams(newParams, { replace: true });
  };

  const leftHeader = (
    <div
      className="team-season-dropdown"
      onClick={() => setDropdownOpen((open) => !open)}
    >
      {season}
      <span className="team-season-dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
      {dropdownOpen && (
        <div
          className="team-season-dropdown-list"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {allYears.map((opt) => (
            <div
              key={opt}
              className={
                'team-season-dropdown-option' +
                (opt === season ? ' team-season-dropdown-option-active' : '')
              }
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
    <InfoPageWrapper title="Head to Head View" subtitle={null} leftHeader={leftHeader}>
      <HeadToHeadView
        season={season}
        loading={loading}
        error={error}
        teams={teamsForSelector}
        selectedIds={h2hSelectedIds}
        onSelectionChange={handleHeadToHeadSelectionChange}
        weeks={matchupWeeks}
        preloadedTeamData={rosters && users ? { rosters, users } : null}
        preloadedWeeksData={weeksParsedData}
        preloadedPlayersData={playersData}
        preloadedPlayerIdMap={playerIdMap}
        usePlayoffTheme={false}
        displaySeeds
        expandedWeeksOverride={null}
      />
    </InfoPageWrapper>
  );
}

export default H2hPage;


