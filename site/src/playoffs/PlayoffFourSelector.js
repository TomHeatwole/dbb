import React, { useEffect, useState } from 'react';
import { isMyRoster } from '../hooks/useAuthUser';

function normalizeSelection(selectedIds) {
  const src = Array.isArray(selectedIds) ? selectedIds : [];
  const out = src.slice(0, 4).map((id) => (id == null ? null : Number(id)));
  while (out.length < 4) out.push(null);
  return out;
}

/**
 * Pick exactly four playoff teams (h2h-style cards).
 */
export default function PlayoffFourSelector({
  teams,
  selectedIds,
  onSelectionChange,
  myRosterId = null,
  maxTeams = 4,
}) {
  const [slots, setSlots] = useState(() => normalizeSelection(selectedIds));

  useEffect(() => {
    setSlots(normalizeSelection(selectedIds));
  }, [selectedIds]);

  const handleToggle = (rosterId) => {
    setSlots((prev) => {
      const next = [...prev];
      const rid = Number(rosterId);
      const existingIdx = prev.findIndex((id) => Number(id) === rid);
      if (existingIdx !== -1) {
        next[existingIdx] = null;
      } else {
        const openIdx = prev.findIndex((id) => id == null);
        if (openIdx === -1) return prev;
        next[openIdx] = rid;
      }
      if (onSelectionChange) {
        onSelectionChange(next.filter((id) => id != null));
      }
      return next;
    });
  };

  if (!teams || !teams.length) return null;

  const picked = slots.filter((id) => id != null);
  const selectionFull = picked.length >= maxTeams;

  return (
    <div className="pp-field-picker">
      <p className="pp-field-picker-hint">
        {selectionFull
          ? 'Unselect a team to change the field'
          : `Select ${maxTeams} teams for the playoff field (${picked.length}/${maxTeams})`}
      </p>
      <div className="pp-field-picker-list">
        {teams.map((team) => {
          const rid = Number(team.rosterId);
          const isSelected = slots.some((id) => Number(id) === rid);
          const isDisabled = selectionFull && !isSelected;
          const mine = isMyRoster(rid, myRosterId);
          return (
            <button
              key={rid}
              type="button"
              className={
                'h2h-web-card h2h-web-card--compact'
                + (isSelected ? ' h2h-web-card--selected-primary' : '')
                + (mine ? ' h2h-web-card--me' : '')
                + (isDisabled ? ' h2h-web-card--disabled' : '')
              }
              disabled={isDisabled}
              onClick={() => handleToggle(rid)}
            >
              {team.avatarUrl ? (
                <img className="standings-avatar h2h-web-avatar" src={team.avatarUrl} alt="" />
              ) : null}
              <span className="yoffs-bracket-name h2h-web-name">
                {team.teamName}
                {mine ? <span className="me-chip">YOU</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}