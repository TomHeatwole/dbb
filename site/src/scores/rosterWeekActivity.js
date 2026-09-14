/**
 * Count live / yet-to-play starters+bench from ESPN/Sleeper game labels.
 * unlabeled players are skipped so a missing map does not look "finished".
 */
export function rosterWeekActivity(weekBreakdown, playerGameLabels) {
  let live = 0;
  let yetToPlay = 0;
  let labeled = 0;
  const rows = [...(weekBreakdown?.starters || []), ...(weekBreakdown?.bench || [])];
  for (const p of rows) {
    const pid = p && p.id;
    if (pid == null || String(pid) === '0') continue;
    const labels = playerGameLabels || {};
    const label = labels[pid] || labels[String(pid)] || null;
    if (!label) continue;
    labeled += 1;
    if (label.live) {
      live += 1;
    } else if (label.text !== 'BYE' && !label.completed) {
      yetToPlay += 1;
    }
  }
  return {
    live,
    yetToPlay,
    labeled,
    allGamesFinished: labeled > 0 && live === 0 && yetToPlay === 0,
  };
}
