import React, { useEffect, useRef, useState, useMemo } from 'react';
import LoadingState from '../LoadingState';
import { CURRENT_YEAR, getDefaultDisplayWeek, getCurrentNFLWeek } from '../utils/DateHelper';
import WeekSelector from './WeekSelector';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import { getWeekScoreBreakdown, getStandings, getPlayerSeasonTotalsMap } from './ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';
import { startSitWithProjections } from './projectionScoring';
import useWeeklyProjectedPoints from './useWeeklyProjectedPoints';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import useIsMobile from '../hooks/useIsMobile';
import MobileTeamScoreSummary from './MobileTeamScoreSummary';
import LeagueScoresTeamBreakdown from './LeagueScoresTeamBreakdown';
import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { mapPlayersToGames, getGameDisplayForTeam, isScoreboardWeekComplete } from './GamesParser';
import { fetchInjuriesForWeek } from '../lookups/InjuryLookup';
import { readPlayersSnapshot } from '../utils/database';
import { useMyRosterId, isMyRoster } from '../hooks/useAuthUser';

function MobileScaled({ children, className = 'mobile-standings-scale-70' }) {
  const innerRef = useRef(null);
  const [heightPx, setHeightPx] = useState(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) {
      return;
    }
    const compute = () => {
      const rect = el.getBoundingClientRect();
      setHeightPx(rect.height);
    };
    compute();
    const ro = new ResizeObserver(() => compute());
    ro.observe(el);
    window.addEventListener('resize', compute);
    return () => {
      try {
        ro.disconnect();
      } catch (_) {
        // ignore
      }
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

/**
 * Reusable league scores view (per-week scoreboard).
 *
 * Props:
 * - season: Sleeper season (string or number)
 * - includedRosterIds: optional array of roster_ids to include; when omitted, shows all teams
 * - minWeek / maxWeek: inclusive week bounds for the selector (defaults 1–17)
 * - usePlayoffTheme: when true, use gold playoff styling for rows
 * - rosterIdToSeed: optional map of rosterId -> seed (displayed as #seed next to name)
 * - rosterIdToPlayoffMeta: optional map of rosterId -> { place, total } using playoff totals;
 *   when provided, Place/# and PF in the banner use these instead of season-long totals
 */
function ScoresView({
  season,
  includedRosterIds = null,
  minWeek = 1,
  maxWeek = 17,
  usePlayoffTheme = false,
  rosterIdToSeed = null,
  rosterIdToPlayoffMeta = null,
}) {
  const isMobile = useIsMobile();
  const safeMinWeek = Math.max(1, Number.isFinite(minWeek) ? minWeek : 1);
  const safeMaxWeek = Math.max(safeMinWeek, Number.isFinite(maxWeek) ? maxWeek : 17);

  const [week, setWeek] = useState(() => {
    const def = getDefaultDisplayWeek(season);
    return Math.min(safeMaxWeek, Math.max(safeMinWeek, def));
  });

  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const myRosterId = useMyRosterId(rosters, users);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [benchOpen, setBenchOpen] = useState({});
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [playerGameLabels, setPlayerGameLabels] = useState({});
  const [isWeekCompleteByGames, setIsWeekCompleteByGames] = useState(false);
  const [injuriesMap, setInjuriesMap] = useState({});
  const [playersTeamMap, setPlayersTeamMap] = useState({});
  const showFullScoreBreakdownOnMobile = false;

  const hasAnyExpanded = Object.values(expanded || {}).some(Boolean);

  const rosterFilter =
    Array.isArray(includedRosterIds) && includedRosterIds.length > 0
      ? new Set(includedRosterIds.map((id) => String(id)))
      : null;

  useEffect(() => {
    const def = getDefaultDisplayWeek(season);
    setWeek((prev) => {
      const base = Number.isFinite(prev) ? prev : def;
      return Math.min(safeMaxWeek, Math.max(safeMinWeek, base));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, safeMinWeek, safeMaxWeek]);

  // Load league scores/teams and player metadata for season
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchScoresData(season),
      fetchTeamData(season),
      fetchPlayerIdMap()
    ])
      .then(async ([weeksData, teamData, idMap]) => {
        if (cancelled) {
          return;
        }
        const players = await fetchPlayersData(
          String(season) === String(CURRENT_YEAR)
            ? (teamData && teamData.rosters ? teamData.rosters : null)
            : String(season)
        );
        if (cancelled) {
          return;
        }
        setWeeksParsedData(weeksData);
        setRosters(teamData.rosters);
        setUsers(teamData.users);
        setPlayersData(players);
        setPlayerIdMap(idMap);
      })
      .catch(() => {
        if (!cancelled) {
          setWeeksParsedData(null);
          setRosters(null);
          setUsers(null);
          setPlayersData(null);
          setPlayerIdMap(null);
          setError('Failed to load scores');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  // Load injuries map for season/week (used for past weeks rendering)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const isCurrentSeason = String(season) === String(CURRENT_YEAR);
        const currentWeekNum = getCurrentNFLWeek();
        const isPreviousWeek = isCurrentSeason ? Number(week) < currentWeekNum : true;
        if (isPreviousWeek) {
          try {
            const snap = await readPlayersSnapshot(String(season), Number(week));
            const data = snap && snap.snapshot && snap.snapshot.data ? snap.snapshot.data : null;
            if (data && !cancelled) {
              const byPlayerId = {};
              for (const [pid, p] of Object.entries(data)) {
                const status =
                  (p &&
                    (p.injury_status ||
                      p.injury_notes ||
                      (p.status &&
                        /out|pup|questionable|doubtful|suspended|ir|injured reserve|na/i.test(
                          p.status
                        )
                        ? p.status
                        : null))) ||
                  null;
                if (status) {
                  byPlayerId[String(pid)] = String(status);
                }
              }
              setInjuriesMap(byPlayerId);
              return;
            }
          } catch (_) {
            // fall through to file-based
          }
        }
        const m = await fetchInjuriesForWeek(season, week);
        if (!cancelled) {
          let combined = { ...(m || {}) };
          try {
            if (playerIdMap && typeof playerIdMap === 'object') {
              for (const [pid, mapping] of Object.entries(playerIdMap)) {
                const espnId =
                  mapping && (mapping.espn_id || (mapping.metadata && mapping.metadata.espn_id));
                if (espnId && combined[String(espnId)] && !combined[String(pid)]) {
                  combined[String(pid)] = combined[String(espnId)];
                }
              }
            }
          } catch (_) {
            // ignore
          }
          setInjuriesMap(combined);
        }
      } catch (_) {
        if (!cancelled) {
          setInjuriesMap({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [season, week, playerIdMap]);

  const playerSeasonTotalsMap = useMemo(() => {
    return getPlayerSeasonTotalsMap(weeksParsedData);
  }, [weeksParsedData]);
  const projectedPtsById = useWeeklyProjectedPoints(season, week);

  // Compute player->game labels for the selected week (web tables)
  useEffect(() => {
    if (!playersData || !playerIdMap || !weeksParsedData) {
      setIsWeekCompleteByGames(false);
      return;
    }
    const weekArr = Array.isArray(weeksParsedData) ? weeksParsedData[week - 1] : null;
    if (!Array.isArray(weekArr)) {
      setIsWeekCompleteByGames(false);
      return;
    }
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
          for (const pid of playersArray) {
            playerIdSet.add(pid);
          }
        }
      }
    }
    const playerIds = Array.from(playerIdSet);
    if (playerIds.length === 0) {
      setPlayerGameLabels({});
      setIsWeekCompleteByGames(false);
      return;
    }

    const seasonYear = Number(season);
    let cancelled = false;
    fetchNflScoreboard(seasonYear, week)
      .then(async (json) => {
        if (cancelled) {
          return;
        }
        try {
          setIsWeekCompleteByGames(isScoreboardWeekComplete(json));
        } catch (_) {
          setIsWeekCompleteByGames(false);
        }
        const mapping = await mapPlayersToGames(
          playerIds,
          playersData,
          playerIdMap,
          json,
          String(season) === String(CURRENT_YEAR) ? playersTeamMap : null
        );
        const labels = {};
        for (const pid of playerIds) {
          const item = mapping[pid];
          const ev = item && item.event;
          const teamForWeek = item && item.team;
          const d = ev ? getGameDisplayForTeam(ev, teamForWeek) : { text: 'BYE', live: false };
          labels[pid] = { ...d, team: teamForWeek || null };
        }
        if (!cancelled) {
          setPlayerGameLabels(labels);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerGameLabels({});
          setIsWeekCompleteByGames(false);
        }
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, week, playersData, playerIdMap, weeksParsedData, playersTeamMap]);

  // Load per-player team mapping from weekly players snapshot (current season only)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const isCurrentSeason = String(season) === String(CURRENT_YEAR);
        if (!isCurrentSeason || !week || Number(week) < 1) {
          if (!cancelled) {
            setPlayersTeamMap({});
          }
          return;
        }
        const snap = await readPlayersSnapshot(String(season), Number(week));
        const data = snap && snap.snapshot && snap.snapshot.data ? snap.snapshot.data : null;
        if (cancelled) {
          return;
        }
        if (!data) {
          setPlayersTeamMap({});
          return;
        }
        const next = {};
        for (const [pid, pinfo] of Object.entries(data)) {
          const abbr = pinfo && (pinfo.team || pinfo.team_abbr || pinfo.team_abbreviation);
          if (abbr) {
            next[String(pid)] = String(abbr);
          }
        }
        setPlayersTeamMap(next);
      } catch (_) {
        if (!cancelled) {
          setPlayersTeamMap({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  function getTeamName(rosterId) {
    if (!rosters || !users) {
      return `Team ${rosterId}`;
    }
    const roster = rosters.find((r) => String(r.roster_id) === String(rosterId));
    if (!roster) {
      return `Team ${rosterId}`;
    }
    const user = users.find((u) => String(u.user_id) === String(roster.owner_id));
    if (user && user.metadata && user.metadata.team_name) {
      return user.metadata.team_name;
    }
    if (user && user.display_name) {
      return `Team ${user.display_name}`;
    }
    return `Team ${rosterId}`;
  }

  function getAvatar(rosterId) {
    if (!rosters || !users) {
      return null;
    }
    const roster = rosters.find((r) => String(r.roster_id) === String(rosterId));
    if (!roster) {
      return null;
    }
    const user = users.find((u) => String(u.user_id) === String(roster.owner_id));
    if (!user) {
      return null;
    }
    return user.team_avatar_url || user.user_avatar_url || user.avatar_url || null;
  }

  function toggleExpand(rosterId) {
    setExpanded((prev) => ({ ...prev, [rosterId]: !prev[rosterId] }));
  }

  function toggleBench(rosterId) {
    setBenchOpen((prev) => ({ ...prev, [rosterId]: !prev[rosterId] }));
  }

  if (loading) {
    return (
      <LoadingState label="Loading scores…" />
    );
  }

  if (error || !weeksParsedData || !rosters || !users) {
    return <div>Error loading scores.</div>;
  }

  const breakdownByRoster = getWeekScoreBreakdown(weeksParsedData, week, rosters) || {};
  const rawWeekEntries = (Array.isArray(weeksParsedData) && weeksParsedData[week - 1]
    ? weeksParsedData[week - 1]
    : []
  ).filter((e) => e && e.roster_id != null);
  const weekEntries = rosterFilter
    ? rawWeekEntries.filter((e) => rosterFilter.has(String(e.roster_id)))
    : rawWeekEntries;

  if (!weekEntries.length) {
    return (
      <>
        <div className="team-scores-container">
          <WeekSelector
            week={week}
            onChange={setWeek}
            minWeek={safeMinWeek}
            maxWeek={safeMaxWeek}
          />
        </div>
        <div>No scores found for this week.</div>
      </>
    );
  }

  const standingsArr = getStandings(weeksParsedData) || [];
  const placeByRosterIdBase = {};
  const basePointsByRoster = {};
  for (const r of standingsArr) {
    if (r && r.roster_id != null) {
      placeByRosterIdBase[String(r.roster_id)] = r.place || 9999;
      basePointsByRoster[String(r.roster_id)] =
        typeof r.points_scored === 'number' ? r.points_scored : 0;
    }
  }

  let placeByRosterIdLive = null;
  let liveTotalByRosterId = null;
  try {
    const isCurrentSeason = String(season) === String(CURRENT_YEAR);
    if (isCurrentSeason && playersData && playerIdMap) {
      const currentWeekNum = getCurrentNFLWeek();
      const currentBreakdown = getWeekScoreBreakdown(weeksParsedData, currentWeekNum, rosters) || {};
      const totals = (standingsArr || [])
        .map((s) => {
          const raw = currentBreakdown[s.roster_id];
          let liveTotal = s.points_scored || 0;
          if (raw) {
            const computed = StartSitSort(raw, playersData, playerIdMap, null, injuriesMap, playerSeasonTotalsMap);
            if (computed && typeof computed.starterTotal === 'number') {
              const priorWeeks = (weeksParsedData || []).slice(0, currentWeekNum - 1) || [];
              const priorSum = priorWeeks.reduce((sum, wkArr) => {
                if (!Array.isArray(wkArr)) {
                  return sum;
                }
                const e = wkArr.find(
                  (x) => x && Number(x.roster_id) === Number(s.roster_id)
                );
                const pts = e && typeof e.points === 'number' ? e.points : 0;
                return sum + pts;
              }, 0);
              liveTotal = Math.round((priorSum + computed.starterTotal) * 10) / 10;
            }
          }
          return { roster_id: s.roster_id, liveTotal };
        })
        .sort((a, b) => b.liveTotal - a.liveTotal);
      placeByRosterIdLive = {};
      liveTotalByRosterId = {};
      let place = 1;
      let i = 0;
      while (i < totals.length) {
        const score = totals[i].liveTotal;
        let j = i + 1;
        while (j < totals.length && totals[j].liveTotal === score) {
          j += 1;
        }
        for (let k = i; k < j; k += 1) {
          placeByRosterIdLive[String(totals[k].roster_id)] = place;
          liveTotalByRosterId[String(totals[k].roster_id)] = totals[k].liveTotal;
        }
        place += j - i;
        i = j;
      }
    }
  } catch (_) {
    placeByRosterIdLive = null;
    liveTotalByRosterId = null;
  }

  const computedEntries = weekEntries
    .map((e) => {
      const rid = e.roster_id;
      const raw = breakdownByRoster[rid];
      const computed = raw ? startSitWithProjections(raw, playersData, playerIdMap, playerGameLabels, injuriesMap, playerSeasonTotalsMap, projectedPtsById) : null;
      const pts = computed
        ? computed.starterTotal
        : typeof e.points === 'number'
        ? Number(e.points.toFixed(2))
        : 0;
      const place =
        (placeByRosterIdLive && placeByRosterIdLive[String(rid)]) ||
        placeByRosterIdBase[String(rid)] ||
        9999;
      const pfTotal =
        liveTotalByRosterId && liveTotalByRosterId[String(rid)] != null
          ? liveTotalByRosterId[String(rid)]
          : basePointsByRoster[String(rid)] || 0;
      return { rosterId: rid, points: pts, place, pfTotal, breakdown: computed };
    })
    .sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }
      if ((a.place || 9999) !== (b.place || 9999)) {
        return (a.place || 9999) - (b.place || 9999);
      }
      return String(a.rosterId).localeCompare(String(b.rosterId));
    });

  const isCurrentSeason = String(season) === String(CURRENT_YEAR);
  const currentWeekNum = getCurrentNFLWeek();

  return (
    <>
      <div className="team-scores-container">
        <WeekSelector
          week={week}
          onChange={setWeek}
          minWeek={safeMinWeek}
          maxWeek={safeMaxWeek}
        />
      </div>
      <div
        className={
          'standings-list' + (hasAnyExpanded ? ' standings-list--expanded' : '')
        }
      >
        {computedEntries.map(({ rosterId, points, place, pfTotal, breakdown }) => {
          const teamName = getTeamName(rosterId);
          const avatarUrl = getAvatar(rosterId);
          const isExpanded = !!expanded[rosterId];
          const weekBreakdown = breakdown;
          const benchTotal = weekBreakdown ? weekBreakdown.benchTotal : 0;
          const isActiveWeek =
            isCurrentSeason &&
            Number(week) === Number(currentWeekNum) &&
            !isWeekCompleteByGames;
          const showCurrentInjury =
            String(season) === String(CURRENT_YEAR) &&
            Number(week) >= Number(getCurrentNFLWeek());

          let activeCount = 0;
          let yetToPlayCount = 0;
          if (isActiveWeek && weekBreakdown) {
            const rosterPlayerIds = [...(weekBreakdown.starters || []), ...(weekBreakdown.bench || [])]
              .map((p) => p && p.id)
              .filter((pid) => pid && pid !== '0');
            for (const pid of rosterPlayerIds) {
              const label = playerGameLabels && playerGameLabels[pid];
              if (!label) {
                continue;
              }
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

          const mine = isMyRoster(rosterId, myRosterId);
          const baseRowClass = (usePlayoffTheme ? ' standings-row--playoff' : '') + (mine ? ' standings-row--me' : '');

          const seed =
            rosterIdToSeed && rosterIdToSeed[String(rosterId)] != null
              ? rosterIdToSeed[String(rosterId)]
              : null;
          const playoffMeta =
            rosterIdToPlayoffMeta && rosterIdToPlayoffMeta[String(rosterId)]
              ? rosterIdToPlayoffMeta[String(rosterId)]
              : null;
          const displayPlace =
            playoffMeta && playoffMeta.place != null
              ? playoffMeta.place
              : place;
          const displayPfTotal =
            playoffMeta && typeof playoffMeta.total === 'number'
              ? playoffMeta.total
              : pfTotal;

          return (
            <div
              key={rosterId}
              className={`standings-row${baseRowClass}`}
            >
              <button
                className="standings-row-header"
                type="button"
                onClick={() => toggleExpand(rosterId)}
              >
                <span
                  className={
                    'standings-toggle-icon' +
                    (isExpanded ? ' standings-toggle-icon--open' : '')
                  }
                >
                  {isExpanded ? '▾' : '▸'}
                </span>
                <span className="standings-rank">
                  {seed != null ? `#${seed}` : ''}
                </span>
                {avatarUrl && (
                  <img
                    className="standings-avatar"
                    src={avatarUrl}
                    alt={`${teamName} avatar`}
                  />
                )}
                <span className="standings-title">{teamName}{mine ? <span className="me-chip">YOU</span> : null}</span>
                {isActiveWeek && !isMobile ? (
                  <span className="standings-activity">
                    <span className="standings-activity-item">
                      Yet to Play: {yetToPlayCount}
                    </span>
                    <span className="standings-activity-item">
                      In-Play: {activeCount}
                    </span>
                  </span>
                ) : null}
                {isActiveWeek && isMobile ? (
                  <div className="standings-activity standings-activity-mobile">
                    <span className="standings-activity-item">
                      YTP {yetToPlayCount}
                    </span>
                    <span className="standings-activity-item">
                      Live {activeCount}
                    </span>
                  </div>
                ) : null}
                <span
                  className={`standings-total${weekBreakdown && weekBreakdown.includesProjection ? ' standings-total--proj' : ''}`}
                  title={weekBreakdown && weekBreakdown.includesProjection ? 'Includes projections for players who have not played yet' : undefined}
                >
                  {Number(points || 0).toFixed(1)}
                  {weekBreakdown && weekBreakdown.includesProjection ? <span className="proj-tag"> proj</span> : ' pts'}
                </span>
              </button>
              {isExpanded && (
                <div className="standings-row-expand">
                  <div className="team-expanded-banner">
                    <div className="team-expanded-banner-left">
                      <span className="team-expanded-label">Owner:</span>
                      {(() => {
                        const roster =
                          rosters &&
                          rosters.find(
                            (r) => String(r.roster_id) === String(rosterId)
                          );
                        const owner =
                          roster && users
                            ? users.find(
                                (u) =>
                                  String(u.user_id) === String(roster.owner_id)
                              )
                            : null;
                        const ownerName =
                          owner && owner.display_name
                            ? owner.display_name
                            : teamName;
                        const ownerAvatar =
                          owner &&
                          (owner.user_avatar_url ||
                            owner.avatar_url ||
                            owner.team_avatar_url)
                            ? owner.user_avatar_url ||
                              owner.avatar_url ||
                              owner.team_avatar_url
                            : avatarUrl;
                        const teamLink = `/team/${rosterId}`;
                        return (
                          <a className="team-expanded-owner" href={teamLink}>
                            {ownerAvatar ? (
                              <img
                                className="team-expanded-owner-avatar"
                                src={ownerAvatar}
                                alt={`${ownerName} avatar`}
                              />
                            ) : null}
                            <span className="team-expanded-owner-name">
                              {ownerName}
                            </span>
                          </a>
                        );
                      })()}
                    </div>
                    <div className="team-expanded-banner-center">
                          <a className="team-expanded-place" href="/standings">
                        Place: #{displayPlace || 9999} (
                        {Number(displayPfTotal || 0).toFixed(1)} PF)
                      </a>
                    </div>
                    <div className="team-expanded-banner-right" />
                  </div>
                  {isMobile && showFullScoreBreakdownOnMobile ? (
                    <MobileTeamScoreSummary
                      weekBreakdown={weekBreakdown}
                      week={week}
                      rosterId={rosterId}
                      searchParams={null}
                      isActiveWeek={isActiveWeek}
                      activeCount={activeCount}
                      yetToPlayCount={yetToPlayCount}
                    />
                  ) : isMobile ? (
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
                        searchParams={null}
                        playerGameLabels={playerGameLabels}
                        isActiveWeek={isActiveWeek}
                        injuriesMap={injuriesMap}
                        showCurrentInjury={showCurrentInjury}
                        playerHighlightMap={{}}
                        playersTeamMap={playersTeamMap}
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
                      searchParams={null}
                      playerGameLabels={playerGameLabels}
                      isActiveWeek={isActiveWeek}
                      injuriesMap={injuriesMap}
                      showCurrentInjury={showCurrentInjury}
                      playerHighlightMap={{}}
                      playersTeamMap={playersTeamMap}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export default ScoresView;


