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

export default {
  writeHelloWorld,
};


