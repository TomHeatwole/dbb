/**
 * ESPN spot text ("ND 33", "MISS 25") → yards-to-goal.
 * yardLine on the wire is a 0–50 hash-mark, not ytg.
 */

export function normAbbr(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bst\b/g, 'state')
    .replace(/\s+/g, ' ')
    .trim();
}

function phraseScore(hay, needle) {
  const h = normName(hay);
  const n = normName(needle);
  if (!h || !n) return 0;
  if (h === n) return 1000 + n.length;
  const hw = h.split(' ').filter(Boolean);
  const nw = n.split(' ').filter(Boolean);
  if (!nw.length || nw.length > hw.length) return 0;
  for (let i = 0; i <= hw.length - nw.length; i += 1) {
    if (nw.every((w, j) => hw[i + j] === w)) return 100 + nw.length * 20 + n.length;
  }
  return 0;
}

function initialsOf(name) {
  const words = normName(name).split(' ').filter(Boolean);
  if (words.length < 2) return '';
  return words.map((w) => w[0]).join('').toUpperCase();
}

/** Exact abbr / full-name / initials. No prefix match (ORE must not hit ORST). */
function spotSideScore(spotName, name, abbr) {
  const tok = normAbbr(spotName);
  let best = 0;
  const a = normAbbr(abbr);
  if (tok && a && tok === a) best = Math.max(best, 2000 + tok.length);
  best = Math.max(best, phraseScore(spotName, name));
  const init = initialsOf(name);
  if (tok && init && tok === init) best = Math.max(best, 400 + tok.length);
  const n = normName(name);
  if (tok === 'PSU' && n.includes('portland state')) best = Math.max(best, 1500);
  return best;
}

export function ytgFromSpot(text, teams = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  if (raw === '50') return 50;
  const m = raw.match(/^(?:at\s+)?(.+?)\s+(\d{1,2})$/i);
  if (!m) return null;
  const yl = Number(m[2]);
  if (!Number.isFinite(yl) || yl < 0 || yl > 50) return null;
  if (yl === 50) return 50;
  if (yl === 0) return 99;
  const homeScore = spotSideScore(m[1], teams.home, teams.homeAbbr);
  const awayScore = spotSideScore(m[1], teams.away, teams.awayAbbr);
  const offScore = teams.possession === 'home'
    ? homeScore
    : teams.possession === 'away'
      ? awayScore
      : 0;
  const defScore = teams.possession === 'home'
    ? awayScore
    : teams.possession === 'away'
      ? homeScore
      : Math.max(homeScore, awayScore);
  if (offScore > defScore && offScore > 0) return 100 - yl;
  if (homeScore > 0 || awayScore > 0) return yl;
  return yl;
}
