// POST /api/onboard { sleeperUsername } — attach a verified Sleeper username
// to the authenticated user's account. The username must resolve to a real
// Sleeper user via the public Sleeper API.

import { getSql } from '../lib/db.mjs';
import { getSessionUser } from '../lib/authServer.mjs';

const SLEEPER_USERNAME_RE = /^[A-Za-z0-9_]{1,32}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Not signed in' });
    }

    const raw = req.body?.sleeperUsername;
    const username = typeof raw === 'string' ? raw.trim() : '';
    if (!SLEEPER_USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Enter a valid Sleeper username (letters, numbers, underscores)' });
    }

    // Verify against Sleeper — returns the user object, or null/404 if no such user
    const sleeperRes = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`);
    const sleeperUser = sleeperRes.ok ? await sleeperRes.json().catch(() => null) : null;
    if (!sleeperUser || !sleeperUser.user_id) {
      return res.status(400).json({ error: `No Sleeper user named "${username}" found` });
    }

    const sql = getSql();
    const [profile] = await sql`
      INSERT INTO app_users (auth_user_id, sleeper_username, sleeper_user_id, sleeper_display_name, sleeper_avatar)
      VALUES (${user.userId}, ${sleeperUser.username || username}, ${sleeperUser.user_id},
              ${sleeperUser.display_name || null}, ${sleeperUser.avatar || null})
      ON CONFLICT (auth_user_id) DO UPDATE SET
        sleeper_username = EXCLUDED.sleeper_username,
        sleeper_user_id = EXCLUDED.sleeper_user_id,
        sleeper_display_name = EXCLUDED.sleeper_display_name,
        sleeper_avatar = EXCLUDED.sleeper_avatar,
        updated_at = now()
      RETURNING sleeper_username, sleeper_user_id, sleeper_display_name
    `;

    return res.status(200).json({
      ok: true,
      sleeperUsername: profile.sleeper_username,
      sleeperDisplayName: profile.sleeper_display_name,
    });
  } catch (e) {
    // Unique violation: that Sleeper account is already claimed by another login
    if (e.code === '23505') {
      return res.status(409).json({ error: 'That Sleeper account is already linked to another user' });
    }
    console.error('onboard API error:', e);
    return res.status(500).json({ error: 'Server error', details: e.message });
  }
}
