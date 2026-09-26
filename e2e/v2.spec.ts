import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

// v2-specific behavior. Shared scanner behavior (grades, errors, routing,
// wallet) is covered for both UIs by the other specs.

const WHIRLPOOL = "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2";
const LEGACY = "0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

test("home fetches no transaction or address data before a scan", async ({ page }) => {
  const lookups: string[] = [];
  page.on("request", (req) => {
    if (/\/api\/(tx|address)\//.test(req.url())) lookups.push(req.url());
  });
  await page.goto("/v2/");
  await expect(page.getByTestId("v2-home")).toBeVisible();
  await expect(page.getByTestId("address-input")).toBeVisible();
  await page.waitForTimeout(2_000);
  expect(lookups).toEqual([]);
});

test("results are progressive: verdict, stage, leaks open, minor signals collapsed", async ({ page }) => {
  await page.goto(`/v2/#tx=${LEGACY}`);
  const score = page.getByTestId("score-display");
  await expect(score).toHaveAttribute("data-grade", "C", { timeout: 15_000 });
  await expect(page.getByTestId("tx-stage")).toBeVisible();
  await expect(page.getByTestId("v2-score-breakdown")).toBeVisible();

  const findings = page.getByTestId("v2-findings");
  await expect(findings.getByText("Leaks")).toBeVisible();
  const minor = findings.getByRole("button", { name: /Minor signals/ });
  await expect(minor).toHaveAttribute("aria-expanded", "false");
  await minor.click();
  await expect(minor).toHaveAttribute("aria-expanded", "true");

  // Analyst tools are available to everyone (no mode toggle in v2).
  await expect(page.locator("#v2-analyst")).toBeAttached();
});

test("score breakdown ends at the reported score", async ({ page }) => {
  await page.goto(`/v2/#tx=${WHIRLPOOL}`);
  const score = page.getByTestId("score-display");
  await expect(score).toHaveAttribute("data-score", "100", { timeout: 15_000 });
  const breakdown = page.getByTestId("v2-score-breakdown");
  await expect(breakdown.locator("li").last()).toContainText("100");
});

test("the reveal can be skipped and settles on the final score", async ({ page }) => {
  await page.goto(`/v2/#tx=${LEGACY}`);
  const skip = page.getByTestId("reveal-skip");
  await expect(skip).toBeVisible({ timeout: 15_000 });
  await skip.click();
  await expect(skip).toHaveCount(0);
  await expect(page.getByTestId("score-display")).toContainText("50");
});

test("reduced motion shows the final result without a reveal", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await mockMempoolApi(page);
  await page.goto(`/v2/#tx=${LEGACY}`);
  await expect(page.getByTestId("score-display")).toHaveAttribute("data-score", "50", { timeout: 15_000 });
  await expect(page.getByTestId("reveal-skip")).toHaveCount(0);
  await context.close();
});

test("the classic header links to v2 carrying the scan, and v2 links back", async ({ page }) => {
  await page.goto(`/#tx=${WHIRLPOOL}`);
  await expect(page.getByTestId("score-display")).toBeVisible({ timeout: 15_000 });
  const pill = page.getByRole("link", { name: "Try the new am-i.exposed" }).first();
  await expect(pill).toHaveAttribute("href", `/v2/#tx=${WHIRLPOOL}`);

  await page.goto(`/v2/#tx=${WHIRLPOOL}`);
  await expect(page.getByTestId("score-display")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Classic", exact: true })).toHaveAttribute("href", `/#tx=${WHIRLPOOL}`);
});

test("inline graph is compact; analysis tools live in fullscreen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/v2/#tx=${LEGACY}`);
  const analyst = page.locator("#v2-analyst");
  const fullscreen = analyst.getByTitle("Fullscreen (F)");
  await expect(fullscreen).toBeVisible({ timeout: 20_000 });
  await expect(analyst.getByTitle("Heat Map (H)")).toHaveCount(0);
  await expect(analyst.getByText(/open fullscreen for heat map/)).toBeVisible();

  await fullscreen.click();
  const dialog = page.getByRole("dialog", { name: "Transaction graph fullscreen" });
  await expect(dialog.getByTitle("Heat Map (H)")).toBeVisible();
});
