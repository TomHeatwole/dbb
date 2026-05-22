import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { fetchTeamData } from '../lookups/TeamLookup';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import { getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';
import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { mapPlayersToGames, getGameDisplayForTeam, isScoreboardWeekComplete } from '../scores/GamesParser';
import { CURRENT_YEAR, getCurrentNFLWeek, getCompletedWeeksCount } from '../utils/DateHelper';
import { STARTER_POSITION_NAMES } from '../utils/global_constants';
import useIsMobile from '../hooks/useIsMobile';
import MatchupWeekView from './MatchupWeekView';
import { fetchInjuriesForWeek, getInjuryAbbreviation } from '../lookups/InjuryLookup';
import { readPlayersSnapshot } from '../utils/database';
import { createLiveScoresPoller } from '../utils/livePolling';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import LoadingState from '../LoadingState';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import PositionBadge from '../PositionBadge';

function resolveTeamMeta(teamData, rosterId) {
  if (rosterId == null) {
    return { teamName: '????', avatarUrl: null, isPlaceholder: true };
  }

  if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
    return { teamName: `Team ${rosterId}`, avatarUrl: null, isPlaceholder: false };
  }

  const roster = teamData.rosters.find(
    (r) => String(r.roster_id) === String(rosterId)
  );
  const user = roster
    ? teamData.users.find(
        (u) => String(u.user_id) === String(roster.owner_id)
      )
    : null;

  let teamName = `Team ${rosterId}`;
  if (user && user.metadata && user.metadata.team_name) {
    teamName = user.metadata.team_name;
  } else if (user && user.display_name) {
    teamName = `Team ${user.display_name}`;
  }

  const avatarUrl =
    (user &&
      (user.team_avatar_url ||
        user.user_avatar_url ||
        user.avatar_url)) ||
    null;

  return { teamName, avatarUrl, isPlaceholder: false };
}

/**
 * MatchupView
 *
 * Props:
 * - season: string | number (ESPN/Sleeper season identifier)
 * - team1Id: roster_id for the left team
 * - team2Id: roster_id for the right team
 * - week: number (single-week view; kept for backwards compatibility)
 * - weeks: array of numbers (optional) – if provided, render one MatchupWeekView
 *          per week and use the cumulative total across all weeks in the header.
 * - displaySeeds: boolean (optional) – if true, show seeds before team names
 * - seed1: number (optional) – seed for team1
 * - seed2: number (optional) – seed for team2
 * - expandedWeeksOverride: number[] (optional) – list of week numbers that
 *   should be expanded by default on initial render; when provided, this
 *   overrides the “expand current NFL week” behavior.
 */
function MatchupView({
  season,
  team1Id,
  team2Id,
  week,
  weeks = null,
  displaySeeds = false,
  seed1 = null,
  seed2 = null,
  expandedWeeksOverride = null,
  preloadedTeamData = null,
  preloadedWeeksData = null,
  preloadedPlayersData = null,
  preloadedPlayerIdMap = null,
  playoffBufferAmount = 0,
  playoffBufferSide = null,
  bufferLabel = null,
  bufferLeftText = null,
  bufferRightText = null,
  headerLeftOverride = null,
  headerRightOverride = null,
  highlightMode = 'default', // 'default' | 'weekly' | 'seasonFinalOnly'
  highlightThreshold = null
}) {
  const [teamData, setTeamData] = useState(preloadedTeamData || null);
  const [weeksParsedData, setWeeksParsedData] = useState(preloadedWeeksData || null);
  const [playersData, setPlayersData] = useState(preloadedPlayersData || null);
  const [playerIdMap, setPlayerIdMap] = useState(preloadedPlayerIdMap || null);
  const [playerGameLabelsByWeek, setPlayerGameLabelsByWeek] = useState({});
  const [weekCompleteByGames, setWeekCompleteByGames] = useState({});
  const [injuriesByWeek, setInjuriesByWeek] = useState({});
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingScores, setLoadingScores] = useState(true);
  const [error, setError] = useState(null);
  const [scoresError, setScoresError] = useState(null);
  const [gridExpandedByWeek, setGridExpandedByWeek] = useState({});
  const [playersTeamMapByWeek, setPlayersTeamMapByWeek] = useState({});
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  const isMobileView = useIsMobile();
  const isCurrentSeason = String(season) === String(CURRENT_YEAR);
  const currentWeekNum = getCurrentNFLWeek();
  const effectiveWeeks = useMemo(() => {
    if (Array.isArray(weeks) && weeks.length > 0) {
      return weeks;
    }
    if (week != null) {
      return [week];
    }
    return [];
  }, [weeks, week]);
  const hasAnyWeeks = effectiveWeeks.length > 0;

  const isSingleWeekWithNoWeeksProp =
    effectiveWeeks.length === 1 &&
    !(Array.isArray(weeks) && weeks.length > 0);

  const playerSeasonTotalsMap = useMemo(() => {
    return getPlayerSeasonTotalsMap(weeksParsedData);
  }, [weeksParsedData]);

  useEffect(() => {
    if (!hasAnyWeeks) {
      return;
    }
    setGridExpandedByWeek((prev) => {
      const next = { ...prev };
      const hasOverride = Array.isArray(expandedWeeksOverride);
      effectiveWeeks.forEach((w) => {
        if (!Object.prototype.hasOwnProperty.call(next, w)) {
          if (hasOverride) {
            next[w] = expandedWeeksOverride.some(
              (ow) => Number(ow) === Number(w)
            );
          } else {
            const isCurrentWeekForDisplay =
              isCurrentSeason && Number(w) === Number(currentWeekNum);
            next[w] = isCurrentWeekForDisplay;
          }
        }
      });

      // Remove any weeks that are no longer visible so state does not
      // accumulate stale entries over time.
      Object.keys(next).forEach((key) => {
        const numericKey = Number(key);
        const stillVisible = effectiveWeeks.some(
          (w) => Number(w) === numericKey
        );
        if (!stillVisible) {
          delete next[numericKey];
        }
      });

      return next;
    });
  }, [hasAnyWeeks, effectiveWeeks, isCurrentSeason, currentWeekNum, expandedWeeksOverride]);

  useEffect(() => {
    let cancelled = false;

    async function loadTeams() {
      if (preloadedTeamData) {
        setTeamData(preloadedTeamData);
        setLoadingTeams(false);
        return;
      }
      setLoadingTeams(true);
      setError(null);
      try {
        const data = await fetchTeamData(season);
        if (!cancelled) {
          setTeamData(data);
        }
      } catch (e) {
        if (!cancelled) {
          setError('Failed to load team data');
        }
      } finally {
        if (!cancelled) {
          setLoadingTeams(false);
        }
      }
    }

    loadTeams();

    return () => {
      cancelled = true;
    };
  }, [season, preloadedTeamData]);

  // Load scores + player metadata for the given season
  useEffect(() => {
    let cancelled = false;
    async function loadScores() {
      if (!season) {
        return;
      }
      if (preloadedWeeksData && preloadedPlayerIdMap && preloadedPlayersData) {
        setWeeksParsedData(preloadedWeeksData);
        setPlayerIdMap(preloadedPlayerIdMap);
        setPlayersData(preloadedPlayersData);
        setLoadingScores(false);
        return;
      }
      setLoadingScores(true);
      setScoresError(null);
      try {
        const [weeksData, idMap] = await Promise.all([
          fetchScoresData(season),
          fetchPlayerIdMap()
        ]);
        if (cancelled) {
          return;
        }

        let players = null;
        try {
          const useRosters =
            teamData &&
            Array.isArray(teamData.rosters) &&
            String(season) === String(CURRENT_YEAR)
              ? teamData.rosters
              : null;
          players = await fetchPlayersData(
            useRosters || String(season)
          );
        } catch (_) {
          players = null;
        }

        if (cancelled) {
          return;
        }

        setWeeksParsedData(weeksData);
        setPlayerIdMap(idMap);
        setPlayersData(players);
      } catch (e) {
        if (!cancelled) {
          setWeeksParsedData(null);
          setPlayerIdMap(null);
          setPlayersData(null);
          setScoresError('Failed to load matchup scores');
        }
      } finally {
        if (!cancelled) {
          setLoadingScores(false);
        }
      }
    }
    loadScores();
    return () => {
      cancelled = true;
    };
  }, [season, teamData, preloadedWeeksData, preloadedPlayerIdMap, preloadedPlayersData]);

  // Build per-player game labels (matchup info) for this week, using only these two teams
  useEffect(() => {
    if (!weeksParsedData || !playersData || !playerIdMap || !hasAnyWeeks) {
      setPlayerGameLabelsByWeek({});
      setWeekCompleteByGames({});
      return;
    }
    let cancelled = false;
    const seasonYear = Number(season);
    async function loadLabels() {
      const nextLabelsByWeek = {};
      const nextWeekCompleteByGames = {};

      for (let i = 0; i < effectiveWeeks.length; i += 1) {
        const w = effectiveWeeks[i];
        const weekIdx = Number(w) - 1;
        const weekArr = Array.isArray(weeksParsedData)
          ? weeksParsedData[weekIdx]
          : null;
        if (!Array.isArray(weekArr)) {
          // No data for this week
          // eslint-disable-next-line no-continue
          continue;
        }
        const playerIdSet = new Set();
        weekArr.forEach((entry) => {
          if (!entry || entry.roster_id == null) {
            return;
          }
          let playersArray = entry.players;
          // If players array is empty/missing, fall back to roster data
          if ((!playersArray || playersArray.length === 0) && teamData && Array.isArray(teamData.rosters)) {
            const roster = teamData.rosters.find(r => r && Number(r.roster_id) === Number(entry.roster_id));
            if (roster && Array.isArray(roster.players)) {
              playersArray = roster.players;
            }
          }
          if (Array.isArray(playersArray)) {
            playersArray.forEach((pid) => {
              if (pid) {
                playerIdSet.add(pid);
              }
            });
          }
        });
        const playerIds = Array.from(playerIdSet);
        if (!playerIds.length) {
          // eslint-disable-next-line no-continue
          continue;
        }

        try {
          const overrideTeamMap =
            String(season) === String(CURRENT_YEAR) &&
            playersTeamMapByWeek &&
            playersTeamMapByWeek[w]
              ? playersTeamMapByWeek[w]
              : null;
          // eslint-disable-next-line no-await-in-loop
          const json = await fetchNflScoreboard(seasonYear, w);
          if (cancelled) {
            return;
          }
          try {
            nextWeekCompleteByGames[w] = isScoreboardWeekComplete(json);
          } catch (_) {
            nextWeekCompleteByGames[w] = false;
          }
          // eslint-disable-next-line no-await-in-loop
          const mapping = await mapPlayersToGames(
            playerIds,
            playersData,
            playerIdMap,
            json,
            overrideTeamMap
          );
          const labels = {};
          for (let j = 0; j < playerIds.length; j += 1) {
            const pid = playerIds[j];
            const item = mapping[pid];
            const ev = item && item.event;
            const teamForWeek = item && item.team;
            const d = ev
              ? getGameDisplayForTeam(ev, teamForWeek)
              : { text: 'BYE', live: false, completed: false, eventId: null };
            labels[pid] = { ...d, team: teamForWeek || null };
          }
          nextLabelsByWeek[w] = labels;
        } catch (e) {
          nextLabelsByWeek[w] = {};
          nextWeekCompleteByGames[w] = false;
        }
      }

      if (!cancelled) {
        setPlayerGameLabelsByWeek(nextLabelsByWeek);
        setWeekCompleteByGames(nextWeekCompleteByGames);
      }
    }

    loadLabels();

    return () => {
      cancelled = true;
    };
  }, [
    season,
    hasAnyWeeks,
    effectiveWeeks,
    weeksParsedData,
    playersData,
    playerIdMap,
    playersTeamMapByWeek,
    team1Id,
    team2Id,
    teamData
  ]);

  // Load per-player team mapping from weekly players snapshot for each
  // effective week (current season only), so we can override historical
  // team inference and always use the correct team for 2025 matchups.
  useEffect(() => {
    if (!hasAnyWeeks || !isCurrentSeason) {
      setPlayersTeamMapByWeek({});
      return;
    }
    let cancelled = false;
    async function loadPlayersTeamMaps() {
      const next = {};
      for (let i = 0; i < effectiveWeeks.length; i += 1) {
        const w = effectiveWeeks[i];
        try {
          // eslint-disable-next-line no-await-in-loop
          const snap = await readPlayersSnapshot(String(season), Number(w));
          if (cancelled) {
            return;
          }
          const data =
            snap && snap.snapshot && snap.snapshot.data
              ? snap.snapshot.data
              : null;
          if (!data) {
            // eslint-disable-next-line no-continue
            continue;
          }
          const mapForWeek = {};
          Object.entries(data).forEach(([pid, pinfo]) => {
            const abbr =
              pinfo &&
              (pinfo.team ||
                pinfo.team_abbr ||
                pinfo.team_abbreviation);
            if (abbr) {
              mapForWeek[String(pid)] = String(abbr);
            }
          });
          next[w] = mapForWeek;
        } catch (e) {
          // Ignore snapshot errors for this week; leave it unmapped.
        }
      }
      if (!cancelled) {
        setPlayersTeamMapByWeek(next);
      }
    }
    loadPlayersTeamMaps();
    return () => {
      cancelled = true;
    };
  }, [season, hasAnyWeeks, effectiveWeeks, isCurrentSeason]);

  // Load injuries per week for all effective weeks so we can show injury
  // badges next to player names in the matchup view, similar to ScoresView.
  useEffect(() => {
    if (!hasAnyWeeks || !playerIdMap) {
      setInjuriesByWeek({});
      return;
    }
    let cancelled = false;
    async function loadInjuries() {
      const next = {};
      for (let i = 0; i < effectiveWeeks.length; i += 1) {
        const w = effectiveWeeks[i];
        try {
          const isCurrentSeasonLocal = String(season) === String(CURRENT_YEAR);
          const currentWeekNum = getCurrentNFLWeek();
          const isPreviousWeek = isCurrentSeasonLocal ? Number(w) < currentWeekNum : true;

          let combined = {};

          if (isPreviousWeek) {
            try {
              // eslint-disable-next-line no-await-in-loop
              const snap = await readPlayersSnapshot(String(season), Number(w));
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
                combined = byPlayerId;
              }
            } catch (_) {
              // fall through to file-based
            }
          }

          if (!combined || Object.keys(combined).length === 0) {
            // eslint-disable-next-line no-await-in-loop
            const m = await fetchInjuriesForWeek(season, w);
            if (cancelled) {
              return;
            }
            combined = { ...(m || {}) };
          }

          try {
            if (playerIdMap && typeof playerIdMap === 'object') {
              // Mirror the remapping logic from TeamScores: if we have an
              // injury keyed by ESPN ID, also expose it under the Sleeper ID.
              Object.entries(playerIdMap).forEach(([pid, mapping]) => {
                const espnId =
                  mapping &&
                  (mapping.espn_id ||
                    (mapping.metadata && mapping.metadata.espn_id));
                if (
                  espnId &&
                  combined[String(espnId)] &&
                  !combined[String(pid)]
                ) {
                  combined[String(pid)] = combined[String(espnId)];
                }
              });
            }
          } catch (_) {
            // ignore mapping errors; fall back to raw map
          }
          next[w] = combined;
        } catch (e) {
          next[w] = {};
        }
      }
      if (!cancelled) {
        setInjuriesByWeek(next);
      }
    }
    loadInjuries();
    return () => {
      cancelled = true;
    };
  }, [season, hasAnyWeeks, effectiveWeeks, playerIdMap]);

  // Live polling: when viewing a matchup that includes the current NFL week
  // in the current season, periodically refresh weeksParsedData using the
  // shared live polling helper so scores update while games are live.
  useEffect(() => {
    if (!isCurrentSeason || !hasAnyWeeks) {
      return;
    }
    const liveWeek = effectiveWeeks.find(
      (w) => Number(w) === Number(currentWeekNum)
    );
    if (!liveWeek) {
      return;
    }

    let cancelled = false;

    const poller = createLiveScoresPoller({
      season,
      week: liveWeek,
      forceOnStartAndFocus: true,
      forceWeeks: effectiveWeeks, // Pass all weeks we're displaying so they stay loaded
      onData: ({ newWeeks }) => {
        if (cancelled || !Array.isArray(newWeeks)) {
          return;
        }
        setWeeksParsedData(newWeeks);
      },
    });

    poller.start();

    return () => {
      cancelled = true;
      poller.stop();
    };
  }, [season, isCurrentSeason, currentWeekNum, hasAnyWeeks, effectiveWeeks]);

  function formatPlayerNameForDisplay(nameOrId) {
    const raw = nameOrId;
    if (!isMobileView) {
      return raw;
    }
    if (typeof raw !== 'string') {
      return raw;
    }
    const name = raw.trim();
    if (!name) {
      return raw;
    }
    const parts = name.split(/\s+/);
    const first = parts[0] || '';
    const last = parts.slice(1).join(' ') || '';
    if (!first && !last) {
      return raw;
    }
    const firstInitial = first ? `${first[0].toUpperCase()}.` : '';
    let lastShort = last;
    if (last && last.length > 15) {
      const hyphenIdx = last.indexOf('-');
      if (hyphenIdx > 0) {
        const prefix = last.slice(0, Math.min(hyphenIdx + 3, last.length));
        lastShort = `${prefix}...`;
      } else {
        lastShort = `${last.slice(0, 12)}...`;
      }
    }
    return `${firstInitial} ${lastShort || ''}`.trim();
  }

  function makeRenderPlayerSideForWeek(weekNumber) {
    const labelsForWeek =
      (playerGameLabelsByWeek && playerGameLabelsByWeek[weekNumber]) || {};
    const isActiveWeekForDisplay =
      isCurrentSeason &&
      Number(weekNumber) === Number(currentWeekNum) &&
      !(weekCompleteByGames && weekCompleteByGames[weekNumber]);
    const injuriesForWeek =
      (injuriesByWeek && injuriesByWeek[weekNumber]) || {};
    const showCurrentInjuryForWeek =
      String(season) === String(CURRENT_YEAR) &&
      Number(weekNumber) >= Number(currentWeekNum);

    function renderInjuryBadge(playerId, info) {
      let status = null;
      if (
        !showCurrentInjuryForWeek &&
        injuriesForWeek &&
        playerId &&
        injuriesForWeek[String(playerId)]
      ) {
        status = injuriesForWeek[String(playerId)];
      } else if (showCurrentInjuryForWeek && info) {
        status =
          info.injury_status ||
          info.injury_notes ||
          (info.status &&
          /out|pup|questionable|doubtful|suspended|ir|injured reserve/i.test(
            info.status
          )
            ? info.status
            : null);
      }
      const ab = status ? getInjuryAbbreviation(status) : null;
      if (!ab) {
        return null;
      }
      const isRetired = ab === 'NA';
      const label = isRetired ? 'Retired 😂' : ab;
      const cls = isRetired
        ? 'injury-badge injury-badge--retired'
        : 'injury-badge';
      return (
        <span className={cls} title={status}>
          {label}
        </span>
      );
    }

    function renderPlayerSide(slot, align) {
      const isPlaceholderSide =
        (align === 'left' && leftIsPlaceholder) ||
        (align === 'right' && rightIsPlaceholder);

      if (isPlaceholderSide) {
        const gameCellClasses = [
          'team-scores-game-cell',
          'team-scores-game-cell--compact'
        ];
        return (
          <div className={`yoffs-matchup-player yoffs-matchup-player--${align}`}>
            <div className="yoffs-matchup-player-main">
              <span className="player-name">{'\u00A0'}</span>
              <span className="yoffs-matchup-player-pts">{'\u00A0'}</span>
            </div>
            <div className={gameCellClasses.join(' ')}>
              <div className="team-scores-game-text">{'\u00A0'}</div>
            </div>
          </div>
        );
      }

      if (!slot || !slot.id || String(slot.id) === '0') {
        return (
          <div className="yoffs-matchup-player yoffs-matchup-player--empty">
            <span className="yoffs-matchup-player-empty">—</span>
          </div>
        );
      }
      const info = getPlayerInfo(slot.id, playersData, playerIdMap);
      const gameObj =
        (labelsForWeek && labelsForWeek[slot.id]) ||
        { text: '', live: false, completed: false, eventId: null };
      const ptsVal = Number(slot.pts || 0);
      const showDash = !gameObj.live && !gameObj.completed && ptsVal === 0;
      const ptsText = showDash ? '-' : ptsVal.toFixed(1);

      const gameCellClasses = [
        'team-scores-game-cell',
        'team-scores-game-cell--compact'
      ];
      if (isActiveWeekForDisplay && gameObj.live) {
        gameCellClasses.push('team-scores-game-live');
      } else if (isActiveWeekForDisplay && gameObj.completed) {
        gameCellClasses.push('team-scores-game-completed');
      }

      const rawName = info && info.name ? info.name : (slot.id === '0' ? '\u00A0' : String(slot.id || ''));
      const playerName = formatPlayerNameForDisplay(rawName);
      const injuryBadge = renderInjuryBadge(slot.id, info);

      const playersTeamMapForWeek =
        (playersTeamMapByWeek && playersTeamMapByWeek[weekNumber]) || {};
      const snapshotTeam = playersTeamMapForWeek[String(slot.id)];
      const teamAbbr = snapshotTeam || gameObj.team || (info && (info.team || info.team_abbr)) || null;

      const avatarNode = (
        <img
          className="player-avatar player-avatar-style team-scores-player-img-margin"
          src={getPlayerLogoUrl(info && info.espn_photo_url)}
          alt={info && info.name ? info.name : ''}
        />
      );

      const nameNode = (
        <span className="player-name">
          {playerName}
          {info && info.position ? <> <PositionBadge position={info.position} /></> : ''}
          {teamAbbr ? <span className="team-scores-game-cell team-scores-team-abbr">{teamAbbr}</span> : null}
          {injuryBadge}
        </span>
      );

      const ptsNode = (
        <span className="yoffs-matchup-player-pts">{ptsText}</span>
      );

      const isRight = align === 'right';

      return (
        <div
          className={`yoffs-matchup-player yoffs-matchup-player--${align} player-clickable`}
          onClick={() => info && setSelectedPlayer(info)}
        >
          <div className="yoffs-matchup-player-main">
            {isRight ? (
              <>
                {ptsNode}
                {nameNode}
                {avatarNode}
              </>
            ) : (
              <>
                {avatarNode}
                {nameNode}
                {ptsNode}
              </>
            )}
          </div>
          <div className={gameCellClasses.join(' ')}>
            <div className="team-scores-game-text">
              {gameObj && gameObj.eventId ? (
                <a
                  href={`https://www.espn.com/nfl/game/_/gameId/${gameObj.eventId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="team-scores-game-link"
                  onClick={(e) => e.stopPropagation()}
                >
                  {gameObj.text}
                </a>
              ) : (
                gameObj.text
              )}
            </div>
          </div>
        </div>
      );
    }

    return renderPlayerSide;
  }

  const isLoading = loadingTeams || loadingScores;

  if (isLoading) {
    return (
      <LoadingState
        className="yoffs-matchup-view"
        label="Loading matchup…"
        ariaLabel="Loading matchup"
      />
    );
  }

  if (error || scoresError) {
    return (
      <div className="yoffs-matchup-view-error">
        {error || scoresError}
      </div>
    );
  }

  const weekBlocks = effectiveWeeks.map((w) => {
    const breakdownByRoster = getWeekScoreBreakdown(weeksParsedData, w, teamData?.rosters) || {};
    const raw1 = breakdownByRoster[team1Id] || null;
    const raw2 = breakdownByRoster[team2Id] || null;

    const labelsForWeek =
      (playerGameLabelsByWeek && playerGameLabelsByWeek[w]) || {};
    
    const injuriesForWeek =
      (injuriesByWeek && injuriesByWeek[w]) || {};

    const breakdown1 =
      raw1 && playersData && playerIdMap
        ? StartSitSort(raw1, playersData, playerIdMap, labelsForWeek, injuriesForWeek, playerSeasonTotalsMap)
        : null;
    const breakdown2 =
      raw2 && playersData && playerIdMap
        ? StartSitSort(raw2, playersData, playerIdMap, labelsForWeek, injuriesForWeek, playerSeasonTotalsMap)
        : null;

    const starters1 =
      breakdown1 && Array.isArray(breakdown1.starters)
        ? breakdown1.starters
        : [];
    const starters2 =
      breakdown2 && Array.isArray(breakdown2.starters)
        ? breakdown2.starters
        : [];
    const bench1 =
      breakdown1 && Array.isArray(breakdown1.bench) ? breakdown1.bench : [];
    const bench2 =
      breakdown2 && Array.isArray(breakdown2.bench) ? breakdown2.bench : [];

    const leftTotalValue =
      breakdown1 && typeof breakdown1.starterTotal === 'number'
        ? Number(breakdown1.starterTotal)
        : null;
    const rightTotalValue =
      breakdown2 && typeof breakdown2.starterTotal === 'number'
        ? Number(breakdown2.starterTotal)
        : null;

    const leftTotalText =
      leftTotalValue != null ? leftTotalValue.toFixed(1) : '—';
    const rightTotalText =
      rightTotalValue != null ? rightTotalValue.toFixed(1) : '—';

    // Compute Yet to Play / Live counts for the current NFL week if this
    // block corresponds to the current week.
    let isCurrentWeekBlock = false;
    let leftYetToPlayLabel = '';
    let leftLiveLabel = '';
    let rightYetToPlayLabel = '';
    let rightLiveLabel = '';

    if (
      isCurrentSeason &&
      Number(w) === Number(currentWeekNum) &&
      playerGameLabelsByWeek &&
      !(weekCompleteByGames && weekCompleteByGames[w])
    ) {
      const labelsForActivity =
        playerGameLabelsByWeek[w] || {};
      let leftActiveCount = 0;
      let leftYetToPlayCount = 0;
      let rightActiveCount = 0;
      let rightYetToPlayCount = 0;

      const leftSlots = [...starters1, ...bench1];
      const rightSlots = [...starters2, ...bench2];

      leftSlots.forEach((slot) => {
        const pid = slot && slot.id;
        if (!pid || String(pid) === '0') {
          return;
        }
        const label = labelsForActivity[pid];
        if (!label) {
          return;
        }
        const isLive = !!label.live;
        const isCompleted = !!label.completed;
        const isBye = label && label.text === 'BYE';
        if (isLive) {
          leftActiveCount += 1;
        } else if (!isCompleted && !isBye) {
          leftYetToPlayCount += 1;
        }
      });

      rightSlots.forEach((slot) => {
        const pid = slot && slot.id;
        if (!pid || String(pid) === '0') {
          return;
        }
        const label = labelsForActivity[pid];
        if (!label) {
          return;
        }
        const isLive = !!label.live;
        const isCompleted = !!label.completed;
        const isBye = label && label.text === 'BYE';
        if (isLive) {
          rightActiveCount += 1;
        } else if (!isCompleted && !isBye) {
          rightYetToPlayCount += 1;
        }
      });

      isCurrentWeekBlock = true;
      leftYetToPlayLabel = isMobileView
        ? `YTP ${leftYetToPlayCount}`
        : `Yet to Play: ${leftYetToPlayCount}`;
      leftLiveLabel = isMobileView
        ? `Live ${leftActiveCount}`
        : `Live: ${leftActiveCount}`;
      rightYetToPlayLabel = isMobileView
        ? `YTP ${rightYetToPlayCount}`
        : `Yet to Play: ${rightYetToPlayCount}`;
      rightLiveLabel = isMobileView
        ? `Live ${rightActiveCount}`
        : `Live: ${rightActiveCount}`;
    }

    return {
      weekNumber: w,
      breakdown1,
      breakdown2,
      starters1,
      starters2,
      bench1,
      bench2,
      leftTotalValue,
      rightTotalValue,
      leftTotalText,
      rightTotalText,
      renderPlayerSide: makeRenderPlayerSideForWeek(w),
      isCurrentWeekBlock,
      leftYetToPlayLabel,
      leftLiveLabel,
      rightYetToPlayLabel,
      rightLiveLabel
    };
  });

  const leftMeta = resolveTeamMeta(teamData, team1Id);
  const rightMeta = resolveTeamMeta(teamData, team2Id);
  const leftIsPlaceholder = !!leftMeta.isPlaceholder;
  const rightIsPlaceholder = !!rightMeta.isPlaceholder;

  const hasAnyBreakdown = weekBlocks.some(
    (block) => block.breakdown1 || block.breakdown2
  ) || leftIsPlaceholder || rightIsPlaceholder;

  if (!hasAnyBreakdown && !leftIsPlaceholder && !rightIsPlaceholder) {
    return (
      <div className="yoffs-matchup-view-error">
        No starter data available for this matchup.
      </div>
    );
  }

  let headerLeftTotal = leftIsPlaceholder ? '-' : '—';
  let headerRightTotal = rightIsPlaceholder ? '-' : '—';

  // Add buffer to totals for championship
  const hasBuffer =
    effectiveWeeks.length === 1 &&
    (
      (typeof playoffBufferAmount === 'number' && playoffBufferAmount > 0 &&
        (playoffBufferSide === 'left' || playoffBufferSide === 'right')) ||
      bufferLeftText != null ||
      bufferRightText != null
    );

  if (weekBlocks.length === 1) {
    let leftVal = weekBlocks[0].leftTotalValue != null ? weekBlocks[0].leftTotalValue : 0;
    let rightVal = weekBlocks[0].rightTotalValue != null ? weekBlocks[0].rightTotalValue : 0;
    
    if (hasBuffer) {
      if (playoffBufferSide === 'left') {
        leftVal += playoffBufferAmount;
      } else if (playoffBufferSide === 'right') {
        rightVal += playoffBufferAmount;
      }
    }
    
    headerLeftTotal = weekBlocks[0].leftTotalValue != null ? leftVal.toFixed(1) : '—';
    headerRightTotal = weekBlocks[0].rightTotalValue != null ? rightVal.toFixed(1) : '—';
  } else {
    const leftSum = weekBlocks.reduce((acc, block) => {
      if (block.leftTotalValue != null) {
        return acc + block.leftTotalValue;
      }
      return acc;
    }, 0);
    const rightSum = weekBlocks.reduce((acc, block) => {
      if (block.rightTotalValue != null) {
        return acc + block.rightTotalValue;
      }
      return acc;
    }, 0);

    const hasLeft = weekBlocks.some(
      (block) => block.leftTotalValue != null
    );
    const hasRight = weekBlocks.some(
      (block) => block.rightTotalValue != null
    );

    headerLeftTotal = hasLeft ? leftSum.toFixed(1) : headerLeftTotal;
    headerRightTotal = hasRight ? rightSum.toFixed(1) : headerRightTotal;
  }

  if (headerLeftOverride != null) {
    headerLeftTotal = headerLeftOverride;
  }
  if (headerRightOverride != null) {
    headerRightTotal = headerRightOverride;
  }

  const completedWeeks = getCompletedWeeksCount(season);
  const lastWeekNumber =
    effectiveWeeks.length > 0 ? effectiveWeeks[effectiveWeeks.length - 1] : null;
  const allWeeksCompleted =
    lastWeekNumber != null &&
    (!isCurrentSeason || Number(lastWeekNumber) <= Number(completedWeeks));

  let leftIsWinner = false;
  let rightIsWinner = false;
  let leftIsLoser = false;
  let rightIsLoser = false;

  const seasonCompleteFor17 =
    !isCurrentSeason || Number(completedWeeks) >= 17;

  let enableHighlight = false;

  if (highlightMode === 'weekly') {
    // Highlight any completed week, regardless of overall season completion
    enableHighlight = !!allWeeksCompleted;
  } else if (highlightMode === 'seasonFinalOnly') {
    const threshold = highlightThreshold != null
      ? Number(highlightThreshold)
      : (lastWeekNumber || 0);
    const seasonDoneForView = !isCurrentSeason || Number(completedWeeks) >= threshold;
    const viewingFinalWeek = lastWeekNumber != null && Number(lastWeekNumber) === threshold;
    enableHighlight = !!allWeeksCompleted && seasonDoneForView && viewingFinalWeek;
  } else {
    // Default: highlight only when full 17-week season is complete
    const seasonComplete = seasonCompleteFor17;
    enableHighlight = !!allWeeksCompleted && seasonComplete;
  }

  if (enableHighlight) {
    const leftVal = parseFloat(headerLeftTotal);
    const rightVal = parseFloat(headerRightTotal);
    if (Number.isFinite(leftVal) && Number.isFinite(rightVal)) {
      if (leftVal > rightVal) {
        leftIsWinner = true;
        rightIsLoser = true;
      } else if (rightVal > leftVal) {
        rightIsWinner = true;
        leftIsLoser = true;
      } else if (
        effectiveWeeks.length > 1 &&
        seed1 != null &&
        seed2 != null &&
        seed1 !== seed2
      ) {
        if (Number(seed1) < Number(seed2)) {
          leftIsWinner = true;
          rightIsLoser = true;
        } else {
          rightIsWinner = true;
          leftIsLoser = true;
        }
      }
    }
  }

  const leftTeamBlockClasses = ['yoffs-matchup-team-block', 'yoffs-matchup-team-block--left'];
  const rightTeamBlockClasses = [
    'yoffs-matchup-team-block',
    'yoffs-matchup-team-block--right'
  ];
  if (leftIsWinner) {
    leftTeamBlockClasses.push('yoffs-matchup-team-block--winner');
  } else if (leftIsLoser) {
    leftTeamBlockClasses.push('yoffs-matchup-team-block--loser');
  }
  if (rightIsWinner) {
    rightTeamBlockClasses.push('yoffs-matchup-team-block--winner');
  } else if (rightIsLoser) {
    rightTeamBlockClasses.push('yoffs-matchup-team-block--loser');
  }

  const positions = STARTER_POSITION_NAMES || [];

  return (
    <div className="yoffs-matchup-view">
      <div className="yoffs-matchup-header-row">
        <div className="yoffs-matchup-side yoffs-matchup-side--left">
          {leftIsPlaceholder ? (
            <div className="yoffs-matchup-team-block yoffs-matchup-team-block--placeholder">
              <div className="yoffs-matchup-team-placeholder">
                <span className="yoffs-matchup-team-placeholder-text">?????</span>
              </div>
            </div>
          ) : (
            <div className={leftTeamBlockClasses.join(' ')}>
              <div className="yoffs-matchup-team-top">
                {leftMeta.avatarUrl && (
                  <img
                    className="yoffs-matchup-avatar-large"
                    src={leftMeta.avatarUrl}
                    alt={`${leftMeta.teamName} avatar`}
                  />
                )}
                <span className="yoffs-matchup-team-score">
                  {headerLeftTotal}
                </span>
              </div>
              <div className="yoffs-matchup-team-bottom">
                {displaySeeds && seed1 != null && (
                  <span className="yoffs-bracket-seed">#{seed1}</span>
                )}
                <span className="yoffs-bracket-name">{leftMeta.teamName}</span>
              </div>
            </div>
          )}
        </div>
        <div className="yoffs-matchup-side yoffs-matchup-side--right">
          {rightIsPlaceholder ? (
            <div className="yoffs-matchup-team-block yoffs-matchup-team-block--placeholder">
              <div className="yoffs-matchup-team-placeholder">
                <span className="yoffs-matchup-team-placeholder-text">?????</span>
              </div>
            </div>
          ) : (
            <div className={rightTeamBlockClasses.join(' ')}>
              <div className="yoffs-matchup-team-top">
                {rightMeta.avatarUrl && (
                  <img
                    className="yoffs-matchup-avatar-large"
                    src={rightMeta.avatarUrl}
                    alt={`${rightMeta.teamName} avatar`}
                  />
                )}
                <span className="yoffs-matchup-team-score">
                  {headerRightTotal}
                </span>
              </div>
              <div className="yoffs-matchup-team-bottom">
                {displaySeeds && seed2 != null && (
                  <span className="yoffs-bracket-seed">#{seed2}</span>
                )}
                <span className="yoffs-bracket-name">{rightMeta.teamName}</span>
              </div>
            </div>
          )}
        </div>
      </div>
      {hasBuffer && (
        <MatchupWeekView
          key="playoff-buffer"
          positions={[]}
          starters1={[]}
          starters2={[]}
          bench1={[]}
          bench2={[]}
          renderPlayerSide={() => null}
          expanded={false}
          onToggleExpanded={null}
          week={null}
          leftTotalText={
            bufferLeftText != null
              ? bufferLeftText
              : (playoffBufferSide === 'left'
                ? `+${playoffBufferAmount.toFixed(1)}`
                : '-')
          }
          rightTotalText={
            bufferRightText != null
              ? bufferRightText
              : (playoffBufferSide === 'right'
                ? `+${playoffBufferAmount.toFixed(1)}`
                : '-')
          }
          labelOverride={bufferLabel != null ? bufferLabel : 'Semis Buffer'}
          isBufferRow
          bufferSide={playoffBufferSide}
        />
      )}
      {weekBlocks.map((block) => (
        <MatchupWeekView
          key={block.weekNumber}
          positions={positions}
          starters1={block.starters1}
          starters2={block.starters2}
          bench1={block.bench1}
          bench2={block.bench2}
          renderPlayerSide={block.renderPlayerSide}
          week={block.weekNumber}
          leftTotalText={block.leftTotalText}
          rightTotalText={block.rightTotalText}
          isCurrentWeek={block.isCurrentWeekBlock}
          leftYetToPlayLabel={block.leftYetToPlayLabel}
          leftLiveLabel={block.leftLiveLabel}
          rightYetToPlayLabel={block.rightYetToPlayLabel}
          rightLiveLabel={block.rightLiveLabel}
          expanded={
            Object.prototype.hasOwnProperty.call(
              gridExpandedByWeek,
              block.weekNumber
            )
              ? gridExpandedByWeek[block.weekNumber]
              : false
          }
          onToggleExpanded={
            isSingleWeekWithNoWeeksProp
              ? null
              : () =>
                  setGridExpandedByWeek((prev) => {
                    const currentValue = Object.prototype.hasOwnProperty.call(
                      prev,
                      block.weekNumber
                    )
                      ? prev[block.weekNumber]
                      : true;
                    return {
                      ...prev,
                      [block.weekNumber]: !currentValue
                    };
                  })
          }
        />
      ))}
      {selectedPlayer && createPortal(
        <div className="player-modal-overlay" onClick={() => setSelectedPlayer(null)}>
          <div className="player-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <PlayerWeeklyScores
              player={selectedPlayer}
              onClose={() => setSelectedPlayer(null)}
              rosters={teamData && teamData.rosters ? teamData.rosters : null}
              users={teamData && teamData.users ? teamData.users : null}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default MatchupView;


