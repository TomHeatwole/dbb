import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import HprojHint from '../scores/HprojHint';
import useLeagueHproj from '../scores/useLeagueHproj';
import useWeeklyProjectedPoints from '../scores/useWeeklyProjectedPoints';
import { startSitWithProjections } from '../scores/projectionScoring';
import { getPlayerSeasonTotalsMap, getWeekScoreBreakdown } from '../scores/ScoresParser';
import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { fetchInjuriesForWeek } from '../lookups/InjuryLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { buildRosterIdToTeamInfoMap, fetchTeamData } from '../lookups/TeamLookup';
import { mapPlayersToGames, getGameDisplayForTeam, isScoreboardWeekComplete } from '../scores/GamesParser';
import { hprojPageHref, ownerFirstNameCounts } from '../scores/hprojTeamSim';
import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';
import { HPROJ_ON_SCORES } from '../utils/featureToggles';
import { useMyRosterId, isMyRoster } from '../hooks/useAuthUser';

function fmt(n) {
  return Number(n || 0).toFixed(1);
}

function ThisWeeksProjectionsCard({ currentWeekOverride = null }) {
  const season = CURRENT_YEAR;
  const week = useMemo(() => {
    const raw = currentWeekOverride != null ? Number(currentWeekOverride) : getCurrentNFLWeek(season);
    if (!Number.isFinite(raw) || raw < 1) return 1;
    return Math.min(17, raw);
  }, [currentWeekOverride, season]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [playerGameLabels, setPlayerGameLabels] = useState({});
  const [injuriesMap, setInjuriesMap] = useState({});
  const [isWeekCompleteByGames, setIsWeekCompleteByGames] = useState(false);
  const [rankMode, setRankMode] = useState('scores');

  const myRosterId = useMyRosterId(rosters, users);
  const projectedPtsById = useWeeklyProjectedPoints(season, week);
  const weekEntries = useMemo(() => {
    const fromScores = Array.isArray(weeksParsedData) ? weeksParsedData[week - 1] : null;
    if (Array.isArray(fromScores) && fromScores.length) return fromScores;
    return (rosters || [])
      .filter((r) => r && r.roster_id != null)
      .map((r) => ({
        roster_id: r.roster_id,
        players: r.players || [],
        starters: r.starters || [],
        players_points: {},
        starters_points: [],
      }));
  }, [weeksParsedData, week, rosters]);
  const weekScoresByRoster = useMemo(() => {
    if (!weekEntries.length) return null;
    const padded = Array.from({ length: week }, () => []);
    padded[week - 1] = weekEntries;
    return getWeekScoreBreakdown(padded, week, rosters);
  }, [weekEntries, week, rosters]);
  const playerSeasonTotalsMap = useMemo(
    () => getPlayerSeasonTotalsMap(weeksParsedData),
    [weeksParsedData],
  );
  const { hprojByRoster, liveProjByRoster, gamesStarted } = useLeagueHproj({
    season,
    week,
    rosters,
    playersData,
    projectedPtsById,
    playerGameLabels,
    weekScoresByRoster,
    injuriesMap,
    playerIdMap,
    enabled: HPROJ_ON_SCORES,
  });
  const firstNameCounts = useMemo(
    () => ownerFirstNameCounts(rosters, users),
    [rosters, users],
  );
  const rosterMap = useMemo(
    () => buildRosterIdToTeamInfoMap(rosters, users),
    [rosters, users],
  );

  const liveMode = Boolean(gamesStarted && !isWeekCompleteByGames);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [weeksData, teamData, idMap] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season),
          fetchPlayerIdMap(),
        ]);
        if (cancelled) return;
        const players = await fetchPlayersData(
          teamData && teamData.rosters ? teamData.rosters : null,
        );
        if (cancelled) return;
        setWeeksParsedData(weeksData);
        setRosters(teamData && teamData.rosters ? teamData.rosters : null);
        setUsers(teamData && teamData.users ? teamData.users : null);
        setPlayersData(players);
        setPlayerIdMap(idMap);
      } catch (_) {
        if (!cancelled) {
          setError('Unable to load this week\'s board right now.');
          setWeeksParsedData(null);
          setRosters(null);
          setUsers(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [season]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await fetchInjuriesForWeek(season, week);
        if (!cancelled) setInjuriesMap(m || {});
      } catch (_) {
        if (!cancelled) setInjuriesMap({});
      }
    })();
    return () => { cancelled = true; };
  }, [season, week]);

  useEffect(() => {
    if (!playersData || !playerIdMap || !weeksParsedData) return undefined;
    if (!weekEntries.length) {
      setPlayerGameLabels({});
      setIsWeekCompleteByGames(false);
      return undefined;
    }
    const playerIdSet = new Set();
    for (const entry of weekEntries) {
      let playersArray = entry && entry.players;
      if ((!playersArray || !playersArray.length) && Array.isArray(rosters)) {
        const roster = rosters.find((r) => r && Number(r.roster_id) === Number(entry && entry.roster_id));
        if (roster && Array.isArray(roster.players)) playersArray = roster.players;
      }
      if (Array.isArray(playersArray)) {
        for (const pid of playersArray) playerIdSet.add(pid);
      }
    }
    const playerIds = Array.from(playerIdSet);
    if (!playerIds.length) {
      setPlayerGameLabels({});
      setIsWeekCompleteByGames(false);
      return undefined;
    }
    let cancelled = false;
    fetchNflScoreboard(Number(season), week)
      .then(async (json) => {
        if (cancelled) return;
        try {
          setIsWeekCompleteByGames(isScoreboardWeekComplete(json));
        } catch (_) {
          setIsWeekCompleteByGames(false);
        }
        const mapping = await mapPlayersToGames(playerIds, playersData, playerIdMap, json, null);
        const labels = {};
        for (const pid of playerIds) {
          const item = mapping[pid];
          const ev = item && item.event;
          const teamForWeek = item && item.team;
          const d = ev ? getGameDisplayForTeam(ev, teamForWeek) : { text: 'BYE', live: false };
          labels[pid] = { ...d, team: teamForWeek || null };
        }
        if (!cancelled) setPlayerGameLabels(labels);
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerGameLabels({});
          setIsWeekCompleteByGames(false);
        }
      });
    return () => { cancelled = true; };
  }, [season, week, playersData, playerIdMap, weekEntries, rosters]);

  const rows = useMemo(() => {
    if (!weekScoresByRoster || !weekEntries.length) return [];
    const lineupMode = liveMode && rankMode === 'projections' ? 'projections' : 'scores';
    return weekEntries
      .filter((entry) => entry && entry.roster_id != null)
      .map((entry) => {
        const rid = entry.roster_id;
        const raw = weekScoresByRoster[rid] || weekScoresByRoster[String(rid)];
        const computed = raw
          ? startSitWithProjections(
            raw,
            playersData,
            playerIdMap,
            playerGameLabels,
            injuriesMap,
            playerSeasonTotalsMap,
            projectedPtsById,
            lineupMode,
          )
          : null;
        const info = rosterMap[Number(rid)] || rosterMap[rid] || {};
        const ownerName = info.ownerName || '';
        const href = HPROJ_ON_SCORES
          ? hprojPageHref(week, { rosterId: rid, ownerName }, firstNameCounts)
          : null;
        return {
          rosterId: rid,
          teamName: info.teamName || `Team ${rid}`,
          avatarUrl: info.user
            ? (info.user.team_avatar_url || info.user.user_avatar_url || info.user.avatar_url || null)
            : null,
          sleeperProj: computed
            ? Number(computed.optimalProjTotal ?? computed.starterProjTotal ?? 0)
            : 0,
          actual: computed ? Number(computed.starterActualTotal ?? 0) : 0,
          hproj: hprojByRoster[String(rid)] ?? null,
          liveProj: liveProjByRoster[String(rid)] ?? null,
          hprojHref: href,
        };
      });
  }, [
    weekEntries,
    weekScoresByRoster,
    week,
    liveMode,
    rankMode,
    playersData,
    playerIdMap,
    playerGameLabels,
    injuriesMap,
    playerSeasonTotalsMap,
    projectedPtsById,
    rosterMap,
    firstNameCounts,
    hprojByRoster,
    liveProjByRoster,
  ]);

  const top3 = useMemo(() => {
    const copy = rows.slice();
    copy.sort((a, b) => {
      let av;
      let bv;
      if (liveMode) {
        if (rankMode === 'projections') {
          av = Number.isFinite(a.liveProj) ? a.liveProj : (Number.isFinite(a.hproj) ? a.hproj : a.actual);
          bv = Number.isFinite(b.liveProj) ? b.liveProj : (Number.isFinite(b.hproj) ? b.hproj : b.actual);
        } else {
          av = a.actual;
          bv = b.actual;
        }
      } else {
        av = Number.isFinite(a.hproj) ? a.hproj : a.sleeperProj;
        bv = Number.isFinite(b.hproj) ? b.hproj : b.sleeperProj;
      }
      if (bv !== av) return bv - av;
      return String(a.rosterId).localeCompare(String(b.rosterId));
    });
    return copy.slice(0, 3);
  }, [rows, liveMode, rankMode]);

  const title = liveMode || isWeekCompleteByGames
    ? "This Week's Scores"
    : "This Week's Projections";
  const scoresHref = `/Scores/Week?week=${week}`;

  let body = null;
  if (loading) {
    body = (
      <LoadingState
        className="this-week-proj-loading"
        label="Loading this week…"
        ariaLabel="Loading this week's projections"
      />
    );
  } else if (error) {
    body = <div className="week-stars-status week-stars-status--error">{error}</div>;
  } else if (!top3.length) {
    body = (
      <div className="week-stars-status">
        Not enough data yet for Week {week}.
      </div>
    );
  } else {
    body = (
      <div className="this-week-proj-body">
        {liveMode ? (
          <div className="this-week-proj-toggle" role="group" aria-label="Rank by">
            <button
              type="button"
              className={`this-week-proj-toggle-btn${rankMode === 'scores' ? ' is-active' : ''}`}
              aria-pressed={rankMode === 'scores'}
              onClick={() => setRankMode('scores')}
            >
              Score
            </button>
            <button
              type="button"
              className={`this-week-proj-toggle-btn${rankMode === 'projections' ? ' is-active' : ''}`}
              aria-pressed={rankMode === 'projections'}
              onClick={() => setRankMode('projections')}
            >
              Live Proj
            </button>
          </div>
        ) : null}
        <div className="this-week-proj-rows">
          {top3.map((row, idx) => {
            const mine = isMyRoster(row.rosterId, myRosterId);
            const chipHref = row.hprojHref;
            const chipValue = liveMode
              ? (Number.isFinite(row.liveProj) ? row.liveProj : row.hproj)
              : row.hproj;
            return (
              <div className={`this-week-proj-row${mine ? ' this-week-proj-row--me' : ''}`} key={row.rosterId}>
                <span className="this-week-proj-rank">#{idx + 1}</span>
                <Link to={`/team/${row.rosterId}`} className="this-week-proj-team">
                  {row.avatarUrl ? (
                    <img className="this-week-proj-avatar" src={row.avatarUrl} alt="" />
                  ) : (
                    <span className="this-week-proj-avatar this-week-proj-avatar--empty" />
                  )}
                  <span className="this-week-proj-name">
                    {row.teamName}
                    {mine ? <span className="me-chip">YOU</span> : null}
                  </span>
                </Link>
                <span className="this-week-proj-nums">
                  {liveMode || isWeekCompleteByGames ? (
                    <span className="this-week-proj-score">{fmt(row.actual)}<span className="this-week-proj-units"> pts</span></span>
                  ) : (
                    <span className="this-week-proj-score">
                      <HprojHint
                        value={row.sleeperProj}
                        variant="sleeper"
                        tipTitle="Sleeper sum of totals"
                        showTag={false}
                        className="this-week-proj-sleeper-hint"
                      />
                      <span className="this-week-proj-units"> proj</span>
                    </span>
                  )}
                  {HPROJ_ON_SCORES && Number.isFinite(chipValue) ? (
                    <HprojHint
                      href={chipHref}
                      value={chipValue}
                      size="sm"
                      variant={liveMode ? 'live' : 'hproj'}
                    />
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <HomeCard className="this-week-proj-card">
      <div className="home-card-inner">
        <div className="home-card-title-row">
          <h2 className="home-card-title">{liveMode ? '🏈 ' : '🔮 '}{title}</h2>
          <Link className="active-playoffs-link" to={scoresHref}>
            Scores →
          </Link>
        </div>
        {body}
      </div>
    </HomeCard>
  );
}

export default ThisWeeksProjectionsCard;
