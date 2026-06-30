/**
 * Load/save DraftKings session cookies for local dev (gitignored files only).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DK_COOKIE_FILE = path.join(SITE_DIR, '.dk-cookies.json');
export const ENV_LOCAL_FILE = path.join(SITE_DIR, '.env.local');

export function cookiesToHeader(cookies) {
  return cookies
    .filter((c) => String(c.domain ?? '').includes('draftkings'))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

export function loadDkCookieHeader() {
  const fromEnv = process.env.DK_COOKIE?.trim();
  if (fromEnv) return fromEnv;

  try {
    if (fs.existsSync(DK_COOKIE_FILE)) {
      const data = JSON.parse(fs.readFileSync(DK_COOKIE_FILE, 'utf8'));
      if (data.cookieHeader) return data.cookieHeader;
    }
  } catch (_) {}

  return null;
}

export function saveDkCookies({ cookieHeader, cookies }) {
  fs.writeFileSync(
    DK_COOKIE_FILE,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        cookieHeader,
        cookies,
      },
      null,
      2,
    ),
  );
  upsertEnvLocal('DK_COOKIE', cookieHeader);
}

export function upsertEnvLocal(key, value) {
  let lines = [];
  try {
    lines = fs.readFileSync(ENV_LOCAL_FILE, 'utf8').split('\n');
  } catch (_) {
    lines = [];
  }

  const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const nextLine = `${key}="${escaped}"`;
  let found = false;

  const updated = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return nextLine;
    }
    return line;
  });

  if (!found) updated.push(nextLine);
  fs.writeFileSync(ENV_LOCAL_FILE, updated.filter((l, i, arr) => !(i === arr.length - 1 && l === '')).join('\n') + '\n');
}
