import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { downloadText, fetchPreflopDiagnostics, formatQuizExport } from '../poker/quiz';
import { HandGrid, HoleCards } from './PreflopShared';

export default function PreflopResults({
  title = 'Quiz results',
  questions,
  guesses,
  exportPayload,
  exportName = 'preflop-quiz',
  onPlayAgain,
  playAgainLabel = 'Play again',
  onRetryMisses,
  onChangeSettings,
  onExit,
}) {
  const [reviewIncorrect, setReviewIncorrect] = useState(false);
  const [diagnostics, setDiagnostics] = useState({ status: 'idle', text: '', error: '' });

  const answeredCount = guesses.filter(Boolean).length;
  const correctCount = questions.reduce((sum, q, i) => (
    guesses[i] && guesses[i] === q.correctAction ? sum + 1 : sum
  ), 0);
  const missed = questions.filter((q, i) => guesses[i] && guesses[i] !== q.correctAction);
  const unansweredCount = questions.length - answeredCount;
  const reviewItems = reviewIncorrect
    ? questions.map((q, i) => ({ q, i })).filter(({ q, i }) => guesses[i] && guesses[i] !== q.correctAction)
    : questions.map((q, i) => ({ q, i })).filter(({ i }) => guesses[i] || answeredCount === questions.length);

  const payload = useMemo(() => ({
    questions,
    guesses,
    ...exportPayload,
  }), [questions, guesses, exportPayload]);

  const exportResults = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`${exportName}-${stamp}.txt`, formatQuizExport(payload));
  };

  const runDiagnostics = async () => {
    setDiagnostics({ status: 'loading', text: '', error: '' });
    try {
      const text = await fetchPreflopDiagnostics(payload);
      setDiagnostics({ status: 'done', text, error: '' });
    } catch (err) {
      setDiagnostics({
        status: 'error',
        text: '',
        error: err.message || 'Diagnostics failed.',
      });
    }
  };

  return (
    <div className="preflop-quiz-results">
      <h2>{title}</h2>
      <p className="preflop-quiz-score">
        {correctCount} / {answeredCount || questions.length} correct
      </p>
      <p className="preflop-quiz-help">
        {missed.length > 0 ? `${missed.length} miss${missed.length === 1 ? '' : 'es'}` : 'No misses'}
        {unansweredCount > 0 ? ` · ${unansweredCount} unanswered` : ''}
      </p>
      <div className="preflop-quiz-result-actions">
        <button className="preflop-quiz-start" onClick={onPlayAgain}>{playAgainLabel}</button>
        <button
          className="preflop-quiz-start preflop-quiz-start--secondary"
          onClick={onRetryMisses}
          disabled={missed.length === 0}
        >
          Retry misses
        </button>
        <button
          className="preflop-quiz-start"
          onClick={runDiagnostics}
          disabled={answeredCount === 0 || diagnostics.status === 'loading'}
        >
          {diagnostics.status === 'loading' ? 'Reading your leaks…' : 'See diagnostics'}
        </button>
        <button className="preflop-quiz-link" onClick={exportResults}>Export results</button>
        {onChangeSettings && (
          <button className="preflop-quiz-link" onClick={onChangeSettings}>Change settings</button>
        )}
        <button className="preflop-quiz-link" onClick={onExit}>Back to charts</button>
      </div>
      <label className="preflop-quiz-check">
        <input
          type="checkbox"
          checked={reviewIncorrect}
          onChange={(e) => setReviewIncorrect(e.target.checked)}
          disabled={missed.length === 0}
        />
        Review incorrect
      </label>
      {diagnostics.status === 'error' && (
        <p className="preflop-quiz-feedback preflop-quiz-feedback--bad">{diagnostics.error}</p>
      )}
      {diagnostics.status === 'done' && diagnostics.text && (
        <div className="preflop-diagnostics">
          <ReactMarkdown>{diagnostics.text}</ReactMarkdown>
        </div>
      )}
      {reviewIncorrect && reviewItems.length === 0 && (
        <p className="preflop-quiz-help">No misses to review.</p>
      )}
      {reviewItems.map(({ q, i }) => (
        <div key={q.key + i} className="preflop-quiz-review">
          <div className={`preflop-quiz-feedback${guesses[i] === q.correctAction ? ' preflop-quiz-feedback--ok' : guesses[i] ? ' preflop-quiz-feedback--bad' : ''}`}>
            Q{i + 1}: {guesses[i] ? `you ${q.actionLabels[guesses[i]] || guesses[i]}` : 'unanswered'} · chart {q.actionLabels[q.correctAction]}
          </div>
          {q.sessionNote && <p className="preflop-quiz-help">{q.sessionNote}</p>}
          <p className="preflop-quiz-prompt">{q.prompt}</p>
          <HoleCards cards={q.cards} hand={q.hand} size="md" />
          <HandGrid
            grid={q.chart}
            actionColors={q.actionColors}
            actionLabels={q.actionLabels}
            highlightHand={q.hand}
            reachMask={q.reachMask}
          />
        </div>
      ))}
    </div>
  );
}
