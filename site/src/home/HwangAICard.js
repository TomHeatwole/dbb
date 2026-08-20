import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import HomeCard from './HomeCard';

const LOGO = '/data/hwangai.png';

function HwangAICard() {
  const [input, setInput] = useState('');

  function handleInputChange(e) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
  }

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    window.open('/hwangai?q=' + encodeURIComponent(text), '_blank');
    setInput('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <HomeCard>
      <div className="home-card-inner">
        <div className="home-card-title-row">
          <h2 className="home-card-title hwang-ai-card-title">
            <img src={LOGO} alt="" className="hwang-ai-card-title-logo" aria-hidden="true" />
            HwangAI
          </h2>
          <Link className="active-playoffs-link" to="/hwangai">
            Open HwangAI →
          </Link>
        </div>
        <div className="hwang-ai-card-prompt">
          Ask me anything — trade values, league history, waiver pickups, dynasty strategy, NFL news, etc.
        </div>
        <div className="hwang-ai-card-input-row">
          <textarea
            className="hwang-ai-card-input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask HwangAI…"
            rows={1}
          />
          <button
            className="hwang-ai-card-send-btn"
            onClick={handleSend}
            disabled={!input.trim()}
            aria-label="Send message"
          >
            ↑
          </button>
        </div>
      </div>
    </HomeCard>
  );
}

export default HwangAICard;
