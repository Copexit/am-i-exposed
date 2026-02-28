import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

test("Whirlpool CoinJoin scores A+ 100", async ({ page }) => {
  await page.goto(
    "/#tx=323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2",
  );

  const scoreDisplay = page.locator("[data-testid='score-display']");
  await expect(scoreDisplay).toBeVisible({ timeout: 15_000 });
  await expect(scoreDisplay).toHaveAttribute("data-grade", "A+");
  await expect(scoreDisplay).toHaveAttribute("data-score", "100");
});

test("Simple legacy P2PKH scores C 65", async ({ page }) => {
  await page.goto(
    "/#tx=0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4",
  );

  const scoreDisplay = page.locator("[data-testid='score-display']");
  await expect(scoreDisplay).toBeVisible({ timeout: 15_000 });
  await expect(scoreDisplay).toHaveAttribute("data-grade", "C");
  await expect(scoreDisplay).toHaveAttribute("data-score", "65");
});

test("Nonexistent txid shows error message", async ({ page }) => {
  await page.goto(
    "/#tx=0000000000000000000000000000000000000000000000000000000000000000",
  );

  const errorMsg = page.locator("[data-testid='error-message']");
  await expect(errorMsg).toBeVisible({ timeout: 15_000 });
});
