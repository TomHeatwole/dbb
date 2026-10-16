import {
  applyRosOrder,
  flattenRosRows,
  maxRanksFromRosRows,
  moveListItem,
  moveRosRow,
  rankMapFromRosRows,
  resetRosPosition,
  rosOrderByPosition,
  rosOrdersEqual,
  stampFpRanks,
} from './rosRankOrder';

function row(sleeperId, position, posRank, name) {
  return {
    sleeperId,
    name,
    position,
    posRank,
    effRank: posRank,
    adp: posRank,
    fpRank: posRank,
  };
}

const BOARD = [
  row('qb1', 'QB', 1, 'Allen'),
  row('qb2', 'QB', 2, 'Lamar'),
  row('rb1', 'RB', 1, 'CMC'),
  row('rb2', 'RB', 2, 'Barkley'),
  row('rb3', 'RB', 3, 'Henry'),
  row('rb4', 'RB', 4, 'Taylor'),
];

describe('moveListItem', () => {
  const list = ['A', 'B', 'C', 'D'];

  it('inserts before a later player without skipping an extra slot', () => {
    expect(moveListItem(list, 0, 2)).toEqual(['B', 'A', 'C', 'D']);
  });

  it('moves a player to the end', () => {
    expect(moveListItem(list, 0, 4)).toEqual(['B', 'C', 'D', 'A']);
  });

  it('moves a player up', () => {
    expect(moveListItem(list, 3, 1)).toEqual(['A', 'D', 'B', 'C']);
  });

  it('leaves the list alone when the drop is the same gap', () => {
    expect(moveListItem(list, 2, 2)).toBe(list);
    expect(moveListItem(list, 2, 3)).toBe(list);
  });
});

describe('moveRosRow', () => {
  it('reassigns positional ranks and keeps the FantasyPros rank', () => {
    const next = moveRosRow(BOARD, 'RB', 0, 3);
    const rbs = rosOrderByPosition(next).RB;
    expect(rbs).toEqual(['rb2', 'rb3', 'rb1', 'rb4']);
    const cmc = next.find((r) => r.sleeperId === 'rb1');
    expect(cmc.posRank).toBe(3);
    expect(cmc.effRank).toBe(3);
    expect(cmc.fpRank).toBe(1);
    expect(rosOrderByPosition(next).QB).toEqual(['qb1', 'qb2']);
  });

  it('returns the same rows when the drop does not change order', () => {
    expect(moveRosRow(BOARD, 'RB', 1, 2)).toBe(BOARD);
  });
});

describe('applyRosOrder', () => {
  it('restores a saved order and appends players the save does not mention', () => {
    const saved = { RB: ['rb4', 'rb1', 'missing'] };
    const next = applyRosOrder(BOARD, saved);
    expect(rosOrderByPosition(next).RB).toEqual(['rb4', 'rb1', 'rb2', 'rb3']);
    expect(next.find((r) => r.sleeperId === 'rb4').posRank).toBe(1);
    expect(next.find((r) => r.sleeperId === 'rb4').fpRank).toBe(4);
  });

  it('reset restores one position and leaves the others', () => {
    const moved = moveRosRow(moveRosRow(BOARD, 'RB', 0, 3), 'QB', 0, 2);
    const reset = resetRosPosition(moved, BOARD, 'RB');
    expect(rosOrderByPosition(reset).RB).toEqual(['rb1', 'rb2', 'rb3', 'rb4']);
    expect(rosOrderByPosition(reset).QB).toEqual(['qb2', 'qb1']);
  });

  it('treats identical orders as equal and ignores empty input', () => {
    expect(rosOrdersEqual(rosOrderByPosition(BOARD), rosOrderByPosition(stampFpRanks(BOARD)))).toBe(true);
    expect(rosOrdersEqual(null, null)).toBe(true);
    expect(applyRosOrder(BOARD, null).map((r) => r.sleeperId).sort())
      .toEqual(BOARD.map((r) => r.sleeperId).sort());
  });
});

describe('rank maps', () => {
  it('keys the simulator map by the reordered positional rank', () => {
    const next = flattenRosRows({
      QB: [row('qb1', 'QB', 9, 'Allen')],
      RB: [row('rb2', 'RB', 9, 'Barkley'), row('rb1', 'RB', 1, 'CMC')],
      WR: [],
      TE: [],
    });
    const map = rankMapFromRosRows(next);
    expect(map.rb2.posRank).toBe(1);
    expect(map.rb1.posRank).toBe(2);
    expect(map.rb1.effRank).toBe(2);
    expect(maxRanksFromRosRows(next).RB).toEqual({ maxPosRank: 2, maxEffRank: 2 });
  });
});
