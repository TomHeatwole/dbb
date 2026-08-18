import React, { useMemo, useState } from 'react';
import { defaultMix, generateQuestion, generateQuiz, getSpotCounts, shuffleItems } from '../poker/quiz';
import { PokerTable, HandGrid, ActionButtons } from './PreflopShared';
import PreflopResults from './PreflopResults';

const MIX_LABELS = {
  rfi: 'Open',
  vs_rfi: 'Against Open',
  vs_3bet: '3-Bet',
  vs_4bet: '4-Bet',
};

function MixSlider({ id, value, onChange, count }) {
  return (
    <label className="preflop-quiz-slider">
      <span className="preflop-quiz-slider-label">
        {MIX_LABELS[id]}
        <span className="preflop-quiz-slider-meta">{count} spots · {value}</span>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(e) => onChange(id, Number(e.target.value))}
      />
    </label>
  );
}

function QuestionCard({ question, showAnswer, guessed, onGuess }) {
  const correct = guessed && guessed === question.correctAction;

  return (
    <div className="preflop-quiz-question">
      <p className="preflop-quiz-prompt">{question.prompt}</p>
      <PokerTable
        myPos={question.myPos}
        villainPos={question.villainPos}
        pickMode="pick_hero"
        onClickSeat={() => {}}
        validVillainPositions={[]}
        interactive={false}
        holeCards={question.cards}
      />
      <ActionButtons
        chart={question.chart}
        actionLabels={question.actionLabels}
        actionColors={question.actionColors}
        disabled={Boolean(guessed)}
        selected={guessed}
        onPick={onGuess}
      />
      {showAnswer && guessed && (
        <div className={`preflop-quiz-feedback${correct ? ' preflop-quiz-feedback--ok' : ' preflop-quiz-feedback--bad'}`}>
          {correct ? 'Correct' : `Wrong. Chart says ${question.actionLabels[question.correctAction] || question.correctAction}.`}
        </div>
      )}
      {showAnswer && guessed && (
        <HandGrid
          grid={question.chart}
          actionColors={question.actionColors}
          actionLabels={question.actionLabels}
          highlightHand={question.hand}
          reachMask={question.reachMask}
        />
      )}
    </div>
  );
}

export default function PreflopQuiz({ onExit }) {
  const counts = useMemo(() => getSpotCounts(), []);
  const [mix, setMix] = useState(() => defaultMix());
  const [difficulty, setDifficulty] = useState(0);
  const [questionCount, setQuestionCount] = useState(20);
  const [continuous, setContinuous] = useState(false);
  const [immediate, setImmediate] = useState(true);
  const [phase, setPhase] = useState('setup');
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [guesses, setGuesses] = useState([]);
  const [recentKeys, setRecentKeys] = useState([]);
  const [missRetry, setMissRetry] = useState(false);

  const current = questions[index];
  const guessed = guesses[index] || '';
  const answeredCount = guesses.filter(Boolean).length;
  const correctCount = questions.reduce((sum, q, i) => (
    guesses[i] && guesses[i] === q.correctAction ? sum + 1 : sum
  ), 0);
  const missed = questions.filter((q, i) => guesses[i] && guesses[i] !== q.correctAction);

  const handleMix = (id, value) => {
    setMix(prev => ({ ...prev, [id]: value }));
  };

  const startQuiz = () => {
    if (continuous) {
      const first = generateQuestion(mix, difficulty / 100, []);
      setQuestions([first]);
      setRecentKeys([first.key]);
    } else {
      const count = Math.max(1, Math.min(500, Number(questionCount) || 1));
      const generated = generateQuiz(count, mix, difficulty / 100);
      setQuestions(generated);
      setRecentKeys(generated.map(q => q.key));
    }
    setIndex(0);
    setGuesses([]);
    setMissRetry(false);
    setPhase('play');
  };

  const goNext = () => {
    const finite = !continuous || missRetry;
    if (finite && index + 1 >= questions.length) {
      setPhase('results');
      return;
    }
    if (!finite && index + 1 >= questions.length) {
      const next = generateQuestion(mix, difficulty / 100, recentKeys.slice(-80));
      setQuestions(prev => [...prev, next]);
      setRecentKeys(prev => [...prev, next.key]);
    }
    setIndex(prev => prev + 1);
  };

  const handleGuess = (action) => {
    setGuesses(prev => {
      const next = [...prev];
      next[index] = action;
      return next;
    });
    const finite = !continuous || missRetry;
    if (!immediate && finite && index + 1 >= questions.length) {
      setPhase('results');
      return;
    }
    if (!immediate) {
      if (!finite && index + 1 >= questions.length) {
        const next = generateQuestion(mix, difficulty / 100, recentKeys.slice(-80));
        setQuestions(prev => [...prev, next]);
        setRecentKeys(prev => [...prev, next.key]);
      }
      setIndex(prev => prev + 1);
    }
  };

  const retryMisses = () => {
    if (missed.length === 0) return;
    setQuestions(shuffleItems(missed));
    setIndex(0);
    setGuesses([]);
    setMissRetry(true);
    setPhase('play');
  };

  const quizExport = {
    mix,
    difficulty,
    continuous,
    immediate,
    questionCount,
    sessionKind: 'quiz',
  };

  if (phase === 'setup') {
    return (
      <div className="preflop-quiz-setup">
        <div className="preflop-quiz-setup-head">
          <h2>Quiz mode</h2>
          <button className="preflop-quiz-link" onClick={onExit}>Back to charts</button>
        </div>

        <label className="preflop-quiz-slider">
          <span className="preflop-quiz-slider-label">
            Questions
            <span className="preflop-quiz-slider-meta">{continuous ? 'Continuous' : questionCount}</span>
          </span>
          <div className="preflop-quiz-count-row">
            <input
              className="preflop-quiz-count"
              type="number"
              min="1"
              max="500"
              disabled={continuous}
              value={questionCount}
              onChange={(e) => setQuestionCount(e.target.value)}
            />
            <label className="preflop-quiz-check">
              <input
                type="checkbox"
                checked={continuous}
                onChange={(e) => setContinuous(e.target.checked)}
              />
              Continuous
            </label>
          </div>
        </label>

        <div className="preflop-control-group">
          <label className="preflop-label">Mix</label>
          {Object.keys(MIX_LABELS).map(id => (
            <MixSlider
              key={id}
              id={id}
              value={mix[id]}
              count={counts[id]}
              onChange={handleMix}
            />
          ))}
        </div>

        <label className="preflop-quiz-slider">
          <span className="preflop-quiz-slider-label">
            Difficulty
            <span className="preflop-quiz-slider-meta">{difficulty === 0 ? 'Easy' : difficulty === 100 ? 'Hard' : `${difficulty}% hard`}</span>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={difficulty}
            onChange={(e) => setDifficulty(Number(e.target.value))}
          />
          <span className="preflop-quiz-help">Easy is uniform. Hard only uses hands on the chart borders.</span>
        </label>

        <div className="preflop-control-group">
          <label className="preflop-label">Scoring</label>
          <label className="preflop-quiz-check">
            <input
              type="radio"
              name="scoring"
              checked={immediate}
              onChange={() => setImmediate(true)}
            />
            Show the correct answer immediately
          </label>
          <label className="preflop-quiz-check">
            <input
              type="radio"
              name="scoring"
              checked={!immediate}
              onChange={() => setImmediate(false)}
            />
            Wait until the quiz is over
          </label>
        </div>

        <button className="preflop-quiz-start" onClick={startQuiz}>Start quiz</button>
      </div>
    );
  }

  if (phase === 'results') {
    return (
      <PreflopResults
        title="Quiz results"
        questions={questions}
        guesses={guesses}
        exportPayload={quizExport}
        exportName="preflop-quiz"
        onPlayAgain={startQuiz}
        onRetryMisses={retryMisses}
        onChangeSettings={() => setPhase('setup')}
        onExit={onExit}
      />
    );
  }

  const finite = !continuous || missRetry;
  const nextLabel = finite && index + 1 >= questions.length ? 'See results' : 'Next';

  return (
    <div className="preflop-quiz-play">
      <div className="preflop-quiz-play-bar">
        <div>
          <div className="preflop-quiz-progress">
            {finite ? `Question ${index + 1} / ${questions.length}` : `Question ${index + 1}`}
          </div>
          <div className="preflop-quiz-live-score">
            {answeredCount > 0 ? `${correctCount}/${answeredCount}` : 'Quiz'}
          </div>
        </div>
        <div className="preflop-quiz-result-actions">
          {immediate && (
            <button
              className="preflop-quiz-start preflop-quiz-next"
              onClick={goNext}
              disabled={!guessed}
            >
              {nextLabel}
            </button>
          )}
          {(continuous || immediate) && (
            <button className="preflop-quiz-link" onClick={() => setPhase('results')}>End quiz</button>
          )}
          <button className="preflop-quiz-link" onClick={() => setPhase('setup')}>Settings</button>
        </div>
      </div>

      {current && (
        <QuestionCard
          question={current}
          showAnswer={immediate}
          guessed={guessed}
          onGuess={handleGuess}
        />
      )}
    </div>
  );
}
