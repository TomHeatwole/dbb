import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bettingHistoryHash,
  canonicalBettingHistory,
} from './fetch_fredduel_betting_history.mjs';

test('canonicalBettingHistory sorts rows by id', () => {
  const canonical = canonicalBettingHistory({
    offers: [{ id: 2 }, { id: 1 }],
    bets: [{ id: 9 }, { id: 3 }],
  });
  assert.deepEqual(canonical.offers.map((row) => row.id), [1, 2]);
  assert.deepEqual(canonical.bets.map((row) => row.id), [3, 9]);
});

test('bettingHistoryHash ignores row order', () => {
  const a = bettingHistoryHash({
    offers: [{ id: 1, status: 'open' }],
    bets: [{ id: 2, status: 'live' }],
  });
  const b = bettingHistoryHash({
    offers: [{ id: 1, status: 'open' }],
    bets: [{ id: 2, status: 'live' }],
  });
  const reordered = bettingHistoryHash({
    offers: [{ id: 1, status: 'open' }],
    bets: [{ id: 2, status: 'live' }],
  });
  assert.equal(a, b);
  assert.equal(a, reordered);
});

test('bettingHistoryHash changes when bet status changes', () => {
  const live = bettingHistoryHash({
    offers: [],
    bets: [{ id: 1, status: 'live', result: null }],
  });
  const settled = bettingHistoryHash({
    offers: [],
    bets: [{ id: 1, status: 'settled', result: 'taker' }],
  });
  assert.notEqual(live, settled);
});
