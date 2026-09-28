import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

test("Boltzmann heatmap renders for Whirlpool 5x5 CoinJoin", async ({ page }) => {
  await page.goto(
    "/#tx=323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2",
  );
  await expect(page.getByTestId("score-display")).toBeVisible({ timeout: 15_000 });

  // The heat map lives in the analyst tools (open to everyone); Boltzmann
  // auto-computes for <=8x8 transactions.
  const analyst = page.locator("#v2-analyst");
  await analyst.scrollIntoViewIfNeeded();
  const heatmapTitle = analyst.getByText("Link Probability Matrix");
  await expect(heatmapTitle).toBeVisible({ timeout: 15_000 });

  await expect(analyst.getByText("interpretations").first()).toBeVisible({ timeout: 10_000 });
  await expect(analyst.getByText("bits entropy").first()).toBeVisible();
});
