// Hardcoded Sleeper usernames that can open unlisted/internal pages.
export const ADMIN_SLEEPER_USERNAMES = [
  'sleeperdotcom',
  'jheatwole',
];

export function isAdminUser(user) {
  if (!user?.onboarded || !user.sleeperUsername) return false;
  return ADMIN_SLEEPER_USERNAMES.includes(String(user.sleeperUsername).toLowerCase());
}
