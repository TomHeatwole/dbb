import React, { useEffect, useState, useRef, useMemo } from 'react';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import { trackPageLoad } from '../utils/UsageTracker';
import { useSearchParams, Link } from 'react-router-dom';
import { PREVIOUS_YEARS } from '../utils/global_constants';
import { CURRENT_YEAR, getCurrentNFLWeek, getCompletedWeeksCount, isCurrentWeekCompleted } from '../utils/DateHelper';
import { getStandings, getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { StartSitSort } from '../players/StartSitDecider';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import useIsMobile from '../hooks/useIsMobile';
import PlayoffRaceGraph from '../standings/PlayoffRaceGraph';
import YoffsLink from '../yoffs/YoffsLink';
import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { mapPlayersToGames, getGameDisplayForTeam, isScoreboardWeekComplete } from '../scores/GamesParser';
import StandingsRowHeader from '../standings/StandingsRowHeader';
import PageMeta from '../PageMeta';
import LoadingState from '../LoadingState';
import { useMyRosterId, isMyRoster } from '../hooks/useAuthUser';

const OG_TITLE = 'Standings – The Hwang Dynasty';
const OG_DESCRIPTION = '';

const allYears = [CURRENT_YEAR, ...Object.keys(PREVIOUS_YEARS)].sort((a, b) => b - a);

function getAvailableYearsAndDefault() {
  const isPreSeason = getCompletedWeeksCount(CURRENT_YEAR) === 0;
  const prevYears = Object.keys(PREVIOUS_YEARS).sort((a, b) => b - a);
  const availableYears = isPreSeason ? prevYears : allYears;
  const defaultSeason = isPreSeason && prevYears.length > 0 ? prevYears[0] : CURRENT_YEAR;
  return { availableYears, defaultSeason, isPreSeason };
}

function LeagueStandings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { availableYears, defaultSeason, isPreSeason } = getAvailableYearsAndDefault();
  const urlYear = searchParams.get('year');
  const initialSeason = urlYear && availableYears.includes(urlYear) ? urlYear : defaultSeason;
  const [season, setSeason] = useState(initialSeason);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const isMobile = useIsMobile();
  const myRosterId = useMyRosterId(rosters, users);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [currentWeekLabels, setCurrentWeekLabels] = useState({}); // pid -> { live, completed, text }
  const [isCurrentWeekDoneByGames, setIsCurrentWeekDoneByGames] = useState(false);

  // Season/week context and DB-aware completed weeks
  const isCurrentSeason = season === CURRENT_YEAR;
  const completedWeeksBase = isCurrentSeason ? getCompletedWeeksCount() : getCompletedWeeksCount(season);
  const [completedWeeks, setCompletedWeeks] = useState(completedWeeksBase);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isCurrentSeason) { setCompletedWeeks(completedWeeksBase); return; }
      try {
        const done = await isCurrentWeekCompleted(season);
        const cw = getCurrentNFLWeek(season);
        const val = done ? Math.max(completedWeeksBase, cw) : completedWeeksBase;
        if (!cancelled) setCompletedWeeks(val);
      } catch (_) {
        if (!cancelled) setCompletedWeeks(completedWeeksBase);
      }
    })();
    return () => { cancelled = true; };
  }, [season, completedWeeksBase, isCurrentSeason]);

  useEffect(() => {
    trackPageLoad();
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
    if (urlYear && availableYears.includes(urlYear) && season !== urlYear) {
      setSeason(urlYear);
      setDropdownOpen(false);
    }
    if (!urlYear) {
      const target = isPreSeason ? defaultSeason : CURRENT_YEAR;
      if (season !== target) {
        setSeason(target);
        setDropdownOpen(false);
      }
    }
    // eslint-disable-next-line
  }, [urlYear]);

  useEffect(() => {
    if (season === CURRENT_YEAR) {
      searchParams.delete('year');
      setSearchParams(searchParams, { replace: true });
    } else if (availableYears.includes(season)) {
      searchParams.set('year', season);
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line
  }, [season]);

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
        setError('Failed to load standings');
      })
      .finally(() => setLoading(false));
  }, [season]);

  // Build current week player game labels (live/completed) matching LeagueScores logic
  useEffect(() => {
    const isCurrentSeason = season === CURRENT_YEAR;
    if (!isCurrentSeason || !weeksParsedData || !playersData || !playerIdMap) {
      setCurrentWeekLabels({});
      setIsCurrentWeekDoneByGames(false);
      return;
    }
    const currentWeekNum = getCurrentNFLWeek();
    const weekArr = Array.isArray(weeksParsedData) ? weeksParsedData[currentWeekNum - 1] : null;
    if (!Array.isArray(weekArr)) { setCurrentWeekLabels({}); return; }
    const playerIdSet = new Set();
    for (const entry of weekArr) {
      if (entry) {
        let playersArray = entry.players;
        // If players array is empty/missing, fall back to roster data
        if ((!playersArray || playersArray.length === 0) && rosters && Array.isArray(rosters)) {
          const roster = rosters.find(r => r && Number(r.roster_id) === Number(entry.roster_id));
          if (roster && Array.isArray(roster.players)) {
            playersArray = roster.players;
          }
        }
        if (Array.isArray(playersArray)) {
          for (const pid of playersArray) { playerIdSet.add(pid); }
        }
      }
    }
    const playerIds = Array.from(playerIdSet);
    if (playerIds.length === 0) { setCurrentWeekLabels({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const json = await fetchNflScoreboard(Number(season), Number(currentWeekNum));
        try {
          setIsCurrentWeekDoneByGames(isScoreboardWeekComplete(json));
        } catch (_) {
          setIsCurrentWeekDoneByGames(false);
        }
        const mapping = await mapPlayersToGames(playerIds, playersData, playerIdMap, json);
        const labels = {};
        for (const pid of playerIds) {
          const item = mapping[pid];
          const ev = item && item.event;
          const teamForWeek = item && item.team;
          const d = ev ? getGameDisplayForTeam(ev, teamForWeek) : { text: 'BYE', live: false };
          labels[pid] = { ...d, team: teamForWeek || null };
        }
        if (!cancelled) setCurrentWeekLabels(labels);
      } catch (_) {
        if (!cancelled) {
          setCurrentWeekLabels({});
          setIsCurrentWeekDoneByGames(false);
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, weeksParsedData, playersData, playerIdMap]);

  const playerSeasonTotalsMap = useMemo(() => {
    return getPlayerSeasonTotalsMap(weeksParsedData);
  }, [weeksParsedData]);

  // Bracket-aware top-4 placement (matches /yoffs bracket behavior, including Semis Buffer).
  // Must be defined as a hook before any early returns.
  const bracketTop4PlaceMap = useMemo(() => {
    try {
      const isSeason2024 = String(season) === '2024';
      if (isSeason2024) {
        return null;
      }
      const playoffsFinished =
        Number.isFinite(Number(completedWeeks)) &&
        Number(completedWeeks) >= 17 &&
        (!isCurrentSeason || isCurrentWeekDoneByGames);
      if (!playoffsFinished) {
        return null;
      }
      if (!weeksParsedData || !Array.isArray(weeksParsedData)) {
        return null;
      }
      if (!rosters || !users || !playersData || !playerIdMap) {
        return null;
      }

      // Seeds are top 4 after regular season (Weeks 1-14).
      const weeksFirst14Local = weeksParsedData.slice(0, 14).filter(Boolean);
      const standings14Local = getStandings(weeksFirst14Local) || [];
      const top4IdsLocal = standings14Local
        .slice()
        .sort((a, b) => (a.place || 999) - (b.place || 999))
        .slice(0, 4)
        .map((r) => Number(r.roster_id));
      if (top4IdsLocal.length < 4) {
        return null;
      }

      const seeds = top4IdsLocal.slice(0, 4).map((rid, idx) => ({
        rosterId: Number(rid),
        seed: idx + 1,
      }));
      const seed1 = seeds.find((s) => s.seed === 1);
      const seed2 = seeds.find((s) => s.seed === 2);
      const seed3 = seeds.find((s) => s.seed === 3);
      const seed4 = seeds.find((s) => s.seed === 4);
      if (!seed1 || !seed2 || !seed3 || !seed4) {
        return null;
      }

      const playerSeasonTotalsMapLocal = getPlayerSeasonTotalsMap(weeksParsedData);

      function computeWeekTotal(rid, weekNum) {
        const weekArr = Array.isArray(weeksParsedData) ? weeksParsedData[weekNum - 1] : null;
        const entry = Array.isArray(weekArr)
          ? weekArr.find((e) => e && Number(e.roster_id) === Number(rid))
          : null;
        let total =
          entry && typeof entry.points === 'number' && Number.isFinite(entry.points)
            ? Math.round(entry.points * 10) / 10
            : 0;
        try {
          const breakdown = getWeekScoreBreakdown(weeksParsedData, weekNum, rosters) || {};
          const teamScore = breakdown && breakdown[rid];
          if (teamScore) {
            const computed = StartSitSort(
              teamScore,
              playersData,
              playerIdMap,
              null,
              null,
              playerSeasonTotalsMapLocal
            );
            if (computed && typeof computed.starterTotal === 'number') {
              total = Math.round(computed.starterTotal * 10) / 10;
            }
          }
        } catch (_) {
          // keep Sleeper API points fallback
        }
        return total;
      }

      // Semifinals are cumulative Weeks 15-16.
      const semiTotals = {};
      const semiStart = 15;
      const semiEnd = 16;
      for (let wk = semiStart; wk <= semiEnd; wk += 1) {
        for (const s of seeds) {
          if (!semiTotals[s.rosterId]) {
            semiTotals[s.rosterId] = 0;
          }
          semiTotals[s.rosterId] += computeWeekTotal(s.rosterId, wk);
        }
      }

      // Winners with seed tiebreaker (lower seed wins ties).
      const topWinner =
        (semiTotals[seed1.rosterId] || 0) > (semiTotals[seed4.rosterId] || 0) ||
        ((semiTotals[seed1.rosterId] || 0) === (semiTotals[seed4.rosterId] || 0) &&
          (seed1.seed || 999) < (seed4.seed || 999))
          ? seed1
          : seed4;
      const topLoser = topWinner.rosterId === seed1.rosterId ? seed4 : seed1;

      const bottomWinner =
        (semiTotals[seed2.rosterId] || 0) > (semiTotals[seed3.rosterId] || 0) ||
        ((semiTotals[seed2.rosterId] || 0) === (semiTotals[seed3.rosterId] || 0) &&
          (seed2.seed || 999) < (seed3.seed || 999))
          ? seed2
          : seed3;
      const bottomLoser = bottomWinner.rosterId === seed2.rosterId ? seed3 : seed2;

      // Finals week is Week 17 plus the "Semis Buffer" awarded to higher semi scorer.
      const finalsWeek = 17;
      const finalsTotals = {
        [topWinner.rosterId]: computeWeekTotal(topWinner.rosterId, finalsWeek),
        [bottomWinner.rosterId]: computeWeekTotal(bottomWinner.rosterId, finalsWeek),
      };

      const topWinnerSemi = semiTotals[topWinner.rosterId] || 0;
      const bottomWinnerSemi = semiTotals[bottomWinner.rosterId] || 0;
      const highSemi = Math.max(topWinnerSemi, bottomWinnerSemi);
      const lowSemi = Math.min(topWinnerSemi, bottomWinnerSemi);
      const buffer = highSemi > lowSemi ? (highSemi - lowSemi) / 2 : 0;
      if (buffer > 0) {
        if (topWinnerSemi > bottomWinnerSemi) {
          finalsTotals[topWinner.rosterId] =
            Math.round((finalsTotals[topWinner.rosterId] + buffer) * 10) / 10;
        } else if (bottomWinnerSemi > topWinnerSemi) {
          finalsTotals[bottomWinner.rosterId] =
            Math.round((finalsTotals[bottomWinner.rosterId] + buffer) * 10) / 10;
        }
      }

      const champion =
        (finalsTotals[topWinner.rosterId] || 0) > (finalsTotals[bottomWinner.rosterId] || 0) ||
        ((finalsTotals[topWinner.rosterId] || 0) === (finalsTotals[bottomWinner.rosterId] || 0) &&
          (topWinner.seed || 999) < (bottomWinner.seed || 999))
          ? topWinner
          : bottomWinner;
      const runnerUp = champion.rosterId === topWinner.rosterId ? bottomWinner : topWinner;

      // 3rd/4th: semifinal losers ranked by semifinal total (seed tiebreaker).
      const third =
        (semiTotals[topLoser.rosterId] || 0) > (semiTotals[bottomLoser.rosterId] || 0) ||
        ((semiTotals[topLoser.rosterId] || 0) === (semiTotals[bottomLoser.rosterId] || 0) &&
          (topLoser.seed || 999) < (bottomLoser.seed || 999))
          ? topLoser
          : bottomLoser;
      const fourth = third.rosterId === topLoser.rosterId ? bottomLoser : topLoser;

      const map = new Map();
      map.set(champion.rosterId, 1);
      map.set(runnerUp.rosterId, 2);
      map.set(third.rosterId, 3);
      map.set(fourth.rosterId, 4);
      return map;
    } catch (_) {
      return null;
    }
  }, [
    season,
    completedWeeks,
    isCurrentSeason,
    isCurrentWeekDoneByGames,
    weeksParsedData,
    rosters,
    users,
    playersData,
    playerIdMap,
  ]);

  function roundToTenth(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) {
      return 0;
    }
    return Math.round(n * 10) / 10;
  }
  const currentWeekForSeason = getCurrentNFLWeek(season);
  const showYoffsLink = !isCurrentSeason || (Number.isFinite(currentWeekForSeason) && currentWeekForSeason >= 15);

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
    if (!user) return null;
    return user.team_avatar_url || user.user_avatar_url || user.avatar_url || null;
  }

  function sumPointsForWeeks(weeksArr, rosterId, { applyCurrentWeekOverride = true } = {}) {
    if (!Array.isArray(weeksArr)) { return 0; }
    let total = 0;
    weeksArr.forEach((weekEntries, idx) => {
      if (!Array.isArray(weekEntries)) { return; }
      const entry = weekEntries.find(e => e && Number(e.roster_id) === Number(rosterId));
      if (!entry) { return; }
      let pts = typeof entry.points === 'number' ? entry.points : 0;
      // Override current week using StartSitDecider when possible
      const isCurrentSeason = season === CURRENT_YEAR;
      const currentWeekNum = isCurrentSeason ? getCurrentNFLWeek() : getCurrentNFLWeek(season);
      const thisWeekNum = idx + 1;
      if (applyCurrentWeekOverride && isCurrentSeason && thisWeekNum === currentWeekNum && weeksParsedData && playersData) {
        try {
          const breakdown = getWeekScoreBreakdown(weeksParsedData, thisWeekNum);
          const teamScore = breakdown && breakdown[rosterId];
          if (teamScore) {
            const computed = StartSitSort(teamScore, playersData, playerIdMap, null, null, playerSeasonTotalsMap);
            if (computed && typeof computed.starterTotal === 'number') {
              pts = computed.starterTotal;
            }
          }
        } catch (_) {
          // fallback to API points
        }
      }
      total += pts;
    });
    return total;
  }

  function computeTotals(rosterId, weeksArr) {
    const weeksCountLocal = Array.isArray(weeksArr) ? weeksArr.filter(Boolean).length : 0;
    const total = sumPointsForWeeks(weeksArr, rosterId);
    const ppg = weeksCountLocal > 0 ? Math.round((total / weeksCountLocal) * 10) / 10 : 0;
    return { total: Math.round(total), ppg, weeks: weeksCountLocal };
  }

  function getPlace(standingsArr, rosterId) {
    const row = (standingsArr || []).find(r => Number(r.roster_id) === Number(rosterId));
    return row ? row.place : null;
  }

  function computeHighLow(rosterId, weeksArr, completedWeeksLimit = null) {
    const totalWeeksAvailable = Array.isArray(weeksArr) ? weeksArr.filter(Boolean).length : 0;
    const cap = completedWeeksLimit == null ? totalWeeksAvailable : Math.max(0, Math.min(totalWeeksAvailable, completedWeeksLimit));
    if (cap === 0) {
      return { high: { points: 'N/A', week: null }, low: { points: 'N/A', week: null } };
    }

    // Helper: compute a week's starter total using StartSit when possible; fallback to API points
    const computeWeekTotal = (weekIndex1Based) => {
      try {
        if (playersData && playerIdMap && weeksParsedData) {
          const wb = getWeekScoreBreakdown(weeksParsedData, weekIndex1Based) || {};
          const raw = wb && wb[rosterId];
          if (raw) {
            const computed = StartSitSort(raw, playersData, playerIdMap, null, null, playerSeasonTotalsMap);
            if (computed && typeof computed.starterTotal === 'number') {
              return Math.round(computed.starterTotal * 10) / 10;
            }
          }
        }
      } catch (_) { /* fallback below */ }
      const wkEntries = (weeksArr && Array.isArray(weeksArr[weekIndex1Based - 1])) ? weeksArr[weekIndex1Based - 1] : null;
      const entry = wkEntries && wkEntries.find(e => e && Number(e.roster_id) === Number(rosterId));
      if (entry && typeof entry.points === 'number') {
        return Math.round(entry.points * 10) / 10;
      }
      return null;
    };

    let high = { points: -Infinity, week: null };
    let low = { points: Infinity, week: null };
    for (let i = 1; i <= cap; i++) {
      const pts = computeWeekTotal(i);
      if (typeof pts === 'number' && isFinite(pts)) {
        if (pts > high.points) { high = { points: pts, week: i }; }
        if (pts < low.points) { low = { points: pts, week: i }; }
      }
    }
    if (!isFinite(high.points)) { high = { points: 0, week: '-' }; }
    if (!isFinite(low.points)) { low = { points: 0, week: '-' }; }
    return { high, low };
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
          {availableYears.map(opt => (
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

  // Show error state if there's an error
  if (error && !weeksParsedData) {
    return (
      <>
        <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper title="Standings" subtitle={null} leftHeader={leftHeader}>
        <div>Error loading standings.</div>
      </InfoPageWrapper>
      </>
    );
  }

  // Allow rendering with partial data - show loading state only if we have nothing
  if (loading && !weeksParsedData) {
    return (
      <>
        <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper title="Standings" subtitle={null} leftHeader={leftHeader}>
        <LoadingState label="Loading standings…" />
      </InfoPageWrapper>
      </>
    );
  }

  // If we don't have minimum required data, show loading
  if (!rosters || !users) {
    return (
      <>
        <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper title="Standings" subtitle={null} leftHeader={leftHeader}>
        <LoadingState label="Loading standings…" />
      </InfoPageWrapper>
      </>
    );
  }

  const weeksFirst14 = Array.isArray(weeksParsedData) ? weeksParsedData.slice(0, 14).filter(Boolean) : [];
  const weeksCount14 = weeksFirst14.length;
  const weeks15to17 = Array.isArray(weeksParsedData) ? weeksParsedData.slice(14, 17).filter(Boolean) : [];

  const standingsAll = getStandings(weeksParsedData) || [];
  const standings14 = getStandings(weeksFirst14) || [];

  // Determine if we should apply playoff logic
  const effectiveCompletedWeeks = Math.max(1, completedWeeks);
  const weeksCompletedArr = Array.isArray(weeksParsedData) ? weeksParsedData.slice(0, effectiveCompletedWeeks).filter(Boolean) : [];
  const standingsCompleted = getStandings(weeksCompletedArr) || [];
  const usePlayoffLogic = completedWeeks >= 15;

  // Determine playoff teams based on first 14 weeks (or current cumulative when playoff logic is off)
  const top4Source = usePlayoffLogic ? standings14 : standingsCompleted;
  const top4Ids = top4Source
    .slice()
    .sort((a, b) => a.place - b.place)
    .slice(0, 4)
    .map(r => r.roster_id);
  // When in current season pre-playoffs, highlight top 4 by the same live-inclusive totals used for ordering
  let top4Set = new Set(top4Ids);
  if (!usePlayoffLogic && season === CURRENT_YEAR) {
    const othersWeeks = usePlayoffLogic ? weeksCount14 : effectiveCompletedWeeks;
    const othersWeeksLive = Math.min(17, othersWeeks + 1);
    const liveTotalsAll = (standingsCompleted || []).map((r) => ({
      roster_id: r.roster_id,
      total: sumPointsForWeeks((weeksParsedData || []).slice(0, othersWeeksLive), r.roster_id)
    })).sort((a, b) => b.total - a.total);
    const liveTop4 = liveTotalsAll.slice(0, 4).map(x => x.roster_id);
    top4Set = new Set(liveTop4);
  }

  // Compute playoff points for weeks 15-17 and build playoff display rows
  const top4Display = usePlayoffLogic ? top4Ids
    .map(rid => {
      const playoffPoints = roundToTenth(sumPointsForWeeks(weeks15to17, rid));
      const seasonTotal = (standingsAll.find(s => s.roster_id === rid)?.points_scored) || 0;
      return { roster_id: rid, playoffPoints, seasonTotal };
    })
    .sort((a, b) => {
      const placeA = bracketTop4PlaceMap ? bracketTop4PlaceMap.get(a.roster_id) : null;
      const placeB = bracketTop4PlaceMap ? bracketTop4PlaceMap.get(b.roster_id) : null;
      if (placeA != null || placeB != null) {
        return (placeA || 999) - (placeB || 999);
      }
      return b.playoffPoints - a.playoffPoints;
    })
    .map(r => ({ roster_id: r.roster_id, points_scored: r.playoffPoints, isPlayoff: true, weeksCount: weeks15to17.length })) : [];

  const othersSource = usePlayoffLogic ? standings14 : standingsCompleted;
  const othersWeeks = usePlayoffLogic ? weeksCount14 : effectiveCompletedWeeks;
  const othersWeeksLive = (!usePlayoffLogic && season === CURRENT_YEAR) ? Math.min(17, othersWeeks + 1) : othersWeeks;
  const othersDisplayUnsorted = othersSource
    .filter(r => !usePlayoffLogic || !top4Set.has(r.roster_id))
    .slice(0, Math.max(0, 10 - top4Display.length))
    .map(r => ({
      roster_id: r.roster_id,
      points_scored: sumPointsForWeeks((weeksParsedData || []).slice(0, othersWeeksLive), r.roster_id),
      isPlayoff: false,
      place: r.place,
      weeksCount: othersWeeksLive
    }));
  // Sort others by live-inclusive totals during current season (pre-playoffs); otherwise by place
  const othersDisplay = (!usePlayoffLogic && season === CURRENT_YEAR)
    ? othersDisplayUnsorted.slice().sort((a, b) => b.points_scored - a.points_scored)
    : othersDisplayUnsorted.slice().sort((a, b) => a.place - b.place);

  // Build dynamic rank map when using live-inclusive ordering
  const liveRankMap = (!usePlayoffLogic && season === CURRENT_YEAR) ? (() => {
    const map = new Map();
    let place = 1;
    let i = 0;
    while (i < othersDisplay.length) {
      const score = othersDisplay[i].points_scored;
      let j = i + 1;
      while (j < othersDisplay.length && othersDisplay[j].points_scored === score) { j++; }
      for (let k = i; k < j; k++) {
        map.set(othersDisplay[k].roster_id, place);
      }
      place += (j - i);
      i = j;
    }
    return map;
  })() : null;

  const displayRows = [...top4Display, ...othersDisplay].slice(0, 10);
  // Tie-aware places for playoff subset
  const playoffOrderMap = (() => {
    if (bracketTop4PlaceMap) {
      return bracketTop4PlaceMap;
    }
    const rows = top4Display.slice().sort((a, b) => b.points_scored - a.points_scored);
    const map = new Map();
    let place = 1;
    let i = 0;
    while (i < rows.length) {
      const score = rows[i].points_scored;
      let j = i + 1;
      while (j < rows.length && rows[j].points_scored === score) { j++; }
      for (let k = i; k < j; k++) {
        map.set(rows[k].roster_id, place);
      }
      place += (j - i);
      i = j;
    }
    return map;
  })();

  function toggleExpand(rosterId) {
    setExpanded(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
  }

  const hasAnyExpanded = Object.values(expanded || {}).some(Boolean);
  const showPpgColumn = (season === CURRENT_YEAR) ? (completedWeeks > 1) : (completedWeeks > 0);

  function computeCompletedWeeksPpg(weeksArr, rosterId, capWeeks = null) {
    const baseCap = (weeksArr ? weeksArr.filter(Boolean).length : 0);
    const limit = capWeeks != null ? Math.min(baseCap, capWeeks) : baseCap;
    let effectiveCompleted = 0;
    if (season === CURRENT_YEAR) {
      const currentWeekNum = getCurrentNFLWeek();
      // Include current week if it's completed per admin/db-aware state
      const completedOnly = Math.max(0, Math.min(completedWeeks, currentWeekNum, limit));
      effectiveCompleted = completedOnly;
    } else {
      // Previous seasons: all scheduled weeks are completed
      effectiveCompleted = Math.max(0, Math.min(completedWeeks, limit));
    }
    if (effectiveCompleted === 0) { return 0; }
    const sum = sumPointsForWeeks((weeksArr || []).slice(0, effectiveCompleted), rosterId, { applyCurrentWeekOverride: false });
    return Math.round((sum / effectiveCompleted) * 10) / 10;
  }

  function renderExpandedStats({
    isMobileView,
    shouldUsePlayoffLogic,
    isPlayoffTeam,
    playoffPointsTotal,
    playoffPointsPerGame,
    playoffStandingPlace,
    fourteenWeekTotals,
    seventeenWeekTotals,
    fourteenWeekPlace,
    seventeenWeekPlace,
    placeCompletedRank,
    highestWeekly,
    lowestWeekly,
    rosterIdForLink,
    currentSearchParams,
    completedWeeksNumber,
    ppg14Completed,
    ppg17Completed
  }) {
    const baseQuery = currentSearchParams && currentSearchParams.toString() ? currentSearchParams.toString() : '';
    const buildWeekLink = (week) => {
      if (typeof week !== 'number' || !isFinite(week)) { return null; }
      const qs = baseQuery ? `${baseQuery}&week=${week}&tab=Scores` : `week=${week}&tab=Scores`;
      return `/team/${rosterIdForLink}?${qs}`;
    };
    // Compute new live/weekly summary fields
    const isCurrentSeason = season === CURRENT_YEAR;
    const currentWeekNum = isCurrentSeason ? getCurrentNFLWeek() : getCurrentNFLWeek(season);
    const isCurrentWeekDone = isCurrentSeason
      ? ((completedWeeksNumber >= currentWeekNum) || isCurrentWeekDoneByGames)
      : true;
    const showLiveSummary = isCurrentSeason && !isCurrentWeekDone;
    const wbAll = getWeekScoreBreakdown(weeksParsedData, currentWeekNum) || {};
    const rosterIdForCalc = rosterIdForLink;
    let scoreThisWeek = 0;
    try {
      const raw = wbAll && wbAll[rosterIdForCalc];
      if (raw && playersData && playerIdMap) {
        const computed = StartSitSort(raw, playersData, playerIdMap, null, null, playerSeasonTotalsMap);
        scoreThisWeek = computed && typeof computed.starterTotal === 'number' ? Math.round(computed.starterTotal * 10) / 10 : 0;
      }
    } catch (_) {}
    const completedWeeksOnlyTotal = (() => {
      try {
        const baseCap = (weeksParsedData ? weeksParsedData.filter(Boolean).length : 0);
        let completedOnly = 0;
        if (season === CURRENT_YEAR) {
          const currentWeekNum2 = getCurrentNFLWeek();
          completedOnly = Math.max(0, Math.min(completedWeeks, currentWeekNum2 - 1, baseCap));
        } else {
          completedOnly = Math.max(0, Math.min(completedWeeks, baseCap));
        }
        const arr = (weeksParsedData || []).slice(0, completedOnly);
        const total = arr.reduce((sum, wk) => {
          if (!Array.isArray(wk)) { return sum; }
          const e = wk.find(x => x && Number(x.roster_id) === Number(rosterIdForCalc));
          const pts = e && typeof e.points === 'number' ? e.points : 0;
          return sum + pts;
        }, 0);
        return Math.round(total * 10) / 10;
      } catch (_) { return 0; }
    })();
    let activeCount = 0, yetToPlayCount = 0;
    try {
      const wk = wbAll && wbAll[rosterIdForCalc];
      if (isCurrentSeason && wk) {
        const rosterPlayerIds = [...(wk.starters || []), ...(wk.bench || [])].map(p => p && p.id).filter(pid => pid && pid !== '0');
        for (const pid of rosterPlayerIds) {
          const label = currentWeekLabels && currentWeekLabels[pid];
          if (!label) { continue; }
          const isLive = !!label.live;
          const isCompleted = !!label.completed;
          const isBye = label && label.text === 'BYE';
          if (isLive) { activeCount += 1; }
          else if (!isCompleted && !isBye) { yetToPlayCount += 1; }
        }
      }
    } catch (_) {}

    const expandClassName = showLiveSummary
      ? 'standings-row-expand standings-expand-split'
      : 'standings-row-expand standings-expand-solo';

    return (
      <div className={expandClassName}>
        <div className="standings-row-expand-inner standings-stats-grid standings-expand-left">
          {shouldUsePlayoffLogic && isPlayoffTeam && (
            isMobileView ? (
              <>
                <div className="stat-label">Playoffs:</div>
                <div className="stat-v1">{playoffPointsTotal} pts</div>
                <div className="stat-v2">#{playoffStandingPlace}</div>
                <div className="stat-v3"></div>
              </>
            ) : (
              <>
                <div className="stat-label">Playoffs:</div>
                <div className="stat-v1">{playoffPointsTotal} pts</div>
                <div className="stat-v2">{playoffPointsPerGame} ppg</div>
                <div className="stat-v3">#{playoffStandingPlace}</div>
              </>
            )
          )}

          {completedWeeksNumber < 15 ? (
            // Pre-playoffs: only show PF once
            <>
              <div className="stat-label">PF:</div>
              <div className="stat-v1">{seventeenWeekTotals.total} pts</div>
              <div className="stat-v2">#{placeCompletedRank}</div>
              <div className="stat-v3"></div>
            </>
          ) : (
            // Playoffs or after week 15: show 14-week and 17-week rows
            <>
              {isMobileView ? (
                <>
                  <div className="stat-label">14-Week:</div>
                  <div className="stat-v1">{fourteenWeekTotals.total} pts</div>
                  <div className="stat-v2">#{fourteenWeekPlace}</div>
                  <div className="stat-v3"></div>
                </>
              ) : (
                <>
                  <div className="stat-label">14-Week:</div>
                  <div className="stat-v1">{fourteenWeekTotals.total} pts</div>
                  <div className="stat-v2">{ppg14Completed} ppg</div>
                  <div className="stat-v3">#{fourteenWeekPlace}</div>
                </>
              )}

              {isMobileView ? (
                <>
                  <div className="stat-label">17-Week:</div>
                  <div className="stat-v1">{seventeenWeekTotals.total} pts</div>
                  <div className="stat-v2">#{seventeenWeekPlace}</div>
                  <div className="stat-v3"></div>
                </>
              ) : (
                <>
                  <div className="stat-label">17-Week:</div>
                  <div className="stat-v1">{seventeenWeekTotals.total} pts</div>
                  <div className="stat-v2">{ppg17Completed} ppg</div>
                  <div className="stat-v3">#{seventeenWeekPlace}</div>
                </>
              )}
            </>
          )}

          {isMobileView ? (
            <>
              <div className="stat-label">High Score:</div>
              <div className="stat-v1">{typeof highestWeekly.points === 'number' ? `${highestWeekly.points} pts` : 'N/A'}</div>
              <div className="stat-v2">
                {typeof highestWeekly.week === 'number' ? (
                  <Link className="standings-inline-link" to={buildWeekLink(highestWeekly.week)}>{isMobileView ? `W${highestWeekly.week}` : `Week ${highestWeekly.week}`}</Link>
                ) : null}
              </div>
              <div className="stat-v3"></div>
            </>
          ) : (
            <>
              <div className="stat-label">High Score:</div>
              <div className="stat-v1">{typeof highestWeekly.points === 'number' ? `${highestWeekly.points} pts` : 'N/A'}</div>
              <div className="stat-v2">
                {typeof highestWeekly.week === 'number' ? (
                  <Link className="standings-inline-link" to={buildWeekLink(highestWeekly.week)}>{`Week ${highestWeekly.week}`}</Link>
                ) : null}
              </div>
              <div className="stat-v3"></div>
            </>
          )}

          {isMobileView ? (
            <>
              <div className="stat-label">Low Score:</div>
              <div className="stat-v1">{typeof lowestWeekly.points === 'number' ? `${lowestWeekly.points} pts` : 'N/A'}</div>
              <div className="stat-v2">
                {typeof lowestWeekly.week === 'number' ? (
                  <Link className="standings-inline-link" to={buildWeekLink(lowestWeekly.week)}>{isMobileView ? `W${lowestWeekly.week}` : `Week ${lowestWeekly.week}`}</Link>
                ) : null}
              </div>
              <div className="stat-v3"></div>
            </>
          ) : (
            <>
              <div className="stat-label">Low Score:</div>
              <div className="stat-v1">{typeof lowestWeekly.points === 'number' ? `${lowestWeekly.points} pts` : 'N/A'}</div>
              <div className="stat-v2">
                {typeof lowestWeekly.week === 'number' ? (
                  <Link className="standings-inline-link" to={buildWeekLink(lowestWeekly.week)}>{`Week ${lowestWeekly.week}`}</Link>
                ) : null}
              </div>
              <div className="stat-v3"></div>
            </>
          )}

          <div className="standings-team-link">
            <Link to={`/team/${rosterIdForLink}${currentSearchParams && currentSearchParams.toString() ? `?${currentSearchParams.toString()}` : ''}`}>See Team Overview</Link>
          </div>
        </div>
        {showLiveSummary ? (
          <div className="standings-expand-right">
            <div className="standings-extra-block">
              <div className="standings-extra-row">
                <span className="standings-extra-label">PF through completed weeks:</span>
                <span className="standings-extra-val">{completedWeeksOnlyTotal} pts</span>
              </div>
              <div className="standings-extra-row">
                <span className="standings-extra-label">PF this week:</span>
                <span className="standings-extra-val">{scoreThisWeek} pts</span>
              </div>
              <div className="standings-extra-row">
                <span className="standings-extra-sub">(Yet To Play: {yetToPlayCount}, In-Play: {activeCount})</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
    <InfoPageWrapper title="Standings" subtitle={null} leftHeader={leftHeader}>
      {showYoffsLink ? <YoffsLink /> : null}
      <div className={"standings-list" + (hasAnyExpanded ? " standings-list--expanded" : "") + (showPpgColumn ? "" : " standings-list--no-ppg") }>
        {displayRows.map((row, idx) => {
          const rosterId = row.roster_id;
          const isExpanded = !!expanded[rosterId];
          const isPlayoff = row.isPlayoff;
          const teamName = getTeamName(rosterId);
          const avatarUrl = getAvatar(rosterId);
          const isTop4Highlight = top4Set.has(rosterId);

          // Display metrics: PPG should use only completed weeks; if none, show N/A
          // Only compute for header display - expanded stats computed separately when expanded
          const hasCompletedWeeks = completedWeeks > 0;
          const ppgValue = hasCompletedWeeks && weeksParsedData ? computeCompletedWeeksPpg(weeksParsedData, rosterId, 17) : null;

          // Compute cheap lookups needed for header (used regardless of expansion)
          const place14 = getPlace(standings14, rosterId);
          const placeCompleted = getPlace(standingsCompleted, rosterId);

          const rankLabel = (usePlayoffLogic && isPlayoff)
            ? playoffOrderMap.get(rosterId)
            : (!usePlayoffLogic && season === CURRENT_YEAR && liveRankMap && liveRankMap.has(rosterId)
              ? liveRankMap.get(rosterId)
              : ((usePlayoffLogic ? place14 : placeCompleted) || idx + 1));

          // OPTIMIZATION: Only compute expensive expanded details when actually expanded
          let det14, det17, place17, placePfLiveOrCompleted;
          let high, low, playoffPts, completedPlayoffWeeks, playoffPpg, playoffPlace;
          let ppg14Completed, ppg17Completed;

          if (isExpanded) {
            det14 = computeTotals(rosterId, weeksFirst14);
            det17 = computeTotals(rosterId, weeksParsedData);
            place17 = getPlace(standingsAll, rosterId);
            placePfLiveOrCompleted = (!usePlayoffLogic && season === CURRENT_YEAR && liveRankMap && liveRankMap.has(rosterId))
              ? liveRankMap.get(rosterId)
              : placeCompleted;
            ({ high, low } = computeHighLow(rosterId, weeksParsedData, completedWeeks));
            playoffPts = usePlayoffLogic && isPlayoff ? roundToTenth(sumPointsForWeeks(weeks15to17, rosterId)) : null;
            completedPlayoffWeeks = usePlayoffLogic && isPlayoff ? (isCurrentSeason ? Math.max(0, Math.min(3, completedWeeks - 14)) : 3) : 0;
            playoffPpg = usePlayoffLogic && isPlayoff && completedPlayoffWeeks > 0
              ? Math.round((sumPointsForWeeks(weeks15to17.slice(0, completedPlayoffWeeks), rosterId) / completedPlayoffWeeks) * 10) / 10
              : null;
            playoffPlace = usePlayoffLogic && isPlayoff ? playoffOrderMap.get(rosterId) : null;
            ppg14Completed = computeCompletedWeeksPpg(weeksFirst14, rosterId, 14);
            ppg17Completed = computeCompletedWeeksPpg(weeksParsedData, rosterId, 17);
          }

          let rightHeaderContent;
          if (isMobile) {
            rightHeaderContent = usePlayoffLogic && isPlayoff ? (
              <span className="standings-total">Playoffs: {roundToTenth(row.points_scored).toFixed(1)} pts</span>
            ) : (
              <span className={`standings-total${usePlayoffLogic ? ' standings-metric' : ''}`}>
                {Math.round(row.points_scored)} pts
                {usePlayoffLogic && (
                  <span className="standings-tooltip">Non-playoff teams use only weeks 1–14 for PPG and totals.</span>
                )}
              </span>
            );
          } else {
            rightHeaderContent = usePlayoffLogic && isPlayoff ? (
              <>
                {showPpgColumn ? (
                  <span className="standings-ppg standings-ppg--playoff-mobile">
                    Playoffs: {roundToTenth(row.points_scored).toFixed(1)} pts
                  </span>
                ) : null}
                <span className="standings-total standings-total--playoff-desktop">
                  Playoffs: {roundToTenth(row.points_scored).toFixed(1)} pts
                </span>
              </>
            ) : (
              <>
                {showPpgColumn ? (
                  <span className="standings-ppg">
                    {ppgValue != null ? `${ppgValue} ppg` : ''}
                  </span>
                ) : null}
                <span className={`standings-total${usePlayoffLogic ? ' standings-metric' : ''}`}>
                  {Math.round(row.points_scored)} pts
                  {usePlayoffLogic && (
                    <span className="standings-tooltip">Non-playoff teams use only weeks 1–14 for PPG and totals.</span>
                  )}
                </span>
              </>
            );
          }

          return (
            <div key={rosterId} className={`standings-row ${isTop4Highlight ? 'standings-row--playoff' : ''}${isMyRoster(rosterId, myRosterId) ? ' standings-row--me' : ''}`}>
              <StandingsRowHeader
                isExpanded={isExpanded}
                onToggle={() => toggleExpand(rosterId)}
                rankLabel={`#${rankLabel}`}
                avatarUrl={avatarUrl}
                teamName={teamName}
                isMe={isMyRoster(rosterId, myRosterId)}
                rightContent={rightHeaderContent}
              />
              {isExpanded && (
                // Show loading state if we don't have complete data yet
                (!playersData || !playerIdMap) ? (
                  <div className="standings-row-expand">
                    <LoadingState
                      label="Loading stats…"
                      ariaLabel="Loading team statistics"
                      className="standings-expand-loading"
                    />
                  </div>
                ) : (
                  renderExpandedStats({
                    isMobileView: isMobile,
                    shouldUsePlayoffLogic: usePlayoffLogic,
                    isPlayoffTeam: isPlayoff,
                    playoffPointsTotal: playoffPts,
                    playoffPointsPerGame: playoffPpg,
                    playoffStandingPlace: playoffPlace,
                    fourteenWeekTotals: det14,
                    seventeenWeekTotals: det17,
                    fourteenWeekPlace: place14,
                    seventeenWeekPlace: place17,
                    placeCompletedRank: placePfLiveOrCompleted,
                    highestWeekly: high,
                    lowestWeekly: low,
                    rosterIdForLink: rosterId,
                    currentSearchParams: searchParams,
                    completedWeeksNumber: effectiveCompletedWeeks,
                    ppg14Completed,
                    ppg17Completed
                  })
                )
              )}
            </div>
          );
        })}
      </div>
      {/* Playoff Race Graph based on completed weeks only */}
      <PlayoffRaceGraph
        weeksParsedData={weeksParsedData}
        completedWeeks={completedWeeks}
        rosterIdToName={Object.fromEntries((rosters || []).map(r => [Number(r.roster_id), getTeamName(r.roster_id)]))}
        playersData={playersData}
        playerIdMap={playerIdMap}
      />
    </InfoPageWrapper>
    </>
  );
}

export default LeagueStandings; 