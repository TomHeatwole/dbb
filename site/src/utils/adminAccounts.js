// Hardcoded Sleeper usernames that can open unlisted/internal pages.
export const ADMIN_SLEEPER_USERNAMES = [
  'sleeperdotcom',
  'jheatwole',
];

// /redraftdash is admin-gated plus extra Sleeper accounts that only get this page.
export const REDRAFT_DASH_SLEEPER_USERNAMES = [
  ...ADMIN_SLEEPER_USERNAMES,
  'aaaa',
  'rdguest',
];

// Email allowlist for accounts that never completed Sleeper onboarding.
export const REDRAFT_DASH_EMAILS = [
  '0405110197a@gmail.com',
];

function sleeperHandle(user) {
  if (!user?.onboarded || !user.sleeperUsername) return null;
  return String(user.sleeperUsername).toLowerCase();
}

function userEmail(user) {
  if (!user?.email) return null;
  return String(user.email).toLowerCase();
}

export function isAdminUser(user) {
  const handle = sleeperHandle(user);
  return handle != null && ADMIN_SLEEPER_USERNAMES.includes(handle);
}

export function canAccessRedraftDash(user) {
  const handle = sleeperHandle(user);
  if (handle != null && REDRAFT_DASH_SLEEPER_USERNAMES.includes(handle)) return true;
  const email = userEmail(user);
  return email != null && REDRAFT_DASH_EMAILS.includes(email);
}
