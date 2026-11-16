/**
 * Week to simulate for matchup win%: the live NFL week if it is in the
 * matchup, otherwise the first remaining (future) week. Past-only
 * matchups return null.
 */
export function resolveMatchupWinProbWeek(weeks, currentWeek) {
  const list = (Array.isArray(weeks) ? weeks : [])
    .map(Number)
    .filter((w) => Number.isFinite(w));
  const current = Number(currentWeek);
  if (Number.isFinite(current) && list.some((w) => w === current)) {
    return current;
  }
  if (!Number.isFinite(current)) {
    return list.length ? list[0] : null;
  }
  const future = list.filter((w) => w > current).sort((a, b) => a - b);
  return future.length ? future[0] : null;
}

export function sumRange(totalsByWeek, startW, endW) {
  if (!totalsByWeek || startW > endW) {
    return 0;
  }
  let sum = 0;
  for (let w = startW; w <= endW; w += 1) {
    if (typeof totalsByWeek[w] === 'number' && Number.isFinite(totalsByWeek[w])) {
      sum += totalsByWeek[w];
    }
  }
  return sum;
}
