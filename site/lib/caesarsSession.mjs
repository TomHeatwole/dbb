/**
 * Caesars sits behind AWS WAF. The sportsbook page mints aws-waf-token in a
 * normal browser; we reuse that cookie the same way DraftKings cookies are
 * stored locally. No challenge solver — if the token is missing or stale,
 * the feed fails soft and the page shows a notice.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_FILE = path.join(SITE_DIR, '.caesars-waf.json');

export function loadCaesarsToken() {
  const fromEnv = String(process.env.CAESARS_WAF_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const json = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    return String(json?.token || '').trim();
  } catch {
    return '';
  }
}
