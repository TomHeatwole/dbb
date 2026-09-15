import React, { useEffect, useMemo, useState } from 'react';
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
import { fetchScoresData } from '../lookups/ScoresLookup';
import { getPlayerSeasonTotalsMap } from '../scores/ScoresParser';
import { CURRENT_YEAR, getCompletedWeeksCount } from '../utils/DateHelper';
import { getPlayerLogoUrl } from '../utils/playerLogo';

const SLEEPER_BOT = '/data/sleeper-bot.png';

const ASSETS_MODES = [
  { id: 'points', label: 'PF' },
  { id: 'ktc', label: 'KTC' },
  { id: 'posRank', label: 'Pos Rank (PF)' },
];

function formatSeasonPoints(pts) {
  const n = Number(pts) || 0;
  return n.toFixed(1);
}

function buildPfPositionRankMap(seasonTotals, playersData, idMap) {
  const byPos = {};
  for (const [pid, pts] of Object.entries(seasonTotals || {})) {
    const points = Number(pts);
    if (!Number.isFinite(points) || points <= 0) continue;
    const playerInfo = getPlayerInfo(pid, playersData, idMap);
    const position = playerInfo?.position;
    if (!position) continue;
    if (!byPos[position]) byPos[position] = [];
    byPos[position].push({ pid: String(pid), points });
  }

  const rankMap = {};
  for (const [position, entries] of Object.entries(byPos)) {
    entries.sort((a, b) => b.points - a.points);
    entries.forEach((entry, idx) => {
      rankMap[entry.pid] = { rank: idx + 1, position };
    });
  }
  return rankMap;
}

function buildRosterAssetRows(playerIds, playersData, idMap, seasonTotals, ktcMap) {
  return playerIds.map((pid) => {
    const playerInfo = getPlayerInfo(pid, playersData, idMap);
    if (!playerInfo) return null;
    const name = playerInfo.full_name || playerInfo.name || '';
    const hints = {
      position: playerInfo.position,
      team: playerInfo.team || playerInfo.team_abbr,
      age: playerInfo.age,
    };
    const entry = getKtcEntryByName(name, ktcMap, 'sf_tep', hints);
    const pidKey = String(pid);
    return {
      playerId: pid,
      name,
      position: playerInfo.position || entry?.position || '',
      photo: playerInfo.espn_photo_url || null,
      fullInfo: playerInfo,
      points: seasonTotals[pidKey] || seasonTotals[pid] || 0,
      ktcValue: entry?.ktcValue || 0,
    };
  }).filter(Boolean);
}

function rankTopAssets(assets, assetsMode, positionRankMap) {
  const ranked = assets.map((asset) => {
    const pidKey = String(asset.playerId);
    const posRankInfo = positionRankMap[pidKey] || null;
    if (assetsMode === 'posRank') {
      return {
        ...asset,
        value: posRankInfo?.rank ?? null,
        displayRank: posRankInfo,
      };
    }
    if (assetsMode === 'ktc') {
      return { ...asset, value: asset.ktcValue, displayRank: null };
    }
    return { ...asset, value: asset.points, displayRank: null };
  });

  ranked.sort((a, b) => {
    if (assetsMode === 'posRank') {
      const rankA = a.value ?? Number.POSITIVE_INFINITY;
      const rankB = b.value ?? Number.POSITIVE_INFINITY;
      if (rankA !== rankB) return rankA - rankB;
      return (b.points || 0) - (a.points || 0);
    }
    return (b.value || 0) - (a.value || 0);
  });

  if (assetsMode === 'posRank') {
    return ranked.filter((asset) => asset.value != null).slice(0, 3);
  }
  return ranked.slice(0, 3);
}

function YourTeamHomeCard() {
  const { user } = useAuthUser();
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState(null);
  const [rosterAssets, setRosterAssets] = useState([]);
  const [seasonTotals, setSeasonTotals] = useState({});
  const [rankingContext, setRankingContext] = useState(null);
  const [assetsMode, setAssetsMode] = useState(() => (
    getCompletedWeeksCount() > 0 ? 'points' : 'ktc'
  ));
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
      setRosterAssets([]);
      setSeasonTotals({});
      setRankingContext(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    Promise.all([
      loadCurrentTeamData(),
      fetchPlayerIdMap(),
      fetchPlayersData(),
      fetchScoresData(CURRENT_YEAR).catch(() => null),
      fetchKtcData().catch(() => null),
    ])
      .then(([teamPayload, idMap, playersData, scoresData, ktcData]) => {
        if (cancelled) return;
        const { rosters, users } = teamPayload;
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
        const totals = getPlayerSeasonTotalsMap(scoresData);
        const map = ktcData?.map || null;

        setSeasonTotals(totals);
        setRankingContext({ playersData, idMap });
        setRosterAssets(buildRosterAssetRows(playerIds, playersData, idMap, totals, map));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setTeam(null);
          setRosterAssets([]);
          setSeasonTotals({});
          setRankingContext(null);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [user]);

  const topAssets = useMemo(() => {
    if (!rosterAssets.length) return [];
    const rankMap = buildPfPositionRankMap(
      seasonTotals,
      rankingContext?.playersData,
      rankingContext?.idMap
    );
    return rankTopAssets(rosterAssets, assetsMode, rankMap);
  }, [rosterAssets, assetsMode, seasonTotals, rankingContext]);

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
    const emptyLabel = assetsMode === 'points'
      ? 'No points yet.'
      : assetsMode === 'ktc'
        ? 'No KTC values yet.'
        : 'No position ranks yet.';
    body = (
      <>
        <Link to={`/team/${team.rosterId}`} className="your-team-home-hero">
          <div className="your-team-home-hero-glow" aria-hidden="true" />
          {team.teamAvatarUrl ? (
            <img
              className="your-team-home-avatar me-avatar"
              src={team.teamAvatarUrl}
              alt=""
            />
          ) : (
            <span className="your-team-home-avatar your-team-home-avatar--empty me-avatar" aria-hidden="true" />
          )}
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

        <div className="your-team-home-assets">
          <div className="your-team-home-assets-header">
            <span className="your-team-home-assets-title">Top Assets</span>
            <div className="your-team-home-assets-toggle" role="group" aria-label="Top assets ranking">
              {ASSETS_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={`your-team-home-assets-toggle-btn${assetsMode === mode.id ? ' is-active' : ''}`}
                  aria-pressed={assetsMode === mode.id}
                  onClick={() => setAssetsMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          {topAssets.length === 0 ? (
            <div className="your-team-home-assets-empty">{emptyLabel}</div>
          ) : (
            <ul className="your-team-home-assets-grid">
              {topAssets.map((asset, idx) => (
                <li key={asset.playerId}>
                  <button
                    type="button"
                    className="your-team-home-asset-tile"
                    title={asset.name}
                    onClick={() => setSelectedPlayer(asset.fullInfo)}
                  >
                    <span className="your-team-home-asset-rank" aria-hidden="true">
                      {idx + 1}
                    </span>
                    <img
                      className="your-team-home-asset-photo"
                      src={getPlayerLogoUrl(asset.photo)}
                      alt=""
                    />
                    <span className="your-team-home-asset-name">{asset.name}</span>
                    <span className="your-team-home-asset-meta">
                      <PositionBadge position={asset.position} />
                      <span className="your-team-home-asset-value">
                        {assetsMode === 'points'
                          ? `${formatSeasonPoints(asset.value)} pts`
                          : assetsMode === 'ktc'
                            ? formatKtcValue(asset.value)
                            : (asset.displayRank
                              ? `${asset.displayRank.position}${asset.displayRank.rank}`
                              : '—')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <HomeCard className="your-team-home-card">
        <div className="home-card-inner">
          <div className="home-card-title-row">
            <h2 className="home-card-title login-home-card-title">
              <img src={SLEEPER_BOT} alt="" className="login-home-card-title-logo" aria-hidden="true" />
              Your Team
            </h2>
            {team?.rosterId ? (
              <Link className="active-playoffs-link" to={`/team/${team.rosterId}`}>
                Open your team →
              </Link>
            ) : null}
          </div>
          {body}
        </div>
      </HomeCard>
      {modal ? createPortal(modal, document.body) : null}
    </>
  );
}

export default YourTeamHomeCard;
