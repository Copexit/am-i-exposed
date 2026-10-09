import { test, expect, type Page } from "@playwright/test";
import { mockExtraTxs, mockMempoolApi, mockWalletAddresses, type MockTx } from "./helpers/mock-api";
import { parseXpub, deriveOneAddress } from "../src/lib/bitcoin/descriptor";
import { decisionTreeReplica } from "../src/lib/analysis/__tests__/fixtures/wallet-history";

// BIP-84 test vector account zpub (m/84'/0'/0'), as in wallet-coin-selection.spec.ts
const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const parsed = parseXpub(ZPUB);

/**
 * Synthetic replica of a tester's wallet (amounts and tx structure only): a 165,519,188 change coin,
 * the two outputs of one self-transfer (3,296,321 on the change chain, 2,399,400 on the receive chain),
 * and two receipts, on the zpub's first addresses so a gap limit of 2 finds them.
 */
async function mockReplica(page: Page) {
  const infos = decisionTreeReplica((i) => deriveOneAddress(parsed, 0, i).address, (i) => deriveOneAddress(parsed, 1, i).address, 4, 1);
  const txs = new Map(infos.flatMap((i) => i.txs).map((t) => [t.txid, t]));
  await mockExtraTxs(page, [...txs.values()] as unknown as MockTx[]);
  await mockWalletAddresses(page, Object.fromEntries(infos.map((i) => [i.derived.address, {
    txs: i.txs as unknown as MockTx[],
    utxos: i.utxos,
    fundedSats: i.addressData!.chain_stats.funded_txo_sum,
    fundedCount: i.addressData!.chain_stats.funded_txo_count,
  }])));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("xpub-privacy-ack", "1");
    localStorage.setItem("analysis-settings", JSON.stringify({ walletGapLimit: 2 }));
  });
  await mockMempoolApi(page);
  await mockReplica(page);
});

const SHOTS = process.env.WF_SHOTS ?? "test-results";

async function shot(page: Page, el: import("@playwright/test").Locator, path: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = (await el.boundingBox())!;
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path, fullPage: true, clip: { x: box.x, y: box.y + scrollY, width: box.width, height: box.height } });
}

async function suggest(page: Page, amount: string) {
  const selector = page.getByTestId("coin-selector");
  await selector.getByLabel("Amount (sats)").fill(amount);
  await selector.getByRole("button", { name: "Suggest selection" }).click();
  return selector;
}

for (const width of [1440, 390]) {
  test(`tester replica at ${width}px: 38,034 pays with one receipt; 3,382,886 recommends his 3-coin pick`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/#xpub=${ZPUB}`);
    await expect(page.getByText("Wallet Privacy Audit")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /Coin Selection Advisor/ }).click();

    // 38,034: 38,625 alone, no change, the only option; the 64,332 coin (only 436 sats cheaper) not listed
    let selector = await suggest(page, "38034");
    const plans = selector.locator("[data-testid^='coin-plan-']");
    await expect(plans).toHaveCount(1);
    await expect(plans.first().getByText("38,625 sats", { exact: true })).toBeVisible();
    await expect(plans.first().getByTestId("plan-learns")).toContainText("No change output to follow");
    await expect(selector.getByTestId("no-clean-option")).toHaveCount(0);
    if (width === 1440) await shot(page, selector, `${SHOTS}/wf2-38034-${width}.png`);

    // 3,382,886: his pick first and recommended (3,296,321 is ambiguous change: no hard violation), no dilemma
    selector = await suggest(page, "3382886");
    await expect(selector.getByTestId("no-clean-option")).toHaveCount(0);
    const first = plans.first();
    await expect(first.getByText("Recommended")).toBeVisible();
    await expect(first.getByText("64,332 sats", { exact: true })).toBeVisible();
    await expect(first.getByTestId("plan-learns")).toContainText("an observer could not tell it was your change");
    await expect(plans.nth(1)).toContainText("165,519,188 sats");
    await expect(plans.nth(2)).toContainText("2,399,400 sats");
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(sw, `scrollWidth ${sw} > innerWidth ${iw}`).toBeLessThanOrEqual(iw);
    await shot(page, selector, `${SHOTS}/wf2-3382886-${width}.png`);
  });
}
