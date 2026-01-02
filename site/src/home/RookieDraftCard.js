import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import { CURRENT_YEAR, getCompletedWeeksCount } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData, fetchTradedPicks, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { getStandings, getWeekScoreBreakdown, getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { StartSitSort } from '../players/StartSitDecider';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import useIsMobile from '../hooks/useIsMobile';

function RookieDraftCard() {
  const isMobile = useIsMobile();
  const draftYear = useMemo(() => {
    const n = Number(CURRENT_YEAR);
    if (!Number.isFinite(n)) {
      return CURRENT_YEAR;
    }
    return String(n + 1);
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [gridRows, setGridRows] = useState(null); // [{ pickNum, cells: [{ round, label, ownerRosterId, ownerTeamName, ownerAvatarUrl }] }]
  const [tooltipState, setTooltipState] = useState(null); // { x, y, label, ownerTeamName, originalTeamName, isTraded, ownerRosterId }
  const [activeMobileCell, setActiveMobileCell] = useState(null);

  // Close tooltip on scroll/resize so it never "floats" in the wrong place.
  useEffect(() => {
    if (isMobile || !tooltipState) {
      return;
    }
    const close = () => setTooltipState(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [tooltipState, isMobile]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const season = CURRENT_YEAR;
        const seasonNum = Number(season);
        const draftYearNum = Number(draftYear);
        if (!Number.isFinite(seasonNum) || !Number.isFinite(draftYearNum)) {
          throw new Error('Invalid season/draft year');
        }

        const [weeksData, teamData, tradedPicks, players, idMap] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season),
          fetchTradedPicks(season),
          fetchPlayersData(),
          fetchPlayerIdMap(),
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
        if (!Array.isArray(teamData.rosters) || teamData.rosters.length !== 10) {
          throw new Error('Expected exactly 10 teams');
        }

        // Ensure the underlying season is finished so draft order is stable.
        const completedWeeks = getCompletedWeeksCount(season);
        if (!Number.isFinite(completedWeeks) || completedWeeks < 17) {
          throw new Error('Season not complete yet');
        }

        const rosterMap = buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users);
        const playerSeasonTotalsMap = getPlayerSeasonTotalsMap(weeksData);

        // Build final placements (1..10). For 2024, keep the historical behavior: total season points only.
        let placeToRosterId = {};
        if (String(season) === '2024') {
          const standingsAll = getStandings(weeksData) || [];
          const ordered = standingsAll
            .slice()
            .sort((a, b) => {
              if ((a.place || 999) !== (b.place || 999)) {
                return (a.place || 999) - (b.place || 999);
              }
              if ((b.points_scored || 0) !== (a.points_scored || 0)) {
                return (b.points_scored || 0) - (a.points_scored || 0);
              }
              return Number(a.roster_id) - Number(b.roster_id);
            })
            .map((r) => Number(r.roster_id));
          for (let i = 0; i < ordered.length; i += 1) {
            placeToRosterId[i + 1] = ordered[i];
          }
        } else {
          // Seeds are top 4 after regular season (Weeks 1-14).
          const weeks14 = (weeksData || []).slice(0, 14).filter(Boolean);
          const standings14 = getStandings(weeks14) || [];
          const top4Seeds = standings14
            .slice()
            .sort((a, b) => {
              if ((a.place || 999) !== (b.place || 999)) {
                return (a.place || 999) - (b.place || 999);
              }
              if ((b.points_scored || 0) !== (a.points_scored || 0)) {
                return (b.points_scored || 0) - (a.points_scored || 0);
              }
              return Number(a.roster_id) - Number(b.roster_id);
            })
            .slice(0, 4)
            .map((r, idx) => ({ rosterId: Number(r.roster_id), seed: idx + 1 }));

          if (top4Seeds.length !== 4) {
            throw new Error('Unable to determine top 4 seeds');
          }

          const seed1 = top4Seeds.find((s) => s.seed === 1);
          const seed2 = top4Seeds.find((s) => s.seed === 2);
          const seed3 = top4Seeds.find((s) => s.seed === 3);
          const seed4 = top4Seeds.find((s) => s.seed === 4);
          if (!seed1 || !seed2 || !seed3 || !seed4) {
            throw new Error('Invalid seed data');
          }

          function computeWeekTotal(rid, weekNum) {
            const weekArr = Array.isArray(weeksData) ? weeksData[weekNum - 1] : null;
            const entry = Array.isArray(weekArr)
              ? weekArr.find((e) => e && Number(e.roster_id) === Number(rid))
              : null;
            let total =
              entry && typeof entry.points === 'number' && Number.isFinite(entry.points)
                ? Math.round(entry.points * 10) / 10
                : 0;
            try {
              const breakdown = getWeekScoreBreakdown(weeksData, weekNum, teamData.rosters) || {};
              const teamScore = breakdown && breakdown[rid];
              if (teamScore && players && idMap) {
                const computed = StartSitSort(teamScore, players, idMap, null, null, playerSeasonTotalsMap);
                if (computed && typeof computed.starterTotal === 'number') {
                  total = Math.round(computed.starterTotal * 10) / 10;
                }
              }
            } catch (_) {
              // keep Sleeper API points fallback
            }
            return total;
          }

          // Semifinals cumulative Weeks 15-16.
          const semiTotals = {};
          const seeds = [seed1, seed2, seed3, seed4];
          for (const s of seeds) {
            semiTotals[s.rosterId] = 0;
          }
          for (let wk = 15; wk <= 16; wk += 1) {
            for (const s of seeds) {
              semiTotals[s.rosterId] += computeWeekTotal(s.rosterId, wk);
            }
          }

          const topWinner =
            semiTotals[seed1.rosterId] > semiTotals[seed4.rosterId] ||
            (semiTotals[seed1.rosterId] === semiTotals[seed4.rosterId] && (seed1.seed || 999) < (seed4.seed || 999))
              ? seed1
              : seed4;
          const topLoser = topWinner.rosterId === seed1.rosterId ? seed4 : seed1;

          const bottomWinner =
            semiTotals[seed2.rosterId] > semiTotals[seed3.rosterId] ||
            (semiTotals[seed2.rosterId] === semiTotals[seed3.rosterId] && (seed2.seed || 999) < (seed3.seed || 999))
              ? seed2
              : seed3;
          const bottomLoser = bottomWinner.rosterId === seed2.rosterId ? seed3 : seed2;

          // Finals Week 17 + Semis Buffer (matches /yoffs).
          const finalsTotals = {
            [topWinner.rosterId]: computeWeekTotal(topWinner.rosterId, 17),
            [bottomWinner.rosterId]: computeWeekTotal(bottomWinner.rosterId, 17),
          };
          const topWinnerSemi = semiTotals[topWinner.rosterId] || 0;
          const bottomWinnerSemi = semiTotals[bottomWinner.rosterId] || 0;
          const highSemi = Math.max(topWinnerSemi, bottomWinnerSemi);
          const lowSemi = Math.min(topWinnerSemi, bottomWinnerSemi);
          const buffer = highSemi > lowSemi ? (highSemi - lowSemi) / 2 : 0;
          if (buffer > 0) {
            if (topWinnerSemi > bottomWinnerSemi) {
              finalsTotals[topWinner.rosterId] = Math.round((finalsTotals[topWinner.rosterId] + buffer) * 10) / 10;
            } else if (bottomWinnerSemi > topWinnerSemi) {
              finalsTotals[bottomWinner.rosterId] = Math.round((finalsTotals[bottomWinner.rosterId] + buffer) * 10) / 10;
            }
          }

          const champion =
            finalsTotals[topWinner.rosterId] > finalsTotals[bottomWinner.rosterId] ||
            (finalsTotals[topWinner.rosterId] === finalsTotals[bottomWinner.rosterId] &&
              (topWinner.seed || 999) < (bottomWinner.seed || 999))
              ? topWinner
              : bottomWinner;
          const runnerUp = champion.rosterId === topWinner.rosterId ? bottomWinner : topWinner;

          const third =
            semiTotals[topLoser.rosterId] > semiTotals[bottomLoser.rosterId] ||
            (semiTotals[topLoser.rosterId] === semiTotals[bottomLoser.rosterId] &&
              (topLoser.seed || 999) < (bottomLoser.seed || 999))
              ? topLoser
              : bottomLoser;
          const fourth = third.rosterId === topLoser.rosterId ? bottomLoser : topLoser;

          // Places 5-10 follow regular season order excluding seeds.
          const seedSet = new Set([seed1.rosterId, seed2.rosterId, seed3.rosterId, seed4.rosterId].map(String));
          const remaining = standings14
            .slice()
            .sort((a, b) => {
              if ((a.place || 999) !== (b.place || 999)) {
                return (a.place || 999) - (b.place || 999);
              }
              if ((b.points_scored || 0) !== (a.points_scored || 0)) {
                return (b.points_scored || 0) - (a.points_scored || 0);
              }
              return Number(a.roster_id) - Number(b.roster_id);
            })
            .map((r) => Number(r.roster_id))
            .filter((rid) => !seedSet.has(String(rid)));

          placeToRosterId = {
            1: champion.rosterId,
            2: runnerUp.rosterId,
            3: third.rosterId,
            4: fourth.rosterId,
          };
          let nextPlace = 5;
          for (const rid of remaining) {
            if (nextPlace > 10) {
              break;
            }
            placeToRosterId[nextPlace] = rid;
            nextPlace += 1;
          }
        }

        // Validate we have all 10 places mapped.
        const missing = [];
        for (let p = 1; p <= 10; p += 1) {
          if (placeToRosterId[p] == null) {
            missing.push(p);
          }
        }
        if (missing.length) {
          throw new Error(`Missing placements: ${missing.join(', ')}`);
        }

        // Traded picks map: key is `${draftYear}-${round}-${originalRosterId}` -> ownerRosterId
        const tradedMap = {};
        const wantedRounds = new Set([1, 2, 3, 4]);
        (Array.isArray(tradedPicks) ? tradedPicks : []).forEach((p) => {
          if (!p) {
            return;
          }
          const seasonStr = p.season != null ? String(p.season) : null;
          const roundNum = p.round != null ? Number(p.round) : null;
          const originalRid = p.roster_id != null ? Number(p.roster_id) : null;
          const ownerRid = p.owner_id != null ? Number(p.owner_id) : null;
          if (seasonStr !== String(draftYear)) {
            return;
          }
          if (!Number.isFinite(roundNum) || !wantedRounds.has(roundNum)) {
            return;
          }
          if (!Number.isFinite(originalRid) || !Number.isFinite(ownerRid)) {
            return;
          }
          tradedMap[`${seasonStr}-${roundNum}-${originalRid}`] = ownerRid;
        });

        // Build the 10x4 grid (rows are pick number, columns are round).
        const rows = [];
        for (let pickNum = 1; pickNum <= 10; pickNum += 1) {
          const originalRosterId = placeToRosterId[11 - pickNum]; // 1.01 -> 10th place
          const originalInfo =
            rosterMap[originalRosterId] || rosterMap[String(originalRosterId)] || null;
          const originalTeamName =
            originalInfo && originalInfo.teamName ? originalInfo.teamName : `Team ${originalRosterId}`;
          const cells = [];
          for (let round = 1; round <= 4; round += 1) {
            const key = `${draftYear}-${round}-${originalRosterId}`;
            const ownerRosterId = tradedMap[key] != null ? tradedMap[key] : originalRosterId;
            const info =
              rosterMap[ownerRosterId] || rosterMap[String(ownerRosterId)] || null;
            const teamName = info && info.teamName ? info.teamName : `Team ${ownerRosterId}`;
            const avatarUrl =
              info && info.user
                ? (info.user.team_avatar_url || info.user.user_avatar_url || info.user.avatar_url || null)
                : null;
            const label = `${round}.${String(pickNum).padStart(2, '0')}`;
            cells.push({
              round,
              label,
              ownerRosterId,
              ownerTeamName: teamName,
              ownerAvatarUrl: avatarUrl,
              isTraded: ownerRosterId !== originalRosterId,
              originalRosterId,
              originalTeamName,
            });
          }
          rows.push({ pickNum, cells });
        }

        setGridRows(rows);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e && e.message ? e.message : 'Unable to load rookie draft board right now.');
          setGridRows(null);
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [draftYear]);

  const title = `👨🏿‍🎓 ${draftYear} Rookie Draft`;

  const desktopTooltipPortal =
    !isMobile && tooltipState
      ? createPortal(
          <div
            className="rookie-draft-tooltip"
            role="tooltip"
            style={{ left: `${tooltipState.x}px`, top: `${tooltipState.y}px` }}
          >
            <div className="rookie-draft-tooltip-title">
              {tooltipState.label} - {tooltipState.ownerTeamName}
            </div>
            {tooltipState.isTraded ? (
              <div className="rookie-draft-tooltip-sub">
                <span className="rookie-draft-traded-dot rookie-draft-traded-dot--inline" aria-hidden="true">
                  ↔
                </span>
                Traded from {tooltipState.originalTeamName}
              </div>
            ) : null}
          </div>,
          document.body
        )
      : null;

  const mobileModal = activeMobileCell ? (
    <div
      className="rookie-draft-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Draft pick details"
      onClick={() => setActiveMobileCell(null)}
    >
      <div
        className="rookie-draft-modal"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <button
          type="button"
          className="rookie-draft-modal-close"
          aria-label="Close"
          onClick={() => setActiveMobileCell(null)}
        >
          ×
        </button>
        <div className="rookie-draft-modal-title">
          {activeMobileCell.label} - {activeMobileCell.ownerTeamName}
        </div>
        {activeMobileCell.isTraded ? (
          <div className="rookie-draft-modal-sub">
            <span className="rookie-draft-traded-dot rookie-draft-traded-dot--inline" aria-hidden="true">
              ↔
            </span>
            Traded from {activeMobileCell.originalTeamName}
          </div>
        ) : null}
        <div className="rookie-draft-modal-actions">
          <Link
            className="active-playoffs-link"
            to={`/team/${activeMobileCell.ownerRosterId}`}
            onClick={() => setActiveMobileCell(null)}
          >
            View Team →
          </Link>
        </div>
      </div>
    </div>
  ) : null;

  let body = null;
  if (loading) {
    body = <LoadingState label="Loading draft board…" ariaLabel="Loading draft board" />;
  } else if (error) {
    body = <div className="rookie-draft-status rookie-draft-status--error">{error}</div>;
  } else if (!gridRows) {
    body = <div className="rookie-draft-status">No draft board data found.</div>;
  } else {
    body = (
      <div className="rookie-draft-table-wrap" role="region" aria-label={`${draftYear} rookie draft board`}>
        <table className="rookie-draft-table">
          <thead>
            <tr>
              <th className="rookie-draft-pick-col" scope="col">Round:</th>
              <th scope="col">1</th>
              <th scope="col">2</th>
              <th scope="col">3</th>
              <th scope="col">4</th>
            </tr>
          </thead>
          <tbody>
            {gridRows.map((row) => {
              return (
                <tr key={row.pickNum}>
                  <th scope="row" className="rookie-draft-pick-col">
                    {String(row.pickNum).padStart(2, '0')}
                  </th>
                  {row.cells.map((cell) => {
                    const hoverData = {
                      label: cell.label,
                      ownerTeamName: cell.ownerTeamName,
                      originalTeamName: cell.originalTeamName,
                      isTraded: !!cell.isTraded,
                      ownerRosterId: cell.ownerRosterId,
                    };
                    return (
                      <td key={cell.round} className="rookie-draft-cell">
                        <div
                          className="rookie-draft-cell-inner"
                        >
                          <button
                            type="button"
                            className="rookie-draft-pick-button"
                            onMouseEnter={(e) => {
                              if (isMobile) {
                                return;
                              }
                              const rect = e.currentTarget.getBoundingClientRect();
                              setTooltipState({
                                ...hoverData,
                                x: rect.left + rect.width / 2,
                                y: rect.bottom + 6,
                              });
                            }}
                            onMouseLeave={() => {
                              if (!isMobile) {
                                setTooltipState(null);
                              }
                            }}
                            onClick={() => {
                              if (isMobile) {
                                setActiveMobileCell(hoverData);
                              }
                            }}
                            aria-label={`${cell.label} - ${cell.ownerTeamName}`}
                          >
                            <Link
                              className="rookie-draft-team rookie-draft-team--icon"
                              to={`/team/${cell.ownerRosterId}`}
                              onClick={(e) => {
                                if (isMobile) {
                                  e.preventDefault();
                                }
                              }}
                            >
                              {cell.ownerAvatarUrl ? (
                                <img
                                  className="rookie-draft-avatar"
                                  src={cell.ownerAvatarUrl}
                                  alt=""
                                />
                              ) : (
                                <div className="rookie-draft-avatar rookie-draft-avatar--placeholder" />
                              )}
                            </Link>
                            {cell.isTraded ? (
                              <span className="rookie-draft-traded-dot" aria-hidden="true">
                                ↔
                              </span>
                            ) : null}
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {mobileModal}
        {desktopTooltipPortal}
      </div>
    );
  }

  return (
    <HomeCard>
      <div className="home-card-inner">
        <h2 className="home-card-title">{title}</h2>
        <div className="home-card-body">{body}</div>
      </div>
    </HomeCard>
  );
}

export default RookieDraftCard;


