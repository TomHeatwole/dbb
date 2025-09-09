import React, { useEffect, useState, useRef } from 'react';
import InfoPageWrapper from './InfoPageWrapper';
import { trackPageLoad } from './UsageTracker';
import { useSearchParams, Link } from 'react-router-dom';
import { PREVIOUS_YEARS, LEAGUE_ID, DEBUG_SCORES_LOG } from './global_constants';
import { CURRENT_YEAR, getDefaultDisplayWeek, getCurrentNFLWeek, shouldPollCurrentWeek } from './DateHelper';
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
  const intervalRef = useRef(null);
  const lastDbEntryTsRef = useRef(null);
  const [prevData, setPrevData] = useState(null);
  const [teamHighlightMap, setTeamHighlightMap] = useState({}); // rosterId -> 'up'|'down'|'row'
  const [playerHighlightMap, setPlayerHighlightMap] = useState({}); // rosterId -> { playerId -> 'up'|'down' }
  const labelBaselineKeyRef = useRef(null);

  function buildExpandedData(srcWeeksParsedData, targetWeek, labels) {
    if (!srcWeeksParsedData) { return null; }
    const breakdownByRoster = getWeekScoreBreakdown(srcWeeksParsedData, targetWeek) || {};
    const weekEntries = (Array.isArray(srcWeeksParsedData) && srcWeeksParsedData[targetWeek - 1] ? srcWeeksParsedData[targetWeek - 1] : [])
      .filter(e => e && e.roster_id != null);
    const rows = weekEntries.map((e) => {
      const rid = e.roster_id;
      const raw = breakdownByRoster[rid];
      const computed = raw ? StartSitSort(raw, playersData, playerIdMap, labels || playerGameLabels) : null;
      const total = computed ? computed.starterTotal : (typeof e.points === 'number' ? Number(e.points.toFixed(2)) : 0);
      const starters = computed && Array.isArray(computed.starters) ? computed.starters.map(p => ({ id: String(p.id), pts: Number(p.pts || 0) })) : [];
      const bench = computed && Array.isArray(computed.bench) ? computed.bench.map(p => ({ id: String(p.id), pts: Number(p.pts || 0) })) : [];
      return { rosterId: String(rid), total, starters, bench };
    }).sort((a, b) => b.total - a.total);
    const order = rows.map(r => r.rosterId);
    const teams = {};
    rows.forEach(r => { teams[r.rosterId] = { total: r.total, starters: r.starters, bench: r.bench }; });
    return { order, teams };
  }

  function compareExpanded(prev, next) {
    if (!prev || !next) { return []; }
    const changes = [];
    // Order changes: compute per-roster index movement
    const prevIndex = {};
    const nextIndex = {};
    (prev.order || []).forEach((rid, i) => { if (rid != null) { prevIndex[rid] = i; } });
    (next.order || []).forEach((rid, i) => { if (rid != null) { nextIndex[rid] = i; } });
    const allRostersForPlacement = new Set([...(prev.order || []), ...(next.order || [])]);
    for (const rid of allRostersForPlacement) {
      const pi = prevIndex[rid];
      const ni = nextIndex[rid];
      if (typeof pi === 'number' && typeof ni === 'number' && pi !== ni) {
        changes.push({ type: 'placement', rosterId: rid, beforeIndex: pi, afterIndex: ni, direction: ni < pi ? 'up' : 'down' });
      }
    }
    const allRosters = new Set([...(prev.order || []), ...(next.order || [])]);
    for (const rid of allRosters) {
      const pa = prev.teams[rid] || { total: 0, starters: [], bench: [] };
      const pb = next.teams[rid] || { total: 0, starters: [], bench: [] };
      const beforeDisplay = Math.round(((pa.total || 0)) * 10) / 10;
      const afterDisplay = Math.round(((pb.total || 0)) * 10) / 10;
      if (beforeDisplay !== afterDisplay) {
        changes.push({ type: 'teamTotal', rosterId: rid, before: beforeDisplay, after: afterDisplay });
      }
      // starters by slot
      const maxSlots = Math.max(pa.starters.length, pb.starters.length);
      for (let s = 0; s < maxSlots; s++) {
        const sa = pa.starters[s] || { id: null, pts: 0 };
        const sb = pb.starters[s] || { id: null, pts: 0 };
        if (sa.id !== sb.id || Math.abs((sb.pts || 0) - (sa.pts || 0)) > 0.001) {
          changes.push({ type: 'starterSlot', rosterId: rid, slot: s, before: sa, after: sb });
        }
      }
      // bench membership/pts
      const mapA = new Map((pa.bench || []).map(p => [p.id, p.pts || 0]));
      const mapB = new Map((pb.bench || []).map(p => [p.id, p.pts || 0]));
      const ids = new Set([...mapA.keys(), ...mapB.keys()]);
      ids.forEach(pid => {
        const a = mapA.has(pid) ? mapA.get(pid) : null;
        const b = mapB.has(pid) ? mapB.get(pid) : null;
        if (a === null && b !== null) { changes.push({ type: 'benchAdd', rosterId: rid, playerId: pid, after: b }); }
        else if (a !== null && b === null) { changes.push({ type: 'benchRemove', rosterId: rid, playerId: pid, before: a }); }
        else if (a !== null && b !== null && Math.abs((b || 0) - (a || 0)) > 0.001) {
          changes.push({ type: 'benchPts', rosterId: rid, playerId: pid, before: a, after: b });
        }
      });
    }
    return changes;
  }

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
    trackPageLoad();
    setLoading(true);
    setError(null);
    Promise.all([
      fetchScoresData(season),
      fetchTeamData(season),
      null,
      fetchPlayerIdMap()
    ])
      .then(async ([weeksData, teamData, _ignored, idMap]) => {
        const players = await fetchPlayersData(season === CURRENT_YEAR ? (teamData && teamData.rosters ? teamData.rosters : null) : String(season));
        setWeeksParsedData(weeksData);
        setRosters(teamData.rosters);
        setUsers(teamData.users);
        setPlayersData(players);
        setPlayerIdMap(idMap);
        try {
          const initExpanded = buildExpandedData(weeksData, week, playerGameLabels);
          setPrevData(initExpanded);
        } catch (_) {}
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

  // Align prevData baseline with first-loaded playerGameLabels for this season/week
  useEffect(() => {
    if (!weeksParsedData) { return; }
    const labelsCount = Object.keys(playerGameLabels || {}).length;
    if (labelsCount === 0) { return; }
    const key = `${season}-${week}`;
    if (labelBaselineKeyRef.current !== key) {
      try {
        const baseline = buildExpandedData(weeksParsedData, week, playerGameLabels);
        setPrevData(baseline);
      } catch (_) {}
      labelBaselineKeyRef.current = key;
    }
  }, [playerGameLabels, weeksParsedData, season, week]);

  // Reset label baseline key on season/week change
  useEffect(() => {
    labelBaselineKeyRef.current = null;
  }, [season, week]);

  // Poll for score updates every 15s only when tab is visible/focused; run an immediate tick on return
  useEffect(() => {
    let cancelled = false;
    const intervalMs = 15000;

    const tick = async () => {
      if (cancelled || document.visibilityState !== 'visible') { return; }
      if (pollingRef.current) { return; }
      pollingRef.current = true;
      try {
        // Gate polling based on ESPN schedule/status for current week's games
        const isCurrentSeason = String(season) === String(CURRENT_YEAR);
        const currentWk = getCurrentNFLWeek();
        const isActiveWeek = isCurrentSeason && (Number(week) === currentWk);
        let activeWeekTtlMs = null;
        if (isActiveWeek) {
          const espnCacheKey = `espn_site_v2_sports_football_nfl_scoreboard_week_${week}_year_${season}_seasontype_2`;
          let scoreboard = null;
          try {
            const latestE = await readApiCacheLatestByKey(espnCacheKey);
            scoreboard = latestE && latestE.data ? latestE.data : null;
          } catch (_) {}
          if (!scoreboard) {
            try { scoreboard = await fetchNflScoreboard(Number(season), Number(week)); } catch (_) {}
          }
          const shouldPoll = shouldPollCurrentWeek(scoreboard);
          activeWeekTtlMs = shouldPoll ? 60 * 1000 : 60 * 60 * 1000;
          if (!shouldPoll) {
            return; // skip this tick if no live or started games
          }
        }

        const newWeeks = await fetchScoresData(season, { activeWeekTtlMs });
        const isCurrentSeason2 = String(season) === String(CURRENT_YEAR);
        const leagueId = isCurrentSeason2 ? LEAGUE_ID : PREVIOUS_YEARS[season];
        const cacheKey = `sleeper_v1_league_${leagueId}_matchups_${week}`;
        let dbEntryTs = null;
        try {
          const latest = await readApiCacheLatestByKey(cacheKey);
          dbEntryTs = latest && latest.ts ? latest.ts : null;
        } catch (_) {}
        if (cancelled || !Array.isArray(newWeeks)) { return; }
        const nextExpanded = buildExpandedData(newWeeks, week, playerGameLabels);
        let changes = [];
        if (prevData) {
          changes = compareExpanded(prevData, nextExpanded);
        }
        const prevTs = lastDbEntryTsRef.current;
        if (DEBUG_SCORES_LOG) {
          // eslint-disable-next-line no-console
          console.log('[scores delta]', { season, week, prevDbTs: prevTs, newDbTs: dbEntryTs, changes });
        }
        if ((dbEntryTs != null && prevTs !== dbEntryTs) || changes.length > 0) {
          setWeeksParsedData(newWeeks);
          lastDbEntryTsRef.current = dbEntryTs != null ? dbEntryTs : prevTs;
          setPrevData(nextExpanded);
          const nextTeamMap = {};
          const nextPlayerMap = {};
          for (const ch of changes) {
            if (ch.type === 'teamTotal') {
              const dir = (ch.after || 0) > (ch.before || 0) ? 'up' : 'down';
              nextTeamMap[String(ch.rosterId)] = dir;
            } else if (ch.type === 'starterSlot') {
              const beforePts = (ch.before && typeof ch.before.pts === 'number') ? ch.before.pts : 0;
              const afterPts = (ch.after && typeof ch.after.pts === 'number') ? ch.after.pts : 0;
              const pid = (ch.after && ch.after.id) ? String(ch.after.id) : ((ch.before && ch.before.id) ? String(ch.before.id) : null);
              if (pid) {
                const dir = afterPts > beforePts ? 'up' : (afterPts < beforePts ? 'down' : null);
                if (dir) {
                  const rid = String(ch.rosterId);
                  if (!nextPlayerMap[rid]) { nextPlayerMap[rid] = {}; }
                  nextPlayerMap[rid][pid] = dir;
                }
              }
            } else if (ch.type === 'benchPts') {
              const dir = (ch.after || 0) > (ch.before || 0) ? 'up' : 'down';
              const rid = String(ch.rosterId);
              if (!nextPlayerMap[rid]) { nextPlayerMap[rid] = {}; }
              nextPlayerMap[rid][String(ch.playerId)] = dir;
            } else if (ch.type === 'placement') {
              if (ch.direction === 'up') {
                // Do not mark 'row' for totals; only row pulse, not total color
                nextTeamMap[String(ch.rosterId)] = 'row';
              }
            }
          }
          if (changes.length > 0) {
            setTeamHighlightMap(nextTeamMap);
            setPlayerHighlightMap(nextPlayerMap);
            setTimeout(() => {
              setTeamHighlightMap({});
              setPlayerHighlightMap({});
            }, 3000);
          }
        }
      } catch (_) {
        // ignore
      } finally {
        pollingRef.current = false;
      }
    };

    const startPolling = () => {
      if (intervalRef.current || cancelled) { return; }
      if (document.visibilityState !== 'visible') { return; }
      intervalRef.current = setInterval(() => { tick(); }, intervalMs);
    };
    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick();
        startPolling();
      } else {
        stopPolling();
      }
    };
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        tick();
        startPolling();
      }
    };
    const handleBlur = () => {
      stopPolling();
    };

    // Initialize based on current visibility
    if (document.visibilityState === 'visible') {
      startPolling();
    }
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, [season, week, weeksParsedData, playersData, playerIdMap, playerGameLabels]);


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
              const computed = raw ? StartSitSort(raw, playersData, playerIdMap, playerGameLabels) : null;
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

              const teamHighlight = teamHighlightMap && teamHighlightMap[String(rosterId)];
              const rowClass = teamHighlight === 'row' ? ' standings-row--pulse' : (teamHighlight === 'up' ? ' standings-row--up' : (teamHighlight === 'down' ? ' standings-row--down' : ''));
              return (
                <div key={rosterId} className={`standings-row${rowClass}`}>
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
                    <span className={`standings-total${teamHighlight === 'up' ? ' text-up' : (teamHighlight === 'down' ? ' text-down' : '')}`}>{Math.round(points * 10) / 10} pts</span>
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
                              playerHighlightMap={playerHighlightMap && playerHighlightMap[String(rosterId)] ? playerHighlightMap[String(rosterId)] : {}}
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
                            playerHighlightMap={playerHighlightMap && playerHighlightMap[String(rosterId)] ? playerHighlightMap[String(rosterId)] : {}}
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