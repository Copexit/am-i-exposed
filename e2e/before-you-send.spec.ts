import { test, expect } from "@playwright/test";
import { mockMempoolApi, mockExtraTxs } from "./helpers/mock-api";
import { buildSignedFixture } from "./helpers/local-tx-fixtures";

const fx = buildSignedFixture();

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
  await page.route(`**/api/tx/${fx.parent.txid}`, (r) => r.fulfill({ json: fx.parent }));
  await page.route("**/api/address/*", (r) => r.fulfill({ json: { chain_stats: { tx_count: 0 }, mempool_stats: { tx_count: 0 } } }));
  await page.route("**/api/v1/fees/recommended", (r) => r.fulfill({ json: { fastestFee: 20, halfHourFee: 10, hourFee: 5, economyFee: 2, minimumFee: 1 } }));
});

test("long PSBT: full analysis, nothing in history or hash", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("address-input").fill(fx.psbtB64);
  await page.getByTestId("scan-button").click();
  await expect(page.getByTestId("before-you-send")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  expect(await page.evaluate(() => localStorage.getItem("recent-scans"))).toBeNull();
});

test("raw hex: consent lookup completes the analysis", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/");
  await page.getByTestId("address-input").fill(fx.rawHex);
  await page.getByTestId("scan-button").click();
  await expect(page.getByTestId("local-lookup")).toBeVisible();
  expect(requests.some((u) => u.includes(fx.parent.txid))).toBe(false); // nothing before consent
  await page.getByTestId("local-lookup").click();
  await expect(page.getByTestId("local-lookup")).toBeHidden();
  expect(requests.some((u) => u.includes(fx.parent.txid))).toBe(true);
});

test("broadcast: one POST, then the txid scan", async ({ page }) => {
  let posts = 0;
  let contentType = "";
  await page.route("**/api/tx", async (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    posts++;
    contentType = r.request().headers()["content-type"] ?? "";
    await r.fulfill({ status: 200, body: fx.txid });
  });
  // The post-broadcast txid scan: the tx itself plus its outspends
  await mockExtraTxs(page, [{ ...fx.parent, txid: fx.txid }]);
  await page.goto("/");
  await page.getByTestId("address-input").fill(fx.psbtB64);
  await page.getByTestId("scan-button").click();
  await page.getByTestId("broadcast-open").click();
  await page.getByTestId("broadcast-confirm").dblclick();
  await expect(page).toHaveURL(new RegExp(`#tx=${fx.txid}`));
  await expect(page.getByTestId("score-display")).toBeVisible({ timeout: 15_000 });
  expect(posts).toBe(1);
  expect(contentType).toContain("text/plain");
});

test("file open of a binary PSBT", async ({ page }) => {
  await page.goto("/");
  const buffer = Buffer.from(fx.psbtB64, "base64");
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("open-file").click();
  await (await chooser).setFiles({ name: "tx.psbt", mimeType: "application/octet-stream", buffer });
  await expect(page.getByTestId("before-you-send")).toBeVisible();
});
