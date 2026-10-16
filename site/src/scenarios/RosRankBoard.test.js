import { act } from 'react';
import { createRoot } from 'react-dom/client';
import RosRankBoard from './RosRankBoard';

jest.mock('../lookups/PlayerLookup', () => ({
  getPlayerInfo: (id) => ({ name: `Player ${id}`, team: 'BUF' }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

if (typeof PointerEvent === 'undefined') {
  global.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, props = {}) {
      super(type, props);
      this.pointerId = props.pointerId ?? 1;
    }
  };
}

function row(sleeperId, position, posRank) {
  return {
    sleeperId,
    name: `Player ${sleeperId}`,
    team: 'BUF',
    position,
    posRank,
    effRank: posRank,
    fpRank: posRank,
  };
}

const rows = [
  row('qb1', 'QB', 1),
  row('qb2', 'QB', 2),
  row('rb1', 'RB', 1),
  row('rb2', 'RB', 2),
];

describe('RosRankBoard', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('lists each position in rank order and reports a drag as a move', () => {
    const onMove = jest.fn();
    const root = createRoot(container);
    act(() => {
      root.render(
        <RosRankBoard
          open
          rows={rows}
          publishedRows={rows}
          playersData={{}}
          playerIdMap={{}}
          onClose={() => {}}
          onMove={onMove}
          onResetPosition={() => {}}
          onResetAll={() => {}}
        />,
      );
    });

    const qbColumn = [...container.querySelectorAll('.ros-rank-col')]
      .find((col) => col.querySelector('.ros-rank-col-pos')?.textContent === 'QB');
    const names = [...qbColumn.querySelectorAll('.ros-rank-name')].map((el) => el.textContent);
    expect(names).toEqual(['Player qb1', 'Player qb2']);

    const first = qbColumn.querySelector('[data-ros-index="0"]');
    const second = qbColumn.querySelector('[data-ros-index="1"]');
    const start = first.getBoundingClientRect();
    const end = second.getBoundingClientRect();

    act(() => {
      first.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        clientY: start.top + 4,
      }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        clientY: end.bottom + 4,
      }));
    });

    expect(onMove).toHaveBeenCalledWith('QB', 0, 2);
    act(() => root.unmount());
  });
});
