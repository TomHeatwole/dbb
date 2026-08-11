import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import { CURRENT_YEAR, getCompletedWeeksCount } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData, fetchTradedPicks, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap } from '../lookups/PlayerLookup';
import { calculateDraftOrder } from '../utils/DraftOrderHelper';
import useIsMobile from '../hooks/useIsMobile';
import { LOGO_LETTER_OVERLAY } from '../utils/global_constants';
import { useMyCurrentRosterId, isMyRoster } from '../hooks/useAuthUser';

function RookieDraftCard() {
  const isMobile = useIsMobile();
  const myRosterId = useMyCurrentRosterId();
  // When pre-season (current season hasn't started): show upcoming draft (CURRENT_YEAR) based on previous year.
  // When in-season/off-season: show next year's draft (CURRENT_YEAR + 1) based on current year.
  const { seasonForOrder, draftYear } = useMemo(() => {
    const n = Number(CURRENT_YEAR);
    if (!Number.isFinite(n)) {
      return { seasonForOrder: CURRENT_YEAR, draftYear: CURRENT_YEAR };
    }
    const completedWeeks = getCompletedWeeksCount(CURRENT_YEAR);
    const isPreSeason = completedWeeks === 0;
    if (isPreSeason) {
      return { seasonForOrder: String(n - 1), draftYear: String(n) };
    }
    return { seasonForOrder: String(n), draftYear: String(n + 1) };
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
        const season = seasonForOrder;
        const seasonNum = Number(season);
        const draftYearNum = Number(draftYear);
        if (!Number.isFinite(seasonNum) || !Number.isFinite(draftYearNum)) {
          throw new Error('Invalid season/draft year');
        }

        // Also fetch traded picks from the draft-year league (e.g. the new 2026 league),
        // since trades made after the new league is created only appear there.
        const draftYearStr = String(draftYear);
        const needsDraftYearFetch = draftYearStr !== String(season);
        const [weeksData, teamData, tradedPicksSeason, tradedPicksDraftYear, players, idMap] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season),
          fetchTradedPicks(season),
          needsDraftYearFetch ? fetchTradedPicks(draftYearStr).catch(() => []) : Promise.resolve([]),
          fetchPlayersData(),
          fetchPlayerIdMap(),
        ]);
        // Merge: draft-year league picks take precedence (latest trade wins per pick slot).
        const tradedPicks = [...(Array.isArray(tradedPicksSeason) ? tradedPicksSeason : []), ...(Array.isArray(tradedPicksDraftYear) ? tradedPicksDraftYear : [])];

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

        // Calculate draft order using shared utility
        const placeToRosterId = calculateDraftOrder(season, weeksData, teamData, players, idMap);

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
  }, [seasonForOrder, draftYear]);

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
              <th className="rookie-draft-pick-col" scope="col">Pick</th>
              <th scope="col">Rd 1</th>
              <th scope="col">Rd 2</th>
              <th scope="col">Rd 3</th>
              <th scope="col">Rd 4</th>
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
                              className={`rookie-draft-team rookie-draft-team--icon${isMyRoster(cell.ownerRosterId, myRosterId) ? ' rookie-draft-row--me' : ''}`}
                              to={`/team/${cell.ownerRosterId}`}
                              onClick={(e) => {
                                if (isMobile) {
                                  e.preventDefault();
                                }
                              }}
                            >
                              <span className="rookie-draft-avatar-wrap" aria-hidden="true">
                                {cell.ownerAvatarUrl ? (
                                  <img
                                    className="rookie-draft-avatar"
                                    src={cell.ownerAvatarUrl}
                                    alt=""
                                  />
                                ) : (
                                  <div className="rookie-draft-avatar rookie-draft-avatar--placeholder" />
                                )}
                                {(() => {
                                  const letter =
                                    LOGO_LETTER_OVERLAY &&
                                    Object.prototype.hasOwnProperty.call(LOGO_LETTER_OVERLAY, String(cell.ownerRosterId))
                                      ? String(LOGO_LETTER_OVERLAY[String(cell.ownerRosterId)] || '').trim()
                                      : '';
                                  if (!letter) {
                                    return null;
                                  }
                                  return (
                                    <span className="rookie-draft-avatar-letter-overlay">
                                      {letter}
                                    </span>
                                  );
                                })()}
                              </span>
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


