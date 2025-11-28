import React, { useEffect, useState } from 'react';
import { fetchScoresData } from './ScoresLookup';
import { fetchTeamData } from './TeamLookup';
import { getStandings, getWeekScoreBreakdown } from './ScoresParser';
import useIsMobile from './useIsMobile';
import StandingsRowHeader from './StandingsRowHeader';
import { CURRENT_YEAR, getCurrentNFLWeek, isCurrentWeekCompleted } from './DateHelper';
import { StartSitSort } from './StartSitDecider';
import { fetchPlayersData, fetchPlayerIdMap } from './PlayerLookup';
import { fetchNflScoreboard } from './GamesLookup';
import { mapPlayersToGames, getGameDisplayForTeam } from './GamesParser';
import YoffsScoresView from './YoffsScoresView';

function Yoffs2024Format({
  season,
  selectedTab,
  onTabChange,
  playoffStartWeek,
  playoffEndWeek,
  showPlayoffPictureWarning,
  playoffSeedLockWeek
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [rosters, setRosters] = useState(null);
  const [users, setUsers] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [weeksParsedData, setWeeksParsedData] = useState(null);
  const [playersData, setPlayersData] = useState(null);
  const [playerIdMap, setPlayerIdMap] = useState(null);
  const [currentWeekLabels, setCurrentWeekLabels] = useState({});
  const [isCurrentWeekDone, setIsCurrentWeekDone] = useState(true);
  const tabOptions = ['Overview', 'Scores', 'Head to Head'];
  const isMobile = useIsMobile();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [weeksData, teamData, players, idMap] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season),
          fetchPlayersData(),
          fetchPlayerIdMap()
        ]);

        if (!weeksData || !Array.isArray(weeksData)) {
          throw new Error('No scores data');
        }
        if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
          throw new Error('No team data');
        }

        const startIdx = playoffStartWeek - 1;
        const endIdx = playoffEndWeek - 1;

        if (!cancelled) {
          setWeeksParsedData(weeksData);
          setRosters(teamData.rosters);
          setUsers(teamData.users);
          setPlayersData(players);
          setPlayerIdMap(idMap);
        }

        // Regular season weeks for seeding: cumulative through first 14 weeks
        const regularSliceFull = weeksData.slice(0, 14);
        const weeksRegular = regularSliceFull.filter(Boolean);

        // Playoff weeks: weeks 14–17
        const playoffSlice = weeksData.slice(startIdx, endIdx + 1);
        const weeksPlayoffs = playoffSlice.filter(Boolean);

        if (!weeksPlayoffs.length || !weeksRegular.length) {
          if (!cancelled) {
            setRows([]);
            setLoading(false);
          }
          return;
        }

        // Regular season standings used to determine playoff seeds (top 4)
        const standingsRegular = getStandings(weeksRegular) || [];
        const top4Regular = standingsRegular
          .slice()
          .sort((a, b) => a.place - b.place)
          .slice(0, 4);
        const seedIds = top4Regular.map(r => Number(r.roster_id));
        const seedSet = new Set(seedIds);
        const seedPlaceById = {};
        top4Regular.forEach(r => {
          seedPlaceById[Number(r.roster_id)] = r.place;
        });

        // Regular season (weeks before playoffs) stats (total + PPG)
        const regularStatsByRoster = {};
        regularSliceFull.forEach((weekEntries) => {
          if (!Array.isArray(weekEntries)) {
            return;
          }
          weekEntries.forEach((entry) => {
            if (!entry || entry.roster_id == null) {
              return;
            }
            const rid = Number(entry.roster_id);
            const pts = typeof entry.points === 'number' ? entry.points : 0;
            if (!regularStatsByRoster[rid]) {
              regularStatsByRoster[rid] = {
                total: 0,
                weeksPlayed: 0,
              };
            }
            if (typeof pts === 'number' && isFinite(pts)) {
              regularStatsByRoster[rid].total += pts;
            }
            regularStatsByRoster[rid].weeksPlayed += 1;
          });
        });

        // Playoff stats by roster, using StartSit algorithm for every playoff week
        const statsByRoster = {};
        for (let wk = playoffStartWeek; wk <= playoffEndWeek; wk += 1) {
          const breakdown = getWeekScoreBreakdown(weeksData, wk) || {};
          const weekEntries = Array.isArray(weeksData[wk - 1]) ? weeksData[wk - 1] : [];
          const basePointsByRoster = {};
          weekEntries.forEach((entry) => {
            if (!entry || entry.roster_id == null) {
              return;
            }
            const rid = Number(entry.roster_id);
            if (!basePointsByRoster[rid]) {
              basePointsByRoster[rid] = 0;
            }
            if (typeof entry.points === 'number' && isFinite(entry.points)) {
              basePointsByRoster[rid] += Math.round(entry.points * 10) / 10;
            }
          });

          Object.keys(breakdown).forEach((ridKey) => {
            const rid = Number(ridKey);
            if (!seedSet.has(rid)) {
              return;
            }
            if (!statsByRoster[rid]) {
              statsByRoster[rid] = {
                weeksPlayed: 0,
                weekPoints: {},
                highPoints: -Infinity,
                highWeek: null,
                lowPoints: Infinity,
                lowWeek: null,
              };
            }
            let weekTotal = basePointsByRoster[rid] || 0;
            try {
              if (players && idMap) {
                const teamScore = breakdown[ridKey];
                if (teamScore) {
                  const computed = StartSitSort(teamScore, players, idMap);
                  if (computed && typeof computed.starterTotal === 'number') {
                    weekTotal = Math.round(computed.starterTotal * 10) / 10;
                  }
                }
              }
            } catch (_) {
              // fall back to base API points
            }
            if (typeof weekTotal === 'number' && isFinite(weekTotal)) {
              const s = statsByRoster[rid];
              s.weeksPlayed += 1;
              if (!s.weekPoints[wk]) {
                s.weekPoints[wk] = 0;
              }
              s.weekPoints[wk] += weekTotal;
              if (weekTotal > s.highPoints) {
                s.highPoints = weekTotal;
                s.highWeek = wk;
              }
              if (weekTotal < s.lowPoints) {
                s.lowPoints = weekTotal;
                s.lowWeek = wk;
              }
            }
          });
        }

        const isCurrentSeasonForPpg = season === CURRENT_YEAR;
        const currentWeekForPpg = isCurrentSeasonForPpg ? getCurrentNFLWeek() : playoffEndWeek;

        const mergedRows = top4Regular.map((seedRow) => {
          const rid = Number(seedRow.roster_id);
          const stats = statsByRoster[rid] || {
            weeksPlayed: 0,
            weekPoints: {},
            highPoints: null,
            highWeek: null,
            lowPoints: null,
            lowWeek: null,
          };
          const weekPoints = stats.weekPoints || {};

          // Total playoff score uses StartSit-based week totals for all playoff weeks
          let total = 0;
          for (let wk = playoffStartWeek; wk <= playoffEndWeek; wk += 1) {
            const val = weekPoints[wk];
            if (typeof val === 'number' && isFinite(val)) {
              total += val;
            }
          }

          // For playoff PPG, only include *completed* weeks in the average.
          let completedPlayoffTotal = 0;
          let completedPlayoffWeeks = 0;
          for (let wk = playoffStartWeek; wk <= playoffEndWeek; wk += 1) {
            const val = weekPoints[wk];
            if (typeof val !== 'number' || !isFinite(val)) {
              continue;
            }
            let isCompletedWeek = true;
            if (isCurrentSeasonForPpg) {
              if (wk > currentWeekForPpg) {
                isCompletedWeek = false;
              } else if (wk === currentWeekForPpg && !isCurrentWeekDone) {
                isCompletedWeek = false;
              }
            }
            if (isCompletedWeek) {
              completedPlayoffTotal += val;
              completedPlayoffWeeks += 1;
            }
          }

          const ppg = completedPlayoffWeeks > 0
            ? Math.round((completedPlayoffTotal / completedPlayoffWeeks) * 10) / 10
            : null;

          const regularStats = regularStatsByRoster[rid] || { total: 0, weeksPlayed: 0 };
          const regularTotal = typeof regularStats.total === 'number' ? regularStats.total : 0;
          const regularPpg = regularStats.weeksPlayed > 0
            ? Math.round((regularTotal / regularStats.weeksPlayed) * 10) / 10
            : null;

          const displayPlace = seedPlaceById[rid] != null ? seedPlaceById[rid] : seedRow.place;

          return {
            rosterId: rid,
            place: displayPlace,
            pointsScored: total,
            weeksPlayed: completedPlayoffWeeks,
            ppg,
            regularTotal,
            regularPpg,
            highPoints: isFinite(stats.highPoints) ? stats.highPoints : null,
            highWeek: stats.highWeek,
            lowPoints: isFinite(stats.lowPoints) ? stats.lowPoints : null,
            lowWeek: stats.lowWeek,
            rawWeekPoints: stats.weekPoints || {}
          };
        })
          .slice(0, 4)
          .sort((a, b) => {
            const ap = typeof a.pointsScored === 'number' ? a.pointsScored : 0;
            const bp = typeof b.pointsScored === 'number' ? b.pointsScored : 0;
            if (bp !== ap) {
              return bp - ap;
            }
            // tie-breaker: lower seed (place) first
            const aPlace = a.place != null ? a.place : 999;
            const bPlace = b.place != null ? b.place : 999;
            return aPlace - bPlace;
          });

        if (!cancelled) {
          setRows(mergedRows);
          const initialExpanded = {};
          mergedRows.forEach((r) => {
            initialExpanded[r.rosterId] = true;
          });
          setExpanded(initialExpanded);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError('Failed to load playoff standings');
          setRows([]);
          setRosters(null);
          setUsers(null);
          setWeeksParsedData(null);
          setPlayersData(null);
          setPlayerIdMap(null);
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [season, isCurrentWeekDone, playoffStartWeek, playoffEndWeek]);

  useEffect(() => {
    let cancelled = false;
    const isCurrentSeasonLocal = season === CURRENT_YEAR;
    if (!isCurrentSeasonLocal) {
      setIsCurrentWeekDone(true);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const done = await isCurrentWeekCompleted(season);
        if (!cancelled) {
          setIsCurrentWeekDone(done);
        }
      } catch (_) {
        if (!cancelled) {
          setIsCurrentWeekDone(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [season]);

  useEffect(() => {
    const isCurrentSeasonLocal = season === CURRENT_YEAR;
    if (!isCurrentSeasonLocal || !weeksParsedData || !playersData || !playerIdMap) {
      setCurrentWeekLabels({});
      return;
    }
    const currentWeekNum = getCurrentNFLWeek();
    if (currentWeekNum < playoffStartWeek || currentWeekNum > playoffEndWeek) {
      setCurrentWeekLabels({});
      return;
    }
    const weekArr = Array.isArray(weeksParsedData) ? weeksParsedData[currentWeekNum - 1] : null;
    if (!Array.isArray(weekArr)) {
      setCurrentWeekLabels({});
      return;
    }
    const playerIdSet = new Set();
    for (const entry of weekArr) {
      if (entry && Array.isArray(entry.players)) {
        for (const pid of entry.players) {
          playerIdSet.add(pid);
        }
      }
    }
    const playerIds = Array.from(playerIdSet);
    if (playerIds.length === 0) {
      setCurrentWeekLabels({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const json = await fetchNflScoreboard(Number(season), Number(currentWeekNum));
        const mapping = await mapPlayersToGames(playerIds, playersData, playerIdMap, json);
        const labels = {};
        for (const pid of playerIds) {
          const item = mapping[pid];
          const ev = item && item.event;
          const teamForWeek = item && item.team;
          const d = ev ? getGameDisplayForTeam(ev, teamForWeek) : { text: 'BYE', live: false };
          labels[pid] = { ...d, team: teamForWeek || null };
        }
        if (!cancelled) {
          setCurrentWeekLabels(labels);
        }
      } catch (_) {
        if (!cancelled) {
          setCurrentWeekLabels({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [season, weeksParsedData, playersData, playerIdMap]);

  function getTeamName(rosterId) {
    if (!rosters || !users) {
      return `Team ${rosterId}`;
    }
    const roster = rosters.find(r => String(r.roster_id) === String(rosterId));
    if (!roster) {
      return `Team ${rosterId}`;
    }
    const user = users.find(u => String(u.user_id) === String(roster.owner_id));
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
    const roster = rosters.find(r => String(r.roster_id) === String(rosterId));
    if (!roster) {
      return null;
    }
    const user = users.find(u => String(u.user_id) === String(roster.owner_id));
    if (!user) {
      return null;
    }
    return user.team_avatar_url || user.user_avatar_url || user.avatar_url || null;
  }

  function toggleExpand(rosterId) {
    setExpanded(prev => ({ ...prev, [rosterId]: !prev[rosterId] }));
  }

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" aria-label="Loading" />
        <div className="loading-text">Loading playoff standings…</div>
      </div>
    );
  }

  if (error) {
    return <div>{error}</div>;
  }

  if (!rows.length) {
    return <div>No playoff data found for weeks {playoffStartWeek}–{playoffEndWeek}.</div>;
  }

  const hasAnyExpanded = Object.values(expanded || {}).some(Boolean);
  const isCurrentSeason = season === CURRENT_YEAR;
  const currentWeekNum = isCurrentSeason ? getCurrentNFLWeek() : getCurrentNFLWeek(season);
  const isPlayoffWeekInProgress = isCurrentSeason
    && currentWeekNum >= playoffStartWeek
    && currentWeekNum <= playoffEndWeek
    && !isCurrentWeekDone
    && weeksParsedData
    && playersData
    && playerIdMap;
  const liveWeekBreakdown = isPlayoffWeekInProgress && weeksParsedData
    ? (getWeekScoreBreakdown(weeksParsedData, currentWeekNum) || {})
    : null;

  return (
    <>
      <div className="team-tabs-bar">
        {tabOptions.map((tab) => (
          <button
            key={tab}
            className={`team-tab${selectedTab === tab ? ' team-tab-active' : ''}`}
            onClick={() => {
              if (onTabChange) {
                onTabChange(tab);
              }
            }}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>

      {showPlayoffPictureWarning && (
        <div className="team-analytics-info yoffs-playoff-info">
          <span className="warning-icon" aria-label="Playoff picture notice">
            ⚠️
          </span>
          <span className="team-analytics-info-text">
            This is the current playoff picture. Teams and seeds are subject to change until Week {playoffSeedLockWeek} has concluded.
          </span>
        </div>
      )}

      {selectedTab === 'Overview' && (
        <div className={'standings-list' + (hasAnyExpanded ? ' standings-list--expanded' : '')}>
          {rows.map((row) => {
        const rosterId = row.rosterId;
        const isExpanded = !!expanded[rosterId];
        const teamName = getTeamName(rosterId);
        const avatarUrl = getAvatar(rosterId);
        const isTop4Highlight = row.place != null && row.place <= 4;
        const rawWeekPoints = row.rawWeekPoints || {};
        const weekTiles = [
          playoffStartWeek,
          playoffStartWeek + 1,
          playoffStartWeek + 2,
        ].filter((wk) => wk <= playoffEndWeek);

        const rightHeaderContent = isMobile ? (
          <span className="standings-total">
            {typeof row.pointsScored === 'number' ? `${Math.round(row.pointsScored)} pts` : ''}
          </span>
        ) : (
          <>
            <span className="standings-ppg">
              {row.ppg != null ? `${row.ppg.toFixed(1)} ppg` : ''}
            </span>
            <span className="standings-total">
              {typeof row.pointsScored === 'number' ? `${Math.round(row.pointsScored)} pts` : ''}
            </span>
          </>
        );

        return (
          <div key={rosterId} className={`standings-row ${isTop4Highlight ? 'standings-row--playoff' : ''}`}>
            <StandingsRowHeader
              isExpanded={isExpanded}
              onToggle={() => toggleExpand(rosterId)}
              rankLabel={`#${row.place}`}
              avatarUrl={avatarUrl}
              teamName={teamName}
              rightContent={rightHeaderContent}
            />
            {isExpanded && (
              <div className="standings-row-expand standings-expand-split">
                <div className="standings-row-expand-inner yoffs-standings-expand standings-expand-left">
                  <div className="yoffs-total-block">
                    <div className="yoffs-total-label">Total Playoff Score</div>
                    <div className="yoffs-total-value">
                      {typeof row.pointsScored === 'number' ? row.pointsScored.toFixed(1) : 'N/A'}
                    </div>
                  </div>
                </div>
                {isPlayoffWeekInProgress && liveWeekBreakdown && (
                  <div className="standings-expand-right">
                    {(() => {
                      let scoreThisWeek = 0;
                      let completedPlayoffTotal = 0;
                      let activeCount = 0;
                      let yetToPlayCount = 0;
                      try {
                        const wbAll = liveWeekBreakdown;
                        const raw = wbAll && wbAll[rosterId];
                        if (raw && playersData && playerIdMap) {
                          const computed = StartSitSort(raw, playersData, playerIdMap);
                          if (computed && typeof computed.starterTotal === 'number') {
                            scoreThisWeek = Math.round(computed.starterTotal * 10) / 10;
                          }
                          const rosterPlayerIds = [
                            ...(computed && Array.isArray(computed.starters) ? computed.starters : []),
                            ...(computed && Array.isArray(computed.bench) ? computed.bench : [])
                          ]
                            .map(p => p && p.id)
                            .filter(pid => pid && pid !== '0');
                          for (const pid of rosterPlayerIds) {
                            const label = currentWeekLabels && currentWeekLabels[pid];
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
                      } catch (_) {
                      }
                      try {
                        let sumCompleted = 0;
                        for (let wk = playoffStartWeek; wk < currentWeekNum && wk <= playoffEndWeek; wk += 1) {
                          const val = rawWeekPoints[wk];
                          if (typeof val === 'number' && isFinite(val)) {
                            sumCompleted += val;
                          }
                        }
                        completedPlayoffTotal = Math.round(sumCompleted * 10) / 10;
                      } catch (_) {
                      }
                      return (
                        <div className="standings-extra-block">
                          <div className="standings-extra-row">
                            <span className="standings-extra-label">PF through completed weeks:</span>
                            <span className="standings-extra-val">
                              {Number.isFinite(completedPlayoffTotal) ? `${completedPlayoffTotal.toFixed(1)} pts` : 'N/A'}
                            </span>
                          </div>
                          <div className="standings-extra-row">
                            <span className="standings-extra-label">PF this week:</span>
                            <span className="standings-extra-val">
                              {Number.isFinite(scoreThisWeek) ? `${scoreThisWeek.toFixed(1)} pts` : 'N/A'}
                            </span>
                          </div>
                          <div className="standings-extra-row">
                            <span className="standings-extra-sub">
                              (Yet To Play: {yetToPlayCount}, In-Play: {activeCount})
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
            {isExpanded && weekTiles.length > 0 && (
              <div className="yoffs-weeks-row">
                {weekTiles.map((wk) => {
                  const val = rawWeekPoints[wk];
                  const display = typeof val === 'number' && isFinite(val) ? val.toFixed(1) : 'N/A';
                  return (
                    <div key={wk} className="yoffs-week-cell">
                      <div className="yoffs-week-label">
                        {isMobile ? `Week ${wk}` : `Week ${wk} Score`}
                      </div>
                      <div className="yoffs-week-value">{display}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
        </div>
      )}

      {selectedTab === 'Scores' && (
        <YoffsScoresView
          season={season}
          rows={rows}
          startWeek={playoffStartWeek}
          endWeek={playoffEndWeek}
        />
      )}

      {selectedTab === 'Head to Head' && (
        <div className="yoffs-tab-placeholder">
          TODO: Playoff Head to Head tab.
        </div>
      )}
    </>
  );
}

export default Yoffs2024Format;


