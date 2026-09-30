import { test, expect } from "@playwright/test";
import { mockMempoolApi, mockObservatoryApi } from "./helpers/mock-api";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
  await mockObservatoryApi(page);
});

test("Whirlpool tab shows pools and recent cycles only", async ({ page }) => {
  await page.goto("/observatory/");

  const whirlpoolTab = page.getByRole("tab", { name: "Whirlpool (Ashigaru)" });
  await expect(whirlpoolTab).toHaveAttribute("aria-selected", "true");

  // Whirlpool pools from whirlpool-summary.json
  await expect(page.getByText("0.025 BTC Pool").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("0.25 BTC Pool").first()).toBeVisible();

  // Recent cycles table from whirlpool-txs.json
  await expect(page.getByRole("heading", { name: "Recent Whirlpool cycles" })).toBeVisible();

  // WabiSabi content lives in the other tab
  await expect(page.getByRole("heading", { name: "WabiSabi coordinators" })).toHaveCount(0);
  await expect(page.getByText(/Live data is not available|Live source unreachable/)).toHaveCount(0);
});

test("WabiSabi tab shows coordinators and the last rounds, and is linkable", async ({ page }) => {
  await page.goto("/observatory/");
  await expect(page.getByText("0.025 BTC Pool").first()).toBeVisible({ timeout: 15_000 });

  // Keyboard: arrow right moves to and activates the WabiSabi tab
  await page.getByRole("tab", { name: "Whirlpool (Ashigaru)" }).focus();
  await page.keyboard.press("ArrowRight");
  const wabisabiTab = page.getByRole("tab", { name: "WabiSabi (Wasabi)" });
  await expect(wabisabiTab).toHaveAttribute("aria-selected", "true");
  await expect(wabisabiTab).toBeFocused();
  await expect(page).toHaveURL(/#wabisabi$/);

  // Coordinators from liquisabi-dashboard.json (JSON-RPC envelope unwrapped)
  for (const name of ["Kruw.io", "OpenCoordinator", "Gingerwallet"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Whirlpool pools" })).toHaveCount(0);

  // Recent rounds from PaginatedRounds, linked to the in-app scanner
  await expect(page.getByRole("heading", { name: "Recent WabiSabi rounds" })).toBeVisible();
  const txid = "789dce145e60f0c8037a6aaa66b25dd2693d5145fd84ba3646e06d71f833b548";
  await expect(page.locator(`a[href="/#tx=${txid}"]`)).toBeVisible();
  await expect(page.locator('a[href^="/#tx="]')).toHaveCount(2);

  // The hash deep-links the tab, and the last click is remembered without one
  await page.goto("/observatory/#whirlpool");
  await expect(page.getByRole("tab", { name: "Whirlpool (Ashigaru)" })).toHaveAttribute("aria-selected", "true");
  await page.goto("/observatory/");
  await expect(page.getByRole("tab", { name: "WabiSabi (Wasabi)" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Recent WabiSabi rounds" })).toBeVisible({ timeout: 15_000 });
});
