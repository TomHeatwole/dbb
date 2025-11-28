import React, { useEffect, useState } from 'react';
import YoffsScoresView from './YoffsScoresView';
import { fetchScoresData } from './ScoresLookup';
import { fetchTeamData } from './TeamLookup';
import { getStandings, getWeekScoreBreakdown } from './ScoresParser';
import { StartSitSort } from './StartSitDecider';
import { fetchPlayersData, fetchPlayerIdMap } from './PlayerLookup';
import useIsMobile from './useIsMobile';
import { CURRENT_YEAR, getCompletedWeeksCount } from './DateHelper';

function Yoffs2025Format({ season, selectedTab, onTabChange, playoffStartWeek, playoffEndWeek }) {
  const tabOptions = ['Bracket', 'Scores', 'Matchups'];
  const [seedTeams, setSeedTeams] = useState(null);
  const [loadingSeeds, setLoadingSeeds] = useState(true);
  const [seedError, setSeedError] = useState(null);
  const [finalsInfo, setFinalsInfo] = useState(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    let cancelled = false;

    async function loadSeeds() {
      setLoadingSeeds(true);
      setSeedError(null);
      try {
        const [weeksData, teamData, players, idMap] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season),
          fetchPlayersData(),
          fetchPlayerIdMap()
        ]);
        if (cancelled) {
          return;
        }
        if (!weeksData || !Array.isArray(weeksData)) {
          throw new Error('No scores data');
        }
        if (!teamData || !Array.isArray(teamData.rosters) || !Array.isArray(teamData.users)) {
          throw new Error('No team data');
        }

        const regularSliceFull = weeksData.slice(0, 14);
        const weeksRegular = regularSliceFull.filter(Boolean);
        if (!weeksRegular.length) {
          setSeedTeams([]);
          setLoadingSeeds(false);
          return;
        }

        const standingsRegular = getStandings(weeksRegular) || [];
        const top4Regular = standingsRegular
          .slice()
          .sort((a, b) => a.place - b.place)
          .slice(0, 4);
        const seedIds = top4Regular.map((r) => Number(r.roster_id));
        const seedSet = new Set(seedIds);

        // Compute cumulative semifinal totals for each playoff team (StartSit-based)
        const semiStart = playoffStartWeek;
        const semiEnd = Math.max(playoffStartWeek, playoffEndWeek - 1);
        const semiTotals = {};
        for (let wk = semiStart; wk <= semiEnd; wk += 1) {
          const breakdown = getWeekScoreBreakdown(weeksData, wk) || {};
          const weekEntries = Array.isArray(weeksData[wk - 1]) ? weeksData[wk - 1] : [];
          const basePointsByRoster = {};
          weekEntries.forEach((entry) => {
            if (!entry || entry.roster_id == null) {
              return;
            }
            const rid = Number(entry.roster_id);
            if (!seedSet.has(rid)) {
              return;
            }
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
              // fallback to base API points
            }
            if (typeof weekTotal === 'number' && isFinite(weekTotal)) {
              if (!semiTotals[rid]) {
                semiTotals[rid] = 0;
              }
              semiTotals[rid] += weekTotal;
            }
          });
        }

        const seeds = top4Regular
          .map((row) => {
            const rid = Number(row.roster_id);
            const roster = teamData.rosters.find(
              (r) => String(r.roster_id) === String(rid)
            );
            const user =
              roster && teamData.users
                ? teamData.users.find(
                    (u) =>
                      String(u.user_id) === String(roster.owner_id)
                  )
                : null;
            let teamName = `Team ${rid}`;
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
            return {
              rosterId: rid,
              seed: row.place,
              teamName,
              avatarUrl,
              semiTotal: semiTotals[rid] != null ? semiTotals[rid] : null
            };
          })
          .sort((a, b) => (a.seed || 999) - (b.seed || 999));

        // Determine if all semifinal weeks are completed
        const isCurrentSeason = String(season) === String(CURRENT_YEAR);
        const completedWeeks = getCompletedWeeksCount(season);
        const semisCompleted = semiEnd <= completedWeeks || !isCurrentSeason;

        let finalsLocal = null;
        if (semisCompleted && seeds.length >= 2) {
          const seed1 = seeds.find((t) => t.seed === 1) || seeds[0];
          const seed4 =
            seeds.find((t) => t.seed === 4) || seeds[seeds.length - 1];
          const seed2 = seeds.find((t) => t.seed === 2) || seeds[1];
          const seed3 =
            seeds.find((t) => t.seed === 3) ||
            seeds[Math.min(2, seeds.length - 1)];

          const total1 = semiTotals[seed1.rosterId] || 0;
          const total4 = semiTotals[seed4.rosterId] || 0;
          const total2 = semiTotals[seed2.rosterId] || 0;
          const total3 = semiTotals[seed3.rosterId] || 0;

          const topWinner =
            total1 > total4 ||
            (total1 === total4 && (seed1.seed || 999) < (seed4.seed || 999))
              ? seed1
              : seed4;
          const bottomWinner =
            total2 > total3 ||
            (total2 === total3 && (seed2.seed || 999) < (seed3.seed || 999))
              ? seed2
              : seed3;

          const finalsWeek = playoffEndWeek;
          const finalsBreakdown =
            getWeekScoreBreakdown(weeksData, finalsWeek) || {};

          const computeFinalTotal = (rid) => {
            let weekTotal = 0;
            const raw = finalsBreakdown[rid];
            try {
              if (raw && players && idMap) {
                const computed = StartSitSort(raw, players, idMap);
                if (computed && typeof computed.starterTotal === 'number') {
                  weekTotal = Math.round(computed.starterTotal * 10) / 10;
                }
              }
            } catch (_) {
              // fallback below
            }
            if (!weekTotal) {
              const weekEntries = Array.isArray(weeksData[finalsWeek - 1])
                ? weeksData[finalsWeek - 1]
                : [];
              const entry = weekEntries.find(
                (e) => e && Number(e.roster_id) === Number(rid)
              );
              if (entry && typeof entry.points === 'number') {
                weekTotal = Math.round(entry.points * 10) / 10;
              }
            }
            return weekTotal || null;
          };

          finalsLocal = {
            top: {
              ...topWinner,
              finalsTotal: computeFinalTotal(topWinner.rosterId),
            },
            bottom: {
              ...bottomWinner,
              finalsTotal: computeFinalTotal(bottomWinner.rosterId),
            },
          };
        }

        setSeedTeams(seeds);
        setFinalsInfo(finalsLocal);
        setLoadingSeeds(false);
      } catch (e) {
        if (!cancelled) {
          setSeedError('Failed to load bracket seeds');
          setSeedTeams([]);
          setLoadingSeeds(false);
        }
      }
    }

    loadSeeds();

    return () => {
      cancelled = true;
    };
  }, [season]);

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

      {selectedTab === 'Bracket' && (
        <>
          {loadingSeeds && (
            <div className="loading-center">
              <div className="spinner" aria-label="Loading" />
              <div className="loading-text">Loading bracket…</div>
            </div>
          )}
          {!loadingSeeds && seedError && <div>{seedError}</div>}
          {!loadingSeeds && !seedError && (!seedTeams || seedTeams.length === 0) && (
            <div>No playoff teams found for this season.</div>
          )}
          {!loadingSeeds && !seedError && seedTeams && seedTeams.length > 0 && (
            <div className="yoffs-bracket">
              {(() => {
                const semiStart = playoffStartWeek;
                const semiEnd = Math.max(playoffStartWeek, playoffEndWeek - 1);
                const finalsWeek = playoffEndWeek;
                const semiLabel =
                  semiStart === semiEnd
                    ? `Semifinals (Week ${semiStart})`
                    : `Semifinals (Weeks ${semiStart}-${semiEnd})`;
                const finalsLabel = 
                  `Championship (Week ${finalsWeek})`;

                const seed1 = seedTeams.find((t) => t.seed === 1) || seedTeams[0];
                const seed4 =
                  seedTeams.find((t) => t.seed === 4) ||
                  seedTeams[seedTeams.length - 1];
                const seed2 = seedTeams.find((t) => t.seed === 2) || seedTeams[1];
                const seed3 =
                  seedTeams.find((t) => t.seed === 3) ||
                  seedTeams[Math.min(2, seedTeams.length - 1)];

                const formatScore = (val) =>
                  typeof val === 'number' && isFinite(val)
                    ? `${val.toFixed(1)} pts`
                    : '—';

                const isCurrentSeasonLocal = String(season) === String(CURRENT_YEAR);
                const completedWeeksLocal = getCompletedWeeksCount(season);
                const semisCompleted =
                  semiEnd <= completedWeeksLocal || !isCurrentSeasonLocal;
                const finalsCompleted =
                  finalsWeek <= completedWeeksLocal || !isCurrentSeasonLocal;

                const topSemiWinner =
                  semisCompleted &&
                  ((seed1.semiTotal || 0) > (seed4.semiTotal || 0) ||
                    ((seed1.semiTotal || 0) === (seed4.semiTotal || 0) &&
                      (seed1.seed || 999) < (seed4.seed || 999)));
                const bottomSemiWinner =
                  semisCompleted &&
                  ((seed2.semiTotal || 0) > (seed3.semiTotal || 0) ||
                    ((seed2.semiTotal || 0) === (seed3.semiTotal || 0) &&
                      (seed2.seed || 999) < (seed3.seed || 999)));

                const finalsTopWinner =
                  finalsCompleted &&
                  finalsInfo &&
                  ((finalsInfo.top.finalsTotal || 0) >
                    (finalsInfo.bottom.finalsTotal || 0) ||
                    ((finalsInfo.top.finalsTotal || 0) ===
                      (finalsInfo.bottom.finalsTotal || 0) &&
                      (finalsInfo.top.seed || 999) <
                        (finalsInfo.bottom.seed || 999)));

                return (
                  <>
                    <div className="yoffs-bracket-column yoffs-bracket-column--left">
                      <div className="yoffs-bracket-round-label">
                        {semiLabel}
                      </div>
                      <div className="yoffs-bracket-match">
                        <div
                          className={
                            'yoffs-bracket-team' +
                            (semisCompleted
                              ? topSemiWinner
                                ? ' yoffs-bracket-team--winner'
                                : ' yoffs-bracket-team--loser'
                              : '')
                          }
                        >
                          <span className="yoffs-bracket-seed">#{seed1.seed}</span>
                          {seed1.avatarUrl && (
                            <img
                              className="standings-avatar"
                              src={seed1.avatarUrl}
                              alt={`${seed1.teamName} avatar`}
                            />
                          )}
                          <span className="yoffs-bracket-name">{seed1.teamName}</span>
                          <span className="yoffs-bracket-score">
                            {formatScore(seed1.semiTotal)}
                          </span>
                        </div>
                        <div
                          className={
                            'yoffs-bracket-team' +
                            (semisCompleted
                              ? !topSemiWinner
                                ? ' yoffs-bracket-team--winner'
                                : ' yoffs-bracket-team--loser'
                              : '')
                          }
                        >
                          <span className="yoffs-bracket-seed">#{seed4.seed}</span>
                          {seed4.avatarUrl && (
                            <img
                              className="standings-avatar"
                              src={seed4.avatarUrl}
                              alt={`${seed4.teamName} avatar`}
                            />
                          )}
                          <span className="yoffs-bracket-name">{seed4.teamName}</span>
                          <span className="yoffs-bracket-score">
                            {formatScore(seed4.semiTotal)}
                          </span>
                        </div>
                      </div>
                      <div className="yoffs-bracket-match">
                        <div
                          className={
                            'yoffs-bracket-team' +
                            (semisCompleted
                              ? bottomSemiWinner
                                ? ' yoffs-bracket-team--winner'
                                : ' yoffs-bracket-team--loser'
                              : '')
                          }
                        >
                          <span className="yoffs-bracket-seed">#{seed2.seed}</span>
                          {seed2.avatarUrl && (
                            <img
                              className="standings-avatar"
                              src={seed2.avatarUrl}
                              alt={`${seed2.teamName} avatar`}
                            />
                          )}
                          <span className="yoffs-bracket-name">{seed2.teamName}</span>
                          <span className="yoffs-bracket-score">
                            {formatScore(seed2.semiTotal)}
                          </span>
                        </div>
                        <div
                          className={
                            'yoffs-bracket-team' +
                            (semisCompleted
                              ? !bottomSemiWinner
                                ? ' yoffs-bracket-team--winner'
                                : ' yoffs-bracket-team--loser'
                              : '')
                          }
                        >
                          <span className="yoffs-bracket-seed">#{seed3.seed}</span>
                          {seed3.avatarUrl && (
                            <img
                              className="standings-avatar"
                              src={seed3.avatarUrl}
                              alt={`${seed3.teamName} avatar`}
                            />
                          )}
                          <span className="yoffs-bracket-name">{seed3.teamName}</span>
                          <span className="yoffs-bracket-score">
                            {formatScore(seed3.semiTotal)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="yoffs-bracket-column yoffs-bracket-column--right">
                      <div className="yoffs-bracket-final-label">
                        {finalsLabel}
                      </div>
                      <div className="yoffs-bracket-final-spacer">
                        <div className="yoffs-bracket-match yoffs-bracket-match--final">
                          {finalsInfo ? (
                            <>
                              <div
                                className={
                                  'yoffs-bracket-team' +
                                  (finalsCompleted
                                    ? finalsTopWinner
                                      ? ' yoffs-bracket-team--winner'
                                      : ' yoffs-bracket-team--loser'
                                    : '')
                                }
                              >
                                <span className="yoffs-bracket-seed">
                                  #{finalsInfo.top.seed}
                                </span>
                                {finalsInfo.top.avatarUrl && (
                                  <img
                                    className="standings-avatar"
                                    src={finalsInfo.top.avatarUrl}
                                    alt={`${finalsInfo.top.teamName} avatar`}
                                  />
                                )}
                                <span className="yoffs-bracket-name">
                                  {finalsInfo.top.teamName}
                                </span>
                                <span className="yoffs-bracket-score">
                                  {formatScore(finalsInfo.top.finalsTotal)}
                                </span>
                              </div>
                              <div
                                className={
                                  'yoffs-bracket-team' +
                                  (finalsCompleted
                                    ? !finalsTopWinner
                                      ? ' yoffs-bracket-team--winner'
                                      : ' yoffs-bracket-team--loser'
                                    : '')
                                }
                              >
                                <span className="yoffs-bracket-seed">
                                  #{finalsInfo.bottom.seed}
                                </span>
                                {finalsInfo.bottom.avatarUrl && (
                                  <img
                                    className="standings-avatar"
                                    src={finalsInfo.bottom.avatarUrl}
                                    alt={`${finalsInfo.bottom.teamName} avatar`}
                                  />
                                )}
                                <span className="yoffs-bracket-name">
                                  {finalsInfo.bottom.teamName}
                                </span>
                                <span className="yoffs-bracket-score">
                                  {formatScore(finalsInfo.bottom.finalsTotal)}
                                </span>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="yoffs-bracket-team yoffs-bracket-team--placeholder">
                                Winner of #1 vs #4
                              </div>
                              <div className="yoffs-bracket-team yoffs-bracket-team--placeholder">
                                Winner of #2 vs #3
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </>
      )}

      {selectedTab === 'Scores' && (
        <YoffsScoresView
          season={season}
          rows={null}
          startWeek={playoffStartWeek}
          endWeek={playoffEndWeek}
        />
      )}

      {selectedTab === 'Matchups' && (
        <div className="yoffs-tab-placeholder">
          TODO: Playoff Matchups tab.
    </div>
      )}
    </>
  );
}

export default Yoffs2025Format;


