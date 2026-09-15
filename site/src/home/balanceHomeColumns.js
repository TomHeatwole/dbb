export const HOME_PINNED_LEFT_ID = 'podcast';
export const HOME_PINNED_RIGHT_ID = 'commissioner-note';

const DEFAULT_MAX_MOVES = 24;

function columnHeight(cards) {
  return cards.reduce((sum, card) => sum + Math.max(0, Number(card.height) || 0), 0);
}

function findBestMoveIndex(tall, short) {
  const tallH = columnHeight(tall);
  const shortH = columnHeight(short);
  const currentGap = Math.abs(tallH - shortH);
  let bestIdx = -1;
  let bestGap = currentGap;

  for (let i = tall.length - 1; i >= 0; i -= 1) {
    const card = tall[i];
    if (card.pinned) continue;
    const height = Number(card.height) || 0;
    if (height <= 0) continue;

    const newGap = Math.abs(tallH - height - (shortH + height));
    if (newGap < bestGap) {
      bestGap = newGap;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function insertBeforePinned(cards, card) {
  let insertAt = cards.length;
  while (insertAt > 0 && cards[insertAt - 1].pinned) {
    insertAt -= 1;
  }
  cards.splice(insertAt, 0, card);
}

export function stripPinnedIds(ids) {
  return ids.filter((id) => id !== HOME_PINNED_LEFT_ID && id !== HOME_PINNED_RIGHT_ID);
}

export function movableIdsEqual(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Move unpinned cards from the taller column onto the shorter one until no
 * single move can reduce the height gap. Pinned cards stay last.
 */
export function balanceHomeColumns(left, right, options = {}) {
  const maxMoves = Number.isFinite(options.maxMoves) ? options.maxMoves : DEFAULT_MAX_MOVES;
  const nextLeft = left.map((card) => ({ ...card }));
  const nextRight = right.map((card) => ({ ...card }));

  for (let n = 0; n < maxMoves; n += 1) {
    const leftH = columnHeight(nextLeft);
    const rightH = columnHeight(nextRight);
    const diff = leftH - rightH;
    if (diff === 0) break;

    const tall = diff > 0 ? nextLeft : nextRight;
    const short = diff > 0 ? nextRight : nextLeft;
    const idx = findBestMoveIndex(tall, short);
    if (idx < 0) break;

    const card = tall[idx];
    tall.splice(idx, 1);
    insertBeforePinned(short, card);
  }

  return {
    leftIds: nextLeft.map((card) => card.id),
    rightIds: nextRight.map((card) => card.id),
  };
}
