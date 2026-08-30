import { CURRENT_YEAR, SEASON_START_DAY } from './config.mjs';

// ─── Date / Week helpers ──────────────────────────────────────────────────────

export function getCurrentNFLWeek(season = null) {
  const now = new Date();
  const year = Number(season || CURRENT_YEAR);
  const [month, day] = SEASON_START_DAY.split('/').map(Number);
  const seasonStart = new Date(year, month - 1, day);
  if (now < seasonStart) return 1;
  const daysSinceStart = Math.floor((now - seasonStart) / (1000 * 60 * 60 * 24));
  return Math.min(Math.floor(daysSinceStart / 7) + 1, 17);
}

export function getCompletedWeeksCount(season = null) {
  const now = new Date();
  const year = Number(season || CURRENT_YEAR);
  const [month, day] = SEASON_START_DAY.split('/').map(Number);
  const seasonStart = new Date(year, month - 1, day);
  if (now < seasonStart) return 0;
  const daysSinceStart = Math.floor((now - seasonStart) / (1000 * 60 * 60 * 24));
  const raw = Math.floor((daysSinceStart - 5) / 7) + 1;
  return Math.max(0, Math.min(17, raw));
}

// ─── Name normalisation (mirrors playerNameMatcher.js in the React app) ───────

export function normalisePlayerName(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when first names look like the same person under a nickname/short form
 * (Kenny/Kenneth, Josh/Joshua), not merely the same initial.
 * Keep in sync with site/src/utils/playerNameMatcher.js.
 */
export function firstNamesCompatible(nameA, nameB) {
  const a = normalisePlayerName(nameA).split(' ')[0] || '';
  const b = normalisePlayerName(nameB).split(' ')[0] || '';
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const limit = Math.min(a.length, b.length);
  let shared = 0;
  while (shared < limit && a[shared] === b[shared]) shared += 1;
  return shared >= 3;
}

/** Sleeper placeholder rows that collide with real players on normalised name. */
export function isPlaceholderPlayerName(name) {
  return /^(player invalid|duplicate player)$/i.test((name || '').trim());
}

/**
 * Tie-break for Sleeper rows that share a normalised name (e.g. retired
 * Kenneth Walker the WR vs Kenneth Walker III the RB). Prefer the active
 * NFL player with a team, then Sleeper search_rank (lower = more relevant).
 */
export function sleeperPlayerQuality(player) {
  if (!player) return 0;
  let q = 0;
  if (player.active) q += 50;
  if (player.team) q += 30;
  const rank = Number(player.search_rank);
  if (Number.isFinite(rank) && rank > 0 && rank < 9_999_999) {
    q += Math.max(0, 25 - Math.log10(rank) * 8);
  }
  return q;
}

// ─── Team / roster helpers ────────────────────────────────────────────────────

export function buildTeamMap(rosters, users) {
  const map = {};
  for (const roster of rosters) {
    if (!roster || roster.roster_id == null) continue;
    const rid = Number(roster.roster_id);
    const user =
      users.find(
        (u) => u && String(u.user_id) === String(roster.owner_id)
      ) || null;
    const ownerName = user?.display_name || `Owner ${rid}`;
    const teamName = user?.metadata?.team_name || `Team ${ownerName}`;
    map[rid] = { roster, user, teamName, ownerName };
  }
  return map;
}

export function getPlayerDisplayName(player) {
  if (!player) return 'Unknown';
  return (
    player.full_name ||
    `${player.first_name || ''} ${player.last_name || ''}`.trim() ||
    'Unknown'
  );
}

// ─── KTC lookup with last-name fallback ──────────────────────────────────────

export function lookupKtc(name, ktcMap, hints = {}) {
  const norm = normalisePlayerName(name);
  const direct = ktcMap.get(norm);
  if (direct) return direct;

  // Last-name fallback requires at least a position hint to avoid false positives
  if (hints.position) {
    const lastName = norm.split(' ').pop();
    for (const [key, entry] of ktcMap) {
      if (
        key.split(' ').pop() === lastName &&
        entry.position?.toUpperCase() === hints.position?.toUpperCase()
      ) {
        return entry;
      }
    }
  }
  return null;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function fmt(n) {
  if (n == null || n <= 0) return '—';
  return Number(n).toLocaleString();
}

export function fmtDate(ts) {
  if (!ts) return 'Unknown date';
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Find a team in teamMap by fuzzy name/owner/id match
export function findTeam(teamMap, query) {
  const q = String(query).toLowerCase();
  for (const [rid, info] of Object.entries(teamMap)) {
    if (
      String(rid) === String(query) ||
      info.teamName.toLowerCase().includes(q) ||
      info.ownerName.toLowerCase().includes(q)
    ) {
      return { rid: Number(rid), ...info };
    }
  }
  return null;
}
