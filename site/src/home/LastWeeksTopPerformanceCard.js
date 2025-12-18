import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import PlayerCard from '../players/PlayerCard';
import { CURRENT_YEAR, getCurrentNFLWeek } from '../utils/DateHelper';
import { fetchScoresData } from '../lookups/ScoresLookup';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';

function LastWeeksTopPerformanceCard({ currentWeekOverride = null }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [targetWeek, setTargetWeek] = useState(null);
  const [starsByPos, setStarsByPos] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playersDataForModal, setPlayersDataForModal] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const season = CURRENT_YEAR;
        let currentWeek = getCurrentNFLWeek(season);
        if (currentWeekOverride != null) {
          const parsed = Number(currentWeekOverride);
          if (Number.isFinite(parsed) && parsed > 0) {
            currentWeek = parsed;
          }
        }

        const prevWeek = currentWeek - 1;
        if (!Number.isFinite(prevWeek) || prevWeek < 1) {
          if (!cancelled) {
            setTargetWeek(null);
            setStarsByPos(null);
            setLoading(false);
          }
          return;
        }

        const effectiveWeek = Math.min(17, prevWeek);
        setTargetWeek(effectiveWeek);

        const [weeksData, teamData, playersData, playerIdMap] = await Promise.all([
          fetchScoresData(season),
          fetchTeamData(season),
          // Prefer the historical snapshot for that specific week when available
          fetchPlayersData(null, { week: effectiveWeek }),
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

        const weekArr = Array.isArray(weeksData[effectiveWeek - 1]) ? weeksData[effectiveWeek - 1] : [];
        if (!weekArr.length) {
          setStarsByPos(null);
          setLoading(false);
          return;
        }

        const rosterMap = buildRosterIdToTeamInfoMap(teamData.rosters, teamData.users);
        const trackedPositions = ['QB', 'RB', 'WR', 'TE'];
        const bestByPos = {};

        trackedPositions.forEach((pos) => {
          bestByPos[pos] = null;
        });

        for (const entry of weekArr) {
          if (!entry || entry.roster_id == null || !entry.players_points) {
            continue;
          }
          const ridRaw = entry.roster_id;
          const ridNum = Number(ridRaw);
          const ridKey = Number.isFinite(ridNum) ? ridNum : ridRaw;

          for (const [pid, pts] of Object.entries(entry.players_points)) {
            if (!pid || pid === '0') {
              continue;
            }
            if (typeof pts !== 'number' || !Number.isFinite(pts)) {
              continue;
            }

            const info = getPlayerInfo(pid, playersData || {}, playerIdMap || {});
            const pos = info && info.position ? String(info.position).toUpperCase() : '';
            if (!trackedPositions.includes(pos)) {
              continue;
            }

            const existing = bestByPos[pos];
            if (!existing || pts > existing.points) {
              const teamInfo = rosterMap && Object.prototype.hasOwnProperty.call(rosterMap, ridKey)
                ? rosterMap[ridKey]
                : null;
              const teamName = teamInfo && teamInfo.teamName
                ? teamInfo.teamName
                : `Team ${ridKey}`;
              const user = teamInfo && teamInfo.user ? teamInfo.user : null;
              const avatarUrl = user
                ? (user.team_avatar_url || user.user_avatar_url || user.avatar_url || null)
                : null;

              bestByPos[pos] = {
                position: pos,
                playerId: pid,
                playerName: info && info.name ? info.name : pid,
                playerPhotoUrl: info && info.espn_photo_url ? info.espn_photo_url : null,
                points: pts,
                rosterId: ridKey,
                teamName,
                avatarUrl,
              };
            }
          }
        }

        setStarsByPos(bestByPos);
        setPlayersDataForModal(playersData);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Unable to load week stars right now.');
          setStarsByPos(null);
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [currentWeekOverride]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setSelectedPlayer(null);
      }
    }
    if (selectedPlayer) {
      document.addEventListener('keydown', onKeyDown);
    }
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedPlayer]);

  useEffect(() => {
    if (selectedPlayer) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [selectedPlayer]);

  const title = targetWeek ? `⭐ Week ${targetWeek} Top Scores` : '⭐ Week Stars';

  let body = null;

  if (loading) {
    body = (
      <div className="week-stars-status">
        Loading…
      </div>
    );
  } else if (error) {
    body = (
      <div className="week-stars-status week-stars-status--error">
        {error}
      </div>
    );
  } else if (!targetWeek || !starsByPos) {
    body = (
      <div className="week-stars-status">
        Not enough data yet to show last week&apos;s stars.
      </div>
    );
  } else {
    const order = ['QB', 'RB', 'WR', 'TE'];
    body = (
      <div className="week-stars-body">
        <div className="week-stars-rows">
          {order.map((pos) => {
            const item = starsByPos[pos];
            if (!item) {
              return (
                <div className="week-stars-row" key={pos}>
                  <div className="week-stars-pos">{pos}</div>
                  <div className="week-stars-player">
                    <span className="week-stars-points">—</span>
                    <span className="week-stars-player-name">—</span>
                  </div>
                  <div className="week-stars-team">
                    <div className="week-stars-team-logo" />
                    <div className="week-stars-team-name">—</div>
                  </div>
                </div>
              );
            }
            const playerData = playersDataForModal && item.playerId
              ? playersDataForModal[item.playerId]
              : null;

            return (
              <div className="week-stars-row" key={pos}>
                <div className="week-stars-pos">{pos}</div>
                <button
                  type="button"
                  className="week-stars-player week-stars-player--clickable"
                  onClick={() => {
                    if (playerData) {
                      setSelectedPlayer(playerData);
                    }
                  }}
                  disabled={!playerData}
                >
                  <span className="week-stars-points">
                    {Number(item.points || 0).toFixed(1)}
                    <span className="week-stars-points-units"> pts</span>
                  </span>
                  {item.playerPhotoUrl && (
                    <img
                      className="week-stars-player-avatar"
                      src={item.playerPhotoUrl}
                      alt={item.playerName}
                    />
                  )}
                  <span className="week-stars-player-name">
                    {item.playerName}
                  </span>
                </button>
                <Link
                  to={`/team/${item.rosterId}`}
                  className="week-stars-team week-stars-team--clickable"
                >
                  <div className="week-stars-team-logo">
                    {item.avatarUrl && (
                      <img
                        className="week-stars-team-avatar"
                        src={item.avatarUrl}
                        alt={`${item.teamName} avatar`}
                      />
                    )}
                  </div>
                  <div className="week-stars-team-name">
                    {item.teamName}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const scoresLinkTo = targetWeek
    ? `/Scores/Week?week=${targetWeek}`
    : '/Scores/Week';
  const scoresLinkLabel = targetWeek
    ? `See Week ${targetWeek} Scores →`
    : 'See Scores →';

  const modal = selectedPlayer ? (
    <div className="player-modal-overlay" onClick={() => setSelectedPlayer(null)}>
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <PlayerCard player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />
      </div>
    </div>
  ) : null;

  return (
    <HomeCard>
      <div className="home-card-inner">
        <h2 className="home-card-title">
          {title}
        </h2>
        {body}
        <div className="active-playoffs-link-row">
          <Link className="active-playoffs-link" to={scoresLinkTo}>
            {scoresLinkLabel}
          </Link>
        </div>
      </div>
      {modal && createPortal(modal, document.body)}
    </HomeCard>
  );
}

export default LastWeeksTopPerformanceCard;



