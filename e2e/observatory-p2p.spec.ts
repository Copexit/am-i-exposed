import { test, expect, type Page } from "@playwright/test";
import { failP2pRoute, mockMempoolApi, mockObservatoryApi, P2P_FIXTURE_TIME } from "./helpers/mock-api";

const WORKER = "https://coinjoin-stats.copexit.workers.dev";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(P2P_FIXTURE_TIME);
  await mockMempoolApi(page);
  await mockObservatoryApi(page);
});

const rows = (page: Page) => page.locator("[data-testid=p2p-offer-row]");
const headline = (page: Page) => page.getByTestId("p2p-headline");

test("P2P tab: headline with liquidity, four sources, the wall and offers", async ({ page }) => {
  await page.goto("/observatory/p2p/");
  await expect(page.getByRole("tab", { name: "P2P markets" })).toHaveAttribute("aria-selected", "true");
  await expect(headline(page)).toContainText(/Up to [1-9][\d.,]* BTC for sale without KYC/, { timeout: 20_000 });
  await expect(page.locator("[data-testid^=p2p-source-]")).toHaveCount(4);
  await expect(page.locator("#p2p-markets svg[role=img]")).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
});

test("a currency chip writes cur= and updates the list", async ({ page }) => {
  await page.goto("/observatory/p2p/");
  await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("list", { name: "Currency" }).getByRole("button", { name: /^EUR/ }).click();
  await expect(page).toHaveURL(/p2p\/#cur=EUR$/);
  await expect(page.getByTestId("p2p-offers").locator("caption")).toContainText("EUR");
});

test("#p2p&side=sell lists buy offers", async ({ page }) => {
  await page.goto("/observatory/p2p/#side=sell");
  await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });
  await expect(rows(page).first()).toHaveAttribute("data-side", "buy");
  await expect(page.getByRole("button", { name: "I want to sell BTC" })).toHaveAttribute("aria-pressed", "true");
});

test("turning HodlHodl off removes its rows; the state survives a reload", async ({ page }) => {
  await page.goto("/observatory/p2p/#cur=USD");
  await expect(page.locator("[data-testid=p2p-offer-row][data-venue=hodlhodl]").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("list", { name: "Venues" }).getByRole("button", { name: "HodlHodl" }).click();
  await expect(page).toHaveURL(/venue=robosats,mostro/);
  await expect(page.locator("[data-testid=p2p-offer-row][data-venue=hodlhodl]")).toHaveCount(0);
  await expect(rows(page).first()).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/p2p\/#cur=USD&venue=robosats,mostro$/);
  await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-testid=p2p-offer-row][data-venue=hodlhodl]")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Venues" }).getByRole("button", { name: "HodlHodl" })).toHaveAttribute("aria-pressed", "false");
});

test("HodlHodl down: its chip says down and the Nostr venues still render", async ({ page }) => {
  await failP2pRoute(page, "/svc/hodlhodl/api/v1/offers");
  await page.goto("/observatory/p2p/#cur=USD");
  await expect(page.getByTestId("p2p-source-hodlhodl")).toHaveAttribute("data-state", "down", { timeout: 20_000 });
  await expect(page.getByTestId("p2p-source-hodlhodl")).toContainText("down");
  await expect(page.locator("[data-testid=p2p-offer-row][data-venue=robosats], [data-testid=p2p-offer-row][data-venue=mostro]").first()).toBeVisible();
  await expect(page.locator("[data-testid=p2p-offer-row][data-venue=hodlhodl]")).toHaveCount(0);
});

test("no P2P request leaves for a third party: only the app and the relay worker", async ({ page }) => {
  const hosts = new Set<string>();
  page.on("request", (r) => hosts.add(new URL(r.url()).origin));
  await page.goto("/observatory/p2p/");
  await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });
  // Scroll to the end so the lazy history loads too.
  await page.locator("#p2p-volume").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("p2p-mostro-days")).toBeVisible({ timeout: 20_000 });
  const app = new URL(page.url()).origin;
  // App-wide probes that run on every page (chain tip, Tor detection) are not part of the P2P tab.
  const appProbes = (h: string) => h === "https://mempool.space" || h === "https://tor-check.copexit.workers.dev" || /^http:\/\/mempool[a-z2-7]+\.onion$/.test(h);
  const unexpected = [...hosts].filter((h) => h !== app && h !== WORKER && !appProbes(h));
  expect(unexpected).toEqual([]);
  const venue = /robosats|thebiglake|templeofsats|hodlhodl|mostro|damus|nos\.lol|librebazov|ngdk7ocd|4t4jxmiv|alice7bq|ixiiqsuz|2enoseg6|ammannjg/;
  expect([...hosts].filter((h) => venue.test(h))).toEqual([]);
});

test("payment-method filter: pick Revolut, the list narrows, pm= survives a reload, clear restores", async ({ page }) => {
  await page.goto("/observatory/p2p/#cur=EUR");
  await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("p2p-pm-trigger").click();
  const any = page.getByRole("group", { name: "Payment method" }).getByRole("button", { name: /^Any payment method/ });
  const total = Number((await any.textContent())!.replace(/\D/g, ""));
  await page.getByRole("searchbox", { name: "Search payment methods" }).fill("revol");
  await page.getByRole("group", { name: "Payment method" }).getByRole("button", { name: /^Revolut/ }).click();
  await expect(page).toHaveURL(/p2p\/#cur=EUR&pm=revolut$/);
  await expect(page.getByTestId("p2p-pm-note")).toContainText("Revolut");
  await expect(rows(page).first()).toBeVisible();
  const shown = Number((await page.getByTestId("p2p-pm-note").textContent())!.match(/(\d+) offers?/)![1]);
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(total);
  expect(await rows(page).count()).toBe(Math.min(shown, 25));

  await page.reload();
  await expect(page.getByTestId("p2p-pm-note")).toContainText("Revolut", { timeout: 20_000 });
  await expect(page.getByTestId("p2p-pm-trigger")).toContainText("Revolut");
  await page.getByRole("button", { name: "Clear payment method filter" }).click();
  await expect(page).toHaveURL(/p2p\/#cur=EUR$/);
  await expect(page.getByTestId("p2p-pm-note")).toHaveCount(0);
});

test("payment-method picker open at 390 px: no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/observatory/p2p/#cur=EUR&pm=sepa-instant");
  await expect(page.locator("[data-testid=p2p-offer-card]").first()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("p2p-pm-trigger").click();
  await expect(page.getByRole("searchbox", { name: "Search payment methods" })).toBeFocused();
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(iw);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("p2p-pm-trigger")).toBeFocused();
});

test("amount filter: €250 narrows the list, names the cheapest venue, survives a reload, clears on currency change", async ({ page }) => {
  await page.goto("/observatory/p2p/#cur=EUR");
  await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });
  const input = page.getByRole("textbox", { name: "Amount in EUR" });
  await input.fill("250");
  await expect(page).toHaveURL(/p2p\/#cur=EUR&amt=250&amtu=fiat$/);
  // The clear button is not part of the input's name.
  await expect(page.getByRole("textbox", { name: "Amount in EUR", exact: true })).toHaveValue("250");
  await expect(page.getByTestId("p2p-amount")).toHaveAccessibleName("Amount in EUR");
  await expect(page.getByTestId("p2p-amount-converted")).toContainText(/≈ 0\.00\d+ BTC/);
  await expect(page.getByTestId("p2p-pm-note")).toContainText("Offers that accept €250:");
  await expect(page.getByTestId("p2p-amount-best")).toContainText(/^Cheapest for €250: \S.+, [+−]?\d+\.\d%\.$/);
  const shown = Number((await page.getByTestId("p2p-pm-note").textContent())!.match(/(\d+) offers?/)![1]);
  expect(shown).toBeGreaterThan(0);
  expect(await rows(page).count()).toBeGreaterThanOrEqual(Math.min(shown, 25));

  await page.reload();
  await expect(page.getByTestId("p2p-pm-note")).toContainText("€250", { timeout: 20_000 });
  await expect(page.getByRole("textbox", { name: "Amount in EUR" })).toHaveValue("250");
  await page.getByRole("list", { name: "Currency" }).getByRole("button", { name: /^USD \d/ }).click();
  await expect(page).toHaveURL(/p2p\/#cur=USD$/);
  await expect(page.getByRole("textbox", { name: "Amount in USD" })).toHaveValue("");
});

test("amount filter at 390 px: no horizontal scroll with a value and the note", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/observatory/p2p/#cur=EUR&amt=250&amtu=fiat");
  await expect(page.locator("[data-testid=p2p-offer-card]").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("p2p-amount-best")).toBeVisible();
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(iw);
});

for (const lang of ["en", "de", "pl"]) {
  test(`no horizontal scroll at 390 px (${lang})`, async ({ page }) => {
    await page.addInitScript((l) => { try { localStorage.setItem("ami-language", l); } catch { /* private mode */ } }, lang);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/observatory/p2p/");
    await expect(page.locator("[data-testid=p2p-offer-card]").first()).toBeVisible({ timeout: 20_000 });
    await expect(headline(page)).toBeVisible();
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw).toBeLessThanOrEqual(iw);
  });
}

test("WabiSabi and Whirlpool tabs still render", async ({ page }) => {
  await page.goto("/observatory/wabisabi/");
  await expect(page.locator("#obs-map")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Whirlpool (Ashigaru)" }).click();
  await expect(page.getByText("0.025 BTC Pool").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "P2P markets" }).click();
  await expect(headline(page)).toBeVisible({ timeout: 20_000 });
});
