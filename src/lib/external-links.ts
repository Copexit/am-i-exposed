/** Canonical external URLs for the official app-store listings. */

/** Public Umbrel App Store listing page (browsable on the clearnet web). */
export const UMBREL_APP_URL = "https://apps.umbrel.com/app/am-i-exposed";

/**
 * Public Start9 marketplace listing.
 *
 * TODO: marketplace.start9.com/am-i-exposed returns 404 upstream as of 2026-06.
 * Until Start9 publishes the public per-app page, link the StartOS button to the
 * in-app setup guide (`/setup-guide/#start9`) instead of this URL. Swap the
 * banner/links over to STARTOS_MARKETPLACE_URL once it resolves.
 */
export const STARTOS_MARKETPLACE_URL = "https://marketplace.start9.com/am-i-exposed";

/** In-app fallback target for StartOS install instructions. */
export const STARTOS_SETUP_ANCHOR = "/setup-guide/#start9";
