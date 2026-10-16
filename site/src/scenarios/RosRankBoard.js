/**
 * Drag-reorder board for ROS Simulator positional ranks.
 * Reordering stays inside one position. The published FantasyPros rank
 * stays visible so a manual move is easy to see.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getPlayerInfo } from '../lookups/PlayerLookup';
import {
  ROS_POSITIONS,
  groupRosRows,
  rosOrderByPosition,
  rosOrdersEqual,
} from './rosRankOrder';

const POS_LABEL = {
  QB: 'Quarterbacks',
  RB: 'Running backs',
  WR: 'Wide receivers',
  TE: 'Tight ends',
};

function playerLabel(row, playersData, playerIdMap) {
  const info = getPlayerInfo(String(row.sleeperId), playersData, playerIdMap);
  return {
    name: info?.name || row.name || String(row.sleeperId),
    team: info?.team || row.team || '',
  };
}

function matchesQuery(name, query) {
  if (!query) return true;
  return name.toLowerCase().includes(query);
}

function PositionColumn({
  position,
  rows,
  publishedIds,
  query,
  active,
  playersData,
  playerIdMap,
  onMove,
  onReset,
}) {
  const listRef = useRef(null);
  const scrollDirRef = useRef(0);
  const draggingRef = useRef(false);
  const dragCleanupRef = useRef(null);
  const lastClientYRef = useRef(0);
  const indexFromPointRef = useRef(() => 0);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  useEffect(() => () => {
    if (dragCleanupRef.current) dragCleanupRef.current();
  }, []);

  const dirty = useMemo(() => {
    const current = rows.map((row) => String(row.sleeperId));
    if (current.length !== publishedIds.length) return true;
    return current.some((id, i) => id !== publishedIds[i]);
  }, [rows, publishedIds]);

  useEffect(() => {
    let frame = 0;
    function tick() {
      const list = listRef.current;
      const dir = scrollDirRef.current;
      if (draggingRef.current && list && dir) {
        list.scrollTop += dir * 16;
        setOverIndex(indexFromPointRef.current(lastClientYRef.current));
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  function indexFromPoint(clientY) {
    const list = listRef.current;
    if (!list) return 0;
    const items = [...list.querySelectorAll('[data-ros-index]')];
    if (items.length === 0) return 0;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return Number(items[i].dataset.rosIndex);
      }
    }
    return Number(items[items.length - 1].dataset.rosIndex) + 1;
  }
  indexFromPointRef.current = indexFromPoint;

  function updateScrollDir(clientY) {
    const list = listRef.current;
    if (!list) {
      scrollDirRef.current = 0;
      return;
    }
    const rect = list.getBoundingClientRect();
    const edge = 42;
    if (clientY < rect.top + edge) scrollDirRef.current = -1;
    else if (clientY > rect.bottom - edge) scrollDirRef.current = 1;
    else scrollDirRef.current = 0;
  }

  function startDrag(event, index) {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    draggingRef.current = true;
    setDragIndex(index);
    setOverIndex(index);
    document.body.classList.add('ros-rank-dragging');

    function move(ev) {
      if (ev.pointerId !== pointerId) return;
      ev.preventDefault();
      lastClientYRef.current = ev.clientY;
      updateScrollDir(ev.clientY);
      setOverIndex(indexFromPoint(ev.clientY));
    }

    let finished = false;
    function releaseListeners() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      draggingRef.current = false;
      scrollDirRef.current = 0;
      document.body.classList.remove('ros-rank-dragging');
      dragCleanupRef.current = null;
    }

    function end(ev) {
      if (finished || ev.pointerId !== pointerId) return;
      finished = true;
      const dest = indexFromPoint(ev.clientY);
      releaseListeners();
      setDragIndex(null);
      setOverIndex(null);
      onMove(position, index, dest);
    }

    dragCleanupRef.current = () => {
      if (finished) return;
      finished = true;
      releaseListeners();
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  const visible = rows
    .map((row, index) => ({ row, index, label: playerLabel(row, playersData, playerIdMap) }))
    .filter(({ label }) => matchesQuery(label.name, query));

  const dropActive = dragIndex != null
    && overIndex != null
    && overIndex !== dragIndex
    && overIndex !== dragIndex + 1;

  return (
    <section className={`ros-rank-col${active ? ' ros-rank-col--active' : ''}`}>
      <header className="ros-rank-col-head">
        <div>
          <div className="ros-rank-col-pos">{position}</div>
          <div className="ros-rank-col-sub">
            {query
              ? `${visible.length} of ${rows.length}`
              : `${rows.length} ${POS_LABEL[position].toLowerCase()}`}
          </div>
        </div>
        <button
          type="button"
          className="ros-rank-reset"
          onClick={() => onReset(position)}
          disabled={!dirty}
        >
          Reset
        </button>
      </header>
      <div className="ros-rank-list" ref={listRef}>
        {visible.length === 0 && (
          <div className="ros-rank-empty">No matches</div>
        )}
        {visible.map(({ row, index, label }) => {
          const moved = row.fpRank != null && row.fpRank !== row.posRank;
          const dragging = dragIndex === index;
          const dropBefore = dropActive && overIndex === index;
          return (
            <div
              key={row.sleeperId}
              data-ros-index={index}
              className={[
                'ros-rank-row',
                dragging ? 'ros-rank-row--dragging' : '',
                dropBefore ? 'ros-rank-row--drop' : '',
                moved ? 'ros-rank-row--moved' : '',
              ].filter(Boolean).join(' ')}
              onPointerDown={(event) => startDrag(event, index)}
              title={`Drag to change ${label.name}'s ${position} rank`}
            >
              <span className="ros-rank-grip" aria-hidden="true">
                <span />
              </span>
              <span className="ros-rank-num">{row.posRank}</span>
              <span className="ros-rank-name">{label.name}</span>
              {label.team ? <span className="ros-rank-team">{label.team}</span> : null}
              <span className="ros-rank-fp">{moved ? `FP ${row.fpRank}` : ''}</span>
            </div>
          );
        })}
        {dropActive && visible.length > 0 && overIndex === visible[visible.length - 1].index + 1 && (
          <div className="ros-rank-row ros-rank-row--drop ros-rank-row--end" />
        )}
      </div>
    </section>
  );
}

export default function RosRankBoard({
  open,
  rows,
  publishedRows,
  playersData,
  playerIdMap,
  onClose,
  onMove,
  onResetPosition,
  onResetAll,
}) {
  const [query, setQuery] = useState('');
  const [activePos, setActivePos] = useState('QB');
  const needle = query.trim().toLowerCase();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const grouped = useMemo(() => groupRosRows(rows), [rows]);
  const published = useMemo(() => rosOrderByPosition(publishedRows), [publishedRows]);
  const edited = !rosOrdersEqual(rosOrderByPosition(rows), published);

  useEffect(() => {
    if (!open) return undefined;
    document.body.classList.add('modal-open');
    function onKey(event) {
      if (event.key === 'Escape') onCloseRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('modal-open');
      document.body.classList.remove('ros-rank-dragging');
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="ros-rank-overlay" onMouseDown={onClose} role="presentation">
      <div
        className="ros-rank-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ros-rank-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ros-rank-head">
          <div className="ros-rank-head-copy">
            <h2 id="ros-rank-title">ROS rankings</h2>
            <p>
              Drag within a position. The number on the left is the rank the simulator uses.
              FP is the FantasyPros rank when you have moved that player.
            </p>
          </div>
          <div className="ros-rank-head-actions">
            <input
              className="ros-rank-search"
              type="search"
              value={query}
              placeholder="Find a player"
              aria-label="Find a player"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              type="button"
              className="ros-rank-reset"
              onClick={onResetAll}
              disabled={!edited}
            >
              Reset all
            </button>
            <button type="button" className="ros-rank-close" onClick={onClose} aria-label="Close rankings">
              ×
            </button>
          </div>
        </header>

        <div className="ros-rank-tabs" role="tablist" aria-label="Position">
          {ROS_POSITIONS.map((pos) => (
            <button
              key={pos}
              type="button"
              role="tab"
              aria-selected={activePos === pos}
              className={`ros-rank-tab${activePos === pos ? ' ros-rank-tab--active' : ''}`}
              onClick={() => setActivePos(pos)}
            >
              {pos}
            </button>
          ))}
        </div>

        <div className="ros-rank-cols">
          {ROS_POSITIONS.map((pos) => (
            <PositionColumn
              key={pos}
              position={pos}
              rows={grouped[pos]}
              publishedIds={published[pos] || []}
              query={needle}
              active={activePos === pos}
              playersData={playersData}
              playerIdMap={playerIdMap}
              onMove={onMove}
              onReset={onResetPosition}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
