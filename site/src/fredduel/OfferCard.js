import React, { useMemo, useState } from 'react';
import {
  formatLine, formatMoney, formatPercent, impliedProbability,
  minStakeForOffer, maxStakeForOffer, takerWinAmount, roundCents,
} from './oddsMath';
import { formatCountdown, formatTimestamp, isExpiringSoon } from './timeFmt';

function kindLabel(offer) {
  if (offer.marketKind === 'weekly') {
    const wk = offer.market?.week;
    return wk ? `Week ${wk}` : 'Weekly';
  }
  if (offer.marketKind === 'custom') return 'Custom';
  return 'Season';
}

function StatusBadge({ status }) {
  if (status === 'open') return null;
  return <span className={`fd-badge fd-badge-${status}`}>{status}</span>;
}

// Inline expanding "take" panel: stake slider + input with live payout math.
function TakePanel({ offer, onTake, onClose }) {
  const min = minStakeForOffer(offer);
  const max = maxStakeForOffer(offer);
  const [stakeText, setStakeText] = useState(String(min));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const stake = Number(stakeText);
  const stakeValid = Number.isFinite(stake) && stake >= min && stake <= max;
  const win = stakeValid ? takerWinAmount(stake, offer.line) : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onTake(roundCents(stake));
    } catch (e) {
      setError(e.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    onClose();
  };

  return (
    <div className="fd-take-panel">
      <div className="fd-take-row">
        <span className="fd-take-label">Your stake</span>
        <input
          type="range"
          min={min}
          max={max}
          step={max - min > 50 ? 1 : 0.01}
          value={stakeValid ? stake : min}
          onChange={(e) => setStakeText(e.target.value)}
          className="fd-take-slider"
        />
        <div className="fd-money-input">
          <span>$</span>
          <input
            type="number"
            min={min}
            max={max}
            step="0.01"
            value={stakeText}
            onChange={(e) => setStakeText(e.target.value)}
          />
        </div>
      </div>
      <div className="fd-take-summary">
        {stakeValid ? (
          <>
            Stake <strong>{formatMoney(stake)}</strong> at {formatLine(offer.line)} to win{' '}
            <strong className="fd-pos">{formatMoney(win)}</strong>
            <span className="fd-muted"> · {offer.creatorName} risks {formatMoney(win)}</span>
          </>
        ) : (
          <span className="fd-muted">
            Enter between {formatMoney(min)} and {formatMoney(max)}
          </span>
        )}
      </div>
      {error && <div className="fd-error">{error}</div>}
      <div className="fd-take-actions">
        <button className="fd-btn fd-btn-primary" disabled={!stakeValid || busy} onClick={submit}>
          {busy ? 'Taking…' : `Take for ${stakeValid ? formatMoney(stake) : '—'}`}
        </button>
        <button className="fd-btn fd-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * One offer on the exchange.
 * props: offer, linkedBets (bets already taken on this offer), actor,
 *        now (ticking ms timestamp), onTake(stake), onCancel(),
 *        onViewBets(betId) — jump to a linked bet ticket
 */
function OfferCard({ offer, linkedBets = [], actor, now, onTake, onCancel, onViewBets }) {
  const [taking, setTaking] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  const isMine = actor && offer.creatorId === actor.id;
  const isOpen = offer.status === 'open';
  const msLeft = new Date(offer.expiresAt).getTime() - now;

  const filled = roundCents(offer.maxExposure - offer.remainingExposure);
  const filledPct = Math.min(100, Math.max(0, (filled / offer.maxExposure) * 100));
  const minStake = minStakeForOffer(offer);
  const maxStake = maxStakeForOffer(offer);
  const prob = useMemo(() => impliedProbability(offer.line), [offer.line]);

  const cancel = async () => {
    setCancelBusy(true);
    setCancelError(null);
    try {
      await onCancel();
    } catch (e) {
      setCancelError(e.message);
    }
    setCancelBusy(false);
  };

  return (
    <div className={`fd-card fd-offer-card${isOpen ? '' : ' fd-card-closed'}`}>
      <div className="fd-card-top">
        <span className="fd-chip">{kindLabel(offer)}</span>
        {isMine && <span className="fd-chip fd-chip-mine">Yours</span>}
        <StatusBadge status={offer.status} />
        <span className="fd-spacer" />
        {isOpen ? (
          <span className={`fd-countdown${isExpiringSoon(msLeft) ? ' fd-countdown-soon' : ''}`}>
            ⏳ {formatCountdown(msLeft)}
          </span>
        ) : (
          <span className="fd-muted fd-small">closed</span>
        )}
      </div>

      <div className="fd-offer-title">{offer.title}</div>
      {offer.description ? <div className="fd-offer-desc">{offer.description}</div> : null}

      <div className="fd-offer-meta">
        Offered by <strong>{offer.creatorName}</strong>
        <span className="fd-muted"> · created {formatTimestamp(offer.createdAt)}</span>
        <span className="fd-muted"> · expires {formatTimestamp(offer.expiresAt)}</span>
      </div>

      <div className="fd-offer-numbers">
        <div className="fd-line-block">
          <div className="fd-line-big">{formatLine(offer.line)}</div>
          <div className="fd-muted fd-small">{formatPercent(prob)} implied</div>
        </div>
        <div className="fd-exposure-block">
          <div className="fd-exposure-labels">
            <span>
              <strong>{formatMoney(offer.remainingExposure)}</strong>
              <span className="fd-muted"> of {formatMoney(offer.maxExposure)} exposure left</span>
            </span>
            {linkedBets.length > 0 && (
              <span className="fd-action-wrap">
                <button
                  type="button"
                  className="fd-action-note"
                  onClick={() => onViewBets && onViewBets(linkedBets[0].id)}
                >
                  🔥 {linkedBets.length} taker{linkedBets.length > 1 ? 's' : ''} · {formatMoney(filled)} matched
                </button>
                <span className="fd-tip-pop fd-action-pop">
                  {linkedBets.map((b) => (
                    <span key={b.id} className="fd-action-pop-row">
                      <strong>{b.takerName}</strong> took {formatMoney(b.takerStake)} to win{' '}
                      {formatMoney(b.creatorRisk)} · {formatTimestamp(b.createdAt)}
                    </span>
                  ))}
                  <span className="fd-action-pop-hint">Click to view the bet ticket</span>
                </span>
              </span>
            )}
          </div>
          <div className="fd-progress">
            <div className="fd-progress-fill" style={{ width: `${filledPct}%` }} />
          </div>
          {isOpen && (
            <div className="fd-muted fd-small">
              Take {formatMoney(minStake)}–{formatMoney(maxStake)}
              {offer.minTake > 1 ? ` (min ${formatMoney(offer.minTake)})` : ''}
            </div>
          )}
        </div>
      </div>

      {isOpen && !taking && (
        <div className="fd-card-actions">
          {!isMine && (
            <button className="fd-btn fd-btn-primary" onClick={() => setTaking(true)}>
              Take this bet
            </button>
          )}
          {isMine && (
            <button className="fd-btn fd-btn-danger" onClick={cancel} disabled={cancelBusy}>
              {cancelBusy ? 'Cancelling…' : 'Cancel offer'}
            </button>
          )}
        </div>
      )}
      {cancelError && <div className="fd-error">{cancelError}</div>}

      {isOpen && taking && (
        <TakePanel offer={offer} onTake={onTake} onClose={() => setTaking(false)} />
      )}
    </div>
  );
}

export default OfferCard;
