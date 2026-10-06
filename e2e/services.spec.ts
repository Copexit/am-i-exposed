import { test, expect } from "@playwright/test";
import { loadTxFixture, mockExtraTxs, mockMempoolApi, mockWabisator, mockWalletAddresses } from "./helpers/mock-api";

const TX = "0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4";
const GENESIS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const FRESH = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
const CHECK = { name: "Check CoinJoin services" };

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

test("tx scan: nothing is sent until the check is clicked", async ({ page }) => {
  const methods = await mockWabisator(page, { [TX]: "coinjoin" });
  await page.goto(`/#tx=${TX}`);
  const button = page.getByRole("button", CHECK);
  await expect(button).toBeVisible({ timeout: 15_000 });
  expect(methods).toEqual([]);
  await button.click();
  await expect(page.getByText("Kruw").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Remixed").first()).toBeVisible();
  expect(methods).toContain("search");
});

test("address scan: privacy line caps the count, click shows a result", async ({ page }) => {
  await mockWabisator(page);
  await page.goto(`/#addr=${GENESIS}`);
  const line = page.getByText(/Sends \d+ transaction ID\(s\) to Wabisator/);
  await expect(line).toBeVisible({ timeout: 15_000 });
  const n = Number(/Sends (\d+)/.exec((await line.textContent()) ?? "")?.[1]);
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(10);
  await page.getByRole("button", CHECK).click();
  await expect(page.getByText("No recorded WabiSabi CoinJoin activity for these transactions.")).toBeVisible({ timeout: 20_000 });
});

test("fresh address with no transactions renders no card", async ({ page }) => {
  await mockWabisator(page);
  await mockWalletAddresses(page, {});
  await page.goto(`/#addr=${FRESH}`);
  // An unused address gets the destination-check flow, which has no results page.
  await expect(page.getByText("Destination check").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", CHECK)).toHaveCount(0);
  await expect(page.locator("#services")).toHaveCount(0);
});

// Wallet: same setup as wallet-scan.spec.ts (one funded receive address).
const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const WALLET_ADDR = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
const fundingTx = loadTxFixture("simple-legacy-p2pkh");
fundingTx.txid = "ab".repeat(32);
Object.assign(fundingTx.vout[0]!, { scriptpubkey_address: WALLET_ADDR, scriptpubkey_type: "v0_p2wpkh" });
const FUNDED = fundingTx.vout[0]!.value as number;

for (const [label, limitOutOf, warned] of [
  ["single-coin tx shows no post-mix warning", 1, false],
  ["multi-coin tx shows the post-mix warning", undefined, true],
] as const) {
  test(`wallet scan: ${label}`, async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("xpub-privacy-ack", "1");
      localStorage.setItem("analysis-settings", JSON.stringify({ walletGapLimit: 2 }));
    });
    await mockExtraTxs(page, [fundingTx]);
    await mockWalletAddresses(page, {
      [WALLET_ADDR]: {
        txs: [fundingTx],
        utxos: [{ txid: fundingTx.txid, vout: 0, value: FUNDED, status: fundingTx.status }],
        fundedSats: FUNDED,
      },
    });
    await mockWabisator(page, { [fundingTx.txid]: "postmix" }, { limitOutOf: limitOutOf });
    await page.goto(`/#xpub=${ZPUB}`);
    await page.getByRole("button", CHECK).click({ timeout: 25_000 });
    await expect(page.getByText("Post-mix merges", { exact: true })).toBeVisible({ timeout: 20_000 });
    const warning = page.getByText(/transactions? spent coins from different CoinJoin outputs/);
    if (warned) await expect(warning).toBeVisible();
    else await expect(warning).toHaveCount(0);
  });
}
