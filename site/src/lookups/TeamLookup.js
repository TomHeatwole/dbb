import { LEAGUE_ID, PREVIOUS_YEARS, PREVIOUS_ROSTER_OVERRIDES } from '../utils/global_constants';
import { getCurrentYear } from '../utils/DateHelper';
import { recordRateLimitHit } from '../utils/database';

// Helper to get avatar URL from value (ID or URL)
function getAvatarUrl(avatarVal) {
  if (!avatarVal) return null;
  if (typeof avatarVal === 'string' && avatarVal.startsWith('http')) return avatarVal;
  return `https://sleepercdn.com/avatars/${avatarVal}`;
}

function getLeagueIdForSeason(season) {
  const currentYear = String(getCurrentYear());
  const normalizedSeason = String(season);
  return PREVIOUS_YEARS[normalizedSeason] ?? (normalizedSeason === currentYear ? LEAGUE_ID : null);
}

/** All known season years, newest first (current + PREVIOUS_YEARS). */
function getAllSeasonYearsNewestFirst() {
  const currentYear = String(getCurrentYear());
  const years = new Set([currentYear, ...Object.keys(PREVIOUS_YEARS || {})]);
  return [...years].sort((a, b) => Number(b) - Number(a));
}

/** Custom team logos live under /uploads/; Sleeper defaults use /images/.../avatar_default_*. */
function isCustomTeamAvatarUrl(url) {
  return typeof url === 'string' && url.includes('/uploads/');
}

// avatar id|url -> whether it is a user-uploaded (non-default) profile image
const userAvatarCustomCache = new Map();
// leagueId -> Promise<users[]>
const leagueUsersCache = new Map();

/**
 * Sleeper default profile avatars (colored Sleeperbots) are consistently sized
 * 168x168 or ~498x500. Custom uploads use other dimensions (280, 400, 1024, …).
 * Uses Image() naturalWidth/Height so we don't depend on CDN CORS/Range headers.
 */
function loadAvatarDimensions(url) {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function isSleeperbotDimensions(dims) {
  if (!dims) return false;
  const { w, h } = dims;
  if (w === 168 && h === 168) return true;
  // Older full-size Sleeperbots are 498x500 (occasionally reported as 500x500).
  if ((w === 498 || w === 500) && (h === 498 || h === 500)) return true;
  return false;
}

async function isCustomUserAvatar(avatarVal) {
  if (!avatarVal) return false;
  if (typeof avatarVal === 'string' && avatarVal.startsWith('http')) {
    if (avatarVal.includes('/uploads/')) return true;
    if (avatarVal.includes('avatar_default_') || avatarVal.includes('/images/')) return false;
  }

  const cacheKey = String(avatarVal);
  if (userAvatarCustomCache.has(cacheKey)) {
    return userAvatarCustomCache.get(cacheKey);
  }

  const url = getAvatarUrl(avatarVal);
  try {
    let isCustom;
    const dims = await loadAvatarDimensions(url);
    if (dims) {
      isCustom = !isSleeperbotDimensions(dims);
    } else {
      // Non-browser / image-load failure fallback: content-type (defaults are webp).
      const res = await fetch(url);
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      try { res.body?.cancel?.(); } catch (_) {}
      isCustom = Boolean(ct) && !ct.includes('image/webp');
    }
    userAvatarCustomCache.set(cacheKey, isCustom);
    return isCustom;
  } catch (_) {
    // Fail soft: treat as non-custom so team / later-season logos can substitute.
    userAvatarCustomCache.set(cacheKey, false);
    return false;
  }
}

async function fetchLeagueUsers(leagueId) {
  if (!leagueId) return [];
  const cached = leagueUsersCache.get(leagueId);
  if (cached) return cached;

  const promise = (async () => {
    const usersRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`);
    if (usersRes.status === 429) {
      try { await recordRateLimitHit('sleeper'); } catch (_) {}
    }
    if (!usersRes.ok) throw new Error('Failed to fetch users');
    const users = await usersRes.json();
    return Array.isArray(users) ? users : [];
  })();

  leagueUsersCache.set(leagueId, promise);
  try {
    return await promise;
  } catch (err) {
    leagueUsersCache.delete(leagueId);
    throw err;
  }
}

/**
 * For each user_id, the most recent custom team logo and custom profile avatar
 * from seasons newer than `fromSeason` (so 2024 can inherit 2025/2026 logos).
 * @returns {Promise<Map<string, { customTeamUrl: string|null, customUserAvatarUrl: string|null }>>}
 */
async function getLaterSeasonCustomLogosByUserId(fromSeason) {
  const fromYear = Number(fromSeason);
  const laterYears = getAllSeasonYearsNewestFirst().filter((y) => Number(y) > fromYear);
  const byUserId = new Map();
  if (!laterYears.length) return byUserId;

  const seasonUsers = await Promise.all(
    laterYears.map(async (year) => {
      const leagueId = getLeagueIdForSeason(year);
      if (!leagueId) return [];
      try {
        return await fetchLeagueUsers(leagueId);
      } catch (_) {
        return [];
      }
    })
  );

  const avatarVals = new Set();
  for (const users of seasonUsers) {
    for (const user of users) {
      if (user && user.avatar) avatarVals.add(user.avatar);
    }
  }
  await Promise.all([...avatarVals].map((avatar) => isCustomUserAvatar(avatar)));

  // laterYears is newest-first; first write wins => most recent custom logo.
  for (let i = 0; i < laterYears.length; i++) {
    const users = seasonUsers[i] || [];
    for (const user of users) {
      if (!user || user.user_id == null) continue;
      const uid = String(user.user_id);
      let entry = byUserId.get(uid);
      if (!entry) {
        entry = { customTeamUrl: null, customUserAvatarUrl: null };
        byUserId.set(uid, entry);
      }

      const teamMeta = user.metadata ? (user.metadata.avatar || user.metadata.team_avatar) : null;
      const teamUrl = getAvatarUrl(teamMeta);
      if (!entry.customTeamUrl && isCustomTeamAvatarUrl(teamUrl)) {
        entry.customTeamUrl = teamUrl;
      }

      if (!entry.customUserAvatarUrl && (await isCustomUserAvatar(user.avatar))) {
        entry.customUserAvatarUrl = getAvatarUrl(user.avatar);
      }
    }
  }

  return byUserId;
}

export async function fetchTeamData(season = getCurrentYear()) {
  const normalizedSeason = String(season);
  const leagueId = getLeagueIdForSeason(normalizedSeason);
  if (!leagueId) {
    throw new Error(`No league ID found for season ${normalizedSeason}`);
  }

  // Fetch rosters
  const rosterRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
  if (rosterRes.status === 429) {
    try { await recordRateLimitHit('sleeper'); } catch (_) {}
  }
  if (!rosterRes.ok) throw new Error('Failed to fetch rosters');
  const rosters = await rosterRes.json();

  // Fetch users (shared cache so later-season logo lookup can reuse this)
  const users = [...(await fetchLeagueUsers(leagueId))];

  for (const roster of rosters) {
    const override = PREVIOUS_ROSTER_OVERRIDES[season] && PREVIOUS_ROSTER_OVERRIDES[season][roster.roster_id];
    if (override) {
      users.push(
        {
          display_name: override.owner,
          metadata: {
            team_name: override.name
          },
          avatar: override.avatar,
          roster_id: roster.roster_id,
          user_id: roster.owner_id,
        }
      )
    }
  }

  // Classify unique profile avatars once (default Sleeperbot vs custom upload).
  const uniqueAvatars = [...new Set(users.map((u) => u && u.avatar).filter(Boolean))];
  await Promise.all(uniqueAvatars.map((avatar) => isCustomUserAvatar(avatar)));

  // Older seasons can inherit custom logos from newer seasons for the same user_id.
  const laterLogosByUserId = await getLaterSeasonCustomLogosByUserId(normalizedSeason);

  for (const user of users) {
    const rawUserAvatarUrl = getAvatarUrl(user.avatar);
    const teamMetaAvatar = user && user.metadata ? (user.metadata.avatar || user.metadata.team_avatar) : null;
    const seasonTeamAvatarUrl = getAvatarUrl(teamMetaAvatar);
    const later = user && user.user_id != null
      ? laterLogosByUserId.get(String(user.user_id))
      : null;

    // Prefer this season's custom team logo; otherwise a newer season's custom team logo.
    const teamAvatarUrl = isCustomTeamAvatarUrl(seasonTeamAvatarUrl)
      ? seasonTeamAvatarUrl
      : (later && later.customTeamUrl) || seasonTeamAvatarUrl;

    const teamIsCustom = isCustomTeamAvatarUrl(teamAvatarUrl);
    const userIsCustom = await isCustomUserAvatar(user.avatar);

    // User-logo slots: this season's custom profile > a newer season's custom
    // profile > custom team logo (this season or newer) > raw Sleeper default.
    let effectiveUserAvatarUrl = rawUserAvatarUrl;
    if (userIsCustom) {
      effectiveUserAvatarUrl = rawUserAvatarUrl;
    } else if (later && later.customUserAvatarUrl) {
      effectiveUserAvatarUrl = later.customUserAvatarUrl;
    } else if (teamIsCustom) {
      effectiveUserAvatarUrl = teamAvatarUrl;
    }

    // Preserve existing field for backward-compat
    user.avatar_url = effectiveUserAvatarUrl;
    // New explicit fields
    user.user_avatar_url = effectiveUserAvatarUrl;
    user.team_avatar_url = teamAvatarUrl;
  }

  return { rosters, users };
}

// Build a lookup map from roster_id -> { teamName, ownerName, roster, user }
export function buildRosterIdToTeamInfoMap(rosters, users) {
  const map = {};
  if (!Array.isArray(rosters) || !Array.isArray(users)) {
    return map;
  }
  for (const roster of rosters) {
    if (!roster || roster.roster_id == null) {
      continue;
    }
    const ridNum = Number(roster.roster_id);
    const ridKey = Number.isFinite(ridNum) ? ridNum : roster.roster_id;
    const ownerIdStr = roster.owner_id != null ? String(roster.owner_id) : null;
    const user = users.find((u) => {
      if (!u) { return false; }
      if (ownerIdStr && String(u.user_id) === ownerIdStr) {
        return true;
      }
      if (u.roster_id != null && Number(u.roster_id) === ridNum) {
        return true;
      }
      return false;
    }) || null;

    const ownerName = user && user.display_name ? user.display_name : null;
    let teamName = null;
    if (user && user.metadata && user.metadata.team_name) {
      teamName = user.metadata.team_name;
    } else if (ownerName) {
      teamName = `Team ${ownerName}`;
    } else {
      teamName = `Team ${ridKey}`;
    }

    map[ridKey] = {
      roster,
      user,
      teamName,
      ownerName: ownerName || `Owner ${ridKey}`,
    };
  }
  return map;
}

// Check whether the current league's rookie draft has completed.
// Uses the Sleeper drafts endpoint: status can be "pre_draft", "drafting", or "complete".
export async function fetchRookieDraftComplete() {
  try {
    const res = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/drafts`);
    if (res.status === 429) {
      try { await recordRateLimitHit('sleeper'); } catch (_) {}
    }
    if (!res.ok) return false;
    const drafts = await res.json();
    if (!Array.isArray(drafts) || drafts.length === 0) return false;
    const currentSeason = String(getCurrentYear());
    const seasonDraft = drafts.find((d) => String(d.season) === currentSeason) || drafts[0];
    return seasonDraft?.status === 'complete';
  } catch (_) {
    return false;
  }
}

// Fetch all drafts for the current league. Returns the raw array from Sleeper.
export async function fetchLeagueDrafts() {
  const res = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/drafts`);
  if (res.status === 429) {
    try { await recordRateLimitHit('sleeper'); } catch (_) {}
  }
  if (!res.ok) throw new Error('Failed to fetch drafts');
  const drafts = await res.json();
  return Array.isArray(drafts) ? drafts : [];
}

// Fetch a specific draft object (includes slot_to_roster_id, draft_order, etc.).
export async function fetchDraft(draftId) {
  if (!draftId) throw new Error('No draft ID');
  const res = await fetch(`https://api.sleeper.app/v1/draft/${draftId}`);
  if (res.status === 429) {
    try { await recordRateLimitHit('sleeper'); } catch (_) {}
  }
  if (!res.ok) throw new Error('Failed to fetch draft');
  return res.json();
}

// Fetch all picks made in a specific draft (by draft_id).
export async function fetchDraftPicks(draftId) {
  if (!draftId) throw new Error('No draft ID');
  const res = await fetch(`https://api.sleeper.app/v1/draft/${draftId}/picks`);
  if (res.status === 429) {
    try { await recordRateLimitHit('sleeper'); } catch (_) {}
  }
  if (!res.ok) throw new Error('Failed to fetch draft picks');
  const picks = await res.json();
  return Array.isArray(picks) ? picks : [];
}

// Fetch traded draft picks for a given season, normalized into a simple structure
// Example item: { round: 2, season: '2025', roster_id: 1, owner_id: 4, previous_owner_id: 1 }
export async function fetchTradedPicks(season = getCurrentYear()) {
  const currentYear = String(getCurrentYear());
  const normalizedSeason = String(season);
  // Prefer PREVIOUS_YEARS when that season exists (handles pre-season when LEAGUE_ID is new year)
  const leagueId = PREVIOUS_YEARS[normalizedSeason] ?? (normalizedSeason === currentYear ? LEAGUE_ID : null);

  if (!leagueId) {
    throw new Error(`No league id found for season ${normalizedSeason}`);
  }

  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`);
  if (res.status === 429) {
    try { await recordRateLimitHit('sleeper'); } catch (_) {}
  }
  if (!res.ok) {
    throw new Error('Failed to fetch traded picks');
  }

  const raw = await res.json();
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((p) => {
    return {
      round: p && p.round != null ? Number(p.round) : null,
      season: p && p.season != null ? String(p.season) : normalizedSeason,
      roster_id: p && p.roster_id != null ? Number(p.roster_id) : null,
      owner_id: p && p.owner_id != null ? Number(p.owner_id) : null,
      previous_owner_id: p && p.previous_owner_id != null ? Number(p.previous_owner_id) : null,
    };
  });
}

