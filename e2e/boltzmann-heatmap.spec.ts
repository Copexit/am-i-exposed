import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

test("Boltzmann heatmap renders for Whirlpool 5x5 CoinJoin", async ({ page }) => {
  await page.goto(
    "/#tx=323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2",
  );

  // Wait for analysis to complete
  const scoreDisplay = page.locator("[data-testid='score-display']");
  await expect(scoreDisplay).toBeVisible({ timeout: 15_000 });

  // Wait for Boltzmann auto-compute (<=8x8 triggers automatically)
  const heatmapTitle = page.locator("text=Link Probability Matrix");
  await expect(heatmapTitle).toBeVisible({ timeout: 15_000 });

  // Verify computation completed with expected results
  await expect(page.locator("text=interpretations")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("text=bits entropy")).toBeVisible();
});
