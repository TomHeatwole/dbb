import {
  HOME_PINNED_LEFT_ID,
  HOME_PINNED_RIGHT_ID,
  balanceHomeColumns,
  movableIdsEqual,
  stripPinnedIds,
} from './balanceHomeColumns';

const podcast = { id: HOME_PINNED_LEFT_ID, height: 300, pinned: true };
const note = { id: HOME_PINNED_RIGHT_ID, height: 200, pinned: true };

describe('balanceHomeColumns', () => {
  it('moves the card above the commissioner note left when the right tail hangs by more than that card', () => {
    const next = balanceHomeColumns(
      [podcast],
      [
        { id: 'recap', height: 220 },
        { id: 'hwang-ai', height: 160 },
        note,
      ]
    );

    expect(stripPinnedIds(next.leftIds)).toEqual(['hwang-ai']);
    expect(stripPinnedIds(next.rightIds)).toEqual(['recap']);
    expect(next.leftIds.at(-1)).toBe(HOME_PINNED_LEFT_ID);
    expect(next.rightIds.at(-1)).toBe(HOME_PINNED_RIGHT_ID);
  });

  it('does not move when the overhang is only one card or less', () => {
    const left = [
      { id: 'auth', height: 180 },
      podcast,
    ];
    const right = [
      { id: 'recap', height: 180 },
      { id: 'hwang-ai', height: 160 },
      note,
    ];
    // left=480, right=540, overhang=60 < hwang-ai 160
    const next = balanceHomeColumns(left, right);
    expect(stripPinnedIds(next.leftIds)).toEqual(['auth']);
    expect(stripPinnedIds(next.rightIds)).toEqual(['recap', 'hwang-ai']);
  });

  it('keeps an already-balanced assignment', () => {
    const next = balanceHomeColumns(
      [
        { id: 'auth', height: 200 },
        { id: 'trades', height: 180 },
        podcast,
      ],
      [
        { id: 'recap', height: 220 },
        { id: 'hwang-ai', height: 160 },
        note,
      ]
    );
    expect(stripPinnedIds(next.leftIds)).toEqual(['auth', 'trades']);
    expect(stripPinnedIds(next.rightIds)).toEqual(['recap', 'hwang-ai']);
  });

  it('can move several bottom cards from the long side', () => {
    const next = balanceHomeColumns(
      [podcast],
      [
        { id: 'a', height: 120 },
        { id: 'b', height: 120 },
        { id: 'c', height: 120 },
        { id: 'hwang-ai', height: 120 },
        note,
      ]
    );

    expect(next.leftIds.at(-1)).toBe(HOME_PINNED_LEFT_ID);
    expect(next.rightIds.at(-1)).toBe(HOME_PINNED_RIGHT_ID);
    expect(stripPinnedIds(next.leftIds).length).toBeGreaterThan(0);
    expect(stripPinnedIds(next.leftIds)).not.toContain('a');
    expect(Math.abs(
      300 + 120 * stripPinnedIds(next.leftIds).length
      - (200 + 120 * stripPinnedIds(next.rightIds).length)
    )).toBeLessThanOrEqual(120);
  });

  it('moves a left-bottom card onto the right, above the commissioner note', () => {
    const next = balanceHomeColumns(
      [
        { id: 'playoffs', height: 260 },
        { id: 'tank', height: 180 },
        podcast,
      ],
      [note]
    );

    expect(stripPinnedIds(next.leftIds)).toEqual(['playoffs']);
    expect(stripPinnedIds(next.rightIds)).toEqual(['tank']);
    expect(next.rightIds).toEqual(['tank', HOME_PINNED_RIGHT_ID]);
  });

  it('never moves pinned cards and skips zero-height placeholders', () => {
    const next = balanceHomeColumns(
      [
        { id: 'auth', height: 0 },
        { id: HOME_PINNED_LEFT_ID, height: 100, pinned: true },
      ],
      [
        { id: 'ghost', height: 0 },
        { id: 'hwang-ai', height: 150 },
        note,
      ]
    );

    expect(next.leftIds.at(-1)).toBe(HOME_PINNED_LEFT_ID);
    expect(next.rightIds.at(-1)).toBe(HOME_PINNED_RIGHT_ID);
    expect(next.leftIds).toContain('hwang-ai');
    expect(next.leftIds).toContain('auth');
    expect(next.rightIds).toContain('ghost');
    expect(next.rightIds).not.toContain('hwang-ai');
  });

  it('does not ping-pong when the leftover gap equals the moved card', () => {
    const next = balanceHomeColumns(
      [podcast],
      [
        { id: 'hwang-ai', height: 100 },
        note,
      ]
    );
    // left=300, right=300. Already even.
    expect(stripPinnedIds(next.leftIds)).toEqual([]);
    expect(stripPinnedIds(next.rightIds)).toEqual(['hwang-ai']);
  });
});

describe('movableIdsEqual', () => {
  it('compares order-sensitive id lists', () => {
    expect(movableIdsEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(movableIdsEqual(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});
