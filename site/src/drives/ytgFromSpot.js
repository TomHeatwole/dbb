/**
 * ESPN spot text ("ND 33", "MISS 25") → yards-to-goal.
 * yardLine on the wire is a 0–50 hash-mark, not ytg.
 */

export function normAbbr(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function teamTokens(abbr, name) {
  const out = new Set();
  const a = normAbbr(abbr);
  if (a) out.add(a);
  const n = String(name ?? '').trim();
  if (!n) return [...out];
  out.add(normAbbr(n));
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    out.add(normAbbr(words.map((w) => w[0]).join('')));
  }
  const last = words[words.length - 1];
  if (last && last.length >= 2 && last.length <= 5) out.add(normAbbr(last));
  return [...out].filter(Boolean);
}

function hits(tok, tokens) {
  if (!tok) return false;
  return tokens.some((t) => {
    if (!t) return false;
    if (t === tok) return true;
    if ((t.startsWith(tok) || tok.startsWith(t)) && Math.min(t.length, tok.length) >= 2) {
      return true;
    }
    return false;
  });
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
  const tok = normAbbr(m[1]);
  const home = teamTokens(teams.homeAbbr, teams.home);
  const away = teamTokens(teams.awayAbbr, teams.away);
  const off = teams.possession === 'home' ? home : teams.possession === 'away' ? away : [];
  if (hits(tok, off)) return 100 - yl;
  if (hits(tok, home) || hits(tok, away)) return yl;
  return yl;
}
