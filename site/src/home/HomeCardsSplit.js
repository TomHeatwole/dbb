import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

function HomeCardsSplit({ left, right }) {
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
  assignmentRef.current = { leftIds, rightIds };
  cardsRef.current = [...left, ...right];

  useEffect(() => {
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
    if (
      movableIdsEqual(nextLeftIds, assignmentRef.current.leftIds)
      && movableIdsEqual(nextRightIds, assignmentRef.current.rightIds)
    ) {
      return;
    }
    setLeftIds(nextLeftIds);
    setRightIds(nextRightIds);
  }, []);

  const placeAndBalance = useCallback(() => {
    const leftCol = leftColRef.current;
    const rightCol = rightColRef.current;
    if (!leftCol || !rightCol) return;

    const slots = slotsRef.current;
    const cards = cardsRef.current;
    cards.forEach((card) => ensureSlot(slots, card.id));
    syncSlots(leftCol, assignmentRef.current.leftIds, slots, leftPinnedRef.current);
    syncSlots(rightCol, assignmentRef.current.rightIds, slots, rightPinnedRef.current);

    const next = balanceHomeColumns(measureColumn(leftCol), measureColumn(rightCol));
    applyBalance(stripPinnedIds(next.leftIds), stripPinnedIds(next.rightIds));
  }, [applyBalance]);

  useLayoutEffect(() => {
    placeAndBalance();
  });

  useEffect(() => {
    const leftCol = leftColRef.current;
    const rightCol = rightColRef.current;
    if (!leftCol || !rightCol || typeof ResizeObserver === 'undefined') return undefined;

    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        placeAndBalance();
      });
    });
    ro.observe(leftCol);
    ro.observe(rightCol);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [preferredKey, placeAndBalance]);

  return (
    <div className="home-cards-grid--split">
      <div ref={leftColRef} className="home-cards-column home-cards-column--left">
        <div
          ref={leftPinnedRef}
          className="home-card-slot"
          data-card-id={HOME_PINNED_LEFT_ID}
          data-pinned="true"
        >
          <PodcastCard />
        </div>
      </div>
      <div ref={rightColRef} className="home-cards-column home-cards-column--right">
        <div
          ref={rightPinnedRef}
          className="home-card-slot"
          data-card-id={HOME_PINNED_RIGHT_ID}
          data-pinned="true"
        >
          <CommissionerNoteCard />
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

export default HomeCardsSplit;
