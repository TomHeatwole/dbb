/**
 * sync-dbbp-data.mjs
 *
 * Copies private data from the sibling `dbbp` repo (gitignored, private GitHub
 * remote) into site/public/data/ so local dev and local builds can serve it.
 *
 * Runs automatically via the `prestart` / `prebuild` hooks in site/package.json.
 * On Vercel (or any checkout of the public repo) `dbbp` does not exist, so this
 * script no-ops and the private data never ships with the deployed site.
 *
 * The destination folders are gitignored — never commit synced copies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

// [dbbp path, site/public/data path] — directories or single files
const SYNC_TARGETS = [
  ['redraft-dash', 'redraft_dash'],
  ['ffb-udk', 'redraft_dash/ffb-udk'],
  ['lrdg_rankings.csv', 'redraft_dash/lrdg_rankings.csv'],
];

const dbbpRoot = path.resolve(scriptDir, '../../dbbp');
const publicData = path.resolve(scriptDir, '../public/data');

if (!fs.existsSync(dbbpRoot)) {
  console.log('[sync-dbbp-data] dbbp/ not found — skipping private data sync (public build).');
  process.exit(0);
}

for (const [srcName, destName] of SYNC_TARGETS) {
  const src = path.join(dbbpRoot, srcName);
  const dest = path.join(publicData, destName);
  if (!fs.existsSync(src)) {
    console.log(`[sync-dbbp-data] dbbp/${srcName} not found — skipping.`);
    continue;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  const detail = fs.statSync(dest).isDirectory()
    ? `${fs.readdirSync(dest).length} files`
    : 'file';
  console.log(`[sync-dbbp-data] dbbp/${srcName} -> public/data/${destName} (${detail})`);
}
