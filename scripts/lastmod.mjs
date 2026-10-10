// Git-based page dates, shared by generate-sitemap.mjs (lastmod) and src/app/seo-routes.ts (JSON-LD dates).
import { execSync } from "child_process";

/** Content sources of the split-out routes: the route folder plus the component that holds the content. */
export const ROUTE_SOURCES = {
  "/guide/labeling/": "src/app/guide/labeling src/components/guide/LabelingSection.tsx",
  "/guide/spending/": "src/app/guide/spending src/components/guide/LabelingSection.tsx",
  "/observatory/wabisabi/": "src/app/observatory/wabisabi src/components/observatory/wabisabi",
  "/observatory/whirlpool/": "src/app/observatory/whirlpool src/components/observatory/ObservatoryPage.tsx",
  "/observatory/p2p/": "src/app/observatory/p2p src/components/observatory/p2p",
};

const today = () => new Date().toISOString().split("T")[0];

/**
 * YYYY-MM-DD of the last (or, with first, the first) commit touching the space-separated paths,
 * tests excluded; today when uncommitted or outside git.
 * @param {string} paths
 * @param {{ first?: boolean }} [opts]
 * @returns {string}
 */
export function lastMod(paths, { first = false } = {}) {
  try {
    const log = execSync(`git log ${first ? "--reverse" : "-1"} --format=%cI -- ${paths} ':(exclude)**/__tests__/**'`, { encoding: "utf-8" }).trim();
    const date = log.split("\n")[0];
    return date ? date.split("T")[0] : today();
  } catch {
    return today();
  }
}
