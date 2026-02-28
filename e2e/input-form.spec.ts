import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

test("invalid input shows error message", async ({ page }) => {
  await page.goto("/");

  const input = page.locator("[data-testid='address-input']");
  const button = page.locator("[data-testid='scan-button']");

  await input.fill("not-a-valid-bitcoin-input");
  await button.click();

  const error = page.locator("[data-testid='input-error']");
  await expect(error).toBeVisible();
});

test("pasting a valid txid triggers auto-scan", async ({ page }) => {
  await page.goto("/");

  const input = page.locator("[data-testid='address-input']");

  // Simulate paste by setting clipboard and dispatching paste event
  const txid =
    "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2";
  await input.focus();
  await page.evaluate(async (text) => {
    const input = document.querySelector(
      "[data-testid='address-input']",
    ) as HTMLInputElement;
    // Create and dispatch a paste event with clipboard data
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const event = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
  }, txid);

  // Should trigger auto-scan - diagnostic loader or results should appear
  const loader = page.locator("[data-testid='diagnostic-loader']");
  const scoreDisplay = page.locator("[data-testid='score-display']");
  await expect(loader.or(scoreDisplay)).toBeVisible({ timeout: 10_000 });
});
