import { test, expect, type Page } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

// Export names Turbopack keeps in engine chunks (heuristics pipeline, entity/OFAC data).
const ENGINE_MARKERS = ["applyCrossHeuristicRules", "analyzeAddress", "loadEntityFilter", "checkOfac"];

async function engineChunksLoaded(page: Page, route: string): Promise<string[]> {
  const offenders: string[] = [];
  const pending: Promise<void>[] = [];
  page.on("response", (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith("/_next/static/") || !url.pathname.endsWith(".js")) return;
    pending.push(res.text().then((body) => {
      const hit = ENGINE_MARKERS.find((m) => body.includes(`"${m}"`));
      if (hit) offenders.push(`${url.pathname} (${hit})`);
    }, () => {}));
  });
  await page.goto(route, { waitUntil: "networkidle" });
  // Viewport prefetches of linked routes fire after hydration
  await page.waitForTimeout(1500);
  await Promise.all(pending);
  return offenders;
}

// Keeps the markers honest: the scanner warms the engine after first paint.
test("the scanner page still loads the engine (markers are valid)", async ({ page }) => {
  await mockMempoolApi(page);
  expect((await engineChunksLoaded(page, "/")).length).toBeGreaterThan(0);
});

// Content pages (and the routes they prefetch) must not download the analysis engine.
for (const route of ["/about/", "/faq/"]) {
  test(`${route} loads no analysis engine code`, async ({ page }) => {
    await mockMempoolApi(page);
    expect(await engineChunksLoaded(page, route)).toEqual([]);
  });
}
