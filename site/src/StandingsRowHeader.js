import React from 'react';

function StandingsRowHeader({ isExpanded, onToggle, rankLabel, avatarUrl, teamName, rightContent }) {
  return (
    <button
      className="standings-row-header"
      type="button"
      onClick={onToggle}
    >
      <span className={`standings-toggle-icon${isExpanded ? ' standings-toggle-icon--open' : ''}`}>
        {isExpanded ? '▾' : '▸'}
      </span>
      <span className="standings-rank">{rankLabel}</span>
      {avatarUrl && (
        <img className="standings-avatar" src={avatarUrl} alt={`${teamName} avatar`} />
      )}
      <span className="standings-title">{teamName}</span>
      {rightContent}
    </button>
  );
}

export default StandingsRowHeader;


