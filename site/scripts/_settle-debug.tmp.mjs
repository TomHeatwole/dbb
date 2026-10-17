#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';
import { ensurePaperTrackSchema } from '../lib/paperTrackCore.mjs';

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

const byPhase = await sql`
  SELECT sport, phase,
         count(*)::int AS n,
         count(*) FILTER (WHERE settled_at IS NOT NULL)::int AS settled,
         count(*) FILTER (WHERE settled_at IS NULL)::int AS open,
         count(*) FILTER (
           WHERE settled_at IS NULL AND (
             phase IN ('live', 'halftime_next', 'live_lines')
             OR kickoff_at IS NULL OR kickoff_at <= now()
           )
         )::int AS ready
  FROM paper_snapshots
  GROUP BY 1, 2
  ORDER BY 1, 2
`;
console.log('byPhase', byPhase);

const openDrives = await sql`
  SELECT event_id, payload->>'name' AS name, phase, offense_side,
         count(*)::int AS n
  FROM paper_snapshots
  WHERE sport = 'drives' AND settled_at IS NULL
    AND (phase IN ('halftime_next', 'live_lines') OR kickoff_at <= now())
  GROUP BY 1, 2, 3, 4
  ORDER BY 2, 3
  LIMIT 40
`;
console.log('openDriveGroups', openDrives);

const openSop = await sql`
  SELECT event_id, payload->>'name' AS name, phase,
         payload->>'score_home' AS home, payload->>'score_away' AS away,
         count(*)::int AS n
  FROM paper_snapshots
  WHERE sport = 'sop' AND settled_at IS NULL
    AND (phase = 'live' OR kickoff_at <= now())
  GROUP BY 1, 2, 3, 4, 5
  ORDER BY 2
`;
console.log('openSop', openSop);
