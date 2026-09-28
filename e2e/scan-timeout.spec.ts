import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

// Whirlpool fixture: 5 inputs whose parents the backward trace fetches
const TXID = "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the trace readout counts from the trace start and never passes its limit", async ({ page }) => {
  test.setTimeout(45_000);
  // 8s trace budget (4s per direction)
  await page.addInitScript(() => {
    localStorage.setItem("analysis-settings", JSON.stringify({ timeout: 8, enableCache: false }));
  });
  await mockMempoolApi(page);
  // Slow backend: the scanned tx takes 6s (before the trace), its parents hang past the budget
  await page.route("**/api/tx/**", async (route) => {
    const url = route.request().url();
    const isRoot = url.includes(`/api/tx/${TXID}`);
    await sleep(isRoot ? 6_000 : 20_000);
    await route.fallback().catch(() => {});
  });

  await page.goto(`/#tx=${TXID}`);
  const loader = page.getByTestId("diagnostic-loader");
  await expect(loader).toBeVisible({ timeout: 10_000 });

  const readout = loader.locator("dt", { hasText: "Trace / time limit" }).locator("xpath=following-sibling::dd");
  await expect(readout).toBeVisible({ timeout: 15_000 });
  const seen: string[] = [];
  while (await readout.isVisible()) {
    // Short timeout: the readout can unmount between the check and the read
    const text = (await readout.textContent({ timeout: 500 }).catch(() => null)) ?? "";
    if (text) seen.push(text);
    await sleep(250);
  }
  expect(seen.length).toBeGreaterThan(0);
  for (const text of seen) {
    const m = /^(\d+)s \/ (\d+)s$/.exec(text);
    expect(m, text).not.toBeNull();
    expect(Number(m![2])).toBe(8);
    expect(Number(m![1])).toBeLessThanOrEqual(8);
  }

  // The trace was cut at its budget: the result is shown and flagged partial
  await expect(page.getByTestId("score-display")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Chain tracing incomplete/).first()).toBeAttached();
});
