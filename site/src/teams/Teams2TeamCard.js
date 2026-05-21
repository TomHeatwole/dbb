import React from 'react';
import { Link } from 'react-router-dom';
import { getPlayerLogoUrl } from '../utils/playerLogo';

function Teams2TeamCard({
  rosterId,
  teamName,
  ownerName,
  avatarUrl,
  rank,
  totalPF,
  ppg,
  recentScores,
  topPlayers,
  season,
}) {
  // Trend: compare last 3 weeks average to prior 3 weeks average
  let trendDirection = null; // 'up', 'down', or null
  if (recentScores && recentScores.length >= 4) {
    const last3 = recentScores.slice(-3);
    const prior = recentScores.slice(-6, -3);
    if (prior.length >= 2) {
      const last3Avg = last3.reduce((s, v) => s + v, 0) / last3.length;
      const priorAvg = prior.reduce((s, v) => s + v, 0) / prior.length;
      const diff = last3Avg - priorAvg;
      if (diff > 3) trendDirection = 'up';
      else if (diff < -3) trendDirection = 'down';
    }
  }

  // Build sparkline from recent scores (SVG)
  const sparkline = recentScores && recentScores.length >= 2 ? (() => {
    const scores = recentScores.slice(-6);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min || 1;
    const w = 80;
    const h = 28;
    const pad = 2;
    const points = scores.map((v, i) => {
      const x = pad + (i / (scores.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    }).join(' ');
    return (
      <svg className="teams2-sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <polyline
          points={points}
          fill="none"
          stroke={trendDirection === 'up' ? '#4ade80' : trendDirection === 'down' ? '#f87171' : '#94a3b8'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  })() : null;

  const yearParam = season ? `?year=${season}` : '';

  return (
    <Link to={`/teams-2/${rosterId}${yearParam}`} className="teams2-card">
      <div className="teams2-card-top">
        <div className="teams2-card-rank">#{rank}</div>
        <div className="teams2-card-identity">
          {avatarUrl && (
            <img src={avatarUrl} alt="" className="teams2-card-avatar" />
          )}
          <div className="teams2-card-names">
            <span className="teams2-card-team-name">{teamName}</span>
            <span className="teams2-card-owner">{ownerName}</span>
          </div>
        </div>
        {sparkline && (
          <div className="teams2-card-trend">
            {sparkline}
            {trendDirection && (
              <span className={`teams2-trend-badge teams2-trend-badge--${trendDirection}`}>
                {trendDirection === 'up' ? '▲' : '▼'}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="teams2-card-stats">
        <div className="teams2-stat">
          <span className="teams2-stat-value">{Math.round(totalPF)}</span>
          <span className="teams2-stat-label">PF</span>
        </div>
        <div className="teams2-stat">
          <span className="teams2-stat-value">{ppg}</span>
          <span className="teams2-stat-label">PPG</span>
        </div>
      </div>
      {topPlayers && topPlayers.length > 0 && (
        <div className="teams2-card-players">
          {topPlayers.map((p, i) => (
            <div key={i} className="teams2-card-player">
              <img
                src={getPlayerLogoUrl(p.espn_photo_url)}
                alt=""
                className="teams2-card-player-img"
              />
              <span className="teams2-card-player-name">{p.name}</span>
              <span className={`teams2-pos-badge teams2-pos-${(p.position || '').toLowerCase()}`}>
                {p.position}
              </span>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}

export default Teams2TeamCard;
