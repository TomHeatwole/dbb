import React from 'react';
import useIsMobile from '../hooks/useIsMobile';

const TEAM_NAME_ABBREV_THRESHOLD = 'Lord Pittsy Flacco Joedy'.length;

function abbreviateTeamNameIfTooLong(rawName) {
  if (typeof rawName !== 'string') {
    return rawName;
  }
  const name = rawName.trim();
  if (name.length < TEAM_NAME_ABBREV_THRESHOLD) {
    return name;
  }

  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    // Fallback: truncate a single long token.
    return name.length > TEAM_NAME_ABBREV_THRESHOLD
      ? `${name.slice(0, Math.max(0, TEAM_NAME_ABBREV_THRESHOLD - 1))}…`
      : name;
  }

  if (parts.length === 2) {
    const [first, last] = parts;
    const firstInitial = first ? `${first[0].toUpperCase()}.` : '';
    const abbreviated = `${firstInitial} ${last}`.trim();
    if (abbreviated.length < name.length) {
      return abbreviated;
    }
    return name.length > TEAM_NAME_ABBREV_THRESHOLD
      ? `${name.slice(0, Math.max(0, TEAM_NAME_ABBREV_THRESHOLD - 1))}…`
      : name;
  }

  const first = parts[0];
  const last = parts[parts.length - 1];
  const middle = parts.slice(1, -1).map((p) => {
    const token = String(p || '').trim();
    if (!token) {
      return '';
    }
    if (token === '&' || token.toLowerCase() === 'and') {
      return '&';
    }
    return `${token[0].toUpperCase()}.`;
  }).filter(Boolean);

  const abbreviated = [first, ...middle, last].join(' ').replace(/\s+/g, ' ').trim();
  if (abbreviated.length < name.length) {
    return abbreviated;
  }
  return name.length > TEAM_NAME_ABBREV_THRESHOLD
    ? `${name.slice(0, Math.max(0, TEAM_NAME_ABBREV_THRESHOLD - 1))}…`
    : name;
}

function StandingsRowHeader({ isExpanded, onToggle, rankLabel, avatarUrl, teamName, rightContent }) {
  const isMobile = useIsMobile();
  const displayTeamName = isMobile ? abbreviateTeamNameIfTooLong(teamName) : teamName;
  const titleText = typeof teamName === 'string' ? teamName : '';
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
      <span className="standings-title" title={titleText}>
        {displayTeamName}
      </span>
      {rightContent}
    </button>
  );
}

export default StandingsRowHeader;


