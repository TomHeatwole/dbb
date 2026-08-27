// Hardcoded Sleeper usernames that can open unlisted/internal pages.
export const ADMIN_SLEEPER_USERNAMES = [
  'sleeperdotcom',
  'jheatwole',
];

// /redraftdash is admin-gated plus extra Sleeper accounts that only get this page.
export const REDRAFT_DASH_SLEEPER_USERNAMES = [
  ...ADMIN_SLEEPER_USERNAMES,
  'aaaa',
];

function sleeperHandle(user) {
  if (!user?.onboarded || !user.sleeperUsername) return null;
  return String(user.sleeperUsername).toLowerCase();
}

export function isAdminUser(user) {
  const handle = sleeperHandle(user);
  return handle != null && ADMIN_SLEEPER_USERNAMES.includes(handle);
}

export function canAccessRedraftDash(user) {
  const handle = sleeperHandle(user);
  return handle != null && REDRAFT_DASH_SLEEPER_USERNAMES.includes(handle);
}
