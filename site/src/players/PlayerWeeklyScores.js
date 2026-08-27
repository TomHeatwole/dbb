import React, { useEffect, useState, useRef } from 'react';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { CURRENT_YEAR, getCurrentNFLWeek, getCompletedWeeksCount } from '../utils/DateHelper';
import LoadingState from '../LoadingState';
import { loadSeasonStatsFromCSV, mapCSVStatsToSleeperFormat } from './WeeklyStatsLoader';
import useIsMobile from '../hooks/useIsMobile';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { fetchTeamData } from '../lookups/TeamLookup';
import PositionBadge from '../PositionBadge';
import { useMyRosterId, isMyRoster } from '../hooks/useAuthUser';
import { fetchNflScoreboard } from '../lookups/GamesLookup';
import { mapPlayersToGames, getGameDisplayForTeam } from '../scores/GamesParser';
import { readPlayersSnapshot } from '../utils/database';

function rosterHasPlayer(roster, playerId) {
  if (!roster || playerId == null) return false;
  const pid = String(playerId);
  const pools = [roster.players, roster.taxi, roster.reserve];
  return pools.some(
    (pool) => Array.isArray(pool) && pool.some((p) => String(p) === pid)
  );
}

function resolveOwnership(playerId, rosters, users) {
  if (!playerId || !Array.isArray(rosters) || !Array.isArray(users)) {
    return { resolved: false, info: null };
  }

  const owningRoster = rosters.find((r) => rosterHasPlayer(r, playerId));
  if (!owningRoster) {
    return { resolved: true, info: null };
  }

  const owningUser = users.find(
    (u) => u && String(u.user_id) === String(owningRoster.owner_id)
  );

  return {
    resolved: true,
    info: {
      teamName:
        (owningUser && owningUser.metadata && owningUser.metadata.team_name) ||
        (owningUser && owningUser.display_name) ||
        `Team ${owningRoster.roster_id}`,
      avatar: owningUser
        ? owningUser.team_avatar_url ||
          owningUser.user_avatar_url ||
          owningUser.avatar_url ||
          null
        : null,
      rosterId: owningRoster.roster_id,
    },
  };
}

function OwnershipDisplay({ info, myRosterId, variant = 'banner', label = 'Owned by' }) {
  const ownedByMe = isMyRoster(info?.rosterId, myRosterId);
  const isFa = !info;
  const rootClass =
    variant === 'banner'
      ? `player-ownership-banner${
          isFa
            ? ' player-ownership-banner--fa'
            : ownedByMe
              ? ' player-ownership-banner--me'
              : ' player-ownership-banner--owned'
        }`
      : `player-ownership-info${ownedByMe ? ' player-ownership-info--me' : ''}${
          isFa ? ' player-ownership-info--fa' : ''
        }`;

  const teamRow = info ? (
    <span className="player-ownership-team-row">
      {info.avatar ? (
        <img src={info.avatar} alt="" className="player-ownership-avatar" />
      ) : null}
      <span className="player-ownership-team">
        {info.teamName}
        {ownedByMe ? <span className="me-chip">YOU</span> : null}
      </span>
    </span>
  ) : (
    <span className="player-ownership-free-agent">Free Agent</span>
  );

  return (
    <div className={rootClass}>
      {variant === 'banner' && info ? (
        <span className="player-ownership-label">{label}</span>
      ) : null}
      {teamRow}
    </div>
  );
}

function PlayerWeeklyScores({ player, onClose, rosters, users, ownershipOverride, initialSeason }) {
  // Default to previous year if current season hasn't started yet
  const completedWeeks = getCompletedWeeksCount(CURRENT_YEAR);
  const isPreSeason = completedWeeks === 0;
  const defaultSeason = isPreSeason ? String(Number(CURRENT_YEAR) - 1) : CURRENT_YEAR;
  const [season, setSeason] = useState(
    initialSeason ? String(initialSeason) : defaultSeason
  );
  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [weeklyScores, setWeeklyScores] = useState([]);
  const [seasonStats, setSeasonStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);
  const [error, setError] = useState(null);
  const [positionRankTotal, setPositionRankTotal] = useState(null);
  const [positionRankPerGame, setPositionRankPerGame] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [weeklyGames, setWeeklyGames] = useState({});
  const [currentRosters, setCurrentRosters] = useState(null);
  const [currentUsers, setCurrentUsers] = useState(null);
  const [seasonRosters, setSeasonRosters] = useState(null);
  const [seasonUsers, setSeasonUsers] = useState(null);
  const dropdownRef = useRef(null);
  const isMobile = useIsMobile();

  const playerId = player && player.player_id ? player.player_id : null;
  const rookieYear = player && player.metadata && player.metadata.rookie_year ? player.metadata.rookie_year : null;

  const hasPropRosters = Array.isArray(rosters) && rosters.length > 0;
  const hasPropUsers = Array.isArray(users) && users.length > 0;
  const effectiveCurrentRosters = hasPropRosters ? rosters : currentRosters;
  const effectiveCurrentUsers = hasPropUsers ? users : currentUsers;
  const myRosterId = useMyRosterId(effectiveCurrentRosters, effectiveCurrentUsers);
  const seasonMyRosterId = useMyRosterId(seasonRosters, seasonUsers);

  useEffect(() => {
    const next = initialSeason ? String(initialSeason) : defaultSeason;
    setSeason(next);
    // Only re-seed when the player or calling page's year changes, not when
    // the user picks a year inside this card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, initialSeason]);

  // Current Hwang Dynasty ownership (top bar) — prefer caller props, else fetch.
  useEffect(() => {
    if (ownershipOverride) return;
    if (hasPropRosters && hasPropUsers) return;

    let cancelled = false;
    fetchTeamData(CURRENT_YEAR)
      .then((data) => {
        if (cancelled || !data) return;
        setCurrentRosters(Array.isArray(data.rosters) ? data.rosters : []);
        setCurrentUsers(Array.isArray(data.users) ? data.users : []);
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentRosters([]);
          setCurrentUsers([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ownershipOverride, hasPropRosters, hasPropUsers]);

  // Selected-season ownership (season header row).
  useEffect(() => {
    if (ownershipOverride && String(season) === String(CURRENT_YEAR)) {
      setSeasonRosters(null);
      setSeasonUsers(null);
      return;
    }

    // Reuse current league data when viewing the current season.
    if (String(season) === String(CURRENT_YEAR) && effectiveCurrentRosters && effectiveCurrentUsers) {
      setSeasonRosters(effectiveCurrentRosters);
      setSeasonUsers(effectiveCurrentUsers);
      return;
    }

    let cancelled = false;
    setSeasonRosters(null);
    setSeasonUsers(null);
    fetchTeamData(season)
      .then((data) => {
        if (cancelled || !data) return;
        setSeasonRosters(Array.isArray(data.rosters) ? data.rosters : []);
        setSeasonUsers(Array.isArray(data.users) ? data.users : []);
      })
      .catch(() => {
        if (!cancelled) {
          setSeasonRosters([]);
          setSeasonUsers([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [season, ownershipOverride, effectiveCurrentRosters, effectiveCurrentUsers]);
  
  // Build available years list from rookie year to current (or previous year if pre-season)
  const availableYears = [];
  if (rookieYear) {
    const startYear = parseInt(rookieYear);
    // Don't include current year if season hasn't started yet
    const endYear = isPreSeason ? parseInt(CURRENT_YEAR) - 1 : parseInt(CURRENT_YEAR);
    for (let year = endYear; year >= startYear; year--) {
      availableYears.push(String(year));
    }
  } else {
    // Fallback list when no rookie year available
    if (isPreSeason) {
      availableYears.push('2025', '2024', '2023');
    } else {
      availableYears.push('2026', '2025', '2024');
    }
  }
  
  const name = player && player.name ? player.name : '';
  const position = player && player.position ? player.position : '';
  const team = player && (player.team || player.team_abbr) ? (player.team || player.team_abbr) : null;
  const age = player && player.age ? player.age : null;
  const birthday = player && player.birth_date ? player.birth_date : null;
  const injury = player && player.injury_status ? player.injury_status : null;
  const yearsExp = (player && player.years_exp != null) ? player.years_exp : null;
  const college = player && player.college ? player.college : null;
  const highSchool = player && player.high_school ? player.high_school : null;
  const nflTeamLogo = team ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.toLowerCase()}.png` : null;

  useEffect(() => {
    setLoading(true);
    setError(null);
    const yearNum = parseInt(season);
    
    if (yearNum >= 2024) {
      fetchScoresData(season)
        .then((weeksData) => setWeeksParsedData(weeksData))
        .catch(() => setError('Failed to load scoring data'))
        .finally(() => setLoading(false));
    } else {
      setWeeksParsedData(Array(17).fill(null));
      setLoading(false);
    }
  }, [season]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [dropdownOpen]);

  const currentWeek = getCurrentNFLWeek(season);
  const totalWeeks = season === CURRENT_YEAR ? Math.min(17, currentWeek) : 17;

  // NFL opponent + result for each week, same source as /scores
  useEffect(() => {
    const pid = playerId ? String(playerId) : null;
    const yearNum = parseInt(season, 10);
    if (!pid || !Number.isFinite(yearNum) || yearNum < 2024 || totalWeeks < 1) {
      setWeeklyGames({});
      return;
    }

    let cancelled = false;
    setWeeklyGames({});
    (async () => {
      try {
        const idMap = await fetchPlayerIdMap().catch(() => null);
        const playersData = { [pid]: player || {} };
        const weeks = Array.from({ length: totalWeeks }, (_, i) => i + 1);
        const results = await Promise.all(weeks.map(async (week) => {
          try {
            const [json, snap] = await Promise.all([
              fetchNflScoreboard(yearNum, week),
              readPlayersSnapshot(String(season), week).catch(() => null),
            ]);
            let overrideTeamMap = null;
            const snapData = snap && snap.snapshot && snap.snapshot.data ? snap.snapshot.data : null;
            if (snapData) {
              const pinfo = snapData[pid] || snapData[playerId];
              const abbr = pinfo && (pinfo.team || pinfo.team_abbr || pinfo.team_abbreviation);
              if (abbr) {
                overrideTeamMap = { [pid]: String(abbr) };
              }
            }
            const mapping = await mapPlayersToGames(
              [pid],
              playersData,
              idMap,
              json,
              overrideTeamMap
            );
            const item = mapping[pid] || mapping[playerId];
            const ev = item && item.event;
            const teamForWeek = item && item.team;
            const d = ev
              ? getGameDisplayForTeam(ev, teamForWeek)
              : { text: 'BYE', live: false, completed: false };
            const eventId = ev && ev.id ? String(ev.id) : null;
            return [week, { ...d, eventId }];
          } catch (_) {
            return [week, { text: '', eventId: null }];
          }
        }));
        if (cancelled) return;
        const next = {};
        for (const [week, game] of results) {
          next[week] = game;
        }
        setWeeklyGames(next);
      } catch (_) {
        if (!cancelled) setWeeklyGames({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [playerId, season, totalWeeks, player]);

  useEffect(() => {
    if (!weeksParsedData || !playerId || loading) return;

    setLoadingStats(true);
    setPositionRankTotal(null);
    setPositionRankPerGame(null);
    
    // Use setTimeout to force React to render the loading state first
    setTimeout(async () => {
      const yearNum = parseInt(season);
      
      // For pre-2024, load season aggregate stats
      if (yearNum < 2024) {
        const seasonRow = await loadSeasonStatsFromCSV(season, player);
        if (seasonRow) {
          const mappedStats = mapCSVStatsToSleeperFormat(seasonRow);
          setSeasonStats({
            stats: mappedStats,
            games: parseInt(seasonRow.games) || 0,
            totalPoints: parseFloat(seasonRow.fantasy_points_ppr) || 0
          });
        } else {
          setSeasonStats(null);
        }
      } else {
        setSeasonStats(null);
      }

      // For 2024+, build the set of all player IDs at the same position for ranking.
      // Use a past-season key so fetchPlayersData always loads the full static players.txt.
      let positionPlayerIds = new Set();
      if (yearNum >= 2024 && position) {
        try {
          const positionLookupSeason = String(parseInt(CURRENT_YEAR) - 1);
          const allPlayersData = await fetchPlayersData(positionLookupSeason);
          for (const [pid, pData] of Object.entries(allPlayersData)) {
            const pPos = pData.position || (pData.fantasy_positions && pData.fantasy_positions[0]) || '';
            if (pPos === position) {
              positionPlayerIds.add(String(pid));
            }
          }
        } catch (err) {
          // Ranking won't be available if this fails
        }
      }
      
      // Parallelize all week fetches using Promise.all
      const weekPromises = Array.from({ length: totalWeeks }, async (_, idx) => {
        const week = idx + 1;
        const weekData = weeksParsedData[week - 1];
        let points = 0;
        let stats = null;
        let positionWeekPoints = null;
        
        if (weekData && Array.isArray(weekData)) {
          for (const entry of weekData) {
            if (entry && entry.players_points && entry.players_points[playerId] != null) {
              points = entry.players_points[playerId];
              break;
            }
          }
        }
        
        if (yearNum >= 2024) {
          try {
            const response = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`);
            if (response.ok) {
              const sleeperStats = await response.json();
              if (sleeperStats[playerId]) {
                stats = sleeperStats[playerId];
                // If points weren't found in matchup data, check if Sleeper stats has them
                if (points === 0) {
                  // Sleeper stats API includes pts_ppr, pts_std, pts_half_ppr
                  const ptsFromStats = stats.pts_ppr || stats.pts_half_ppr || stats.pts_std || 0;
                  if (ptsFromStats > 0) {
                    points = ptsFromStats;
                  }
                }
              }
              // Collect same-position players' points for ranking
              if (positionPlayerIds.size > 0) {
                positionWeekPoints = {};
                for (const pid of positionPlayerIds) {
                  const pStats = sleeperStats[pid];
                  if (pStats) {
                    const pts = pStats.pts_ppr || pStats.pts_half_ppr || pStats.pts_std || 0;
                    if (pts > 0) positionWeekPoints[pid] = pts;
                  }
                }
              }
            }
          } catch (err) {
            // Continue without stats
          }
        }
        
        return { week, points: Math.round(points * 10) / 10, stats, positionWeekPoints };
      });
      
      const scoresWithRankData = await Promise.all(weekPromises);

      // Aggregate position-wide points across all weeks
      const aggregatedPositionPoints = {};
      const aggregatedPositionGames = {};
      for (const { positionWeekPoints } of scoresWithRankData) {
        if (positionWeekPoints) {
          for (const [pid, pts] of Object.entries(positionWeekPoints)) {
            aggregatedPositionPoints[pid] = (aggregatedPositionPoints[pid] || 0) + pts;
            aggregatedPositionGames[pid] = (aggregatedPositionGames[pid] || 0) + 1;
          }
        }
      }

      // Compute position ranks
      let newRankTotal = null;
      let newRankPerGame = null;
      const playerIdStr = String(playerId);
      if (Object.keys(aggregatedPositionPoints).length > 0) {
        const sortedByTotal = Object.entries(aggregatedPositionPoints)
          .sort(([, a], [, b]) => b - a);
        const idxTotal = sortedByTotal.findIndex(([pid]) => pid === playerIdStr);
        newRankTotal = idxTotal >= 0 ? idxTotal + 1 : null;

        const myGames = aggregatedPositionGames[playerIdStr] || 0;
        if (myGames > 0) {
          const sortedByPerGame = Object.entries(aggregatedPositionPoints)
            .filter(([pid]) => (aggregatedPositionGames[pid] || 0) > 0)
            .sort(([pa, a], [pb, b]) => (b / aggregatedPositionGames[pb]) - (a / aggregatedPositionGames[pa]));
          const idxPerGame = sortedByPerGame.findIndex(([pid]) => pid === playerIdStr);
          newRankPerGame = idxPerGame >= 0 ? idxPerGame + 1 : null;
        }
      }

      // Strip positionWeekPoints from stored scores state
      const scores = scoresWithRankData.map(({ positionWeekPoints: _, ...rest }) => rest);

      setWeeklyScores(scores);
      setPositionRankTotal(newRankTotal);
      setPositionRankPerGame(newRankPerGame);
      setLoadingStats(false);
    }, 0);
  }, [weeksParsedData, playerId, season, totalWeeks, loading, player, position]);

  const totalPoints = weeklyScores.reduce((sum, w) => sum + w.points, 0);
  const gamesPlayed = weeklyScores.filter(w => w.points > 0).length;
  const avgPoints = gamesPlayed > 0 ? Math.round((totalPoints / gamesPlayed) * 10) / 10 : 0;

  const getStatsColumns = () => {
    const pos = position ? position.toUpperCase() : '';
    
    if (pos === 'QB') {
      return [
        { key: 'pass_yd', label: 'Pass Yds', format: (v) => v || 0 },
        { key: 'pass_td', label: 'Pass TD', format: (v) => v || 0 },
        { key: 'pass_int', label: 'INT', format: (v) => v || 0 },
        { key: 'rush_yd', label: 'Rush Yds', format: (v) => v || 0 },
        { key: 'rush_td', label: 'Rush TD', format: (v) => v || 0 }
      ];
    } else if (pos === 'RB') {
      return [
        { key: 'rush_yd', label: 'Rush Yds', format: (v) => v || 0 },
        { key: 'rush_td', label: 'Rush TD', format: (v) => v || 0 },
        { key: 'rec', label: 'Rec', format: (v) => v || 0 },
        { key: 'rec_yd', label: 'Rec Yds', format: (v) => v || 0 },
        { key: 'rec_td', label: 'Rec TD', format: (v) => v || 0 }
      ];
    } else if (pos === 'WR' || pos === 'TE') {
      return [
        { key: 'rec', label: 'Rec', format: (v) => v || 0 },
        { key: 'rec_yd', label: 'Rec Yds', format: (v) => v || 0 },
        { key: 'rec_td', label: 'Rec TD', format: (v) => v || 0 },
        { key: 'rush_yd', label: 'Rush Yds', format: (v) => v || 0 },
        { key: 'rush_td', label: 'Rush TD', format: (v) => v || 0 }
      ];
    } else if (pos === 'K') {
      return [
        { key: 'fgm', label: 'FGM', format: (v) => v || 0 },
        { key: 'fga', label: 'FGA', format: (v) => v || 0 },
        { key: 'xpm', label: 'XPM', format: (v) => v || 0 },
        { key: 'xpa', label: 'XPA', format: (v) => v || 0 }
      ];
    } else if (pos === 'DEF') {
      return [
        { key: 'def_td', label: 'TD', format: (v) => v || 0 },
        { key: 'def_int', label: 'INT', format: (v) => v || 0 },
        { key: 'def_sack', label: 'Sacks', format: (v) => v || 0 },
        { key: 'def_fr', label: 'FR', format: (v) => v || 0 }
      ];
    }
    return [];
  };

  const statsColumns = getStatsColumns();

  const currentOwnership = ownershipOverride
    ? { resolved: true, info: ownershipOverride }
    : resolveOwnership(playerId, effectiveCurrentRosters, effectiveCurrentUsers);

  const seasonOwnership =
    ownershipOverride && String(season) === String(CURRENT_YEAR)
      ? { resolved: true, info: ownershipOverride }
      : resolveOwnership(playerId, seasonRosters, seasonUsers);

  const seasonRowMyRosterId =
    String(season) === String(CURRENT_YEAR) ? myRosterId : seasonMyRosterId;

  const isUpcomingRookie = isPreSeason && yearsExp === 0;

  const yearNum = parseInt(season);
  const isPre2024 = yearNum < 2024;
  const showSeasonAggregateOnly = isPre2024;
  const showGameColumn = !isPre2024;

  function renderGameCell(week, { isTotal = false } = {}) {
    if (isTotal || !showGameColumn) return null;
    const game = weeklyGames[week];
    const text = game && game.text ? game.text : '';
    if (!text) {
      return <td className="player-weekly-game">-</td>;
    }
    if (game.eventId) {
      return (
        <td className="player-weekly-game">
          <a
            href={`https://www.espn.com/nfl/game/_/gameId/${game.eventId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="player-weekly-game-link"
            onClick={(e) => e.stopPropagation()}
          >
            {text}
          </a>
        </td>
      );
    }
    return <td className="player-weekly-game">{text}</td>;
  }

  return (
    <div className="player-card player-weekly-card">
      {typeof onClose === 'function' && (
        <button className="player-card-close" type="button" aria-label="Close" onClick={onClose}>×</button>
      )}
      
      <div className="player-card-content player-card-content-expanded">
        <img src={getPlayerLogoUrl(player && player.espn_photo_url)} alt={name} className="player-card-photo" />
        <div className="player-card-info-wrapper">
          <div className="player-card-text">
            <div className="player-card-name">{name}</div>
            <div className="player-card-position-row">
              {nflTeamLogo && <img src={nflTeamLogo} alt={team} className="player-nfl-team-logo" />}
              <PositionBadge position={position} />
              {team && <span className="player-nfl-team-abbr">{team}</span>}
            </div>
          </div>
          
          <div className="player-card-details-inline">
            {age && <span className="player-detail-inline">Age {age}</span>}
            {birthday && <span className="player-detail-inline">{birthday}</span>}
            {yearsExp && <span className="player-detail-inline">{yearsExp} yr{yearsExp !== 1 ? 's' : ''} exp</span>}
            {rookieYear && <span className="player-detail-inline">Rookie {rookieYear}</span>}
            {college && <span className="player-detail-inline">{college}</span>}
            {highSchool && <span className="player-detail-inline">{highSchool}</span>}
            {injury && <span className="player-detail-inline player-injury-status">{injury}</span>}
          </div>
        </div>

        {currentOwnership.resolved ? (
          <OwnershipDisplay
            info={currentOwnership.info}
            myRosterId={myRosterId}
            variant="banner"
            label="Owned by"
          />
        ) : null}
      </div>

      {!isUpcomingRookie && (
        <div className="player-weekly-header">
          <div ref={dropdownRef} className="player-season-dropdown" onClick={() => setDropdownOpen(open => !open)}>
            {season} Season
            <span className="player-season-dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
            {dropdownOpen && (
              <div className="player-season-dropdown-list" onClick={(e) => e.stopPropagation()}>
                {availableYears.map(year => (
                  <div
                    key={year}
                    className={'player-season-dropdown-option' + (year === season ? ' player-season-dropdown-option-active' : '')}
                    onClick={() => { setSeason(year); setDropdownOpen(false); }}
                  >
                    {year}
                  </div>
                ))}
              </div>
            )}
          </div>

          {seasonOwnership.resolved ? (
            <OwnershipDisplay
              info={seasonOwnership.info}
              myRosterId={seasonRowMyRosterId}
              variant="inline"
            />
          ) : null}
        </div>
      )}

      {isUpcomingRookie ? (
        <div className="info-banner">
          <span>{name} is an incoming {CURRENT_YEAR} rookie and hasn't played an NFL game yet.</span>
        </div>
      ) : loading || loadingStats ? (
        <div style={{ padding: '20px' }}>
          <LoadingState label="Loading scores…" />
        </div>
      ) : error ? (
        <div style={{ padding: '20px', color: '#ff6b6b' }}>{error}</div>
      ) : showSeasonAggregateOnly ? (
        <>
          <div className="info-banner warning">
            <span>Weekly data not available for {season}. Showing season totals only.</span>
          </div>
          
          {seasonStats ? (
            <div className="player-season-aggregate">
              <div className="player-season-stats-grid">
                <div className="player-season-detail player-season-detail-total">
                  <span className="player-season-detail-label">Season Total</span>
                  <span className="player-season-detail-value">{seasonStats.totalPoints.toFixed(1)} pts</span>
                </div>
                {seasonStats.stats && statsColumns.map(col => {
                  const value = seasonStats.stats[col.key];
                  if (!value || value === 0) return null;
                  return (
                    <div key={col.key} className="player-season-detail">
                      <span className="player-season-detail-label">{col.label}</span>
                      <span className="player-season-detail-value">{col.format(value)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ padding: '20px', color: 'rgba(255, 255, 255, 0.5)', textAlign: 'center' }}>
              No data available for {name} in {season}.
            </div>
          )}
        </>
      ) : (
        <>
          <div className="player-weekly-summary">
            <div className="player-weekly-stat">
              <div className="player-weekly-stat-label">Total</div>
              <div className="player-weekly-stat-value">{Math.round(totalPoints * 10) / 10}</div>
            </div>
            <div className="player-weekly-stat">
              <div className="player-weekly-stat-label">Points per game</div>
              <div className="player-weekly-stat-value">{avgPoints}</div>
            </div>
            <div className="player-weekly-stat">
              <div className="player-weekly-stat-label">Rank</div>
              <div className="player-weekly-stat-value">
                {positionRankTotal !== null ? `${position}${positionRankTotal}` : '—'}
              </div>
            </div>
            <div className="player-weekly-stat">
              <div className="player-weekly-stat-label">Rank per game</div>
              <div className="player-weekly-stat-value">
                {positionRankPerGame !== null ? `${position}${positionRankPerGame}` : '—'}
              </div>
            </div>
          </div>

          <div className="player-weekly-table-container">
            <table className="player-weekly-table">
              <thead>
                <tr>
                  <th>Week</th>
                  {showGameColumn ? <th>Game</th> : null}
                  {statsColumns.map(col => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {weeklyScores.map(({ week, points, stats }) => (
                  <tr key={week} className={points > 0 ? '' : 'player-weekly-zero'}>
                    <td>{isMobile ? week : `Week ${week}`}</td>
                    {renderGameCell(week)}
                    {statsColumns.map(col => (
                      <td key={col.key} className="player-weekly-stat">
                        {stats ? col.format(stats[col.key]) : '-'}
                      </td>
                    ))}
                    <td className="player-weekly-points">
                      {points > 0 ? points.toFixed(1) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="player-weekly-totals-row">
                  <td className="player-weekly-totals-label">Total</td>
                  {showGameColumn ? <td className="player-weekly-game" /> : null}
                  {statsColumns.map(col => {
                    const total = weeklyScores.reduce((sum, { stats }) => {
                      return sum + (stats ? (stats[col.key] || 0) : 0);
                    }, 0);
                    return (
                      <td key={col.key} className="player-weekly-stat player-weekly-total">
                        {col.format(total)}
                      </td>
                    );
                  })}
                  <td className="player-weekly-points player-weekly-total">
                    {totalPoints.toFixed(1)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default PlayerWeeklyScores;
