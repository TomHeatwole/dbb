#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';
import { ensurePaperTrackSchema } from '../lib/paperTrackCore.mjs';
import {
  countReadyUnsettled,
  settleDrivesSnapshots,
  settleSopSnapshots,
} from '../lib/paperTrackSettle.mjs';

const siteDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try {
  const envContent = fs.readFileSync(path.join(siteDir, '.env.local'), 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
} catch (_) {}

const sql = neon(process.env.DATABASE_URL);
await ensurePaperTrackSchema(sql);

const before = await sql`
  SELECT sport,
         count(*)::int AS n,
         count(*) FILTER (WHERE settled_at IS NOT NULL)::int AS settled,
         count(*) FILTER (WHERE settled_at IS NULL)::int AS open
  FROM paper_snapshots
  GROUP BY 1
  ORDER BY 1
`;
const ready = {
  sop: await countReadyUnsettled('sop', sql),
  drives: await countReadyUnsettled('drives', sql),
};
console.log('before', { before, ready });

const sop = await settleSopSnapshots({ sql });
const drives = await settleDrivesSnapshots({ sql });
console.log('ran', { sop, drives });

const after = await sql`
  SELECT sport,
         count(*)::int AS n,
         count(*) FILTER (WHERE settled_at IS NOT NULL)::int AS settled,
         count(*) FILTER (WHERE settled_at IS NULL)::int AS open
  FROM paper_snapshots
  GROUP BY 1
  ORDER BY 1
`;
const samples = await sql`
  SELECT sport, phase, payload->>'name' AS name, payload->>'result' AS result,
         payload->>'result_label' AS label, offense_side, settled_at
  FROM paper_snapshots
  WHERE settled_at IS NOT NULL
  ORDER BY settled_at DESC
  LIMIT 20
`;
console.log('after', after);
console.log('samples', samples);
console.log('readyAfter', {
  sop: await countReadyUnsettled('sop', sql),
  drives: await countReadyUnsettled('drives', sql),
});
