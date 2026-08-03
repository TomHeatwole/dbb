import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import InfoPageWrapper from '../layout/InfoPageWrapper';
import PageMeta from '../PageMeta';

const OG_TITLE = 'HwangAI';
const OG_DESCRIPTION = 'Your dynasty fantasy football AI assistant';

function TypingDots() {
  return (
    <div className="hwang-ai-bubble hwang-ai-bubble--typing">
      <span className="hwang-ai-dot" />
      <span className="hwang-ai-dot" />
      <span className="hwang-ai-dot" />
    </div>
  );
}

const LOGO = '/data/hwangai.png';

function SearchingBubble() {
  return (
    <div className="hwang-ai-message hwang-ai-message--ai">
      <img src={LOGO} alt="HwangAI" className="hwang-ai-avatar" />
      <div className="hwang-ai-bubble hwang-ai-bubble--searching">
        <span className="hwang-ai-searching-globe">🌐</span>
        <span className="hwang-ai-searching-text">Searching the web…</span>
      </div>
    </div>
  );
}

function ChatMessage({ message }) {
  const isUser = message.role === 'user';

  if (message.searching) {
    return <SearchingBubble />;
  }

  return (
    <div className={`hwang-ai-message ${isUser ? 'hwang-ai-message--user' : 'hwang-ai-message--ai'}`}>
      {!isUser && (
        <img src={LOGO} alt="HwangAI" className="hwang-ai-avatar" />
      )}
      <div className="hwang-ai-message-body">
        <div className={`hwang-ai-bubble ${isUser ? 'hwang-ai-bubble--user' : message.searchFailed ? 'hwang-ai-bubble--search-failed' : 'hwang-ai-bubble--ai'}`}>
          {isUser ? message.content : <ReactMarkdown>{message.content}</ReactMarkdown>}
        </div>
        {message.grounded && (
          <div className="hwang-ai-web-badge">
            🌐 Searched the web
          </div>
        )}
      </div>
    </div>
  );
}

function HwangAIPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const pendingQueryRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) {
      pendingQueryRef.current = q.trim();
      window.history.replaceState({}, '', '/hwangai');
    }
  }, []);

  useEffect(() => {
    fetch('/data/hwangai_system_prompt.txt', { cache: 'no-store' })
      .then(r => r.text())
      .then(text => setSystemPrompt(text.trim()))
      .catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading || searching) return;

    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError(null);

    // Phase 1: main chat with league tools. Long-running operations (season
    // simulations etc.) return an interim "hang on" message plus a continuation
    // token — show the message, keep the typing indicator up, and call back.
    let phase1Data = null;
    try {
      let requestBody = { messages: newMessages, systemPrompt };
      for (let hop = 0; hop < 4; hop++) {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          console.error('[HwangAI] Phase 1 failed:', res.status, errBody);
          throw new Error(`Request failed: ${res.status}`);
        }
        const data = await res.json();
        phase1Data = data;
        if (!data.interim || !data.continuation) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: data.message || "I blanked on that one — clanker moment. Hit me again.",
          }]);
          break;
        }
        // Interim "hang on" message — skip if empty, keep typing dots up
        if (data.message) {
          setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
        }
        requestBody = { messages: newMessages, systemPrompt, continuation: data.continuation };
      }
    } catch (err) {
      console.error('[HwangAI] Phase 1 error:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }

    if (!phase1Data?.needsSearch) return;

    // Phase 2: web search — input stays blocked via `searching` state
    setSearching(true);
    setMessages(prev => [...prev, { role: 'assistant', searching: true }]);

    try {
      const searchRes = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });
      const searchData = searchRes.ok ? await searchRes.json() : null;
      if (searchData?.message) {
        setMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.searching) {
            updated[lastIdx] = {
              role: 'assistant',
              content: searchData.message,
              grounded: true,
              searchQueries: searchData.searchQueries || [],
            };
          }
          return updated;
        });
      } else {
        setMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.searching) {
            updated[lastIdx] = {
              role: 'assistant',
              content: "Web search came back empty. The clanker's internet privileges got revoked for a sec — try again.",
              searchFailed: true,
            };
          }
          return updated;
        });
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.searching) {
          updated[lastIdx] = {
            role: 'assistant',
            content: "Web search came back empty. The clanker's internet privileges got revoked for a sec — try again.",
            searchFailed: true,
          };
        }
        return updated;
      });
    } finally {
      setSearching(false);
      inputRef.current?.focus();
    }
  }, [input, loading, searching, messages, systemPrompt]);

  useEffect(() => {
    if (!systemPrompt || !pendingQueryRef.current) return;
    const text = pendingQueryRef.current;
    pendingQueryRef.current = null;
    sendMessage(text);
  }, [systemPrompt, sendMessage]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInputChange(e) {
    setInput(e.target.value);
    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  }

  return (
    <>
      <PageMeta title={OG_TITLE} description={OG_DESCRIPTION} />
      <InfoPageWrapper title={
        <span className="info-title-inline">
          <img src={LOGO} alt="" className="hwang-ai-title-logo" aria-hidden="true" />
          HwangAI
        </span>
      }>
        <div className="hwang-ai-root">
          <div className="hwang-ai-messages">
            {messages.length === 0 && !loading && (
              <div className="hwang-ai-empty">
                <img src={LOGO} alt="HwangAI" className="hwang-ai-empty-logo" />
                <div className="hwang-ai-empty-text">
                  Ask me anything — trade values, league history, waiver pickups, dynasty strategy, NFL news, etc.
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <ChatMessage key={i} message={msg} />
            ))}
            {loading && (
              <div className="hwang-ai-message hwang-ai-message--ai">
                <img src={LOGO} alt="HwangAI" className="hwang-ai-avatar" />
                <TypingDots />
              </div>
            )}
            {error && (
              <div className="hwang-ai-error">{error}</div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="hwang-ai-input-row">
            <textarea
              ref={inputRef}
              className="hwang-ai-input"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask HwangAI…"
              rows={1}
              disabled={loading || searching}
            />
            <button
              className="hwang-ai-send-btn"
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading || searching}
              aria-label="Send message"
            >
              ↑
            </button>
          </div>
        </div>
      </InfoPageWrapper>
    </>
  );
}

export default HwangAIPage;
