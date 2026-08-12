// Time display helpers for FredDuel cards.

export function formatCountdown(msLeft) {
  if (msLeft <= 0) return 'Expired';
  const s = Math.floor(msLeft / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${String(secs).padStart(2, '0')}s`;
  return `${secs}s`;
}

/** True when an open offer deserves the red "about to expire" treatment. */
export function isExpiringSoon(msLeft) {
  return msLeft > 0 && msLeft < 30 * 60 * 1000;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

export function formatTimestamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return DATE_FMT.format(d);
}

/** Local datetime-local input value for `Date.now() + ms`. */
export function toDatetimeLocalValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
