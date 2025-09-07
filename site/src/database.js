// Firebase database helper
// Initializes Firebase app and exposes simple helpers for writing test data.

import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, ref, set, get, child, remove } from 'firebase/database';
import { FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET, FIREBASE_DATABASE_URL } from './global_constants';
import { CURRENT_YEAR, getCurrentNFLWeek } from './DateHelper';

// Use environment variables for secrets/config. CRA exposes REACT_APP_*
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
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
    const ts = Date.now();
    const path = `api_cache/${key}/${ts}`;
    const entry = {
      url,
      fetchedAt: new Date(ts).toISOString(),
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
    const ts = Date.now();
    const path = `api_cache/${key}/${ts}`;
    const entry = {
      url,
      fetchedAt: new Date(ts).toISOString(),
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
    const base = ref(db, `api_cache/${key}`);
    const snap = await get(base);
    if (!snap.exists()) { return null; }
    const all = snap.val() || {};
    const entries = Object.entries(all)
      .map(([ts, value]) => ({ ts: Number(ts), value }))
      .filter(e => e && !isNaN(e.ts))
      .sort((a, b) => b.ts - a.ts);
    const latest = entries[0];
    if (!latest) { return null; }
    const age = Date.now() - latest.ts;
    if (age <= maxAgeMs && latest.value && latest.value.data !== undefined) {
      return { key, ts: latest.ts, data: latest.value.data };
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
    const base = ref(db, `api_cache/${key}`);
    const snap = await get(base);
    if (!snap.exists()) { return null; }
    const all = snap.val() || {};
    const entries = Object.entries(all)
      .map(([ts, value]) => ({ ts: Number(ts), value }))
      .filter(e => e && !isNaN(e.ts))
      .sort((a, b) => b.ts - a.ts);
    const latest = entries[0];
    if (!latest || !latest.value) { return null; }
    return { key: buildCacheKeyFromUrl(url), ts: latest.ts, data: latest.value.data };
  } catch (_) {
    return null;
  }
}

export async function readApiCacheLatestByKey(cacheKey) {
  try {
    const db = getDb();
    const base = ref(db, `api_cache/${cacheKey}`);
    const snap = await get(base);
    if (!snap.exists()) { return null; }
    const all = snap.val() || {};
    const entries = Object.entries(all)
      .map(([ts, value]) => ({ ts: Number(ts), value }))
      .filter(e => e && !isNaN(e.ts))
      .sort((a, b) => b.ts - a.ts);
    const latest = entries[0];
    if (!latest || !latest.value) { return null; }
    return { key: cacheKey, ts: latest.ts, data: latest.value.data };
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
  const path = `players_${season}_week_${week}`;

  // Check cache with 1-hour TTL
  try {
    const snap = await get(ref(getDb(), path));
    if (snap && snap.exists()) {
      const existing = snap.val();
      const fetchedAtMs = existing && existing.fetchedAt ? Date.parse(existing.fetchedAt) : 0;
      const ageMs = Date.now() - fetchedAtMs;
      if (!Number.isNaN(fetchedAtMs) && ageMs <= 60 * 60 * 1000) {
        return { path, snapshot: existing, skipped: true };
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
  const snapshot = {
    season,
    week,
    fetchedAt: new Date().toISOString(),
    url,
    count: Object.keys(filtered).length,
    data: filtered,
  };
  const db = getDb();
  await set(ref(db, path), snapshot);
  return { path, snapshot };
}

// Read latest players snapshot for current week (regardless of TTL)
export async function readCurrentWeekPlayersSnapshot() {
  const season = String(CURRENT_YEAR);
  const week = getCurrentNFLWeek(season);
  const path = `players_${season}_week_${week}`;
  try {
    const snap = await get(ref(getDb(), path));
    if (snap && snap.exists()) {
      const snapshot = snap.val();
      const fetchedAtMs = snapshot && snapshot.fetchedAt ? Date.parse(snapshot.fetchedAt) : NaN;
      const ageMs = isNaN(fetchedAtMs) ? Infinity : (Date.now() - fetchedAtMs);
      return { path, snapshot, ageMs };
    }
  } catch (_) {}
  return { path, snapshot: null, ageMs: Infinity };
}

// Admin: delete all player snapshots (players_* keys at root)
export async function deleteAllPlayerData() {
  const db = getDb();
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
  const seasonStr = String(season);
  const weekNum = Number(week);
  if (!seasonStr || !Number.isFinite(weekNum) || weekNum < 1 || weekNum > 17) {
    throw new Error('deletePlayerWeek requires valid season and week (1-17)');
  }
  const path = `players_${seasonStr}_week_${weekNum}`;
  const db = getDb();
  await remove(ref(db, path));
  return { path };
}



