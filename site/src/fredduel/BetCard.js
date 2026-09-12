import React from 'react';
import { formatLine, formatMoney } from './oddsMath';
import { formatTimestamp } from './timeFmt';
import { MARKET_RESULT, settlementPayout } from './settlement';

function statusChip(bet) {
  if (bet.status === 'void') return <span className="fd-chip fd-chip-void">Void</span>;
  if (bet.status === 'settled') {
    return (
      <span className="fd-chip fd-chip-settled">
        {bet.result === 'taker' ? 'Backer won' : 'Layer won'}
      </span>
    );
  }
  return <span className="fd-chip fd-chip-live">Live</span>;
}

function resultCopy(bet, actor) {
  if (bet.status === 'void') return 'Push — stakes returned.';
  if (bet.status !== 'settled') return null;
  const iAmTaker = actor && bet.takerId === actor.id;
  const iAmLayer = actor && bet.creatorId === actor.id;
  const payout = settlementPayout(bet, bet.result);
  if (iAmTaker) {
    if (payout.takerDelta > 0) return `You won ${formatMoney(payout.takerDelta)}.`;
    if (payout.takerDelta < 0) return `You lost ${formatMoney(-payout.takerDelta)}.`;
  }
  if (iAmLayer) {
    if (payout.creatorDelta > 0) return `You won ${formatMoney(payout.creatorDelta)}.`;
    if (payout.creatorDelta < 0) return `You lost ${formatMoney(-payout.creatorDelta)}.`;
  }
  return bet.result === 'taker' ? 'Backer won.' : 'Layer won.';
}

/**
 * One bet ticket — live, settled, or void.
 * props: bet, actor, highlight, preview (resolveOffer result), onSettle
 */
function BetCard({ bet, actor, highlight = false, preview = null, onSettle = null }) {
  const iAmTaker = actor && bet.takerId === actor.id;
  const iAmLayer = actor && bet.creatorId === actor.id;
  const canSettle = Boolean(onSettle) && bet.status === 'live';
  const copy = resultCopy(bet, actor);

  return (
    <div
      id={`fd-bet-${bet.id}`}
      className={`fd-card fd-bet-card${highlight ? ' fd-bet-highlight' : ''}`}
    >
      <div className="fd-card-top">
        {statusChip(bet)}
        {(iAmTaker || iAmLayer) && <span className="fd-chip fd-chip-mine">Yours</span>}
        {bet.settledBy === 'auto' && <span className="fd-chip">Auto</span>}
        {bet.settledBy === 'manual' && <span className="fd-chip">Manual</span>}
        <span className="fd-spacer" />
        <span className="fd-muted fd-small">
          {bet.settledAt
            ? `settled ${formatTimestamp(bet.settledAt)}`
            : `accepted ${formatTimestamp(bet.createdAt)}`}
        </span>
      </div>

      <div className="fd-offer-title">{bet.offerTitle}</div>

      <div className="fd-bet-sides">
        <div className={`fd-bet-side${iAmTaker ? ' fd-bet-side-me' : ''}`}>
          <div className="fd-bet-role">Backer {formatLine(bet.line)}</div>
          <div className="fd-bet-who">{bet.takerName}</div>
          <div className="fd-small">
            risks <strong>{formatMoney(bet.takerStake)}</strong> to win{' '}
            <strong className="fd-pos">{formatMoney(bet.creatorRisk)}</strong>
          </div>
        </div>
        <div className="fd-bet-vs">vs</div>
        <div className={`fd-bet-side${iAmLayer ? ' fd-bet-side-me' : ''}`}>
          <div className="fd-bet-role">Layer {formatLine(-bet.line)}</div>
          <div className="fd-bet-who">{bet.creatorName}</div>
          <div className="fd-small">
            risks <strong>{formatMoney(bet.creatorRisk)}</strong> to win{' '}
            <strong className="fd-pos">{formatMoney(bet.takerStake)}</strong>
          </div>
        </div>
      </div>

      {copy && <div className="fd-settle-result">{copy}</div>}
      {bet.settlementNote && bet.status !== 'live' && (
        <div className="fd-muted fd-small">{bet.settlementNote}</div>
      )}
      {canSettle && preview?.status === MARKET_RESULT.PENDING && (
        <div className="fd-muted fd-small">{preview.detail || 'Waiting on the season.'}</div>
      )}
      {canSettle && preview?.status === MARKET_RESULT.MANUAL && (
        <div className="fd-muted fd-small">{preview.detail || 'Needs a manual grade.'}</div>
      )}

      {canSettle && (
        <div className="fd-settle-actions">
          <button type="button" className="fd-btn fd-btn-primary" onClick={() => onSettle('taker')}>
            Backer wins
          </button>
          <button type="button" className="fd-btn" onClick={() => onSettle('creator')}>
            Layer wins
          </button>
          <button type="button" className="fd-btn fd-btn-ghost" onClick={() => onSettle('push')}>
            Void
          </button>
        </div>
      )}

      <div className="fd-muted fd-small">Ticket #{bet.id} · from offer #{bet.offerId}</div>
    </div>
  );
}

export default BetCard;
