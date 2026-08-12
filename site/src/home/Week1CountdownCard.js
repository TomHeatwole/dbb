import React, { useEffect, useMemo, useState } from 'react';
import HomeCard from './HomeCard';
import { CURRENT_YEAR, getWeek1KickoffMs, hasSeasonStarted } from '../utils/DateHelper';
import { SEASON_START_DAY } from '../utils/global_constants';

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

function formatKickoffLabel(tsMs) {
  if (!Number.isFinite(tsMs)) return '';
  try {
    const d = new Date(tsMs);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
    const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'America/New_York' });
    const day = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'America/New_York' });
    return `Kickoff: ${weekday} ${month} ${day}, ${CURRENT_YEAR} • 8:20 PM ET`;
  } catch (_) {
    return `Kickoff: ${SEASON_START_DAY}/${CURRENT_YEAR} • 8:20 PM ET`;
  }
}

function Week1CountdownCard() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const targetMs = useMemo(() => getWeek1KickoffMs(), []);
  const seasonStarted = hasSeasonStarted();

  useEffect(() => {
    if (seasonStarted || !Number.isFinite(targetMs)) return undefined;
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [seasonStarted, targetMs]);

  const remainingMs = Number.isFinite(targetMs) ? Math.max(0, targetMs - nowMs) : 0;
  const parts = useMemo(() => splitMs(remainingMs), [remainingMs]);

  // Season underway (SEASON_START_DAY / CURRENT_WEEK_OVERRIDE) → hide countdown
  if (seasonStarted || !Number.isFinite(targetMs) || remainingMs <= 0) {
    return null;
  }

  const title = `⏱️ ${CURRENT_YEAR} Week 1 Countdown`;

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
            {formatKickoffLabel(targetMs)}
          </div>
        </div>
      </div>
    </HomeCard>
  );
}

export default Week1CountdownCard;
