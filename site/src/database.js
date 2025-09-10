// Firebase database helper
// Initializes Firebase app and exposes simple helpers for writing test data.

import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getDatabase, ref, set, get, child, remove } from 'firebase/database';
import { FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET, FIREBASE_DATABASE_URL, FIREBASE_LOGIN_EMAIL, FIREBASE_LOGIN_PASSWORD, FIREBASE_API_KEY } from './global_constants';
import { CURRENT_YEAR, getCurrentNFLWeek } from './DateHelper';

// Use settings-provided API key first, fallback to env
const firebaseConfig = {
  apiKey: FIREBASE_API_KEY,
  authDomain: FIREBASE_AUTH_DOMAIN,
  projectId: FIREBASE_PROJECT_ID,
  storageBucket: FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  databaseURL: FIREBASE_DATABASE_URL,
};

function getFirebaseApp() {
  if (!getApps().length) {
    initializeApp(firebaseConfig);
  }
  return getApps()[0];
}

function getDb() {
  const app = getFirebaseApp();
  return getDatabase(app);
}

let _signInPromise = null;
async function ensureSignedIn() {
  try {
    const auth = getAuth(getFirebaseApp());
    if (auth.currentUser) { return auth.currentUser; }
    if (!_signInPromise) {
      _signInPromise = signInWithEmailAndPassword(auth, FIREBASE_LOGIN_EMAIL, FIREBASE_LOGIN_PASSWORD)
        .then(cred => cred.user)
        .catch((e) => { _signInPromise = null; throw e; });
    }
    return await _signInPromise;
  } catch (_) {
    return null;
  }
}

function providerFromHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (host.includes('sleeper')) { return 'sleeper'; }
  if (host.includes('espn')) { return 'espn'; }
  return host.replace(/\./g, '_');
}

function buildCacheKeyFromUrl(urlString) {
  try {
    const u = new URL(urlString);
    const provider = providerFromHost(u.hostname);
    const pathSegs = (u.pathname || '')
      .split('/')
      .filter(Boolean)
      .map(s => s.replace(/[^a-zA-Z0-9]+/g, '_'));
    const queryPairs = [];
    const keys = Array.from(u.searchParams.keys()).sort();
    for (const k of keys) {
      const vals = u.searchParams.getAll(k);
      for (const v of vals) {
        queryPairs.push(k.replace(/[^a-zA-Z0-9]+/g, '_'));
        queryPairs.push(String(v).replace(/[^a-zA-Z0-9]+/g, '_'));
      }
    }
    const parts = [provider, ...pathSegs, ...queryPairs].filter(Boolean);
    return parts.join('_').replace(/_+/g, '_');
  } catch (e) {
    return `unknown_${Date.now()}`;
  }
}

export async function writeApiCache(url, payload) {
  try {
    const db = getDb();
    const key = buildCacheKeyFromUrl(url);
    await ensureSignedIn();
    const path = `api_cache/${key}`;
    const entry = {
      url,
      fetchedAt: new Date().toISOString(),
      data: payload,
    };
    await set(ref(db, path), entry);
    return { path, key };
  } catch (_) {
    // Swallow errors for cache writes to avoid breaking UI
    return null;
  }
}

export async function writeApiCacheWithKey(cacheKey, url, payload) {
  try {
    const db = getDb();
    const key = cacheKey || buildCacheKeyFromUrl(url);
    await ensureSignedIn();
    const path = `api_cache/${key}`;
    const entry = {
      url,
      fetchedAt: new Date().toISOString(),
      data: payload,
    };
    await set(ref(db, path), entry);
    return { path, key };
  } catch (_) {
    return null;
  }
}

export async function readApiCacheFresh(url, maxAgeMs = 60_000) {
  try {
    const db = getDb();
    const key = buildCacheKeyFromUrl(url);
    await ensureSignedIn();
    // Prefer DB-configured TTL when not explicitly provided
    let ttlMs = maxAgeMs;
    if (ttlMs == null) {
      try { ttlMs = await readDbCacheTtlMs(); } catch (_) { ttlMs = 60_000; }
    }
    const base = ref(db, `api_cache/${key}`);
    const snap = await get(base);
    if (!snap.exists()) { return null; }
    const val = snap.val() || {};
    const fetchedAtMs = val && val.fetchedAt ? Date.parse(val.fetchedAt) : NaN;
    const age = isNaN(fetchedAtMs) ? Infinity : (Date.now() - fetchedAtMs);
    if (age <= ttlMs && val && val.data !== undefined) {
      return { key, ts: fetchedAtMs, data: val.data };
    }
    return null;
  } catch (_) {
    return null;
  }
}

export async function readApiCacheLatest(url) {
  try {
    const db = getDb();
    const key = buildCacheKeyFromUrl(url);
    await ensureSignedIn();
    const base = ref(db, `api_cache/${key}`);
    const snap = await get(base);
    if (!snap.exists()) { return null; }
    const val = snap.val() || {};
    const fetchedAtMs = val && val.fetchedAt ? Date.parse(val.fetchedAt) : NaN;
    if (!val || val.data === undefined) { return null; }
    return { key: buildCacheKeyFromUrl(url), ts: fetchedAtMs, data: val.data };
  } catch (_) {
    return null;
  }
}

export async function readApiCacheLatestByKey(cacheKey) {
  try {
    const db = getDb();
    await ensureSignedIn();
    const base = ref(db, `api_cache/${cacheKey}`);
    const snap = await get(base);
    if (!snap.exists()) { return null; }
    const val = snap.val() || {};
    const fetchedAtMs = val && val.fetchedAt ? Date.parse(val.fetchedAt) : NaN;
    if (!val || val.data === undefined) { return null; }
    return { key: cacheKey, ts: fetchedAtMs, data: val.data };
  } catch (_) {
    return null;
  }
}

export default {
  writeApiCache,
  writeApiCacheWithKey,
  readApiCacheFresh,
  readApiCacheLatest,
  readApiCacheLatestByKey,
  readDbCacheTtlMs,
  readPollingIntervalMs,
  deleteAllPlayerData,
  deletePlayerWeek,
};

// Fetch Sleeper players, filter to active players intersecting caredPlayerIds, and store snapshot for current week
export async function updatePlayers(caredPlayerIds) {
  if (!Array.isArray(caredPlayerIds)) {
    throw new Error('updatePlayers requires an array of player IDs');
  }
  const season = String(CURRENT_YEAR);
  const week = getCurrentNFLWeek(season);
  const basePath = `players_${season}_week_${week}`;

  // Check latest entry under the week folder with 1-hour TTL
  try {
    await ensureSignedIn();
    const weekSnap = await get(ref(getDb(), basePath));
    if (weekSnap && weekSnap.exists()) {
      const value = weekSnap.val() || {};
      const fetchedAtMs = value && value.fetchedAt ? Date.parse(value.fetchedAt) : NaN;
      const ageMs = isNaN(fetchedAtMs) ? Infinity : (Date.now() - fetchedAtMs);
      if (ageMs <= 60 * 60 * 1000) {
        return { path: basePath, snapshot: value, skipped: true };
      }
    }
  } catch (_) {
    // ignore cache read errors
  }
  const url = 'https://api.sleeper.app/v1/players/nfl';
  const res = await fetch(url);
  if (!res || !res.ok) {
    throw new Error(`Failed to fetch players from Sleeper: ${res ? res.status : 'no response'}`);
  }
  const allPlayers = await res.json();
  const caredSet = new Set(caredPlayerIds.map(String));
  const filtered = {};
  for (const pid of caredSet) {
    const p = allPlayers && allPlayers[pid];
    if (!p) { continue; }
    const isActive = (p && p.active === true) || (p && typeof p.status === 'string' && p.status.toLowerCase() === 'active');
    if (!isActive) { continue; }
    filtered[pid] = p;
  }
  const entry = {
    season,
    week,
    fetchedAt: new Date().toISOString(),
    url,
    count: Object.keys(filtered).length,
    data: filtered,
  };
  const db = getDb();
  await ensureSignedIn();
  const writePath = `${basePath}`;
  await set(ref(db, writePath), entry);
  return { path: writePath, snapshot: entry };
}

// Read latest players snapshot for current week (regardless of TTL)
export async function readCurrentWeekPlayersSnapshot() {
  const season = String(CURRENT_YEAR);
  const week = getCurrentNFLWeek(season);
  const basePath = `players_${season}_week_${week}`;
  try {
    await ensureSignedIn();
    const weekSnap = await get(ref(getDb(), basePath));
    if (weekSnap && weekSnap.exists()) {
      const value = weekSnap.val() || {};
      const fetchedAtMs = value && value.fetchedAt ? Date.parse(value.fetchedAt) : NaN;
      const ageMs = isNaN(fetchedAtMs) ? Infinity : (Date.now() - fetchedAtMs);
      return { path: basePath, snapshot: value, ageMs };
    }
  } catch (_) {}
  return { path: basePath, snapshot: null, ageMs: Infinity };
}

// Read latest players snapshot for a specific season/week (regardless of TTL)
export async function readPlayersSnapshot(season, week) {
  const seasonStr = String(season || CURRENT_YEAR);
  const weekNum = Number(week);
  const basePath = `players_${seasonStr}_week_${weekNum}`;
  try {
    await ensureSignedIn();
    const weekSnap = await get(ref(getDb(), basePath));
    if (weekSnap && weekSnap.exists()) {
      const value = weekSnap.val() || {};
      const fetchedAtMs = value && value.fetchedAt ? Date.parse(value.fetchedAt) : NaN;
      const ageMs = isNaN(fetchedAtMs) ? Infinity : (Date.now() - fetchedAtMs);
      return { path: basePath, snapshot: value, ageMs };
    }
  } catch (_) {}
  return { path: basePath, snapshot: null, ageMs: Infinity };
}

// Admin: delete all player snapshots (players_* keys at root)
export async function deleteAllPlayerData() {
  const db = getDb();
  await ensureSignedIn();
  const rootSnap = await get(ref(db, '/'));
  if (!rootSnap.exists()) { return { deleted: [] }; }
  const val = rootSnap.val() || {};
  const keys = Object.keys(val).filter(k => typeof k === 'string' && k.startsWith('players_'));
  const deleted = [];
  for (const k of keys) {
    try {
      await remove(ref(db, k));
      deleted.push(k);
    } catch (_) {
      // continue deleting others
    }
  }
  return { deleted };
}

// Admin: delete specific player week snapshot
export async function deletePlayerWeek(season, week) {
  const seasonStr = String(season || '').trim();
  const weekNum = Number(week);
  if (!seasonStr) {
    throw new Error('Season is required');
  }
  if (!Number.isFinite(weekNum) || weekNum <= 0 || weekNum > 99) {
    throw new Error('Week must be a positive number');
  }
  const path = `players_${seasonStr}_week_${weekNum}`;
  const db = getDb();
  await ensureSignedIn();
  await remove(ref(db, path));
  return { path };
}




// Admin JSON blob helpers
export async function readAdminBlob() {
  const db = getDb();
  await ensureSignedIn();
  const snap = await get(ref(db, 'admin'));
  if (!snap.exists()) { return null; }
  return snap.val();
}

export async function writeAdminBlob(value) {
  const db = getDb();
  await ensureSignedIn();
  await set(ref(db, 'admin'), value);
  return true;
}

// Config getters: admin/db_cache_ttl and admin/polling_interval
export async function readDbCacheTtlMs() {
  try {
    const db = getDb();
    await ensureSignedIn();
    const snap = await get(ref(db, 'admin/db_cache_ttl'));
    if (!snap.exists()) { return 60_000; }
    const v = snap.val();
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 60_000;
  } catch (_) {
    return 60_000;
  }
}

export async function readPollingIntervalMs() {
  try {
    const db = getDb();
    await ensureSignedIn();
    const snap = await get(ref(db, 'admin/polling_interval'));
    if (!snap.exists()) { return 15_000; }
    const v = snap.val();
    const n = Number(v);
    return Number.isFinite(n) && n >= 1000 ? n : 15_000;
  } catch (_) {
    return 15_000;
  }
}

// Backup: snapshot latest entries of common scraped keys into backups/{ts}
export async function backupLatestData() {
  const db = getDb();
  await ensureSignedIn();
  const ts = Date.now();
  const backupPath = `backups/${ts}`;
  const out = { createdAt: new Date(ts).toISOString() };

  // 1) Sleeper weekly matchups (detect any keys under api_cache starting with sleeper_v1_league_)
  try {
    const rootSnap = await get(ref(db, 'api_cache'));
    if (rootSnap && rootSnap.exists()) {
      const val = rootSnap.val() || {};
      const latestByKey = {};
      for (const key of Object.keys(val)) {
        const isSleeper = /^sleeper_v1_league_/.test(key);
        const isEspn = /^espn_.*_sports_football_nfl_scoreboard_/.test(key) || /^espn_.*_scoreboard_/.test(key);
        if (!isSleeper && !isEspn) { continue; }
        // New format: value is the latest object directly under the key
        const entry = val[key];
        if (entry && typeof entry === 'object') {
          latestByKey[key] = entry;
        }
      }
      out.api_cache = latestByKey;
    }
  } catch (_) {}

  // 2) Players: copy latest snapshot for current season per week that exists
  try {
    const root = await get(ref(db, '/'));
    const all = root && root.exists() ? (root.val() || {}) : {};
    const playerKeys = Object.keys(all).filter(k => /^players_\d{4}_week_\d{1,2}$/.test(k));
    const playersOut = {};
    for (const pk of playerKeys) {
      try {
        const snap = await get(ref(db, pk));
        if (snap && snap.exists()) {
          const value = snap.val() || {};
          playersOut[pk] = value;
        }
      } catch (_) {}
    }
    out.players = playersOut;
  } catch (_) {}

  await set(ref(db, backupPath), out);
  return { path: backupPath };
}

// Clear cache: backup latest first, then remove all but most recent timestamp entry per key
export async function clearCacheKeepLatest() {
  const db = getDb();
  await ensureSignedIn();
  const backup = await backupLatestData();
  const summary = { backupPath: backup && backup.path ? backup.path : null, removed: [] };

  // Helper to prune a subtree with numeric timestamp children
  async function pruneChildren(basePath) {
    try {
      const snap = await get(ref(db, basePath));
      if (!snap || !snap.exists()) { return; }
      const val = snap.val() || {};
      const entries = Object.keys(val)
        .map(ts => ({ ts: Number(ts), key: ts }))
        .filter(e => !isNaN(e.ts))
        .sort((a, b) => b.ts - a.ts);
      if (entries.length <= 1) { return; }
      const toRemove = entries.slice(1); // keep most recent only
      for (const r of toRemove) {
        try {
          await remove(ref(db, `${basePath}/${r.key}`));
          summary.removed.push(`${basePath}/${r.key}`);
        } catch (_) {}
      }
    } catch (_) {}
  }

  // 1) api_cache/*
  try {
    const apiSnap = await get(ref(db, 'api_cache'));
    if (apiSnap && apiSnap.exists()) {
      const keys = Object.keys(apiSnap.val() || {});
      for (const k of keys) {
        await pruneChildren(`api_cache/${k}`);
      }
    }
  } catch (_) {}

  // 2) players_*_week_* subtrees
  try {
    const root = await get(ref(db, '/'));
    const all = root && root.exists() ? (root.val() || {}) : {};
    const playerKeys = Object.keys(all).filter(k => /^players_\d{4}_week_\d{1,2}$/.test(k));
    for (const pk of playerKeys) {
      await pruneChildren(pk);
    }
  } catch (_) {}

  return summary;
}
// Usage tracking: log page loads with path, ip, and timestamp
export async function logUsage(event) {
  try {
    const { path, ip, ts } = event || {};
    if (!path) { return false; }
    const db = getDb();
    await ensureSignedIn();
    const when = Number.isFinite(ts) ? ts : Date.now();
    const entry = {
      path,
      ip: ip || null,
      ts: when,
      at: new Date(when).toISOString()
    };
    await set(ref(db, `usage/${when}_${Math.random().toString(36).slice(2, 8)}`), entry);
    return true;
  } catch (_) {
    return false;
  }
}

