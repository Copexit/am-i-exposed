import { test, expect } from "@playwright/test";
import { mockMempoolApi, mockObservatoryApi } from "./helpers/mock-api";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
  await mockObservatoryApi(page);
});

test("Whirlpool tab shows pools and recent cycles only", async ({ page }) => {
  await page.goto("/observatory/whirlpool/");

  const whirlpoolTab = page.getByRole("tab", { name: "Whirlpool (Ashigaru)" });
  await expect(whirlpoolTab).toHaveAttribute("aria-selected", "true");

  // Whirlpool pools from whirlpool-summary.json
  await expect(page.getByText("0.025 BTC Pool").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("0.25 BTC Pool").first()).toBeVisible();

  // Recent cycles table from whirlpool-txs.json
  await expect(page.getByRole("heading", { name: "Recent Whirlpool cycles" })).toBeVisible();

  // WabiSabi content lives in the other tab
  await expect(page.locator("#obs-map")).toHaveCount(0);
  await expect(page.getByText(/Live data is not available|Live source unreachable/)).toHaveCount(0);
});
