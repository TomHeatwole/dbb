// Firebase database helper
// Initializes Firebase app and exposes simple helpers for writing test data.

import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, ref, set } from 'firebase/database';
import { FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET, FIREBASE_DATABASE_URL } from './global_constants';

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

export async function writeHelloWorld(sender = 'league_scores_refresh') {
  const db = getDb();
  const timestamp = new Date().toISOString();
  const path = `messages/${Date.now()}`;
  console.log("CALLED");
  const data = {
    message: 'Hello, World from React!',
    timestamp,
    sender,
  };
  await set(ref(db, path), data);
  return { path, data };
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

export default {
  writeHelloWorld,
  writeApiCache,
};


