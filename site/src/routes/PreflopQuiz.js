import React, { useMemo, useState } from 'react';
import { defaultMix, generateQuestion, generateQuiz, getSpotCounts } from '../poker/quiz';
import { PokerTable, HandGrid, HoleCards } from './PreflopShared';

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

function ActionButtons({ chart, actionLabels, actionColors, disabled, selected, onPick }) {
  const present = new Set();
  if (chart) {
    for (const row of chart) {
      for (const action of row) present.add(action);
    }
  }
  const unique = [];
  const seen = new Set();
  for (const key of Object.keys(actionLabels)) {
    if (!present.has(key)) continue;
    const label = actionLabels[key];
    if (seen.has(label)) continue;
    seen.add(label);
    unique.push(key);
  }

  return (
    <div className="preflop-quiz-actions">
      {unique.map(key => {
        const color = key === 'F' ? '#94a3b8' : (actionColors[key] || '#94a3b8');
        const picked = selected === key;
        return (
          <button
            key={key}
            className={`preflop-quiz-action${picked ? ' preflop-quiz-action--picked' : ''}`}
            style={{
              borderColor: color,
              color: picked ? '#0f172a' : color,
              background: picked ? color : 'transparent',
            }}
            disabled={disabled}
            onClick={() => onPick(key)}
          >
            {actionLabels[key]}
          </button>
        );
      })}
    </div>
  );
}

function QuestionCard({ question, index, total, showAnswer, guessed, onGuess }) {
  const correct = guessed && guessed === question.correctAction;

  return (
    <div className="preflop-quiz-question">
      <div className="preflop-quiz-progress">
        {total ? `Question ${index + 1} / ${total}` : `Question ${index + 1}`}
      </div>
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

  const current = questions[index];
  const guessed = guesses[index] || '';
  const answeredCount = guesses.filter(Boolean).length;
  const correctCount = questions.reduce((sum, q, i) => (
    guesses[i] && guesses[i] === q.correctAction ? sum + 1 : sum
  ), 0);

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
    setPhase('play');
  };

  const goNext = () => {
    if (!continuous && index + 1 >= questions.length) {
      setPhase('results');
      return;
    }
    if (continuous && index + 1 >= questions.length) {
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
    if (!immediate && !continuous && index + 1 >= questions.length) {
      setPhase('results');
      return;
    }
    if (!immediate) {
      if (continuous && index + 1 >= questions.length) {
        const next = generateQuestion(mix, difficulty / 100, recentKeys.slice(-80));
        setQuestions(prev => [...prev, next]);
        setRecentKeys(prev => [...prev, next.key]);
      }
      setIndex(prev => prev + 1);
    }
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
      <div className="preflop-quiz-results">
        <h2>Quiz results</h2>
        <p className="preflop-quiz-score">{correctCount} / {questions.length} correct</p>
        <div className="preflop-quiz-result-actions">
          <button className="preflop-quiz-start" onClick={startQuiz}>Play again</button>
          <button className="preflop-quiz-link" onClick={() => setPhase('setup')}>Change settings</button>
          <button className="preflop-quiz-link" onClick={onExit}>Back to charts</button>
        </div>
        {questions.map((q, i) => (
          <div key={q.key + i} className="preflop-quiz-review">
            <div className={`preflop-quiz-feedback${guesses[i] === q.correctAction ? ' preflop-quiz-feedback--ok' : ' preflop-quiz-feedback--bad'}`}>
              Q{i + 1}: you {q.actionLabels[guesses[i]] || guesses[i] || '—'} · chart {q.actionLabels[q.correctAction]}
            </div>
            <p className="preflop-quiz-prompt">{q.prompt}</p>
            <HoleCards cards={q.cards} size="md" />
            <HandGrid
              grid={q.chart}
              actionColors={q.actionColors}
              actionLabels={q.actionLabels}
              highlightHand={q.hand}
              reachMask={q.reachMask}
            />
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="preflop-quiz-play">
      <div className="preflop-quiz-setup-head">
        <div className="preflop-quiz-live-score">
          {answeredCount > 0 ? `${correctCount}/${answeredCount}` : 'Quiz'}
        </div>
        <div className="preflop-quiz-result-actions">
          {(continuous || immediate) && (
            <button className="preflop-quiz-link" onClick={() => setPhase('results')}>End quiz</button>
          )}
          <button className="preflop-quiz-link" onClick={() => setPhase('setup')}>Settings</button>
        </div>
      </div>

      {current && (
        <QuestionCard
          question={current}
          index={index}
          total={continuous ? 0 : questions.length}
          showAnswer={immediate}
          guessed={guessed}
          onGuess={handleGuess}
        />
      )}

      {immediate && guessed && (
        <button className="preflop-quiz-start" onClick={goNext}>
          {!continuous && index + 1 >= questions.length ? 'See results' : 'Next'}
        </button>
      )}
    </div>
  );
}
