import React, { useState } from 'react';
import { continueHand, generateHand, isStreetTerminal, streetOverReason } from '../poker/quiz';
import { PokerTable, HandGrid, ActionButtons } from './PreflopShared';

function deal() {
  const first = generateHand();
  return {
    streets: [first],
    index: 0,
  };
}

export default function PreflopPlayer({ onExit }) {
  const [hand, setHand] = useState(() => deal());
  const [guess, setGuess] = useState('');
  const [missedStreet, setMissedStreet] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [queued, setQueued] = useState(null);

  const street = hand.streets[hand.index];
  const nextStreet = queued;
  const handOver = resolved && !nextStreet;
  const correct = guess && guess === street.correctAction;

  const dealNext = () => {
    setHand(deal());
    setGuess('');
    setMissedStreet(false);
    setResolved(false);
    setQueued(null);
  };

  const handleGuess = (action) => {
    if (resolved) return;
    setGuess(action);
    if (action === street.correctAction) {
      setResolved(true);
      setQueued(continueHand(street));
    } else {
      setMissedStreet(true);
    }
  };

  const goContinue = () => {
    if (!queued) return;
    setHand(prev => ({
      streets: [...prev.streets, queued],
      index: prev.index + 1,
    }));
    setGuess('');
    setMissedStreet(false);
    setResolved(false);
    setQueued(null);
  };

  return (
    <div className="preflop-quiz-play">
      <div className="preflop-quiz-play-bar">
        <div>
          <div className="preflop-quiz-progress">Hand player</div>
          <div className="preflop-quiz-live-score">
            Street {hand.index + 1}
            {missedStreet ? ' · miss' : ''}
          </div>
        </div>
        <div className="preflop-quiz-result-actions">
          {resolved && nextStreet && (
            <button className="preflop-quiz-start preflop-quiz-next" onClick={goContinue}>
              Continue
            </button>
          )}
          {handOver && (
            <button className="preflop-quiz-start preflop-quiz-next" onClick={dealNext}>
              Next hand
            </button>
          )}
          <button className="preflop-quiz-link" onClick={dealNext}>Deal</button>
          <button className="preflop-quiz-link" onClick={onExit}>Back to charts</button>
        </div>
      </div>

      <p className="preflop-quiz-help">Trial: same hand, more action until you fold, call, or shove.</p>

      {hand.streets.length > 1 && (
        <ol className="preflop-hand-log">
          {hand.streets.slice(0, -1).map((s, i) => (
            <li key={s.key + i}>
              {s.prompt} You {s.actionLabels[s.correctAction].toLowerCase()}.
            </li>
          ))}
        </ol>
      )}

      <p className="preflop-quiz-prompt">{street.prompt}</p>
      <PokerTable
        myPos={street.myPos}
        villainPos={street.villainPos}
        pickMode="pick_hero"
        onClickSeat={() => {}}
        validVillainPositions={[]}
        interactive={false}
        holeCards={street.cards}
      />
      <ActionButtons
        chart={street.chart}
        actionLabels={street.actionLabels}
        actionColors={street.actionColors}
        disabled={resolved}
        selected={guess}
        onPick={handleGuess}
      />

      {guess && !correct && (
        <div className="preflop-quiz-feedback preflop-quiz-feedback--bad">
          Wrong. Chart says {street.actionLabels[street.correctAction] || street.correctAction}. Pick the chart action to continue.
        </div>
      )}
      {correct && (
        <div className="preflop-quiz-feedback preflop-quiz-feedback--ok">
          {nextStreet
            ? `Correct. ${street.actionLabels[street.correctAction]}.`
            : streetOverReason(street)}
        </div>
      )}

      {(missedStreet || resolved) && (
        <HandGrid
          grid={street.chart}
          actionColors={street.actionColors}
          actionLabels={street.actionLabels}
          highlightHand={street.hand}
          reachMask={street.reachMask}
        />
      )}
    </div>
  );
}
