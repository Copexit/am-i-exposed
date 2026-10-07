import type { Venue } from "./types";

/** RoboSats coordinators with a dedicated `--p2p-coord-<key>` token (globals.css, both themes). */
export const P2P_COORD_KEYS: readonly string[] = ["temple", "lake", "bazaar", "alice", "eleuteria", "freeport", "ammanaya"];

/** Venue fill (bars, wall steps). */
export const venueColorVar = (v: Venue): string => `var(--p2p-${v})`;
/** Venue text and small marks on cards. */
export const venueFgVar = (v: Venue): string => `var(--p2p-${v}-fg)`;

/** RoboSats coordinators get their own token; Mostro instances and HodlHodl use the venue colour. */
export const hostColorVar = (venue: Venue, key: string, fg = true): string =>
  venue === "robosats" && P2P_COORD_KEYS.includes(key)
    ? `var(--p2p-coord-${key}${fg ? "-fg" : ""})`
    : fg ? venueFgVar(venue) : venueColorVar(venue);
