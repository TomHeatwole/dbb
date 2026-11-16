/**
 * Auth + onboarding in one Hobby-plan function.
 * GET  /api/auth  (rewritten from /api/me)
 * POST /api/auth  (rewritten from /api/onboard)
 */

import meHandler from '../lib/me.mjs';
import onboardHandler from '../lib/onboard.mjs';
import {
  handlePlayoffHprojGet,
  handlePlayoffHprojPost,
} from '../lib/playoffHprojCacheApi.mjs';

function wantsPlayoffHproj(req) {
  const q = req.query || {};
  if (q.playoffHproj === '1' || q.playoffHproj === 'true') return true;
  try {
    const url = new URL(req.url || '', 'http://localhost');
    if (url.searchParams.get('playoffHproj') === '1' || url.searchParams.get('playoffHproj') === 'true') {
      return true;
    }
    return /\/playoff-hproj\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (wantsPlayoffHproj(req)) {
    if (req.method === 'GET') return handlePlayoffHprojGet(req, res);
    if (req.method === 'POST') {
      try {
        return await handlePlayoffHprojPost(req, res);
      } catch (e) {
        return res.status(400).json({ error: e?.message || 'Invalid request' });
      }
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (req.method === 'GET') return meHandler(req, res);
  if (req.method === 'POST') return onboardHandler(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
