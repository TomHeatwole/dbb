import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CommissionerNoteCard from './CommissionerNoteCard';
import PodcastCard from './PodcastCard';
import {
  HOME_PINNED_LEFT_ID,
  HOME_PINNED_RIGHT_ID,
  balanceHomeColumns,
  movableIdsEqual,
  stripPinnedIds,
} from './balanceHomeColumns';

function cardSetKey(left, right) {
  return `${left.map((card) => card.id).join(',')}|${right.map((card) => card.id).join(',')}`;
}

function idsFromKey(key, side) {
  const part = (key.split('|')[side] || '');
  return part ? part.split(',') : [];
}

function ensureSlot(slots, id) {
  let slot = slots.get(id);
  if (!slot) {
    slot = document.createElement('div');
    slot.className = 'home-card-slot';
    slot.setAttribute('data-card-id', id);
    slots.set(id, slot);
  }
  return slot;
}

function syncSlots(column, ids, slots, beforeEl) {
  if (!column) return;
  ids.forEach((id) => {
    const slot = slots.get(id);
    if (!slot) return;
    if (slot.parentNode !== column || slot.nextSibling !== beforeEl) {
      column.insertBefore(slot, beforeEl);
    }
  });
}

function measureColumn(columnEl) {
  if (!columnEl) return [];
  return Array.from(columnEl.querySelectorAll(':scope > [data-card-id]')).map((el) => ({
    id: el.getAttribute('data-card-id'),
    height: el.offsetHeight,
    pinned: el.getAttribute('data-pinned') === 'true',
  }));
}

function checkSlotsPlaced(leftCol, rightCol, slots, movableIds) {
  if (!leftCol || !rightCol) return false;
  if (movableIds.length === 0) return true;
  return movableIds.every((id) => {
    const slot = slots.get(id);
    return slot && (slot.parentNode === leftCol || slot.parentNode === rightCol);
  });
}

function HomeCardsSplit({ left, right, onLayoutReady }) {
  const pinnedPodcast = useMemo(() => <PodcastCard />, []);
  const pinnedCommissionerNote = useMemo(() => <CommissionerNoteCard />, []);
  const preferredKey = cardSetKey(left, right);
  const [leftIds, setLeftIds] = useState(() => left.map((card) => card.id));
  const [rightIds, setRightIds] = useState(() => right.map((card) => card.id));

  const leftColRef = useRef(null);
  const rightColRef = useRef(null);
  const leftPinnedRef = useRef(null);
  const rightPinnedRef = useRef(null);
  const slotsRef = useRef(new Map());
  const assignmentRef = useRef({ leftIds, rightIds });
  const cardsRef = useRef([]);
  const layoutReadyRef = useRef(false);
  assignmentRef.current = { leftIds, rightIds };
  cardsRef.current = [...left, ...right];

  const notifyLayoutReady = useCallback(() => {
    if (layoutReadyRef.current) return;
    const leftCol = leftColRef.current;
    const rightCol = rightColRef.current;
    const movableIds = cardsRef.current.map((card) => card.id);
    if (!checkSlotsPlaced(leftCol, rightCol, slotsRef.current, movableIds)) return;
    layoutReadyRef.current = true;
    onLayoutReady?.();
  }, [onLayoutReady]);

  useEffect(() => {
    layoutReadyRef.current = false;
    const nextLeft = idsFromKey(preferredKey, 0);
    const nextRight = idsFromKey(preferredKey, 1);
    setLeftIds((prev) => (movableIdsEqual(prev, nextLeft) ? prev : nextLeft));
    setRightIds((prev) => (movableIdsEqual(prev, nextRight) ? prev : nextRight));
  }, [preferredKey]);

  useEffect(() => {
    const slots = slotsRef.current;
    const alive = new Set(cardsRef.current.map((card) => card.id));
    Array.from(slots.keys()).forEach((id) => {
      if (alive.has(id)) return;
      const slot = slots.get(id);
      if (slot) slot.remove();
      slots.delete(id);
    });
  }, [preferredKey]);

  useEffect(() => () => {
    slotsRef.current.forEach((slot) => slot.remove());
    slotsRef.current.clear();
  }, []);

  const applyBalance = useCallback((nextLeftIds, nextRightIds) => {
    const alive = new Set(cardsRef.current.map((card) => card.id));
    const assigned = new Set([...nextLeftIds, ...nextRightIds]);
    for (const id of alive) {
      if (!assigned.has(id)) return;
    }
    if (
      movableIdsEqual(nextLeftIds, assignmentRef.current.leftIds)
      && movableIdsEqual(nextRightIds, assignmentRef.current.rightIds)
    ) {
      return;
    }
    setLeftIds(nextLeftIds);
    setRightIds(nextRightIds);
  }, []);

  const syncSlotsToColumns = useCallback(() => {
    const leftCol = leftColRef.current;
    const rightCol = rightColRef.current;
    if (!leftCol || !rightCol) return;

    const slots = slotsRef.current;
    cardsRef.current.forEach((card) => ensureSlot(slots, card.id));
    syncSlots(leftCol, assignmentRef.current.leftIds, slots, leftPinnedRef.current);
    syncSlots(rightCol, assignmentRef.current.rightIds, slots, rightPinnedRef.current);
  }, []);

  const measureAndBalance = useCallback(() => {
    const leftCol = leftColRef.current;
    const rightCol = rightColRef.current;
    if (!leftCol || !rightCol) return;

    syncSlotsToColumns();
    const next = balanceHomeColumns(measureColumn(leftCol), measureColumn(rightCol));
    applyBalance(stripPinnedIds(next.leftIds), stripPinnedIds(next.rightIds));
  }, [applyBalance, syncSlotsToColumns]);

  // Card set changed — initial slot placement and balance.
  useLayoutEffect(() => {
    syncSlotsToColumns();
    measureAndBalance();
    notifyLayoutReady();
  }, [preferredKey, syncSlotsToColumns, measureAndBalance, notifyLayoutReady]);

  // Column assignment changed — sync DOM only (no re-measure on parent re-renders).
  useLayoutEffect(() => {
    syncSlotsToColumns();
    notifyLayoutReady();
  }, [leftIds, rightIds, syncSlotsToColumns, notifyLayoutReady]);

  useEffect(() => {
    const leftCol = leftColRef.current;
    const rightCol = rightColRef.current;
    if (!leftCol || !rightCol || typeof ResizeObserver === 'undefined') return undefined;

    let frame = 0;
    let lastBalanceAt = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const now = Date.now();
        // Throttle rebalance while cards load in parallel to avoid layout thrash.
        if (now - lastBalanceAt < 120) return;
        lastBalanceAt = now;
        measureAndBalance();
      });
    });
    ro.observe(leftCol);
    ro.observe(rightCol);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [preferredKey, measureAndBalance]);

  return (
    <div className="home-cards-grid--split">
      <div ref={leftColRef} className="home-cards-column home-cards-column--left">
        <div
          ref={leftPinnedRef}
          className="home-card-slot"
          data-card-id={HOME_PINNED_LEFT_ID}
          data-pinned="true"
        >
          {pinnedPodcast}
        </div>
      </div>
      <div ref={rightColRef} className="home-cards-column home-cards-column--right">
        <div
          ref={rightPinnedRef}
          className="home-card-slot"
          data-card-id={HOME_PINNED_RIGHT_ID}
          data-pinned="true"
        >
          {pinnedCommissionerNote}
        </div>
      </div>
      {cardsRef.current.map((card) => {
        const slot = ensureSlot(slotsRef.current, card.id);
        return (
          <React.Fragment key={card.id}>
            {createPortal(card.node, slot)}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function splitPropsEqual(prev, next) {
  if (prev.left.length !== next.left.length || prev.right.length !== next.right.length) {
    return false;
  }
  for (let i = 0; i < prev.left.length; i += 1) {
    if (prev.left[i].id !== next.left[i].id || prev.left[i].node !== next.left[i].node) {
      return false;
    }
  }
  for (let i = 0; i < prev.right.length; i += 1) {
    if (prev.right[i].id !== next.right[i].id || prev.right[i].node !== next.right[i].node) {
      return false;
    }
  }
  return true;
}

export default React.memo(HomeCardsSplit, splitPropsEqual);
