import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

test("Satoshi genesis address scores F 0", async ({ page }) => {
  await page.goto("/#addr=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");

  const scoreDisplay = page.locator("[data-testid='score-display']");
  await expect(scoreDisplay).toBeVisible({ timeout: 15_000 });
  await expect(scoreDisplay).toHaveAttribute("data-grade", "F");
  await expect(scoreDisplay).toHaveAttribute("data-score", "0");
});
