import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

// Classic and v2 UIs share the scanner, so each behavior is checked in both.
for (const base of ["/", "/v2/"]) {
test.describe(`${base}`, () => {
  test.beforeEach(async ({ page }) => {
    await mockMempoolApi(page);
  });

  test("Satoshi genesis address scores F 0", async ({ page }) => {
    await page.goto(`${base}#addr=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa`);

    const scoreDisplay = page.locator("[data-testid='score-display']");
    await expect(scoreDisplay).toBeVisible({ timeout: 15_000 });
    await expect(scoreDisplay).toHaveAttribute("data-grade", "F");
    await expect(scoreDisplay).toHaveAttribute("data-score", "0");
  });
});
}
