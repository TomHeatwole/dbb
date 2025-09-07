import React, { useEffect, useState, useRef } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { useSearchParams, Link } from 'react-router-dom';
import { PREVIOUS_YEARS } from './global_constants';
import { CURRENT_YEAR, getDefaultDisplayWeek, getCurrentNFLWeek } from './DateHelper';
import WeekSelector from './WeekSelector';
import { fetchScoresData } from './ScoresLookup';
import { fetchTeamData } from './TeamLookup';
import { getWeekScoreBreakdown } from './ScoresParser';
import { StartSitSort } from './StartSitDecider';
import TeamScoresTables from './TeamScoresTables';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from './PlayerLookup';
import useIsMobile from './useIsMobile';
import MobileTeamScoreSummary from './MobileTeamScoreSummary';
import LeagueScoresTeamBreakdown from './LeagueScoresTeamBreakdown';
import { fetchNflScoreboard } from './GamesLookup';
import { mapPlayersToGames, getEventLabelForTeam, getGameDisplayForTeam } from './GamesParser';
import { fetchInjuriesForWeek, maybeRemapInjuriesKeysUsingPlayerIdMap } from './InjuryLookup';

const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

function MobileScaled({ children, className = 'mobile-standings-scale-70' }) {
  const innerRef = useRef(null);
  const [heightPx, setHeightPx] = useState(null);
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      setHeightPx(rect.height);
    };
    compute();
    const ro = new ResizeObserver(() => compute());
    ro.observe(el);
    window.addEventListener('resize', compute);
    return () => {
      try { ro.disconnect(); } catch (_) {}
      window.removeEventListener('resize', compute);
    };
  }, []);
  return (
    <div style={{ height: heightPx != null ? `${heightPx}px` : 'auto' }}>
      <div ref={innerRef} className={className}>
        {children}
      </div>
    </div>
  );
}

function LeagueScores() {
  // Toggle: when true, keep the current mobile summary behavior; when false, render the full web breakdown on mobile
  const showFullScoreBreakdownOnMobile = false;
  const [searchParams, setSearchParams] = useSearchParams();
  const urlYear = searchParams.get('year');
  const initialSeason = urlYear && allYears.includes(urlYear) ? urlYear : CURRENT_YEAR;
  const [season, setSeason] = useState(initialSeason);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const urlWeek = parseInt(searchParams.get('week'), 10);
  const initialWeek = !isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= 17 ? urlWeek : getDefaultDisplayWeek(season);
  const [week, setWeek] = useState(initialWeek);
  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const hasAnyExpanded = Object.values(expanded || {}).some(Boolean);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [benchOpen, setBenchOpen] = useState({});
  const isMobile = useIsMobile();
  const [playerGameLabels, setPlayerGameLabels] = useState({});
  const [injuriesMap, setInjuriesMap] = useState({});

  useEffect(() => {
    if (!dropdownOpen) { return; }
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [dropdownOpen]);

  useEffect(() => {
    if (urlYear && allYears.includes(urlYear) && season !== urlYear) {
      setSeason(urlYear);
      setDropdownOpen(false);
    }
    if (!urlYear && season !== CURRENT_YEAR) {
      setSeason(CURRENT_YEAR);
      setDropdownOpen(false);
    }
    // eslint-disable-next-line
  }, [urlYear]);

  useEffect(() => {
    if (season === CURRENT_YEAR) {
      searchParams.delete('year');
      setSearchParams(searchParams, { replace: true });
    } else if (allYears.includes(season)) {
      searchParams.set('year', season);
      setSearchParams(searchParams, { replace: true });
    }
    // Reset week to default for the selected season
    const newWeek = getDefaultDisplayWeek(season);
    setWeek(newWeek);
    // eslint-disable-next-line
  }, [season]);

  // sync week param
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('week', week);
    newParams.set('tab', 'Scores');
    setSearchParams(newParams, { replace: true });
    // eslint-disable-next-line
  }, [week]);

  useEffect(() => {
    if (!isNaN(urlWeek) && urlWeek >= 1 && urlWeek <= 17 && week !== urlWeek)  {
      setWeek(urlWeek);
    }
    // eslint-disable-next-line
  }, [urlWeek]);

  // Load league scores/teams for season
  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchScoresData(season),
      fetchTeamData(season),
      fetchPlayersData(),
      fetchPlayerIdMap()
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
        setPlayersData(null);
        setPlayerIdMap(null);
        setError('Failed to load scores');
      })
      .finally(() => setLoading(false));
  }, [season]);

  // Load injuries map for season/week (used for past weeks rendering)
  useEffect(() => {
    let cancelled = false;
    fetchInjuriesForWeek(season, week).then((m) => {
      if (!cancelled) {
        const remapped = maybeRemapInjuriesKeysUsingPlayerIdMap(m || {}, playerIdMap || {});
        setInjuriesMap(remapped);
      }
    }).catch(() => { if (!cancelled) { setInjuriesMap({}); } });
    return () => { cancelled = true; };
  }, [season, week, playerIdMap]);

  // Compute player->game labels for the selected week (web tables)
  useEffect(() => {
    if (!playersData || !playerIdMap || !weeksParsedData) { return; }
    const weekArr = Array.isArray(weeksParsedData) ? weeksParsedData[week - 1] : null;
    if (!Array.isArray(weekArr)) { return; }
    const playerIdSet = new Set();
    for (const entry of weekArr) {
      if (entry && Array.isArray(entry.players)) {
        for (const pid of entry.players) { playerIdSet.add(pid); }
      }
    }
    const playerIds = Array.from(playerIdSet);
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
          const eventId = ev && ev.id ? String(ev.id) : null;
          labels[pid] = { ...d, team: teamForWeek || null, eventId };
        }
        if (!cancelled) { setPlayerGameLabels(labels); }
      })
      .catch(() => { if (!cancelled) { setPlayerGameLabels({}); } });
    return () => { cancelled = true; };
  }, [season, week, playersData, playerIdMap, weeksParsedData]);


  function getTeamName(rosterId) {
    if (!rosters || !users) return `Team ${rosterId}`;
    const roster = rosters.find(r => String(r.roster_id) === String(rosterId));
    if (!roster) return `Team ${rosterId}`;
    const user = users.find(u => String(u.user_id) === String(roster.owner_id));
    if (user && user.metadata && user.metadata.team_name) return user.metadata.team_name;
    if (user && user.display_name) return `Team ${user.display_name}`;
    return `Team ${rosterId}`;
  }

  function getAvatar(rosterId) {
    if (!rosters || !users) return null;
    const roster = rosters.find(r => String(r.roster_id) === String(rosterId));
    if (!roster) return null;
    const user = users.find(u => String(u.user_id) === String(roster.owner_id));
    return user && user.avatar_url ? user.avatar_url : null;
  }

  function toggleExpand(rosterId) {
    setExpanded(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
  }
  function toggleBench(rosterId) {
    setBenchOpen(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
  }

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
              className={'team-scores-week-dropdown-option' + (opt === season ? ' team-scores-week-dropdown-option-active' : '')}
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
    <InfoPageWrapper title="Hwang Dynasty Scores" subtitle={null} leftHeader={leftHeader}>
      <div className="team-scores-container">
        <WeekSelector week={week} onChange={setWeek} />
      </div>
      {loading ? (
        <div>Loading scores…</div>
      ) : error || !weeksParsedData || !rosters || !users ? (
        <div>Error loading scores.</div>
      ) : (
        <div className={`standings-list standings-list--scores${hasAnyExpanded ? ' standings-list--expanded' : ''}`}>
          {(() => {
            const breakdownByRoster = getWeekScoreBreakdown(weeksParsedData, week) || {};
            const weekEntries = (Array.isArray(weeksParsedData) && weeksParsedData[week - 1] ? weeksParsedData[week - 1] : [])
              .filter(e => e && e.roster_id != null);
            const computedEntries = weekEntries.map((e) => {
              const rid = e.roster_id;
              const raw = breakdownByRoster[rid];
              const computed = raw ? StartSitSort(raw, playersData, playerIdMap) : null;
              const pts = computed ? computed.starterTotal : (typeof e.points === 'number' ? Number(e.points.toFixed(2)) : 0);
              return { rosterId: rid, points: pts, breakdown: computed };
            }).sort((a, b) => b.points - a.points);
            return computedEntries.map(({ rosterId, points, breakdown }) => {
              const teamName = getTeamName(rosterId);
              const avatarUrl = getAvatar(rosterId);
              const isExpanded = !!expanded[rosterId];
              const weekBreakdown = breakdown;
              const startersTotal = weekBreakdown ? weekBreakdown.starterTotal : 0;
              const benchTotal = weekBreakdown ? weekBreakdown.benchTotal : 0;
              const isActiveWeek = (season === CURRENT_YEAR) && (week === getCurrentNFLWeek());
              const showCurrentInjury = (String(season) === String(CURRENT_YEAR)) && (week >= getCurrentNFLWeek());

              let activeCount = 0;
              let yetToPlayCount = 0;
              if (isActiveWeek && weekBreakdown) {
                const rosterPlayerIds = [...weekBreakdown.starters, ...weekBreakdown.bench]
                  .map((p) => p && p.id)
                  .filter((pid) => pid && pid !== '0');
                for (const pid of rosterPlayerIds) {
                  const label = (playerGameLabels && playerGameLabels[pid]) ? playerGameLabels[pid] : null;
                  if (!label) { continue; }
                  const isLive = !!label.live;
                  const isCompleted = !!label.completed;
                  const isBye = label && label.text === 'BYE';
                  if (isLive) {
                    activeCount += 1;
                  } else if (!isCompleted && !isBye) {
                    yetToPlayCount += 1;
                  }
                }
              }

              return (
                <div key={rosterId} className="standings-row">
                  <button className="standings-row-header" type="button" onClick={() => toggleExpand(rosterId)}>
                    <span className={`standings-toggle-icon${isExpanded ? ' standings-toggle-icon--open' : ''}`}>{isExpanded ? '▾' : '▸'}</span>
                    <span className="standings-rank" style={{ visibility: 'hidden' }}>#</span>
                    {avatarUrl && <img className="standings-avatar" src={avatarUrl} alt={`${teamName} avatar`} />}
                    <span className="standings-title">{teamName}</span>
                    {isActiveWeek && !isMobile ? (
                      <span className="standings-activity">
                        <span className="standings-activity-item">Yet to Play: {yetToPlayCount}</span>
                        <span className="standings-activity-item">In-Play: {activeCount}</span>
                      </span>
                    ) : null}
                    <span className="standings-total">{Math.round(points * 10) / 10} pts</span>
                  </button>
                  {isExpanded && (
                    <div className="standings-row-expand">
                      {isMobile && showFullScoreBreakdownOnMobile ? (
                        <MobileTeamScoreSummary
                          weekBreakdown={weekBreakdown}
                          week={week}
                          rosterId={rosterId}
                          searchParams={searchParams}
                          isActiveWeek={isActiveWeek}
                          activeCount={activeCount}
                          yetToPlayCount={yetToPlayCount}
                        />
                      ) : (
                        isMobile ? (
                          <MobileScaled>
                            <LeagueScoresTeamBreakdown
                              weekBreakdown={weekBreakdown}
                              week={week}
                              rosterId={rosterId}
                              benchOpen={!!benchOpen[rosterId]}
                              onToggleBench={() => toggleBench(rosterId)}
                              benchTotal={benchTotal}
                              playersData={playersData}
                              playerIdMap={playerIdMap}
                              searchParams={searchParams}
                              playerGameLabels={playerGameLabels}
                              isActiveWeek={isActiveWeek}
                              injuriesMap={injuriesMap}
                              showCurrentInjury={showCurrentInjury}
                            />
                          </MobileScaled>
                        ) : (
                          <LeagueScoresTeamBreakdown
                            weekBreakdown={weekBreakdown}
                            week={week}
                            rosterId={rosterId}
                            benchOpen={!!benchOpen[rosterId]}
                            onToggleBench={() => toggleBench(rosterId)}
                            benchTotal={benchTotal}
                            playersData={playersData}
                            playerIdMap={playerIdMap}
                            searchParams={searchParams}
                            playerGameLabels={playerGameLabels}
                            isActiveWeek={isActiveWeek}
                            injuriesMap={injuriesMap}
                            showCurrentInjury={showCurrentInjury}
                          />
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
      )}
    </InfoPageWrapper>
  );
}

export default LeagueScores; 