// Local impersonation for the logged-in team highlight + Your Team home card.
// Set to a Sleeper roster_id (usually 1–10). null = use the real signed-in account.
//
// Leave this null before committing.

export const LOGGED_IN_TEAM = null;

export function getLoggedInTeamOverride() {
  if (LOGGED_IN_TEAM == null || LOGGED_IN_TEAM === '') return null;
  const n = Number(LOGGED_IN_TEAM);
  return Number.isFinite(n) ? n : null;
}
