import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedBook } from './bookCache.mjs';

test('coalesces in-flight calls', async () => {
  let runs = 0;
  const producer = () => new Promise((resolve) => {
    runs += 1;
    setTimeout(() => resolve({ games: [{ inPlay: true }], n: runs }), 40);
  });
  const [a, b] = await Promise.all([
    cachedBook('coalesce', producer, () => 8000),
    cachedBook('coalesce', producer, () => 8000),
  ]);
  assert.equal(runs, 1);
  assert.equal(a, b);
});

test('reuses a snapshot inside the poll window', async () => {
  let runs = 0;
  const producer = async () => ({ games: [], n: ++runs });
  const first = await cachedBook('reuse', producer, () => 5000);
  const second = await cachedBook('reuse', producer, () => 5000);
  assert.equal(runs, 1);
  assert.equal(second.n, first.n);
});

test('recomputes once the window measured from start has elapsed', async () => {
  let runs = 0;
  const producer = async () => ({ games: [], n: ++runs });
  await cachedBook('expire', producer, () => 30);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const second = await cachedBook('expire', producer, () => 30);
  assert.equal(second.n, 2);
});
