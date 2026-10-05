import { test, expect, type Page } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

// Default build (NEXT_PUBLIC_VIDEOS unset): no video UI, no /media/ request anywhere.
function trackMedia(page: Page): string[] {
  const hits: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/media/")) hits.push(r.url());
  });
  return hits;
}

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

test("home has no promo, no Tutorial link, no /media/ request", async ({ page }) => {
  const media = trackMedia(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByPlaceholder(/Address, txid/)).toBeVisible(); // rendered and hydrated
  await expect(page.getByRole("button", { name: "Play the 1-minute overview" })).toHaveCount(0);
  await expect(page.locator('a[href="/tutorial/"]')).toHaveCount(0);
  await expect(page.locator("video")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(media).toEqual([]);
});

test("/tutorial/ shows the unavailable note and requests no media", async ({ page }) => {
  const media = trackMedia(page);
  await page.goto("/tutorial/");
  await expect(page.getByText("The video tutorial is available on am-i.exposed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play the tutorial" })).toHaveCount(0);
  await expect(page.locator("video")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(media).toEqual([]);
});
