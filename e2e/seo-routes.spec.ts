import { test, expect } from "@playwright/test";
import { mockMempoolApi, mockObservatoryApi } from "./helpers/mock-api";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
  await mockObservatoryApi(page);
});

const OBS = [
  { path: "/observatory/wabisabi/", tab: "WabiSabi (Wasabi)", h1: "Live CoinJoin map: WabiSabi coordinators", ready: "#obs-map" },
  { path: "/observatory/whirlpool/", tab: "Whirlpool (Ashigaru)", h1: "Whirlpool CoinJoin pools (Ashigaru)", ready: "text=0.025 BTC Pool" },
  { path: "/observatory/p2p/", tab: "P2P markets", h1: "KYC-free bitcoin P2P offers: RoboSats, Mostro, HodlHodl", ready: "[data-testid=p2p-headline]" },
] as const;

const GUIDE = [
  { path: "/guide/labeling/", h1: "How to label bitcoin UTXOs (BIP329 and Sparrow)", section: "#labeling-coins" },
  { path: "/guide/spending/", h1: "Bitcoin coin control privacy checklist", section: "#spending-checklist" },
] as const;

for (const r of OBS) {
  test(`${r.path} opens its tab under its own H1, without horizontal scroll at 390 px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(r.path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(r.h1);
    await expect(page.getByRole("tab", { name: r.tab })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(r.ready).first()).toBeVisible({ timeout: 20_000 });
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw).toBeLessThanOrEqual(iw);
  });
}

for (const r of GUIDE) {
  test(`${r.path} renders its section under its own H1, without horizontal scroll at 390 px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(r.path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(r.h1);
    await expect(page.locator(r.section)).toBeVisible();
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw).toBeLessThanOrEqual(iw);
  });
}

test("old hub deep links open the tab route with the rest of the hash", async ({ page }) => {
  await page.goto("/observatory/#p2p&cur=EUR");
  await expect(page).toHaveURL(/\/observatory\/p2p\/#cur=EUR$/);
  await expect(page.getByRole("tab", { name: "P2P markets" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("p2p-offers").locator("caption")).toContainText("EUR", { timeout: 20_000 });

  await page.goto("/observatory/#wabisabi&coordinator=kruw");
  await expect(page).toHaveURL(/\/observatory\/wabisabi\/#coordinator=kruw$/);
  await expect(page.getByRole("heading", { name: "Kruw" }).first()).toBeVisible({ timeout: 15_000 });
});

test("the hub shows WabiSabi; tab clicks navigate between the routes with history entries", async ({ page }) => {
  await page.goto("/observatory/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("CoinJoin Observatory");
  await expect(page.getByRole("tab", { name: "WabiSabi (Wasabi)" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Whirlpool (Ashigaru)" }).click();
  await expect(page).toHaveURL(/\/observatory\/whirlpool\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Whirlpool CoinJoin pools (Ashigaru)");
  await page.getByRole("tab", { name: "P2P markets" }).click();
  await expect(page).toHaveURL(/\/observatory\/p2p\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/observatory\/whirlpool\/$/);
  await expect(page.getByRole("tab", { name: "Whirlpool (Ashigaru)" })).toHaveAttribute("aria-selected", "true");
});

test("old /guide/ anchors of the moved sections land on the topic route", async ({ page }) => {
  await page.goto("/guide/#spending-checklist");
  await expect(page).toHaveURL(/\/guide\/spending\/#spending-checklist$/);
  await expect(page.locator("#spending-checklist")).toBeInViewport();
  await page.goto("/guide/#labeling-rule-3");
  await expect(page).toHaveURL(/\/guide\/labeling\/#labeling-rule-3$/);
  await expect(page.locator("#labeling-rule-3")).toBeInViewport();
});

test("/guide/ links to the topic routes", async ({ page }) => {
  await page.goto("/guide/");
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await toc.getByRole("link", { name: /Labeling recommendations/ }).click();
  await expect(page).toHaveURL(/\/guide\/labeling\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How to label bitcoin UTXOs (BIP329 and Sparrow)");
});
