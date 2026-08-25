import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';
import LoadingState from '../LoadingState';
import PlayerWeeklyScores from '../players/PlayerWeeklyScores';
import PositionBadge from '../PositionBadge';
import { CURRENT_YEAR } from '../utils/DateHelper';
import { fetchTransactions } from '../lookups/TransactionLookup';
import { fetchTeamData, buildRosterIdToTeamInfoMap } from '../lookups/TeamLookup';
import { fetchPlayersData, fetchPlayerIdMap, getPlayerInfo } from '../lookups/PlayerLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import { formatTradeDate } from '../trades/TradeComponents';
import { useMyCurrentRosterId, isMyRoster } from '../hooks/useAuthUser';

/** Complete waivers from the most recent processing run (same status_updated). */
function filterLatestWaiverRun(raw) {
  const complete = Array.isArray(raw)
    ? raw.filter((t) => t && t.type === 'waiver' && t.status === 'complete' && t.status_updated)
    : [];
  if (complete.length === 0) return [];

  let latestTs = 0;
  for (const t of complete) {
    const ts = Number(t.status_updated) || 0;
    if (ts > latestTs) latestTs = ts;
  }

  return complete
    .filter((t) => Number(t.status_updated) === latestTs)
    .sort((a, b) => {
      const seqA = Number(a.settings?.seq);
      const seqB = Number(b.settings?.seq);
      if (Number.isFinite(seqA) && Number.isFinite(seqB) && seqA !== seqB) return seqA - seqB;
      return (Number(b.settings?.waiver_bid) || 0) - (Number(a.settings?.waiver_bid) || 0);
    });
}

function playerIdsFromMap(map) {
  return map && typeof map === 'object' ? Object.keys(map) : [];
}

function WaiverPlayerChip({ playerId, players, idMap, onPlayerClick, tone }) {
  const info = getPlayerInfo(playerId, players, idMap);
  const name = info?.name || `Player ${playerId}`;
  const photo = info?.espn_photo_url || null;
  const pos = info?.position || '';

  return (
    <button
      type="button"
      className={`recent-waivers-player recent-waivers-player--${tone}`}
      onClick={() => onPlayerClick && info && onPlayerClick(info)}
    >
      <span className="recent-waivers-tone" aria-hidden="true">
        {tone === 'add' ? '+' : '−'}
      </span>
      <img className="recent-trades-player-photo" src={getPlayerLogoUrl(photo)} alt="" />
      <span className="recent-trades-asset-name">{name}</span>
      {pos ? (
        <span className="recent-waivers-pos">
          <PositionBadge position={pos} />
        </span>
      ) : null}
    </button>
  );
}

function WaiverItem({ txn, rosterMap, players, idMap, onPlayerClick, myRosterId }) {
  const rosterId = Number((txn.roster_ids && txn.roster_ids[0]) || 0);
  const teamInfo = rosterMap[rosterId] || rosterMap[String(rosterId)] || null;
  const name = teamInfo?.teamName || `Team ${rosterId}`;
  const avatarUrl =
    teamInfo?.user?.team_avatar_url ||
    teamInfo?.user?.user_avatar_url ||
    teamInfo?.user?.avatar_url ||
    null;
  const mine = isMyRoster(rosterId, myRosterId);
  const adds = playerIdsFromMap(txn.adds);
  const drops = playerIdsFromMap(txn.drops);
  const bid = txn.settings?.waiver_bid;
  const bidLabel = Number.isFinite(Number(bid)) ? `$${Number(bid)}` : null;

  return (
    <div className={`recent-trades-item recent-waivers-item${mine ? ' recent-waivers-item--me' : ''}`}>
      <div className="recent-waivers-row">
        <Link
          className="recent-trades-team-header recent-waivers-team"
          to={`/team/${rosterId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {avatarUrl ? (
            <img className="recent-trades-team-avatar" src={avatarUrl} alt="" />
          ) : (
            <div className="recent-trades-team-avatar recent-trades-team-avatar--placeholder" />
          )}
          <span className={`recent-trades-team-name${mine ? ' recent-trades-team-name--me' : ''}`}>
            {name}
            {mine ? <span className="me-chip">YOU</span> : null}
          </span>
          {bidLabel ? <span className="recent-waivers-bid">{bidLabel}</span> : null}
        </Link>
        <div className="recent-waivers-moves">
          {adds.map((pid) => (
            <WaiverPlayerChip
              key={`add-${pid}`}
              playerId={pid}
              players={players}
              idMap={idMap}
              onPlayerClick={onPlayerClick}
              tone="add"
            />
          ))}
          {drops.map((pid) => (
            <WaiverPlayerChip
              key={`drop-${pid}`}
              playerId={pid}
              players={players}
              idMap={idMap}
              onPlayerClick={onPlayerClick}
              tone="drop"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RecentWaiversCard() {
  const myRosterId = useMyCurrentRosterId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [waivers, setWaivers] = useState([]);
  const [runDate, setRunDate] = useState('');
  const [rosterMap, setRosterMap] = useState({});
  const [players, setPlayers] = useState(null);
  const [idMap, setIdMap] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const loadIdRef = useRef(0);

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
    loadIdRef.current += 1;
    const currentLoadId = loadIdRef.current;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [allTransactions, currentTeamData, playersData, playerIdMap] = await Promise.all([
          fetchTransactions(1),
          fetchTeamData(CURRENT_YEAR),
          fetchPlayersData(CURRENT_YEAR),
          fetchPlayerIdMap(),
        ]);

        if (cancelled) return;

        const map =
          currentTeamData?.rosters && currentTeamData?.users
            ? buildRosterIdToTeamInfoMap(currentTeamData.rosters, currentTeamData.users)
            : {};

        const latestRun = filterLatestWaiverRun(allTransactions);

        if (currentLoadId === loadIdRef.current && !cancelled) {
          setRosterMap(map);
          setPlayers(playersData);
          setIdMap(playerIdMap);
          setTeamData(currentTeamData);
          setWaivers(latestRun);
          setRunDate(
            latestRun[0]?.status_updated
              ? formatTradeDate(latestRun[0].status_updated)
              : ''
          );
        }
      } catch (_) {
        if (!cancelled && currentLoadId === loadIdRef.current) {
          setError('Unable to load waivers right now.');
        }
      } finally {
        if (!cancelled && currentLoadId === loadIdRef.current) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

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
    body = <LoadingState label="Loading waivers…" ariaLabel="Loading Wednesday's Waiver" />;
  } else if (error) {
    body = <div className="recent-trades-status recent-trades-status--error">{error}</div>;
  } else if (waivers.length === 0) {
    body = <div className="recent-trades-status">No waiver moves yet.</div>;
  } else {
    body = (
      <div className="recent-trades-list">
        {waivers.map((txn) => (
          <WaiverItem
            key={txn.transaction_id}
            txn={txn}
            rosterMap={rosterMap}
            players={players}
            idMap={idMap}
            onPlayerClick={setSelectedPlayer}
            myRosterId={myRosterId}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <HomeCard className="recent-waivers-card">
        <div className="home-card-inner">
          <div className="home-card-title-row">
            <h2 className="home-card-title">📋 Wednesday&apos;s Waiver</h2>
            {runDate ? <span className="recent-waivers-header-date">{runDate}</span> : null}
          </div>
          <div className="home-card-body">{body}</div>
        </div>
      </HomeCard>
      {modal && createPortal(modal, document.body)}
    </>
  );
}

export default RecentWaiversCard;
