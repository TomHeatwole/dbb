// GET /api/me — current authenticated user + Sleeper onboarding status.
// Requires Authorization: Bearer <session token>.
// Returns { user: null } when not signed in (200, not 401, so the frontend
// can treat "signed out" as a normal state).

import { getSessionUser, getAppProfile } from '../lib/authServer.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return res.status(200).json({ user: null });
    }
    const profile = await getAppProfile(user.userId);
    return res.status(200).json({
      user: {
        id: user.userId,
        email: user.email,
        name: user.name,
        image: user.image,
        onboarded: Boolean(profile),
        sleeperUsername: profile?.sleeper_username || null,
        sleeperDisplayName: profile?.sleeper_display_name || null,
      },
    });
  } catch (e) {
    console.error('me API error:', e);
    return res.status(500).json({ error: 'Server error', details: e.message });
  }
}
