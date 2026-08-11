import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import PositionBadge from '../PositionBadge';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import { findMyRosterId, loadCurrentTeamData, useAuthUser } from '../hooks/useAuthUser';
import { getLoggedInTeamOverride } from '../debug/loggedInTeam';
import { buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import { fetchKtcData, getKtcEntryByName, formatKtcValue } from '../lookups/KtcLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';

const SLEEPER_BOT = '/data/sleeper-bot.png';

function YourTeamHomeCard() {
  const { user } = useAuthUser();
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState(null);
  const [topAssets, setTopAssets] = useState([]);
  const [teamData, setTeamData] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  useEffect(() => {
    if (selectedPlayer) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [selectedPlayer]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setSelectedPlayer(null);
    }
    if (selectedPlayer) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedPlayer]);

  useEffect(() => {
    let cancelled = false;
    if (!user && getLoggedInTeamOverride() == null) {
      setTeam(null);
      setTopAssets([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    Promise.all([
      loadCurrentTeamData(),
      fetchKtcData(),
      fetchPlayerIdMap(),
      fetchPlayersData(),
    ])
      .then(([{ rosters, users }, ktcResult, idMap, playersData]) => {
        if (cancelled) return;
        setTeamData({ rosters, users });
        const rosterId = findMyRosterId(rosters, users, user);
        const info = rosterId != null
          ? buildRosterIdToTeamInfoMap(rosters, users)[rosterId]
          : null;
        const sleeperUser = info?.user || null;
        setTeam({
          rosterId,
          teamName: info?.teamName || user?.sleeperDisplayName || user?.sleeperUsername || 'Your team',
          ownerName: info?.ownerName || user?.sleeperDisplayName || user?.sleeperUsername || '',
          teamAvatarUrl: sleeperUser?.team_avatar_url || sleeperUser?.user_avatar_url || sleeperUser?.avatar_url || null,
          ownerAvatarUrl: sleeperUser?.user_avatar_url || sleeperUser?.avatar_url || user?.image || null,
        });

        const roster = (rosters || []).find((r) => Number(r.roster_id) === Number(rosterId));
        const playerIds = Array.isArray(roster?.players) ? roster.players : [];
        const ktcMap = ktcResult?.map || null;
        const ranked = playerIds.map((pid) => {
          const playerInfo = getPlayerInfo(pid, playersData, idMap);
          if (!playerInfo) return null;
          const name = playerInfo.full_name || playerInfo.name || '';
          const hints = {
            position: playerInfo.position,
            team: playerInfo.team || playerInfo.team_abbr,
            age: playerInfo.age,
          };
          const entry = getKtcEntryByName(name, ktcMap, 'sf_tep', hints);
          return {
            playerId: pid,
            name,
            position: playerInfo.position || entry?.position || '',
            photo: playerInfo.espn_photo_url || null,
            ktcValue: entry?.ktcValue || 0,
            fullInfo: playerInfo,
          };
        }).filter(Boolean);
        ranked.sort((a, b) => b.ktcValue - a.ktcValue);
        setTopAssets(ranked.slice(0, 3));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setTeam(null);
          setTopAssets([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [user]);

  const modal = selectedPlayer ? (
    <div className="player-modal-overlay" onClick={() => setSelectedPlayer(null)}>
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <PlayerWeeklyScores
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          rosters={teamData?.rosters || []}
          users={teamData?.users || []}
        />
      </div>
    </div>
  ) : null;

  let body;
  if (loading) {
    body = (
      <LoadingState
        className="active-playoffs-loading"
        label="Loading your team…"
        ariaLabel="Loading your team"
      />
    );
  } else if (!team || team.rosterId == null) {
    body = (
      <div className="active-playoffs-status">
        We couldn&apos;t match your Sleeper account to a Hwang Dynasty roster yet.
      </div>
    );
  } else {
    const showOwnerPic = team.ownerAvatarUrl && team.ownerAvatarUrl !== team.teamAvatarUrl;
    body = (
      <>
        <div className="your-team-home-body">
          <div className="your-team-home-left">
            <Link to={`/team/${team.rosterId}`} className="your-team-home-identity">
              {team.teamAvatarUrl ? (
                <img
                  className="your-team-home-avatar me-avatar"
                  src={team.teamAvatarUrl}
                  alt={`${team.teamName} avatar`}
                />
              ) : null}
              <div className="your-team-home-names">
                <span className="your-team-home-team-name">
                  {team.teamName}
                  <span className="me-chip">YOU</span>
                </span>
                {team.ownerName ? (
                  <span className="your-team-home-owner">
                    {showOwnerPic ? (
                      <img
                        className="your-team-home-owner-avatar me-avatar"
                        src={team.ownerAvatarUrl}
                        alt=""
                      />
                    ) : null}
                    {team.ownerName}
                  </span>
                ) : null}
              </div>
            </Link>
          </div>
          <div className="your-team-home-assets">
            <div className="your-team-home-assets-title">Top assets</div>
            {topAssets.length === 0 ? (
              <div className="your-team-home-assets-empty">No KTC values yet.</div>
            ) : (
              <ul className="your-team-home-assets-list">
                {topAssets.map((asset) => (
                  <li key={asset.playerId}>
                    <button
                      type="button"
                      className="your-team-home-asset"
                      title={asset.name}
                      onClick={() => setSelectedPlayer(asset.fullInfo)}
                    >
                      <img
                        className="your-team-home-asset-photo"
                        src={getPlayerLogoUrl(asset.photo)}
                        alt={asset.name}
                      />
                      <PositionBadge position={asset.position} />
                      <span className="your-team-home-asset-value">{formatKtcValue(asset.ktcValue)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="active-playoffs-link-row your-team-home-link-row">
          <Link className="active-playoffs-link" to={`/team/${team.rosterId}`}>
            Open your team →
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <HomeCard className="your-team-home-card">
        <div className="home-card-inner">
          <h2 className="home-card-title login-home-card-title">
            <img src={SLEEPER_BOT} alt="" className="login-home-card-title-logo" aria-hidden="true" />
            Your Team
          </h2>
          {body}
        </div>
      </HomeCard>
      {modal ? createPortal(modal, document.body) : null}
    </>
  );
}

export default YourTeamHomeCard;
