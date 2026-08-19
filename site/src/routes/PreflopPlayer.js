import React, { useState } from 'react';
import { continueHand, generateHand, shuffleItems, streetOverReason } from '../poker/quiz';
import { PokerTable, HandGrid, ActionButtons } from './PreflopShared';
import PreflopResults from './PreflopResults';

function deal() {
  const first = generateHand();
  return {
    streets: [first],
    index: 0,
  };
}

export default function PreflopPlayer({ onExit }) {
  const [phase, setPhase] = useState('play');
  const [hand, setHand] = useState(() => deal());
  const [handNumber, setHandNumber] = useState(1);
  const [guess, setGuess] = useState('');
  const [missedStreet, setMissedStreet] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [queued, setQueued] = useState(null);
  const [log, setLog] = useState([]);
  const [retrying, setRetrying] = useState(false);

  const street = hand.streets[hand.index];
  const nextStreet = queued;
  const handOver = resolved && !nextStreet;
  const correct = guess && guess === street.correctAction;
  const answeredCount = log.length;
  const correctCount = log.filter(entry => entry.guess === entry.q.correctAction).length;

  const resetStreet = (nextHand) => {
    setHand(nextHand);
    setGuess('');
    setMissedStreet(false);
    setResolved(false);
    setQueued(null);
  };

  const dealNext = () => {
    resetStreet(deal());
    setHandNumber(n => n + 1);
  };

  const startFresh = () => {
    setLog([]);
    setRetrying(false);
    setHandNumber(1);
    resetStreet(deal());
    setPhase('play');
  };

  const handleGuess = (action) => {
    if (resolved) return;
    if (!guess) {
      const note = retrying
        ? `Retry ${hand.index + 1}`
        : `Hand ${handNumber}, street ${hand.index + 1}`;
      setLog(prev => [...prev, { q: { ...street, sessionNote: note }, guess: action }]);
    }
    setGuess(action);
    if (action === street.correctAction) {
      setResolved(true);
      setQueued(retrying ? null : continueHand(street));
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

  const endSession = () => {
    if (log.length === 0) return;
    setPhase('results');
  };

  const retryMisses = () => {
    const missed = log.filter(entry => entry.guess && entry.guess !== entry.q.correctAction).map(entry => entry.q);
    if (missed.length === 0) return;
    const shuffled = shuffleItems(missed);
    setLog([]);
    setRetrying(true);
    resetStreet({ streets: shuffled, index: 0 });
    setPhase('play');
  };

  const goRetryNext = () => {
    if (hand.index + 1 >= hand.streets.length) {
      setPhase('results');
      return;
    }
    setHand(prev => ({ ...prev, index: prev.index + 1 }));
    setGuess('');
    setMissedStreet(false);
    setResolved(false);
    setQueued(null);
  };

  if (phase === 'results') {
    return (
      <PreflopResults
        title="Hand player results"
        questions={log.map(entry => entry.q)}
        guesses={log.map(entry => entry.guess)}
        exportPayload={{ sessionKind: 'hands', continuous: true, immediate: true, questionCount: log.length }}
        exportName="preflop-hands"
        playAgainLabel="Keep dealing"
        onPlayAgain={startFresh}
        onRetryMisses={retryMisses}
        onExit={onExit}
      />
    );
  }

  const nextLabel = retrying
    ? (hand.index + 1 >= hand.streets.length ? 'See results' : 'Next')
    : (handOver ? 'Next hand' : 'Continue');
  const nextReady = retrying ? resolved : (resolved && (nextStreet || handOver));
  const onNext = retrying ? goRetryNext : (nextStreet ? goContinue : dealNext);

  return (
    <div className="preflop-quiz-play">
      <div className="preflop-quiz-play-bar">
        <div>
          <div className="preflop-quiz-progress">
            {retrying
              ? `Retry ${hand.index + 1} / ${hand.streets.length}`
              : `Hand ${handNumber} · street ${hand.index + 1}`}
          </div>
          <div className="preflop-quiz-live-score">
            {answeredCount > 0 ? `${correctCount}/${answeredCount}` : 'Hands'}
            {missedStreet ? ' · miss' : ''}
          </div>
        </div>
        <div className="preflop-quiz-result-actions">
          <button
            className="preflop-quiz-start preflop-quiz-next"
            onClick={onNext}
            disabled={!nextReady}
          >
            {nextLabel}
          </button>
          <button className="preflop-quiz-link" onClick={endSession} disabled={log.length === 0}>
            End session
          </button>
          {!retrying && (
            <button className="preflop-quiz-link" onClick={dealNext}>Deal</button>
          )}
          <button className="preflop-quiz-link" onClick={onExit}>Back to charts</button>
        </div>
      </div>

      <p className="preflop-quiz-help">
        {retrying
          ? 'Retrying misses as individual spots. First click counts.'
          : 'Same hand until you fold, call, or shove. First click on each street counts.'}
      </p>

      {!retrying && hand.streets.length > 1 && (
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
        hand={street.hand}
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
          {retrying || !nextStreet
            ? (retrying ? 'Correct' : streetOverReason(street))
            : `Correct. ${street.actionLabels[street.correctAction]}.`}
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
