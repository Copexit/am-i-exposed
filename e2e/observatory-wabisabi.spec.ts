import { test, expect } from "@playwright/test";
import { mockMempoolApi, mockObservatoryApi } from "./helpers/mock-api";

const KNOWN_TX = "7270e1b805bfde3529bac3f372e131feca97c10d2b5a47253d052f457670b53c";
const UNKNOWN_TX = "ab".repeat(32);
const coinjoins = (page: import("@playwright/test").Page) => page.getByTestId("obs-stat-coinjoins");

let wabisatorBodies: string[];

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
  wabisatorBodies = await mockObservatoryApi(page);
});

test("loads the map, stats and live board", async ({ page }) => {
  await page.goto("/observatory/");
  await expect(page.getByRole("tab", { name: /WabiSabi/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#obs-map canvas").first()).toBeVisible({ timeout: 15_000 });
  await expect(coinjoins(page)).toContainText(/[1-9]/, { timeout: 15_000 });
  await expect(page.locator("#obs-live article").first()).toBeVisible({ timeout: 15_000 });
});

test("switching to 7 d updates the CoinJoins stat", async ({ page }) => {
  await page.goto("/observatory/");
  await expect(coinjoins(page)).toContainText(/[1-9]/, { timeout: 15_000 });
  const before = await coinjoins(page).textContent();
  await page.getByRole("button", { name: "7 d", exact: true }).click();
  await expect(coinjoins(page)).not.toHaveText(before ?? "", { timeout: 15_000 });
  await expect(coinjoins(page)).toContainText(/[1-9]/);
});

test("table view lists Kruw", async ({ page }) => {
  await page.goto("/observatory/");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByRole("rowheader", { name: /Kruw/ }).first()).toBeVisible({ timeout: 15_000 });
});

test("coordinator deep link shows the Kruw page with rounds", async ({ page }) => {
  await page.goto("/observatory/#wabisabi&coordinator=kruw");
  await expect(page.getByRole("heading", { name: "Kruw" }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Transaction" }) }).locator("tbody tr").first()).toBeVisible({ timeout: 15_000 });
});

test("search: a known txid is found, an unknown one links to the analyzer and is never sent", async ({ page }) => {
  await page.goto("/observatory/");
  await expect(coinjoins(page)).toContainText(/[1-9]/, { timeout: 15_000 });
  const box = page.getByRole("searchbox", { name: "Search a CoinJoin txid or a date" });

  await box.fill(KNOWN_TX);
  await box.press("Enter");
  await expect(page.locator("#obs-event-card")).toBeVisible({ timeout: 10_000 });

  await box.fill(UNKNOWN_TX);
  await box.press("Enter");
  await expect(page.getByTestId("obs-search-result").getByRole("link", { name: /Analyze in am-i.exposed/ })).toBeVisible();
  expect(wabisatorBodies.length).toBeGreaterThan(0);
  expect(wabisatorBodies.some((b) => b.includes(UNKNOWN_TX) || b.includes(KNOWN_TX))).toBe(false);
});

test("whirlpool tab still renders pool cards", async ({ page }) => {
  await page.goto("/observatory/#whirlpool");
  await expect(page.getByText("0.025 BTC Pool").first()).toBeVisible({ timeout: 15_000 });
});

test("no horizontal scroll at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/observatory/");
  await expect(coinjoins(page)).toContainText(/[1-9]/, { timeout: 15_000 });
  await expect(page.locator("#obs-live article").first()).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("an unknown coordinator and a malformed tx in the URL are ignored", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (e) => errors.push(e));
  await page.goto("/observatory/#wabisabi&coordinator=nope&tx=zz");
  await expect(coinjoins(page)).toContainText(/[1-9]/, { timeout: 15_000 });
  await expect(page.locator("#obs-map canvas").first()).toBeVisible();
  expect(errors).toEqual([]);
});
