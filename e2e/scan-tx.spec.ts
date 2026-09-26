import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

// Classic and v2 UIs share the scanner, so each behavior is checked in both.
for (const base of ["/", "/v2/"]) {
test.describe(`${base}`, () => {
  test.beforeEach(async ({ page }) => {
    await mockMempoolApi(page);
  });

  test("Whirlpool CoinJoin scores A+ 100", async ({ page }) => {
    await page.goto(`${base}#tx=323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2`);

    const scoreDisplay = page.locator("[data-testid='score-display']");
    await expect(scoreDisplay).toBeVisible({ timeout: 15_000 });
    await expect(scoreDisplay).toHaveAttribute("data-grade", "A+");
    await expect(scoreDisplay).toHaveAttribute("data-score", "100");
  });

  // Web scans include chain and entity findings in the grade (heuristics alone
  // give 52, as in golden-cases): chain-near-exact-spend -1, and the bundled
  // entity index labels output 0 as BTCC (known-entity output) -1. A 1-input tx
  // has no linkability finding (zero entropy is scored by H5).
  test("Simple legacy P2PKH scores C 50", async ({ page }) => {
    await page.goto(`${base}#tx=0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4`);

    const scoreDisplay = page.locator("[data-testid='score-display']");
    await expect(scoreDisplay).toBeVisible({ timeout: 15_000 });
    await expect(scoreDisplay).toHaveAttribute("data-grade", "C");
    await expect(scoreDisplay).toHaveAttribute("data-score", "50");
  });

  test("Nonexistent txid shows error message", async ({ page }) => {
    await page.goto(`${base}#tx=0000000000000000000000000000000000000000000000000000000000000000`);

    const errorMsg = page.locator("[data-testid='error-message']");
    await expect(errorMsg).toBeVisible({ timeout: 15_000 });
  });
});
}
