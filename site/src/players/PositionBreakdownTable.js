import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function ordinalPlace(n) {
  const place = Number(n);
  if (!Number.isFinite(place) || place < 1) return '—';
  const v = place % 100;
  const suffix = (v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[place % 10] || 'th');
  return `${place}${suffix}`;
}

function rankTone(rank, teamCount) {
  if (rank == null || teamCount < 2) return null;
  const midpoint = (teamCount + 1) / 2;
  if (rank < midpoint) return 'pos';
  if (rank > midpoint) return 'neg';
  return null;
}

function weekHasScoring(week) {
  if (!Array.isArray(week)) return false;
  return week.some((entry) => (
    entry && Array.isArray(entry.starters_points) && entry.starters_points.some((v) => Number(v) > 0)
  ));
}

function rankTeams(teamScoresMap) {
  const teams = Object.entries(teamScoresMap).map(([rid, scores]) => ({
    rosterId: Number(rid),
    avg: scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
  }));
  teams.sort((a, b) => b.avg - a.avg);
  let lastAvg = null;
  let lastRank = 0;
  teams.forEach((team, i) => {
    if (lastAvg === null || Math.abs(team.avg - lastAvg) > 1e-9) {
      lastRank = i + 1;
      lastAvg = team.avg;
    }
    team.rank = lastRank;
  });
  return teams;
}

function toneClass(tone) {
  if (tone === 'pos') return 'team-analytics-num--pos';
  if (tone === 'neg') return 'team-analytics-num--neg';
  return '';
}

const HoverInfoCell = React.memo(function HoverInfoCell({ value, tooltipContent, className, variant = 'default' }) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const openTimeout = useRef();
  const closeTimeout = useRef();
  const tooltipRef = useRef(null);
  const anchorRef = useRef(null);

  function open(rect) {
    clearTimeout(closeTimeout.current);
    anchorRef.current = rect;
    if (variant === 'ranklist') {
      setPos({ x: rect.right + 10, y: rect.top });
    } else {
      setPos({ x: rect.left + rect.width / 2, y: rect.top });
    }
    clearTimeout(openTimeout.current);
    openTimeout.current = setTimeout(() => setHovered(true), 50);
  }

  function scheduleClose() {
    clearTimeout(openTimeout.current);
    clearTimeout(closeTimeout.current);
    closeTimeout.current = setTimeout(() => setHovered(false), 120);
  }

  function handleMouseEnter(e) {
    open(e.currentTarget.getBoundingClientRect());
  }

  useLayoutEffect(() => {
    if (!hovered || !tooltipRef.current || !anchorRef.current) return;
    const anchor = anchorRef.current;
    const tip = tooltipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const gap = 10;
    let left;
    let top;
    if (variant === 'ranklist') {
      left = anchor.right + gap;
      if (left + tip.width > vw - margin) left = anchor.left - gap - tip.width;
      left = Math.max(margin, Math.min(left, vw - tip.width - margin));
      top = Math.max(margin, Math.min(anchor.top, vh - tip.height - margin));
    } else {
      left = anchor.left + anchor.width / 2;
      top = anchor.top - 48;
    }
    setPos((prev) => (
      Math.abs(prev.x - left) < 0.5 && Math.abs(prev.y - top) < 0.5
        ? prev
        : { x: left, y: top }
    ));
  }, [hovered, variant]);

  const tooltipStyle = variant === 'ranklist'
    ? { left: pos.x, top: pos.y }
    : { left: pos.x, top: pos.y - 48 };

  const tooltip = hovered && tooltipContent && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={tooltipRef}
        className={`pos-avg-tooltip-fixed pos-avg-tooltip-fadein${variant === 'ranklist' ? ' pos-avg-tooltip-fixed--ranklist' : ''}`}
        style={tooltipStyle}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseEnter={() => {
          clearTimeout(closeTimeout.current);
          setHovered(true);
        }}
        onMouseLeave={scheduleClose}
      >
        {tooltipContent}
      </div>,
      document.body,
    )
    : null;

  return (
    <td className="pos-avg-tooltip-relative">
      <div
        className="pos-avg-tooltip-hover-parent"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={scheduleClose}
        style={{ display: 'inline-block', width: '100%' }}
      >
        <span className={`pos-avg-tooltip-hover-area${className ? ` ${className}` : ''}`}>
          {value}
        </span>
      </div>
      {tooltip}
    </td>
  );
});

function RankListTooltip({
  teams,
  userRosterId,
  posLabel,
  userRank,
  getTeamName,
  getAvatarUrl,
  searchParams,
}) {
  const teamCount = teams.length;
  const qs = searchParams && searchParams.toString() ? `?${searchParams.toString()}` : '';
  return (
    <div className="pos-avg-rank-tooltip">
      <div className="pos-avg-rank-tooltip-head">
        {userRank != null
          ? `${ordinalPlace(userRank)} of ${teamCount} at ${posLabel}`
          : `${posLabel} by team`}
      </div>
      <ol className="pos-avg-rank-list">
        {teams.map((team) => {
          const isMe = Number(team.rosterId) === Number(userRosterId);
          const avatar = getAvatarUrl(team.rosterId);
          const inner = (
            <>
              <span className="pos-avg-rank-place">{team.rank}</span>
              {avatar ? (
                <img src={avatar} alt="" className="pos-avg-rank-avatar" />
              ) : (
                <span className="pos-avg-rank-avatar pos-avg-rank-avatar--empty" />
              )}
              <span className="pos-avg-rank-name">
                {getTeamName(team.rosterId)}
                {isMe ? ' · you' : ''}
              </span>
              <span className="pos-avg-rank-avg">{team.avg.toFixed(1)}</span>
            </>
          );
          return (
            <li
              key={team.rosterId}
              className={`pos-avg-rank-row${isMe ? ' pos-avg-rank-row--me' : ''}`}
            >
              {isMe ? (
                <div className="pos-avg-rank-row-inner">{inner}</div>
              ) : (
                <a
                  href={`/team/${team.rosterId}${qs}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pos-avg-rank-row-inner pos-avg-rank-row-link"
                >
                  {inner}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CeilingFloorTooltip({ rosterId, posLabel, avg, getTeamName, getAvatarUrl, searchParams }) {
  const avatar = getAvatarUrl(rosterId);
  const qs = searchParams && searchParams.toString() ? `?${searchParams.toString()}` : '';
  return (
    <a
      href={`/team/${rosterId}${qs}`}
      target="_blank"
      rel="noopener noreferrer"
      className="pos-avg-tooltip-link"
    >
      {avatar && (
        <img src={avatar} alt={getTeamName(rosterId)} className="owner-avatar pos-avg-tooltip-avatar" />
      )}
      <span className="pos-avg-tooltip-team-name">{getTeamName(rosterId)}</span>
      {posLabel} Avg: {avg.toFixed(1)}
      <br /><br />
      <span className="pos-avg-tooltip-analytics-link">See Team Analytics &rarr;</span>
    </a>
  );
}

export default function PositionBreakdownTable({
  weeksParsedData,
  rosterId,
  startWeek,
  endWeek,
  STARTER_POSITION_NAMES,
  rosters,
  users,
  searchParams,
  selectedPos,
  onSelectPosition,
}) {
  function getUser(rid) {
    if (!rosters || !users) return null;
    const roster = rosters.find(r => Number(r.roster_id) === Number(rid));
    if (!roster) return null;
    return users.find(u => String(u.user_id) === String(roster.owner_id)) || null;
  }

  function getTeamName(rid) {
    const user = getUser(rid);
    if (user && user.metadata && user.metadata.team_name) return user.metadata.team_name;
    if (user && user.display_name) return `Team ${user.display_name}`;
    return `Team ${rid}`;
  }

  function getAvatarUrl(rid) {
    const user = getUser(rid);
    if (!user) return null;
    return user.team_avatar_url || user.user_avatar_url || user.avatar_url || null;
  }

  return (
    <div className="team-analytics-card team-analytics-table-card">
      <div className="team-analytics-card-head">
        <h3 className="team-analytics-card-title">Positional averages</h3>
        <p className="team-analytics-card-sub">Place vs every other team at that slot. Hover rank to see the board</p>
      </div>
      <div className="team-analytics-table-scroll">
      <table className="team-analytics-table">
        <thead>
          <tr>
            <th>Position</th>
            <th>Team</th>
            <th>Rank</th>
            <th>Ceiling</th>
            <th>Floor</th>
          </tr>
        </thead>
        <tbody>
          {STARTER_POSITION_NAMES.map((posLabel, posIdx) => {
            const teamScoresMap = {};
            for (let weekIdx = 0; weekIdx < (endWeek - startWeek + 1); ++weekIdx) {
              const weekNum = startWeek + weekIdx;
              const week = Array.isArray(weeksParsedData) ? weeksParsedData[weekNum - 1] : null;
              if (!week || !weekHasScoring(week)) continue;
              week.forEach(entry => {
                if (!entry) { return; }
                const startersPoints = (entry && Array.isArray(entry.starters_points)) ? entry.starters_points : null;
                const value = (startersPoints && startersPoints.length > posIdx && startersPoints[posIdx] != null) ? startersPoints[posIdx] : null;
                if (value == null) { return; }
                const rid = entry.roster_id;
                if (!teamScoresMap[rid]) teamScoresMap[rid] = [];
                teamScoresMap[rid].push(value);
              });
            }
            const rankedTeams = rankTeams(teamScoresMap);
            const userTeam = rankedTeams.find(t => Number(t.rosterId) === Number(rosterId));
            const userAvg = userTeam ? userTeam.avg : 0;
            const userRank = userTeam ? userTeam.rank : null;
            const teamCount = rankedTeams.length;
            const tone = rankTone(userRank, teamCount);
            let leagueCeiling = 0, leagueCeilingRoster = null;
            let leagueMin = 0, leagueMinRoster = null;
            if (rankedTeams.length) {
              const maxObj = rankedTeams[0];
              const minObj = rankedTeams[rankedTeams.length - 1];
              leagueCeiling = maxObj.avg;
              leagueCeilingRoster = maxObj.rosterId;
              leagueMin = minObj.avg;
              leagueMinRoster = minObj.rosterId;
            }
            const rankTooltip = (
              <RankListTooltip
                teams={rankedTeams}
                userRosterId={rosterId}
                posLabel={posLabel}
                userRank={userRank}
                getTeamName={getTeamName}
                getAvatarUrl={getAvatarUrl}
                searchParams={searchParams}
              />
            );

            return (
              <tr
                key={posIdx}
                className={
                  'team-analytics-pos-row' +
                  (selectedPos === posIdx ? ' team-analytics-pos-row--selected' : '') +
                  (onSelectPosition ? ' team-analytics-pos-row--clickable' : '')
                }
                onClick={onSelectPosition ? () => onSelectPosition(posIdx) : undefined}
              >
                <td className="team-analytics-table-label">{posLabel}</td>
                <HoverInfoCell
                  value={userAvg.toFixed(1)}
                  className={toneClass(tone)}
                  variant="ranklist"
                  tooltipContent={rankTooltip}
                />
                <HoverInfoCell
                  value={userRank != null ? ordinalPlace(userRank) : '—'}
                  className={toneClass(tone)}
                  variant="ranklist"
                  tooltipContent={rankTooltip}
                />
                <HoverInfoCell
                  value={leagueCeiling.toFixed(1)}
                  tooltipContent={
                    leagueCeilingRoster != null ? (
                      <CeilingFloorTooltip
                        rosterId={leagueCeilingRoster}
                        posLabel={posLabel}
                        avg={leagueCeiling}
                        getTeamName={getTeamName}
                        getAvatarUrl={getAvatarUrl}
                        searchParams={searchParams}
                      />
                    ) : null
                  }
                />
                <HoverInfoCell
                  value={leagueMin.toFixed(1)}
                  tooltipContent={
                    leagueMinRoster != null ? (
                      <CeilingFloorTooltip
                        rosterId={leagueMinRoster}
                        posLabel={posLabel}
                        avg={leagueMin}
                        getTeamName={getTeamName}
                        getAvatarUrl={getAvatarUrl}
                        searchParams={searchParams}
                      />
                    ) : null
                  }
                />
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
