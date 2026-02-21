import React, { useState, useRef, useEffect } from 'react';
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

function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`hwang-ai-message ${isUser ? 'hwang-ai-message--user' : 'hwang-ai-message--ai'}`}>
      {!isUser && <div className="hwang-ai-sender">HwangAI</div>}
      <div className={`hwang-ai-bubble ${isUser ? 'hwang-ai-bubble--user' : 'hwang-ai-bubble--ai'}`}>
        {isUser ? message.content : <ReactMarkdown>{message.content}</ReactMarkdown>}
      </div>
      {isUser && <div className="hwang-ai-sender hwang-ai-sender--user">You</div>}
    </div>
  );
}

function HwangAIPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    fetch('/data/hwangai_system_prompt.txt')
      .then(r => r.text())
      .then(text => setSystemPrompt(text.trim()))
      .catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, systemPrompt }),
      });

      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

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
      <InfoPageWrapper title="HwangAI" >
        <div className="hwang-ai-root">
          <div className="hwang-ai-messages">
            {messages.length === 0 && !loading && (
              <div className="hwang-ai-empty">
                <div className="hwang-ai-empty-icon">🤖</div>
                <div className="hwang-ai-empty-text">
                  Ask me anything — trade values, start/sit, waiver pickups, dynasty strategy.
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <ChatMessage key={i} message={msg} />
            ))}
            {loading && (
              <div className="hwang-ai-message hwang-ai-message--ai">
                <div className="hwang-ai-sender">HwangAI</div>
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
              disabled={loading}
            />
            <button
              className="hwang-ai-send-btn"
              onClick={sendMessage}
              disabled={!input.trim() || loading}
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
