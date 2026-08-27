import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

const LOGO = '/data/hwangai.png';
const PROMPT_PATH = '/data/hwangai_scenario_editor_prompt.txt';
const PLACEHOLDER = 'Trade Chase for Bijan…';
const HANDOFF_MARKER = 'HANDOFF_HWANGAI';
const HANDOFF_DELAY_MS = 700;
const INTRO_MESSAGE = {
  role: 'assistant',
  content: 'You can describe roster changes here instead of manually entering them',
  intro: true,
};

function parseHandoffReply(reply) {
  const raw = String(reply || '');
  const hasMarker = raw.includes(HANDOFF_MARKER);
  const hasLink = /\/hwangai\b/i.test(raw);
  if (!hasMarker && !hasLink) return { text: raw.trim(), handoff: false };
  let text = raw.replace(/`?HANDOFF_HWANGAI`?/g, '');
  text = text.replace(/\[[^\]]*\]\(\s*\/hwangai[^)]*\)/gi, '');
  text = text.replace(/https?:\/\/[^\s)]*\/hwangai[^\s)]*/gi, '');
  text = text.replace(/\/hwangai(?:\?[^\s)]*)?/gi, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return {
    text: text || "That's not a roster move. Let me think on it properly…",
    handoff: true,
  };
}

function TypingDots() {
  return (
    <div className="hwang-ai-bubble hwang-ai-bubble--typing">
      <span className="hwang-ai-dot" />
      <span className="hwang-ai-dot" />
      <span className="hwang-ai-dot" />
    </div>
  );
}

function HandoffCard({ query }) {
  const href = `/hwangai?q=${encodeURIComponent(query || '')}`;
  return (
    <a
      className="scenario-hwang-ai-handoff"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      <img src={LOGO} alt="" className="scenario-hwang-ai-handoff-logo" />
      <span className="scenario-hwang-ai-handoff-label">Open response in HwangAI</span>
      <span className="scenario-hwang-ai-handoff-arrow" aria-hidden="true">→</span>
    </a>
  );
}

function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  if (message.handoff) {
    return (
      <div className="hwang-ai-message hwang-ai-message--ai">
        <img src={LOGO} alt="" className="hwang-ai-avatar" />
        <div className="hwang-ai-message-body">
          <HandoffCard query={message.query} />
        </div>
      </div>
    );
  }
  return (
    <div className={`hwang-ai-message ${isUser ? 'hwang-ai-message--user' : 'hwang-ai-message--ai'}`}>
      {!isUser && (
        <img src={LOGO} alt="HwangAI" className="hwang-ai-avatar" />
      )}
      <div className="hwang-ai-message-body">
        <div className={`hwang-ai-bubble ${isUser ? 'hwang-ai-bubble--user' : 'hwang-ai-bubble--ai'}`}>
          {isUser ? message.content : (
            <ReactMarkdown>{message.content}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}

function buildIdentityBlock(identity) {
  if (!identity || identity.rosterId == null) return '';
  const lines = [
    '',
    '════════════════════════════════════════',
    'LOGGED-IN USER',
    '════════════════════════════════════════',
    'The site login identified the person currently chatting with you:',
  ];
  if (identity.teamName) lines.push(`- Team name: ${identity.teamName}`);
  if (identity.ownerName) lines.push(`- Owner / display name: ${identity.ownerName}`);
  lines.push(`- Roster ID: ${identity.rosterId}`);
  lines.push('', 'When they say "my team", use this team.');
  return lines.join('\n');
}

/**
 * Compact HwangAI chat for the scenario builder.
 * Sends the live roster snapshot with every turn so trades resolve against
 * the current scenario, not the original season rosters.
 */
function ScenarioHwangAIEditor({
  season,
  teamsForGrid,
  scenarioRosters,
  originalRosters,
  identity,
  onApplyEdits,
  promptSuffix,
}) {
  const [messages, setMessages] = useState([INTRO_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [basePrompt, setBasePrompt] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const requestGenRef = useRef(0);

  const snapshotRef = useRef({ season, teamsForGrid, scenarioRosters, originalRosters, identity });
  snapshotRef.current = { season, teamsForGrid, scenarioRosters, originalRosters, identity };

  useEffect(() => {
    fetch(PROMPT_PATH, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => setBasePrompt((text || '').trim()))
      .catch(() => {});
  }, []);

  useEffect(() => {
    requestGenRef.current += 1;
    setMessages([INTRO_MESSAGE]);
    setError(null);
    setInput('');
  }, [season]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const systemPrompt = useMemo(() => {
    if (!basePrompt) return '';
    const extra = (promptSuffix || '').trim();
    const withExtra = extra ? `${basePrompt}\n\n${extra}` : basePrompt;
    const block = buildIdentityBlock(identity);
    return block ? `${withExtra}\n${block}` : withExtra;
  }, [basePrompt, identity, promptSuffix]);

  const sendMessage = useCallback(async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading || !systemPrompt) return;

    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError(null);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    const snap = snapshotRef.current;
    const scenario = {
      season: snap.season,
      teams: (snap.teamsForGrid || []).map((t) => ({
        rosterId: t.rosterId,
        teamName: t.teamName,
        ownerName: t.ownerName || '',
      })),
      rosters: snap.scenarioRosters,
      originalRosters: snap.originalRosters,
    };
    const apiMessages = newMessages.filter((m) => !m.intro && !m.handoff);
    const gen = requestGenRef.current;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          systemPrompt,
          mode: 'scenario_editor',
          scenario,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.error('[HwangAI scenario editor] failed:', res.status, errBody);
        throw new Error(`Request failed: ${res.status}`);
      }
      const data = await res.json();
      if (gen !== requestGenRef.current) return;
      const { text: reply, handoff } = parseHandoffReply(
        data.message || "I blanked on that one — clanker moment. Hit me again.",
      );
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
      if (data.reset || (Array.isArray(data.scenarioEdits) && data.scenarioEdits.length > 0)) {
        onApplyEdits?.({
          edits: data.scenarioEdits || [],
          reset: Boolean(data.reset),
        });
      }
      if (handoff) {
        await new Promise((resolve) => { setTimeout(resolve, HANDOFF_DELAY_MS); });
        if (gen !== requestGenRef.current) return;
        setMessages((prev) => [...prev, { role: 'assistant', handoff: true, query: text }]);
      }
    } catch (err) {
      console.error('[HwangAI scenario editor] error:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, messages, systemPrompt, onApplyEdits]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInputChange(e) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 88)}px`;
  }

  return (
    <div className="scenario-hwang-ai">
      <div className="scenario-hwang-ai-heading">
        <img src={LOGO} alt="" className="scenario-hwang-ai-heading-logo" aria-hidden="true" />
        HwangAI
      </div>

      <div className="scenario-hwang-ai-messages">
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} />
        ))}
        {loading && (
          <div className="hwang-ai-message hwang-ai-message--ai">
            <img src={LOGO} alt="HwangAI" className="hwang-ai-avatar" />
            <TypingDots />
          </div>
        )}
        {error && <div className="hwang-ai-error">{error}</div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="hwang-ai-input-row">
        <textarea
          ref={inputRef}
          className="hwang-ai-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDER}
          rows={1}
          disabled={loading || !systemPrompt}
        />
        <button
          type="button"
          className="hwang-ai-send-btn"
          onClick={() => sendMessage()}
          disabled={!input.trim() || loading || !systemPrompt}
          aria-label="Send message"
        >
          ↑
        </button>
      </div>
    </div>
  );
}

export default ScenarioHwangAIEditor;
