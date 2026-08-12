import React from 'react';
import { formatLine, formatMoney } from './oddsMath';
import { formatTimestamp } from './timeFmt';

/**
 * One live bet (an accepted offer, or a slice of one).
 * props: bet, actor, highlight (flash after jumping here from an offer card)
 */
function BetCard({ bet, actor, highlight = false }) {
  const iAmTaker = actor && bet.takerId === actor.id;
  const iAmLayer = actor && bet.creatorId === actor.id;

  return (
    <div
      id={`fd-bet-${bet.id}`}
      className={`fd-card fd-bet-card${highlight ? ' fd-bet-highlight' : ''}`}
    >
      <div className="fd-card-top">
        <span className="fd-chip fd-chip-live">Live</span>
        {(iAmTaker || iAmLayer) && <span className="fd-chip fd-chip-mine">Yours</span>}
        <span className="fd-spacer" />
        <span className="fd-muted fd-small">accepted {formatTimestamp(bet.createdAt)}</span>
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

      <div className="fd-muted fd-small">Ticket #{bet.id} · from offer #{bet.offerId}</div>
    </div>
  );
}

export default BetCard;
