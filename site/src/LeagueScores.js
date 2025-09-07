import React, { useEffect, useState, useRef } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { useSearchParams, Link } from 'react-router-dom';
import { PREVIOUS_YEARS, LEAGUE_ID } from './global_constants';
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
import { readApiCacheLatestByKey } from './database';

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
  const pollingRef = useRef(false);

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
      null,
      fetchPlayerIdMap()
    ])
      .then(async ([weeksData, teamData, _ignored, idMap]) => {
        const players = await fetchPlayersData(teamData && teamData.rosters ? teamData.rosters : null);
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

  // Poll for score updates every 15s; underlying lookups enforce their own TTLs
  useEffect(() => {
    let cancelled = false;
    const intervalMs = 15000;
    async function tick() {
      if (pollingRef.current) { return; }
      pollingRef.current = true;
      try {
        const newWeeks = await fetchScoresData(season);
        // Identify DB entry (timestamp) used for this week's Sleeper data
        const isCurrentSeason = String(season) === String(CURRENT_YEAR);
        const leagueId = isCurrentSeason ? LEAGUE_ID : PREVIOUS_YEARS[season];
        const cacheKey = `sleeper_v1_league_${leagueId}_matchups_${week}`;
        let dbEntryTs = null;
        try {
          const latest = await readApiCacheLatestByKey(cacheKey);
          dbEntryTs = latest && latest.ts ? latest.ts : null;
        } catch (_) {}
        // eslint-disable-next-line no-console
        console.log('[scores data]', { season, week, cacheKey, dbEntryTs, data: newWeeks });
        if (cancelled || !Array.isArray(newWeeks)) { return; }
        // Build computed breakdowns (starters/bench/totals) for prev and next
        const idx = (typeof week === 'number' && week >= 1) ? (week - 1) : 0;
        const prevWeekArr = Array.isArray(weeksParsedData) ? (weeksParsedData[idx] || []) : [];
        const nextWeekArr = newWeeks[idx] || [];

        const buildBreakdownMap = (weekArr) => {
          const byRoster = getWeekScoreBreakdown(Array.isArray(weeksParsedData) ? weeksParsedData : [], week) || {};
          // The helper above uses the component's weeksParsedData; for next week we need to reconstruct byRoster manually
          // Build a temporary map for the provided week array
          const tempByRoster = {};
          (weekArr || []).forEach((e) => {
            if (!e || e.roster_id == null) { return; }
            tempByRoster[e.roster_id] = { starters: e.starters || [], bench: e.bench || [] };
          });
          return tempByRoster;
        };

        const computeOptimal = (sourceMap) => {
          const out = {};
          Object.keys(sourceMap || {}).forEach((rid) => {
            const raw = sourceMap[rid];
            const computed = raw ? StartSitSort(raw, playersData, playerIdMap) : null;
            if (computed) {
              out[String(rid)] = {
                starters: Array.isArray(computed.starters) ? computed.starters.map(p => ({ id: String(p.id), pts: Number(p.pts || 0) })) : [],
                bench: Array.isArray(computed.bench) ? computed.bench.map(p => ({ id: String(p.id), pts: Number(p.pts || 0) })) : [],
                starterTotal: Number(computed.starterTotal || 0)
              };
            }
          });
          return out;
        };

        const prevRawMap = buildBreakdownMap(prevWeekArr);
        const nextRawMap = buildBreakdownMap(nextWeekArr);
        const prevOpt = computeOptimal(prevRawMap);
        const nextOpt = computeOptimal(nextRawMap);

        const changes = [];
        const rosterIds = new Set([ ...Object.keys(prevOpt || {}), ...Object.keys(nextOpt || {}) ]);
        rosterIds.forEach((rid) => {
          const before = prevOpt[rid] || { starters: [], bench: [], starterTotal: 0 };
          const after = nextOpt[rid] || { starters: [], bench: [], starterTotal: 0 };
          const teamDelta = Math.round((after.starterTotal - before.starterTotal) * 100) / 100;

          // Player score deltas across both starters and bench
          const beforeMap = new Map();
          [...before.starters, ...before.bench].forEach(p => { if (p && p.id) { beforeMap.set(p.id, Number(p.pts || 0)); } });
          const afterMap = new Map();
          [...after.starters, ...after.bench].forEach(p => { if (p && p.id) { afterMap.set(p.id, Number(p.pts || 0)); } });
          const playerIds = new Set([ ...beforeMap.keys(), ...afterMap.keys() ]);
          const playerDeltas = [];
          playerIds.forEach((pid) => {
            const b = beforeMap.has(pid) ? beforeMap.get(pid) : 0;
            const a = afterMap.has(pid) ? afterMap.get(pid) : 0;
            const d = Math.round((a - b) * 100) / 100;
            if (Math.abs(d) > 0.001) {
              playerDeltas.push({ playerId: pid, before: b, after: a, diff: d });
            }
          });

          // Movement between starters and bench
          const setOf = (arr) => new Set((arr || []).map(p => String(p.id)));
          const beforeStar = setOf(before.starters);
          const beforeBench = setOf(before.bench);
          const afterStar = setOf(after.starters);
          const afterBench = setOf(after.bench);
          const all = new Set([ ...beforeStar, ...beforeBench, ...afterStar, ...afterBench ]);
          const moves = [];
          all.forEach((pid) => {
            const from = beforeStar.has(pid) ? 'starter' : (beforeBench.has(pid) ? 'bench' : 'none');
            const to = afterStar.has(pid) ? 'starter' : (afterBench.has(pid) ? 'bench' : 'none');
            if (from !== to) {
              moves.push({ playerId: pid, from, to });
            }
          });

          if (Math.abs(teamDelta) > 0.001 || playerDeltas.length > 0 || moves.length > 0) {
            changes.push({ rosterId: rid, teamDelta, playerDeltas, moves });
          }
        });

        // eslint-disable-next-line no-console
        console.log('[scores delta]', { season, week, changes });
        if (changes.length > 0) {
          setWeeksParsedData(newWeeks);
        }
      } catch (_) {
        // ignore
      } finally {
        pollingRef.current = false;
      }
    }
    const id = setInterval(() => { tick(); }, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [season, week, weeksParsedData, playersData, playerIdMap]);


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
        <div className="loading-center">
          <div className="spinner" aria-label="Loading" />
          <div className="loading-text">Loading scores…</div>
          <img src="/logo.jpg" alt="Site logo" className="loading-logo" />
        </div>
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