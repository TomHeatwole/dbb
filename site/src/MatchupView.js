import React, { useEffect, useState } from 'react';
import { fetchTeamData } from './TeamLookup';
import { fetchScoresData } from './ScoresLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from './PlayerLookup';
import { getWeekScoreBreakdown } from './ScoresParser';
import { StartSitSort } from './StartSitDecider';
import { fetchNflScoreboard } from './GamesLookup';
import { mapPlayersToGames, getGameDisplayForTeam } from './GamesParser';
import { CURRENT_YEAR, getCurrentNFLWeek } from './DateHelper';
import { STARTER_POSITION_NAMES } from './global_constants';
import useIsMobile from './useIsMobile';

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
 * - week: number (current matchup week; not yet used for scoring)
 * - displaySeeds: boolean (optional) – if true, show seeds before team names
 * - seed1: number (optional) – seed for team1
 * - seed2: number (optional) – seed for team2
 */
function MatchupView({ season, team1Id, team2Id, week, displaySeeds = false, seed1 = null, seed2 = null }) {
  const [teamData, setTeamData] = useState(null);
  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [playerGameLabels, setPlayerGameLabels] = useState({});
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingScores, setLoadingScores] = useState(true);
  const [error, setError] = useState(null);
  const [scoresError, setScoresError] = useState(null);

  const isMobileView = useIsMobile();
  const isCurrentSeason = String(season) === String(CURRENT_YEAR);
  const currentWeekNum = getCurrentNFLWeek();
  const isActiveWeek =
    isCurrentSeason && Number(week) === Number(currentWeekNum);

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
    if (!weeksParsedData || !playersData || !playerIdMap || !week) {
      setPlayerGameLabels({});
      return;
    }
    const weekIdx = Number(week) - 1;
    const weekArr = Array.isArray(weeksParsedData) ? weeksParsedData[weekIdx] : null;
    if (!Array.isArray(weekArr)) {
      setPlayerGameLabels({});
      return;
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
      setPlayerGameLabels({});
      return;
    }

    let cancelled = false;
    const seasonYear = Number(season);
    fetchNflScoreboard(seasonYear, week)
      .then(async (json) => {
        if (cancelled) {
          return;
        }
        const mapping = await mapPlayersToGames(
          playerIds,
          playersData,
          playerIdMap,
          json,
          null
        );
        const labels = {};
        for (const pid of playerIds) {
          const item = mapping[pid];
          const ev = item && item.event;
          const teamForWeek = item && item.team;
          const d = ev
            ? getGameDisplayForTeam(ev, teamForWeek)
            : { text: 'BYE', live: false, completed: false, eventId: null };
          labels[pid] = { ...d, team: teamForWeek || null };
        }
        if (!cancelled) {
          setPlayerGameLabels(labels);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerGameLabels({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [season, week, weeksParsedData, playersData, playerIdMap, team1Id, team2Id]);

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
      (playerGameLabels && playerGameLabels[slot.id]) ||
      { text: '', live: false, completed: false, eventId: null };
    const ptsVal = Number(slot.pts || 0);
    const showDash = !gameObj.live && !gameObj.completed && ptsVal === 0;
    const ptsText = showDash ? '-' : ptsVal.toFixed(1);

    const gameCellClasses = ['team-scores-game-cell', 'team-scores-game-cell--compact'];
    if (isActiveWeek && gameObj.live) {
      gameCellClasses.push('team-scores-game-live');
    } else if (isActiveWeek && gameObj.completed) {
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

  if (!weeksParsedData || !week) {
    return (
      <div className="yoffs-matchup-view-error">
        No matchup data found for this week.
      </div>
    );
  }

  const breakdownByRoster = getWeekScoreBreakdown(weeksParsedData, week) || {};
  const raw1 = breakdownByRoster[team1Id] || null;
  const raw2 = breakdownByRoster[team2Id] || null;

  const breakdown1 =
    raw1 && playersData && playerIdMap
      ? StartSitSort(raw1, playersData, playerIdMap, playerGameLabels)
      : null;
  const breakdown2 =
    raw2 && playersData && playerIdMap
      ? StartSitSort(raw2, playersData, playerIdMap, playerGameLabels)
      : null;

  if (!breakdown1 && !breakdown2) {
    return (
      <div className="yoffs-matchup-view-error">
        No starter data available for this matchup.
      </div>
    );
  }

  const starters1 =
    breakdown1 && Array.isArray(breakdown1.starters) ? breakdown1.starters : [];
  const starters2 =
    breakdown2 && Array.isArray(breakdown2.starters) ? breakdown2.starters : [];
  const leftTotalText = breakdown1
    ? Number(breakdown1.starterTotal || 0).toFixed(1)
    : '—';
  const rightTotalText = breakdown2
    ? Number(breakdown2.starterTotal || 0).toFixed(1)
    : '—';
  const positions = STARTER_POSITION_NAMES || [];
  const rowCount = positions.length || Math.max(starters1.length, starters2.length);

  return (
    <div className="yoffs-matchup-view">
      <div className="yoffs-matchup-header-row">
        <div className="yoffs-matchup-side yoffs-matchup-side--left">
          <div className="yoffs-matchup-team-block yoffs-matchup-team-block--left">
            <div className="yoffs-matchup-team-top">
              {leftMeta.avatarUrl && (
                <img
                  className="yoffs-matchup-avatar-large"
                  src={leftMeta.avatarUrl}
                  alt={`${leftMeta.teamName} avatar`}
                />
              )}
              <span className="yoffs-matchup-team-score">{leftTotalText}</span>
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
          <div className="yoffs-matchup-team-block yoffs-matchup-team-block--right">
            <div className="yoffs-matchup-team-top">
              {rightMeta.avatarUrl && (
                <img
                  className="yoffs-matchup-avatar-large"
                  src={rightMeta.avatarUrl}
                  alt={`${rightMeta.teamName} avatar`}
                />
              )}
              <span className="yoffs-matchup-team-score">{rightTotalText}</span>
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
      <div className="yoffs-matchup-table">
        {Array.from({ length: rowCount }).map((_, idx) => {
          const posLabel = positions[idx] || `S${idx + 1}`;
          const leftSlot = starters1[idx];
          const rightSlot = starters2[idx];
          return (
            <div key={posLabel + idx} className="yoffs-matchup-row">
              <div className="yoffs-matchup-cell yoffs-matchup-cell--left">
                {renderPlayerSide(leftSlot, 'left')}
              </div>
              <div className="yoffs-matchup-pos-col">
                <span className="yoffs-matchup-pos-pill">{posLabel}</span>
              </div>
              <div className="yoffs-matchup-cell yoffs-matchup-cell--right">
                {renderPlayerSide(rightSlot, 'right')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MatchupView;


