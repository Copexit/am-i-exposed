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
  const analyst = page.locator("#analyst");
  await analyst.scrollIntoViewIfNeeded();
  const heatmapTitle = analyst.getByText("Link Probability Matrix");
  await expect(heatmapTitle).toBeVisible({ timeout: 15_000 });

  await expect(analyst.getByText("interpretations").first()).toBeVisible({ timeout: 10_000 });
  await expect(analyst.getByText("bits entropy").first()).toBeVisible();
});

test("Boltzmann heatmap renders for the home page JoinMarket example (multi-input makers)", async ({ page }) => {
  // 23 inputs x 19 outputs: makers fund the denomination from 2-3 inputs, which
  // used to route to exact DFS and spin forever.
  await page.goto(
    "/#tx=6cb2433f28177a3b07073a0eb34a527ba6d7dd7483cccb394f88321373c0ed20",
  );
  await expect(page.getByTestId("score-display")).toBeVisible({ timeout: 15_000 });

  const analyst = page.locator("#analyst");
  await analyst.scrollIntoViewIfNeeded();
  await expect(analyst.getByText("Link Probability Matrix")).toBeVisible({ timeout: 15_000 });
  await expect(analyst.getByText("(JoinMarket-optimized)")).toBeVisible({ timeout: 15_000 });
  await expect(analyst.getByText("bits entropy").first()).toBeVisible();
  await expect(analyst.getByText("Computing link probabilities...")).toHaveCount(0);
  // Maker-model links are "likely", never the critical deterministic pill
  await expect(analyst.getByTestId("model-links")).toContainText("likely under the JoinMarket maker model");
  await expect(analyst.getByText(/deterministic link/)).toHaveCount(0);
  await expect(analyst.getByText("(model estimate)").first()).toBeVisible();
});
