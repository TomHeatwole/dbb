/**
 * Fallback image used when a player's logo/headshot is not available.
 * Served from public/missing.png.
 */
export const PLAYER_LOGO_MISSING = `${process.env.PUBLIC_URL || ''}/missing.png`;

/**
 * Returns the URL to use for a player's logo. Use this whenever rendering
 * a player headshot/photo so that missing images show the shared fallback
 * instead of nothing.
 * @param {string | null | undefined} photoUrl - Player photo URL (e.g. espn_photo_url, headshot_url).
 * @returns {string} photoUrl if truthy, otherwise PLAYER_LOGO_MISSING.
 */
export function getPlayerLogoUrl(photoUrl) {
  return photoUrl && photoUrl.trim() ? photoUrl : PLAYER_LOGO_MISSING;
}
