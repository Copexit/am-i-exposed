import { test, expect } from "@playwright/test";
import { mockMempoolApi, mockObservatoryApi } from "./helpers/mock-api";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
  await mockObservatoryApi(page);
});

test("observatory renders Whirlpool pools, recent cycles and WabiSabi coordinators", async ({ page }) => {
  await page.goto("/observatory/");

  // Whirlpool pools from whirlpool-summary.json
  await expect(page.getByText("0.025 BTC Pool").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("0.25 BTC Pool").first()).toBeVisible();

  // Recent cycles table from whirlpool-txs.json
  await expect(page.getByRole("heading", { name: "Recent Whirlpool cycles" })).toBeVisible();

  // Coordinators from liquisabi-dashboard.json (JSON-RPC envelope unwrapped)
  for (const name of ["Kruw.io", "OpenCoordinator", "Gingerwallet"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  // Both sources succeeded, so neither error state is shown
  await expect(page.getByText(/Live data is not available|Live source unreachable/)).toHaveCount(0);
});
