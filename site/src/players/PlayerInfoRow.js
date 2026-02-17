import React from 'react';

function PlayerInfoRow({ label, value, className = '' }) {
  if (!value) return null;
  
  return (
    <div className={`player-info-row ${className}`}>
      <span className="player-info-label">{label}</span>
      <span className="player-info-value">{value}</span>
    </div>
  );
}

export default PlayerInfoRow;
