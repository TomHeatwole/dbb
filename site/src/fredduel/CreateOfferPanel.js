import React, { useMemo, useState } from 'react';
import {
  MARKET_KINDS, outcomesForKind, findOutcome, describeMarket, validateMarket,
  PLACE_LINES, describePlaceLine,
} from './markets';
import {
  parseLineInput, isValidLine, formatLine, formatMoney,
  impliedProbability, maxStakeForExposure, takerWinAmount,
  lineFromProbability, parsePercentInput,
} from './oddsMath';
import { toDatetimeLocalValue } from './timeFmt';
import { validateOfferInput } from './exchangeClient';

const EXPIRY_CHIPS = [
  { id: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
  { id: '6h', label: '6 hours', ms: 6 * 60 * 60 * 1000 },
  { id: '24h', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { id: '3d', label: '3 days', ms: 3 * 24 * 60 * 60 * 1000 },
  { id: '1w', label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
];

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`fd-chip-btn${active ? ' fd-chip-btn-active' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Interactive editor for a new offer.
 * props: teams [{rosterId, teamName, ownerName}], currentWeek (the upcoming
 * week — weekly bets are locked to it), onCreate(input), onClose
 */
function CreateOfferPanel({ teams, currentWeek = 1, onCreate, onClose }) {
  const [kind, setKind] = useState(MARKET_KINDS.SEASON);
  const [teamRosterId, setTeamRosterId] = useState(teams[0]?.rosterId ?? 1);
  const [opponentRosterId, setOpponentRosterId] = useState(teams[1]?.rosterId ?? 2);
  // Outcome selection is remembered per kind so toggling back keeps context.
  const [seasonOutcome, setSeasonOutcome] = useState('win_league');
  const [weeklyOutcome, setWeeklyOutcome] = useState('weekly_outscore');
  const [place, setPlace] = useState(3.5);
  const [points, setPoints] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [description, setDescription] = useState('');
  // Line and implied % are two views of the same number; editing either one
  // rewrites the other, so folks can think in whichever unit they prefer.
  const [lineText, setLineText] = useState('+100');
  const [pctText, setPctText] = useState('50');
  const [exposureText, setExposureText] = useState('200');
  const [minTakeText, setMinTakeText] = useState('1');
  const [expiryChoice, setExpiryChoice] = useState('24h');
  const [customExpiry, setCustomExpiry] = useState(toDatetimeLocalValue(Date.now() + 24 * 60 * 60 * 1000));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const isCustom = kind === MARKET_KINDS.CUSTOM;
  const outcomeId = kind === MARKET_KINDS.SEASON ? seasonOutcome : weeklyOutcome;
  const outcomeDef = findOutcome(kind, outcomeId);
  const team = teams.find((t) => Number(t.rosterId) === Number(teamRosterId));
  const opponent = teams.find((t) => Number(t.rosterId) === Number(opponentRosterId));

  // Picking your current opponent as the team swaps the two, so head-to-head
  // never ends up with the same team on both sides.
  const pickTeam = (rid) => {
    if (Number(rid) === Number(opponentRosterId)) setOpponentRosterId(Number(teamRosterId));
    setTeamRosterId(Number(rid));
  };

  const market = useMemo(() => {
    if (isCustom) return null;
    return {
      kind,
      teamRosterId: Number(teamRosterId),
      teamName: team?.teamName || `Team ${teamRosterId}`,
      outcome: outcomeId,
      ...(outcomeDef?.needs === 'place' ? { place: Number(place) } : {}),
      ...(outcomeDef?.needs === 'points' ? { points: Number(points) } : {}),
      ...(outcomeDef?.needs === 'opponent'
        ? {
            opponentRosterId: Number(opponentRosterId),
            opponentName: opponent?.teamName || `Team ${opponentRosterId}`,
          }
        : {}),
      // Weekly bets are always on the upcoming week.
      ...(kind === MARKET_KINDS.WEEKLY ? { week: Number(currentWeek) } : {}),
    };
  }, [
    isCustom, kind, teamRosterId, team, outcomeId, outcomeDef, place, points,
    opponentRosterId, opponent, currentWeek,
  ]);

  const title = isCustom ? customTitle.trim() : describeMarket(market);
  const line = parseLineInput(lineText);
  const lineOk = line != null && isValidLine(line);
  const pctOk = parsePercentInput(pctText) != null;
  const exposure = Number(exposureText);
  const exposureOk = Number.isFinite(exposure) && exposure >= 1;

  const onLineEdited = (text) => {
    setLineText(text);
    const parsed = parseLineInput(text);
    if (parsed != null && isValidLine(parsed)) {
      setPctText((impliedProbability(parsed) * 100).toFixed(1));
    }
  };

  const onPctEdited = (text) => {
    setPctText(text);
    const p = parsePercentInput(text);
    const equivalent = p != null ? lineFromProbability(p) : null;
    if (equivalent != null) {
      setLineText(formatLine(equivalent));
    }
  };

  const expiresAtMs = expiryChoice === 'custom'
    ? new Date(customExpiry).getTime()
    : Date.now() + (EXPIRY_CHIPS.find((c) => c.id === expiryChoice)?.ms || 0);

  // Live payout preview numbers
  const fullTakeStake = lineOk && exposureOk ? maxStakeForExposure(exposure, line) : null;
  const sampleStake = fullTakeStake != null ? Math.min(10, fullTakeStake) : null;
  const sampleWin = sampleStake != null && sampleStake > 0 ? takerWinAmount(sampleStake, line) : null;

  // Min take must fit inside the biggest stake the exposure can cover,
  // otherwise the offer can never be taken.
  const minTake = Number(minTakeText) || 1;
  const minTakeConflict = fullTakeStake != null && minTake > fullTakeStake;

  const submit = async () => {
    setError(null);
    const marketError = isCustom
      ? (customTitle.trim() ? null : 'Give your bet a title.')
      : validateMarket(market);
    if (marketError) {
      setError(marketError);
      return;
    }
    const input = {
      marketKind: kind,
      market,
      title,
      // Description only applies to custom bets; drop any leftover text if
      // the user typed one in custom mode and then switched.
      description: isCustom ? description.trim() : '',
      line,
      maxExposure: exposure,
      minTake: Number(minTakeText) || 1,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    const inputError = validateOfferInput(input);
    if (inputError) {
      setError(inputError);
      return;
    }
    setBusy(true);
    try {
      await onCreate(input);
      onClose();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const placeOptions = outcomeDef?.needs === 'place' ? PLACE_LINES : [];

  return (
    <div className="fd-create-panel">
      <div className="fd-create-header">
        <h3>New offer</h3>
        <button className="fd-btn fd-btn-ghost" onClick={onClose}>✕ Close</button>
      </div>

      {/* Bet type */}
      <div className="fd-field">
        <label>Bet type</label>
        <div className="fd-segmented">
          {[
            { id: MARKET_KINDS.SEASON, label: 'Season-long' },
            { id: MARKET_KINDS.WEEKLY, label: 'Weekly' },
            { id: MARKET_KINDS.CUSTOM, label: 'Custom' },
          ].map((k) => (
            <button
              key={k.id}
              type="button"
              className={`fd-seg${kind === k.id ? ' fd-seg-active' : ''}`}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      {isCustom ? (
        <>
          <div className="fd-field">
            <label>Title</label>
            <input
              type="text"
              maxLength={200}
              placeholder="e.g. Mike and Mac to both miss the playoffs"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="fd-field-row">
            <div className="fd-field">
              <label>Team</label>
              <select value={teamRosterId} onChange={(e) => pickTeam(e.target.value)}>
                {teams.map((t) => (
                  <option key={t.rosterId} value={t.rosterId}>
                    {t.teamName}{t.ownerName ? ` (${t.ownerName})` : ''}
                  </option>
                ))}
              </select>
            </div>
            {kind === MARKET_KINDS.WEEKLY && (
              <div className="fd-field fd-field-narrow">
                <label>Week <span className="fd-muted">(upcoming only)</span></label>
                <div className="fd-static-value">Week {currentWeek}</div>
              </div>
            )}
          </div>

          <div className="fd-field-row">
            <div className="fd-field">
              <label>Outcome</label>
              <select
                value={outcomeId}
                onChange={(e) => (kind === MARKET_KINDS.SEASON
                  ? setSeasonOutcome(e.target.value)
                  : setWeeklyOutcome(e.target.value))}
              >
                {outcomesForKind(kind).map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            {outcomeDef?.needs === 'opponent' && (
              <div className="fd-field">
                <label>Versus</label>
                <select
                  value={opponentRosterId}
                  onChange={(e) => setOpponentRosterId(Number(e.target.value))}
                >
                  {teams
                    .filter((t) => Number(t.rosterId) !== Number(teamRosterId))
                    .map((t) => (
                      <option key={t.rosterId} value={t.rosterId}>
                        {t.teamName}{t.ownerName ? ` (${t.ownerName})` : ''}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {outcomeDef?.needs === 'place' && (
              <div className="fd-field fd-field-narrow">
                <label>Place line</label>
                <select value={place} onChange={(e) => setPlace(Number(e.target.value))}>
                  {placeOptions.map((p) => (
                    <option key={p} value={p}>
                      {p} ({describePlaceLine(p, outcomeDef.placeDirection)})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {outcomeDef?.needs === 'points' && (
              <div className="fd-field fd-field-narrow">
                <label>Points</label>
                <input
                  type="number"
                  min="1"
                  step="0.1"
                  placeholder="e.g. 1500"
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* Structured markets describe themselves; only custom bets need one */}
      {isCustom && (
        <div className="fd-field">
          <label>Description <span className="fd-muted">(optional, settlement rules encouraged)</span></label>
          <textarea
            rows={2}
            maxLength={2000}
            placeholder="How does this settle? Who judges?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      )}

      {/* Live title preview */}
      <div className={`fd-preview${title ? '' : ' fd-preview-empty'}`}>
        <span className="fd-preview-label">Offer preview</span>
        <span className="fd-preview-title">{title || 'Fill in the fields above…'}</span>
        {lineOk && <span className="fd-preview-line">{formatLine(line)}</span>}
      </div>

      {/* The numbers: odds (line ⇄ implied %), exposure, min take — one row */}
      <div className="fd-numbers-row">
        <div className="fd-numbers-field">
          <label>Odds <span className="fd-muted">(edit either side)</span></label>
          <div
            className={`fd-input-box fd-odds-box${
              (lineText && !lineOk) || (pctText && !pctOk) ? ' fd-input-bad' : ''
            }`}
          >
            <input
              type="text"
              className="fd-odds-line"
              value={lineText}
              onChange={(e) => onLineEdited(e.target.value)}
              placeholder="+100"
              aria-label="American line"
            />
            <span className="fd-odds-link" title="Line and implied win % are the same number — editing one updates the other">
              ⇄
            </span>
            <input
              type="text"
              className="fd-odds-pct"
              inputMode="decimal"
              value={pctText}
              onChange={(e) => onPctEdited(e.target.value)}
              placeholder="50"
              aria-label="Implied win percent"
            />
            <span className="fd-unit">%</span>
          </div>
        </div>
        <div className="fd-numbers-field">
          <label>Max exposure <span className="fd-muted">(most you're willing to lose)</span></label>
          <div className="fd-input-box">
            <span className="fd-unit">$</span>
            <input
              type="number"
              min="1"
              step="1"
              value={exposureText}
              onChange={(e) => setExposureText(e.target.value)}
            />
          </div>
        </div>
        <div className="fd-numbers-field">
          <label>Min take <span className="fd-muted">($1 floor)</span></label>
          <div className={`fd-input-box${minTakeConflict ? ' fd-input-bad' : ''}`}>
            <span className="fd-unit">$</span>
            <input
              type="number"
              min="1"
              step="1"
              value={minTakeText}
              onChange={(e) => setMinTakeText(e.target.value)}
            />
          </div>
        </div>
      </div>

      {minTakeConflict && (
        <div className="fd-error">
          Min take doesn't fit this offer: at {formatLine(line)}, a{' '}
          {formatMoney(exposure)} exposure covers at most a {formatMoney(fullTakeStake)} take.
          Lower the min take or raise your exposure.
        </div>
      )}

      {/* Payout math preview */}
      {lineOk && exposureOk && fullTakeStake > 0 && (
        <div className="fd-payout-preview">
          <div>
            You risk <strong>{formatMoney(exposure)}</strong>. Fully matched, takers stake{' '}
            <strong>{formatMoney(fullTakeStake)}</strong> total — you win that if you're right.
          </div>
          {sampleWin != null && (
            <div className="fd-muted fd-small">
              e.g. a taker staking {formatMoney(sampleStake)} at {formatLine(line)} wins {formatMoney(sampleWin)} of your exposure.
            </div>
          )}
        </div>
      )}

      {/* Expiry */}
      <div className="fd-field">
        <label>
          Offer expires in
          <span className="fd-tip">
            {' '}⚠️
            <span className="fd-tip-pop">
              When the countdown hits zero, the unfilled part of this offer is
              pulled from the market. Anything already matched stays live as a
              bet — expiry never voids action you've taken on.
            </span>
          </span>
        </label>
        <div className="fd-chips-row">
          {EXPIRY_CHIPS.map((c) => (
            <Chip key={c.id} active={expiryChoice === c.id} onClick={() => setExpiryChoice(c.id)}>
              {c.label}
            </Chip>
          ))}
          <Chip active={expiryChoice === 'custom'} onClick={() => setExpiryChoice('custom')}>
            Custom…
          </Chip>
          {expiryChoice === 'custom' && (
            <input
              type="datetime-local"
              value={customExpiry}
              onChange={(e) => setCustomExpiry(e.target.value)}
            />
          )}
        </div>
      </div>

      {error && <div className="fd-error">{error}</div>}

      <div className="fd-create-actions">
        <button className="fd-btn fd-btn-primary" onClick={submit} disabled={busy || minTakeConflict}>
          {busy ? 'Posting…' : 'Post offer'}
        </button>
        <button className="fd-btn fd-btn-ghost" onClick={onClose} disabled={busy}>Discard</button>
      </div>
    </div>
  );
}

export default CreateOfferPanel;
