/**
 * Auth + onboarding in one Hobby-plan function.
 * GET  /api/auth  (rewritten from /api/me)
 * POST /api/auth  (rewritten from /api/onboard)
 */

import meHandler from '../lib/me.mjs';
import onboardHandler from '../lib/onboard.mjs';

export default async function handler(req, res) {
  if (req.method === 'GET') return meHandler(req, res);
  if (req.method === 'POST') return onboardHandler(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
