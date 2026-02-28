import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

test("form submission updates URL hash", async ({ page }) => {
  await page.goto("/");

  const input = page.locator("[data-testid='address-input']");
  const button = page.locator("[data-testid='scan-button']");

  const txid =
    "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2";
  await input.fill(txid);
  await button.click();

  // URL hash should contain the txid
  await expect(page).toHaveURL(new RegExp(`#tx=${txid}`));
});

test("hash URL auto-triggers scan", async ({ page }) => {
  const txid =
    "0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4";
  await page.goto(`/#tx=${txid}`);

  // Should show loader or results (auto-scan triggered by hash)
  const loader = page.locator("[data-testid='diagnostic-loader']");
  const scoreDisplay = page.locator("[data-testid='score-display']");
  await expect(loader.or(scoreDisplay)).toBeVisible({ timeout: 15_000 });
});

test("clearing hash returns to idle state", async ({ page }) => {
  await page.goto(
    "/#tx=323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2",
  );

  // Wait for results to load
  const scoreDisplay = page.locator("[data-testid='score-display']");
  await expect(scoreDisplay).toBeVisible({ timeout: 15_000 });

  // Clear hash
  await page.evaluate(() => {
    window.location.hash = "";
  });

  // Should return to idle - input should be visible again
  const input = page.locator("[data-testid='address-input']");
  await expect(input).toBeVisible({ timeout: 5_000 });
});
