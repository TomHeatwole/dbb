import React, { useEffect, useState, useMemo, useRef } from 'react';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import { trackPageLoad } from '../utils/UsageTracker';
import { useSearchParams } from 'react-router-dom';
import { PREVIOUS_YEARS } from '../utils/global_constants';
import { CURRENT_YEAR, getCurrentNFLWeek, getCompletedWeeksCount } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { getStandings } from '../scores/ScoresParser';
import HeadToHeadView from '../matchups/HeadToHeadView';
import SeasonHeadToHeadView from '../matchups/SeasonHeadToHeadView';
import WeekSelector from '../scores/WeekSelector';
import PageMeta from '../PageMeta';

const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

function H2hPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlYear = searchParams.get('year');
  const urlFormat = searchParams.get('format');
  const urlTeamA = searchParams.get('a');
  const urlTeamB = searchParams.get('b');
  const urlWeek = searchParams.get('week');
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
  const validFormats = useMemo(
    () => new Set(['season', 'seasonExpanded', 'season14', 'season14Expanded', 'weekly']),
    []
  );
  const initialFormat = validFormats.has(urlFormat) ? urlFormat : 'season';
  const [h2hFormat, setH2hFormat] = useState(initialFormat);
  const [formatDropdownOpen, setFormatDropdownOpen] = useState(false);
  const formatDropdownRef = useRef(null);
  const [h2hWeek, setH2hWeek] = useState(1);

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
      searchParams.delete('week');
      setSearchParams(searchParams, { replace: true });
    } else if (allYears.includes(season)) {
      searchParams.set('year', season);
      searchParams.delete('week');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  // Keep h2hFormat in sync with URL param (browser nav)
  useEffect(() => {
    if (urlFormat && validFormats.has(urlFormat) && urlFormat !== h2hFormat) {
      setH2hFormat(urlFormat);
      return;
    }
    if (!urlFormat && h2hFormat !== 'season') {
      setH2hFormat('season');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlFormat]);

  // Write h2hFormat back to URL without touching a/b/year
  useEffect(() => {
    const currentFormat = searchParams.get('format');
    if (h2hFormat === 'season' && (currentFormat === null || currentFormat === '')) {
      return;
    }
    if (h2hFormat !== 'season' && currentFormat === h2hFormat) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    if (h2hFormat === 'season') {
      nextParams.delete('format');
    } else {
      nextParams.set('format', h2hFormat);
    }
    // Reset any explicit week selection when switching formats
    nextParams.delete('week');
    setSearchParams(nextParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h2hFormat]);

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
        const placeByRosterId = {};
        standings.forEach((row) => {
          if (row && row.roster_id != null) {
            const key = String(row.roster_id);
            if (row.place != null) {
              seedByRosterId[key] = row.place;
            }
            placeByRosterId[key] = row.place != null ? row.place : 999;
          }
        });

        const teamsUnsorted = (teamData.rosters || []).map((roster) => {
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

        const teams = teamsUnsorted.slice().sort((a, b) => {
          const pa = placeByRosterId[String(a.rosterId)] != null ? placeByRosterId[String(a.rosterId)] : 999;
          const pb = placeByRosterId[String(b.rosterId)] != null ? placeByRosterId[String(b.rosterId)] : 999;
          if (pa !== pb) {
            return pa - pb;
          }
          return Number(a.rosterId) - Number(b.rosterId);
        });

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

  const [team1Id, team2Id] = useMemo(() => {
    if (!Array.isArray(h2hSelectedIds) || h2hSelectedIds.length !== 2) {
      return [null, null];
    }
    const a = h2hSelectedIds[0] != null ? Number(h2hSelectedIds[0]) : null;
    const b = h2hSelectedIds[1] != null ? Number(h2hSelectedIds[1]) : null;
    const safeA = Number.isFinite(a) ? a : null;
    const safeB = Number.isFinite(b) ? b : null;
    return [safeA, safeB];
  }, [h2hSelectedIds]);

  useEffect(() => {
    if (!Array.isArray(weeksParsedData) || weeksParsedData.length === 0) {
      setH2hWeek(1);
      return;
    }
    const maxWeekWithData = weeksParsedData.reduce((max, wk, idx) => {
      if (Array.isArray(wk) && wk.length > 0) {
        return Math.max(max, idx + 1);
      }
      return max;
    }, 0);

    const parsedUrlWeek = (() => {
      if (!urlWeek) { return null; }
      const n = parseInt(urlWeek, 10);
      return Number.isFinite(n) && n >= 1 && n <= 17 ? n : null;
    })();

    if (String(season) !== String(CURRENT_YEAR)) {
      const base = parsedUrlWeek != null
        ? parsedUrlWeek
        : (maxWeekWithData > 0 ? maxWeekWithData : 1);
      const upper = maxWeekWithData > 0 ? Math.min(17, maxWeekWithData) : 17;
      setH2hWeek(Math.min(upper, Math.max(1, base)));
    } else {
      const current = getCurrentNFLWeek();
      if (!Number.isFinite(current) || current < 1) {
        setH2hWeek(1);
      } else {
        const upper = maxWeekWithData > 0
          ? Math.min(current, maxWeekWithData)
          : current;
        const base = parsedUrlWeek != null ? parsedUrlWeek : current;
        setH2hWeek(Math.min(upper, Math.max(1, base)));
      }
    }
  }, [season, weeksParsedData, urlWeek]);

  const handleWeekChange = (nextWeek) => {
    setH2hWeek(nextWeek);
    const nextParams = new URLSearchParams(searchParams);
    if (!Number.isFinite(nextWeek) || nextWeek == null) {
      nextParams.delete('week');
    } else {
      nextParams.set('week', String(nextWeek));
    }
    setSearchParams(nextParams, { replace: true });
  };

  const pageTitle = 'Head to Head – The Hwang Dynasty';
  const pageDescription = 'Compare BestBall head-to-head results across seasons, formats, and weeks in The Hwang Dynasty league.';

  return (
    <>
      <PageMeta title={pageTitle} description={pageDescription} />
      <InfoPageWrapper title="Head to Head" subtitle={null} leftHeader={leftHeader}>
      <div className="yoffs-mode-row">
        <div className="yoffs-mode-dropdown-wrapper">
          <div
            ref={formatDropdownRef}
            className="team-season-dropdown yoffs-mode-dropdown"
            onClick={() => setFormatDropdownOpen(open => !open)}
          >
            <span>
              {h2hFormat === 'season'
                ? 'Season (Cumulative)'
                : h2hFormat === 'seasonExpanded'
                  ? 'Season (Expanded)'
                  : h2hFormat === 'season14'
                    ? 'Season 14-week (Cumulative)'
                    : h2hFormat === 'season14Expanded'
                      ? 'Season 14-week (Expanded)'
                      : 'Week by Week'}
            </span>
            <span className="team-season-dropdown-arrow">
              {formatDropdownOpen ? '▲' : '▼'}
            </span>
            {formatDropdownOpen && (
              <div
                className="team-season-dropdown-list"
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className={
                    'team-season-dropdown-option' +
                    (h2hFormat === 'season' ? ' team-season-dropdown-option-active' : '')
                  }
                  onClick={() => {
                    setH2hFormat('season');
                    setFormatDropdownOpen(false);
                  }}
                >
                  Season (Cumulative)
                </div>
                <div
                  className={
                    'team-season-dropdown-option' +
                    (h2hFormat === 'seasonExpanded' ? ' team-season-dropdown-option-active' : '')
                  }
                  onClick={() => {
                    setH2hFormat('seasonExpanded');
                    setFormatDropdownOpen(false);
                  }}
                >
                  Season (Expanded)
                </div>
                {(() => {
                  if (!Array.isArray(weeksParsedData) || weeksParsedData.length < 14) {
                    return false;
                  }
                  const first14HaveData = weeksParsedData
                    .slice(0, 14)
                    .every((wk) => Array.isArray(wk) && wk.length > 0);
                  if (!first14HaveData) {
                    return false;
                  }
                  const isCurrentSeasonLocal = String(season) === String(CURRENT_YEAR);
                  if (!isCurrentSeasonLocal) {
                    return true;
                  }
                  const completedWeeksForSeason = getCompletedWeeksCount(season);
                  return Number.isFinite(completedWeeksForSeason) && completedWeeksForSeason >= 14;
                })() && (
                  <>
                    <div
                      className={
                        'team-season-dropdown-option' +
                        (h2hFormat === 'season14' ? ' team-season-dropdown-option-active' : '')
                      }
                      onClick={() => {
                        setH2hFormat('season14');
                        setFormatDropdownOpen(false);
                      }}
                    >
                      Season 14-week (Cumulative)
                    </div>
                    <div
                      className={
                        'team-season-dropdown-option' +
                        (h2hFormat === 'season14Expanded' ? ' team-season-dropdown-option-active' : '')
                      }
                      onClick={() => {
                        setH2hFormat('season14Expanded');
                        setFormatDropdownOpen(false);
                      }}
                    >
                      Season 14-week (Expanded)
                    </div>
                  </>
                )}
                <div
                  className={
                    'team-season-dropdown-option' +
                    (h2hFormat === 'weekly' ? ' team-season-dropdown-option-active' : '')
                  }
                  onClick={() => {
                    setH2hFormat('weekly');
                    setFormatDropdownOpen(false);
                  }}
                >
                  Week by Week
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {h2hFormat === 'season' && weeksParsedData && playersData && playerIdMap && (
        <SeasonHeadToHeadView
          season={season}
          loading={loading}
          error={error}
          teams={teamsForSelector}
          selectedIds={h2hSelectedIds}
          onSelectionChange={handleHeadToHeadSelectionChange}
          allWeeks={matchupWeeks}
          weeksParsedData={weeksParsedData}
          playersData={playersData}
          playerIdMap={playerIdMap}
          preloadedTeamData={rosters && users ? { rosters, users } : null}
          mode="season"
          selectedWeek={h2hWeek}
          highlightThreshold={17}
          controls={
            <div className="team-scores-container">
              <WeekSelector
                week={h2hWeek}
                onChange={handleWeekChange}
                maxWeek={matchupWeeks.length > 0 ? matchupWeeks[matchupWeeks.length - 1] : 1}
              />
            </div>
          }
        />
      )}

      {h2hFormat === 'seasonExpanded' && weeksParsedData && playersData && playerIdMap && (
        <SeasonHeadToHeadView
          season={season}
          loading={loading}
          error={error}
          teams={teamsForSelector}
          selectedIds={h2hSelectedIds}
          onSelectionChange={handleHeadToHeadSelectionChange}
          allWeeks={matchupWeeks}
          weeksParsedData={weeksParsedData}
          playersData={playersData}
          playerIdMap={playerIdMap}
          preloadedTeamData={rosters && users ? { rosters, users } : null}
          mode="expanded"
          highlightThreshold={17}
        />
      )}

      {h2hFormat === 'season14' && weeksParsedData && playersData && playerIdMap && (
        <SeasonHeadToHeadView
          season={season}
          loading={loading}
          error={error}
          teams={teamsForSelector}
          selectedIds={h2hSelectedIds}
          onSelectionChange={handleHeadToHeadSelectionChange}
          allWeeks={Array.from({ length: 14 }, (_, idx) => idx + 1)}
          weeksParsedData={weeksParsedData}
          playersData={playersData}
          playerIdMap={playerIdMap}
          preloadedTeamData={rosters && users ? { rosters, users } : null}
          mode="season"
          selectedWeek={h2hWeek}
          highlightThreshold={14}
          controls={
            <div className="team-scores-container">
              <WeekSelector
                week={Math.min(h2hWeek, 14)}
                onChange={handleWeekChange}
                maxWeek={14}
              />
            </div>
          }
        />
      )}

      {h2hFormat === 'season14Expanded' && weeksParsedData && playersData && playerIdMap && (
        <SeasonHeadToHeadView
          season={season}
          loading={loading}
          error={error}
          teams={teamsForSelector}
          selectedIds={h2hSelectedIds}
          onSelectionChange={handleHeadToHeadSelectionChange}
          allWeeks={Array.from({ length: 14 }, (_, idx) => idx + 1)}
          weeksParsedData={weeksParsedData}
          playersData={playersData}
          playerIdMap={playerIdMap}
          preloadedTeamData={rosters && users ? { rosters, users } : null}
          mode="expanded"
          highlightThreshold={14}
        />
      )}

      {h2hFormat === 'weekly' && (
        <HeadToHeadView
          season={season}
          loading={loading}
          error={error}
          teams={teamsForSelector}
          selectedIds={h2hSelectedIds}
          onSelectionChange={handleHeadToHeadSelectionChange}
          weeks={[h2hWeek]}
          preloadedTeamData={rosters && users ? { rosters, users } : null}
          preloadedWeeksData={weeksParsedData}
          preloadedPlayersData={playersData}
          preloadedPlayerIdMap={playerIdMap}
          usePlayoffTheme={false}
          displaySeeds={false}
          expandedWeeksOverride={[h2hWeek]}
          showMatchup
          controls={
            <div className="team-scores-container">
              <WeekSelector
                week={h2hWeek}
                onChange={handleWeekChange}
                maxWeek={matchupWeeks.length > 0 ? matchupWeeks[matchupWeeks.length - 1] : 1}
              />
            </div>
          }
        />
      )}
    </InfoPageWrapper>
    </>
  );
}

export default H2hPage;


