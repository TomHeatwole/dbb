import React, { useEffect, useState } from 'react';
import { fetchTeamData } from './TeamLookup';
import { fetchScoresData } from './ScoresLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from './PlayerLookup';
import { getWeekScoreBreakdown } from './ScoresParser';
import { StartSitSort } from './StartSitDecider';
import { fetchNflScoreboard } from './GamesLookup';
import { mapPlayersToGames, getGameDisplayForTeam } from './GamesParser';
import { CURRENT_YEAR, getCurrentNFLWeek, getCompletedWeeksCount } from './DateHelper';
import { STARTER_POSITION_NAMES } from './global_constants';
import useIsMobile from './useIsMobile';
import MatchupWeekView from './MatchupWeekView';

function resolveTeamMeta(teamData, rosterId) {
  if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
    return { teamName: `Team ${rosterId}`, avatarUrl: null };
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

  return { teamName, avatarUrl };
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
 */
function MatchupView({
  season,
  team1Id,
  team2Id,
  week,
  weeks = null,
  displaySeeds = false,
  seed1 = null,
  seed2 = null
}) {
  const [teamData, setTeamData] = useState(null);
  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [playerGameLabelsByWeek, setPlayerGameLabelsByWeek] = useState({});
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingScores, setLoadingScores] = useState(true);
  const [error, setError] = useState(null);
  const [scoresError, setScoresError] = useState(null);
  const [gridExpandedByWeek, setGridExpandedByWeek] = useState({});

  const isMobileView = useIsMobile();
  const isCurrentSeason = String(season) === String(CURRENT_YEAR);
  const currentWeekNum = getCurrentNFLWeek();
  const effectiveWeeks =
    Array.isArray(weeks) && weeks.length > 0
      ? weeks
      : week != null
      ? [week]
      : [];
  const hasAnyWeeks = effectiveWeeks.length > 0;

  // When the matchup (teams/weeks/season) changes, reset per-week expansion
  // so defaults are recalculated for the new game.
  useEffect(() => {
    setGridExpandedByWeek({});
  }, [season, team1Id, team2Id, effectiveWeeks]);

  useEffect(() => {
    if (!hasAnyWeeks) {
      return;
    }
    const completedWeeks = getCompletedWeeksCount(season);
    setGridExpandedByWeek((prev) => {
      if (prev && Object.keys(prev).length > 0) {
        return prev;
      }
      const next = {};
      if (effectiveWeeks.length === 1) {
        // Finals or single-week view: always expanded by default
        next[effectiveWeeks[0]] = true;
      } else if (effectiveWeeks.length >= 2) {
        // Semifinals: use Week N and Week N+1 rules
        const weekN = effectiveWeeks[0];
        const weekNp1 = effectiveWeeks[1];
        const weekNCompleted =
          !isCurrentSeason || Number(weekN) <= Number(completedWeeks);
        const weekNp1Completed =
          !isCurrentSeason || Number(weekNp1) <= Number(completedWeeks);

        if (weekNCompleted && !weekNp1Completed) {
          // 2) Week N concluded, collapse N, expand N+1
          next[weekN] = false;
          next[weekNp1] = true;
        } else if (!weekNCompleted) {
          // 3) Week N not completed, expand N, collapse N+1
          next[weekN] = true;
          next[weekNp1] = false;
        } else if (weekNCompleted && weekNp1Completed) {
          // 4) Both weeks concluded, collapse both
          next[weekN] = false;
          next[weekNp1] = false;
        }

        // Any additional weeks default collapsed
        for (let i = 0; i < effectiveWeeks.length; i += 1) {
          const w = effectiveWeeks[i];
          if (!Object.prototype.hasOwnProperty.call(next, w)) {
            next[w] = false;
          }
        }
      }
      return next;
    });
  }, [season, hasAnyWeeks, effectiveWeeks, isCurrentSeason]);

  useEffect(() => {
    let cancelled = false;

    async function loadTeams() {
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
  }, [season]);

  // Load scores + player metadata for the given season
  useEffect(() => {
    let cancelled = false;
    async function loadScores() {
      if (!season) {
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
  }, [season, teamData]);

  // Build per-player game labels (matchup info) for this week, using only these two teams
  useEffect(() => {
    if (!weeksParsedData || !playersData || !playerIdMap || !hasAnyWeeks) {
      setPlayerGameLabelsByWeek({});
      return;
    }
    let cancelled = false;
    const seasonYear = Number(season);
    async function loadLabels() {
      const nextLabelsByWeek = {};

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
          if (
            Number(entry.roster_id) !== Number(team1Id) &&
            Number(entry.roster_id) !== Number(team2Id)
          ) {
            return;
          }
          if (Array.isArray(entry.players)) {
            entry.players.forEach((pid) => {
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
          // eslint-disable-next-line no-await-in-loop
          const json = await fetchNflScoreboard(seasonYear, w);
          if (cancelled) {
            return;
          }
          // eslint-disable-next-line no-await-in-loop
          const mapping = await mapPlayersToGames(
            playerIds,
            playersData,
            playerIdMap,
            json,
            null
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
        }
      }

      if (!cancelled) {
        setPlayerGameLabelsByWeek(nextLabelsByWeek);
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
    team1Id,
    team2Id
  ]);

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
      isCurrentSeason && Number(weekNumber) === Number(currentWeekNum);

    function renderPlayerSide(slot, align) {
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

      const playerName = formatPlayerNameForDisplay(
        info && info.name ? info.name : slot.id === '0' ? '\u00A0' : slot.id
      );

      return (
        <div className={`yoffs-matchup-player yoffs-matchup-player--${align}`}>
          <div className="yoffs-matchup-player-main">
            {info && info.espn_photo_url && (
              <img
                className="player-avatar player-avatar-style team-scores-player-img-margin"
                src={info.espn_photo_url}
                alt={info.name}
              />
            )}
            <span className="player-name">
              {playerName}
              {info && info.position ? ` (${info.position})` : ''}
            </span>
            <span className="yoffs-matchup-player-pts">{ptsText}</span>
          </div>
          <div className={gameCellClasses.join(' ')}>
            <div className="team-scores-game-text">
              {gameObj && gameObj.eventId ? (
                <a
                  href={`https://www.espn.com/nfl/game/_/gameId/${gameObj.eventId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="team-scores-game-link"
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

  const leftMeta = resolveTeamMeta(teamData, team1Id);
  const rightMeta = resolveTeamMeta(teamData, team2Id);

  const isLoading = loadingTeams || loadingScores;

  if (isLoading) {
    return (
      <div className="yoffs-matchup-view loading-center">
        <div className="spinner" aria-label="Loading matchup" />
      </div>
    );
  }

  if (error || scoresError) {
    return (
      <div className="yoffs-matchup-view-error">
        {error || scoresError}
      </div>
    );
  }

  if (!weeksParsedData || !hasAnyWeeks) {
    return (
      <div className="yoffs-matchup-view-error">
        No matchup data found for this week.
      </div>
    );
  }

  const weekBlocks = effectiveWeeks.map((w) => {
    const breakdownByRoster = getWeekScoreBreakdown(weeksParsedData, w) || {};
    const raw1 = breakdownByRoster[team1Id] || null;
    const raw2 = breakdownByRoster[team2Id] || null;

    const labelsForWeek =
      (playerGameLabelsByWeek && playerGameLabelsByWeek[w]) || {};

    const breakdown1 =
      raw1 && playersData && playerIdMap
        ? StartSitSort(raw1, playersData, playerIdMap, labelsForWeek)
        : null;
    const breakdown2 =
      raw2 && playersData && playerIdMap
        ? StartSitSort(raw2, playersData, playerIdMap, labelsForWeek)
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
      playerGameLabelsByWeek
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

  const hasAnyBreakdown = weekBlocks.some(
    (block) => block.breakdown1 || block.breakdown2
  );

  if (!hasAnyBreakdown) {
    return (
      <div className="yoffs-matchup-view-error">
        No starter data available for this matchup.
      </div>
    );
  }

  let headerLeftTotal = '—';
  let headerRightTotal = '—';

  if (weekBlocks.length === 1) {
    headerLeftTotal = weekBlocks[0].leftTotalText;
    headerRightTotal = weekBlocks[0].rightTotalText;
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

    headerLeftTotal = hasLeft ? leftSum.toFixed(1) : '—';
    headerRightTotal = hasRight ? rightSum.toFixed(1) : '—';
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

  if (allWeeksCompleted) {
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
        </div>
        <div className="yoffs-matchup-side yoffs-matchup-side--right">
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
        </div>
      </div>
      {weekBlocks.map((block) => (
        <MatchupWeekView
          key={block.weekNumber}
          positions={positions}
          starters1={block.starters1}
          starters2={block.starters2}
          bench1={block.bench1}
          bench2={block.bench2}
          renderPlayerSide={block.renderPlayerSide}
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
              : true
          }
          onToggleExpanded={() =>
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
          week={block.weekNumber}
          leftTotalText={block.leftTotalText}
          rightTotalText={block.rightTotalText}
        />
      ))}
    </div>
  );
}

export default MatchupView;


