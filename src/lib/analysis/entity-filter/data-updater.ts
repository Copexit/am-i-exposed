/**
 * Service worker messaging and cache invalidation for entity data updates.
 *
 * Handles checking for newer full entity data on the server and
 * forcing re-downloads when the user requests an update.
 */

import type { AddressFilter } from "./types";
import type { ProgressCallback } from "./filter-loader";

const DATA_CACHE_NAME = "ami-exposed-data";

const FULL_INDEX_PATH = "/data/entity-index-full.bin";
const FULL_BLOOM_PATH = "/data/entity-filter-full.bin";

/**
 * Check if the server has newer full entity data than what's cached.
 * Sends a message to the service worker to compare cached ETags vs server.
 * Returns true if an update is available for the full database.
 */
export async function checkForFullDataUpdate(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg?.active) return false;

    const channel = new MessageChannel();
    const activeWorker = reg.active;
    const result = await new Promise<
      Record<string, { cached: boolean; updateAvailable: boolean }>
    >((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 10_000);
      channel.port1.onmessage = (e) => {
        clearTimeout(timeout);
        resolve(e.data);
      };
      activeWorker.postMessage(
        {
          type: "CHECK_DATA_ETAGS",
          paths: [FULL_INDEX_PATH, FULL_BLOOM_PATH],
        },
        [channel.port2],
      );
    });

    return (
      (result[FULL_INDEX_PATH]?.updateAvailable ?? false) ||
      (result[FULL_BLOOM_PATH]?.updateAvailable ?? false)
    );
  } catch {
    return false;
  }
}

/**
 * Force re-download of full entity data (clears cache, re-fetches).
 * Called when user clicks "Update to latest database".
 *
 * @param resetFullState - Callback to reset full filter state in filter-loader
 * @param reloadFull - Function to trigger a fresh loadFullEntityFilter
 * @param onProgress - Optional callback for download progress
 */
export async function updateFullEntityData(
  resetFullState: () => void,
  reloadFull: (onProgress?: ProgressCallback) => Promise<AddressFilter | null>,
  onProgress?: ProgressCallback,
): Promise<AddressFilter | null> {
  // Clear cached full data so the SW fetches fresh copies
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    await cache.delete(FULL_INDEX_PATH);
    await cache.delete(FULL_BLOOM_PATH);
  } catch {
    // Cache API may not be available (e.g., private browsing)
  }

  // Reset state so loadFullEntityFilter re-fetches from network
  resetFullState();

  return reloadFull(onProgress);
}
