import React, { useEffect, useMemo, useState } from 'react';
import HomeCard from './HomeCard';

// Hardcoded kickoff time: September 4th at 8:15PM ET.
// For 2026, 8:15PM ET is 2026-09-05T00:15:00Z (EDT, UTC-4).
const TARGET_KICKOFF_TS_MS = Date.parse('2026-09-05T00:15:00Z');

function formatTwo(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) {
    return '00';
  }
  return String(Math.max(0, Math.floor(v))).padStart(2, '0');
}

function splitMs(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}

function Week1CountdownCard() {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, TARGET_KICKOFF_TS_MS - nowMs);
  const parts = useMemo(() => splitMs(remainingMs), [remainingMs]);
  const labelYear = useMemo(() => {
    try {
      const d = new Date(TARGET_KICKOFF_TS_MS);
      return d.getUTCFullYear();
    } catch (_) {
      return 2026;
    }
  }, []);

  const isDone = remainingMs <= 0;
  // If kickoff time has already passed, don't render the card at all.
  if (isDone) {
    return null;
  }
  const title = `⏱️ ${labelYear} Week 1 Countdown`;

  return (
    <HomeCard className="week1-countdown-card">
      <div className="home-card-inner">
        <h2 className="home-card-title">{title}</h2>
        <div className="home-card-body week1-countdown-body">
          <div className="week1-countdown-timer" role="timer" aria-label={`${title} timer`}>
            <div className="week1-countdown-seg">
              <div className="week1-countdown-val">{parts.days}</div>
              <div className="week1-countdown-label">Days</div>
            </div>
            <div className="week1-countdown-seg">
              <div className="week1-countdown-val">{formatTwo(parts.hours)}</div>
              <div className="week1-countdown-label">Hours</div>
            </div>
            <div className="week1-countdown-seg">
              <div className="week1-countdown-val">{formatTwo(parts.minutes)}</div>
              <div className="week1-countdown-label">Min</div>
            </div>
            <div className="week1-countdown-seg">
              <div className="week1-countdown-val">{formatTwo(parts.seconds)}</div>
              <div className="week1-countdown-label">Sec</div>
            </div>
          </div>
          <div className="week1-countdown-kickoff">
            Kickoff: Sep 4, {labelYear} • 8:15 PM ET
          </div>
        </div>
      </div>
    </HomeCard>
  );
}

export default Week1CountdownCard;


