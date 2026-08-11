/**
 * Shared trade display components used by both RecentTradesCard (home)
 * and TradesPage (full history).
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { buildTradeSides } from '../lookups/TransactionLookup';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import { getPlayerLogoUrl } from '../utils/playerLogo';
import { CURRENT_YEAR } from '../utils/DateHelper';
import PositionBadge from '../PositionBadge';
import { findMyRosterId, isMyRoster, useAuthUser } from '../hooks/useAuthUser';

// ─── Helpers ────────────────────────────────────────────────────────────────

export function filterAndSortTrades(raw) {
  return Array.isArray(raw)
    ? raw
        .filter((t) => t && t.type === 'trade' && t.status === 'complete')
        .sort((a, b) => (b.created || 0) - (a.created || 0))
    : [];
}

export function formatTradeDate(ts) {
  if (!ts) return '';
  return new Date(Number(ts)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a pick label.
 * When rosterIdToPickNum is provided (current year only), shows "2026 1.05".
 * Otherwise falls back to "2026 R1".
 */
export function formatPickLabel(pick, rosterIdToPickNum = {}) {
  const season = pick.season ? String(pick.season) : '?';
  const round = pick.round != null ? Number(pick.round) : null;

  // Only use exact slot numbers for the current draft year (standings are finalized)
  if (round != null && season === String(CURRENT_YEAR) && pick.roster_id != null && rosterIdToPickNum) {
    const pickNum = rosterIdToPickNum[String(pick.roster_id)];
    if (Number.isFinite(pickNum)) {
      return `${season} ${round}.${String(pickNum).padStart(2, '0')}`;
    }
  }

  if (round != null) {
    const ordinal = round === 1 ? '1st' : round === 2 ? '2nd' : round === 3 ? '3rd' : `${round}th`;
    return `${season} ${ordinal}`;
  }
  return `${season} Pick`;
}

// ─── TeamSide ────────────────────────────────────────────────────────────────

export function TeamSide({ rosterId, teamInfo, side, rosterIdToPickNum, players, idMap, onPlayerClick, myRosterId }) {
  const name = teamInfo?.teamName || `Team ${rosterId}`;
  const avatarUrl =
    teamInfo?.user?.team_avatar_url ||
    teamInfo?.user?.user_avatar_url ||
    teamInfo?.user?.avatar_url ||
    null;

  const assets = [];

  for (const playerId of (side?.playerIds || [])) {
    const info = getPlayerInfo(playerId, players, idMap);
    const playerName = info?.name || `Player ${playerId}`;
    const photo = info?.espn_photo_url || null;
    const pos = info?.position || '';
    const team = info?.team || info?.team_abbr || '';
    assets.push({ type: 'player', key: `p-${playerId}`, label: playerName, pos, team, photo, fullInfo: info });
  }

  for (let i = 0; i < (side?.picks || []).length; i++) {
    const label = formatPickLabel(side.picks[i], rosterIdToPickNum);
    assets.push({ type: 'pick', key: `pick-${i}`, label });
  }

  if (side?.faab > 0) {
    assets.push({ type: 'faab', key: 'faab', label: `$${side.faab} FAAB` });
  }

  const mine = isMyRoster(rosterId, myRosterId);

  return (
    <div className={`recent-trades-side${mine ? ' recent-trades-side--me' : ''}`}>
      <Link
        className="recent-trades-team-header"
        to={`/team/${rosterId}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {avatarUrl ? (
          <img className="recent-trades-team-avatar" src={avatarUrl} alt="" />
        ) : (
          <div className="recent-trades-team-avatar recent-trades-team-avatar--placeholder" />
        )}
        <span className="recent-trades-team-name">
          {name}
          {mine ? <span className="me-chip">YOU</span> : null}
        </span>
      </Link>

      {assets.length > 0 && (
        <>
          <div className="recent-trades-receives-label">Receives:</div>
          <div className="recent-trades-assets">
            {assets.map((asset) => {
              if (asset.type === 'player') {
                return (
                  <button
                    key={asset.key}
                    type="button"
                    className="recent-trades-asset recent-trades-asset--player"
                    onClick={() => onPlayerClick && onPlayerClick(asset.fullInfo)}
                  >
                    <img
                      className="recent-trades-player-photo"
                      src={getPlayerLogoUrl(asset.photo)}
                      alt=""
                    />
                    <div className="recent-trades-asset-text">
                      <span className="recent-trades-asset-name">{asset.label}</span>
                      <span className="recent-trades-asset-meta">
                        <PositionBadge position={asset.pos} />
                        {asset.team && <span style={{ marginLeft: '0.3rem' }}>{asset.team}</span>}
                      </span>
                    </div>
                  </button>
                );
              }
              return (
                <div key={asset.key} className="recent-trades-asset">
                  <div className="recent-trades-asset-text">
                    <span className="recent-trades-asset-name">{asset.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {assets.length === 0 && (
        <div className="recent-trades-assets">
          <div className="recent-trades-asset">
            <span className="recent-trades-none">—</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TradeItem ───────────────────────────────────────────────────────────────

export function TradeItem({ trade, rosterMap, rosterIdToPickNum, players, idMap, onPlayerClick }) {
  const { user: authUser } = useAuthUser();
  const sides = buildTradeSides(trade);
  const rosterIds = Object.keys(sides).map(Number).sort((a, b) => a - b);
  if (rosterIds.length < 2) return null;

  const [leftId, rightId] = rosterIds;
  const leftInfo = rosterMap[leftId] || rosterMap[String(leftId)] || null;
  const rightInfo = rosterMap[rightId] || rosterMap[String(rightId)] || null;

  const rosterList = rosterMap
    ? Object.values(rosterMap).map((info) => info?.roster).filter(Boolean)
    : [];
  const userList = rosterMap
    ? Object.values(rosterMap).map((info) => info?.user).filter(Boolean)
    : [];
  const myRosterId = findMyRosterId(rosterList, userList, authUser);

  return (
    <div className="recent-trades-item">
      <div className="recent-trades-date">{formatTradeDate(trade.created)}</div>
      <div className="recent-trades-body">
        <TeamSide
          rosterId={leftId}
          teamInfo={leftInfo}
          side={sides[leftId]}
          rosterIdToPickNum={rosterIdToPickNum}
          players={players}
          idMap={idMap}
          onPlayerClick={onPlayerClick}
          myRosterId={myRosterId}
        />
        <div className="recent-trades-divider" aria-hidden="true">⇄</div>
        <TeamSide
          rosterId={rightId}
          teamInfo={rightInfo}
          side={sides[rightId]}
          rosterIdToPickNum={rosterIdToPickNum}
          players={players}
          idMap={idMap}
          onPlayerClick={onPlayerClick}
          myRosterId={myRosterId}
        />
      </div>
    </div>
  );
}
