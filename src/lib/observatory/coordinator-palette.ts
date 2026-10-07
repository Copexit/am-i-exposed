/** Coordinators with a dedicated colour token (`--coord-<key>` in globals.css, both themes). */
export const KNOWN_COORDINATORS: readonly string[] = ["kruw", "opencoordinator", "gingerwallet", "coinjoin_nl", "coinjoiner", "swisscoordinator", "openwasabi"];

/** CSS custom property name, for canvas `getComputedStyle` lookups. Unknown keys share `--coord-other`. */
export const coordinatorColorToken = (key: string): string =>
  `--coord-${KNOWN_COORDINATORS.includes(key) ? key : "other"}`;

export const coordinatorColorVar = (key: string): string => `var(${coordinatorColorToken(key)})`;

/** Darker-in-light variant for marks on cards, charts and legends (>= 3:1 on --card-bg). */
export const coordinatorFgVar = (key: string): string => `var(${coordinatorColorToken(key)}-fg)`;
