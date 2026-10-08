import { test, expect, type Page } from "@playwright/test";
import { mockExtraTxs, mockMempoolApi, mockWalletAddresses, type MockTx } from "./helpers/mock-api";
import { parseXpub, deriveOneAddress } from "../src/lib/bitcoin/descriptor";
import { testerHistory } from "../src/lib/analysis/__tests__/fixtures/wallet-history";

// BIP-84 test vector account zpub (m/84'/0'/0')
const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const parsed = parseXpub(ZPUB);
const CJ_INDEX = 20; // 1/146 in the tester's wallet; consecutive here so a gap limit of 2 finds it

/** The tester's wallet (11 UTXOs, one CoinJoin change) on the zpub's real addresses. */
async function mockTesterWallet(page: Page) {
  const { h, addresses } = testerHistory(deriveOneAddress(parsed, 0, 0).address, (i) => deriveOneAddress(parsed, 1, i).address, CJ_INDEX);
  const infos = h.infos(addresses);
  await mockExtraTxs(page, h.txs as unknown as MockTx[]);
  await mockWalletAddresses(page, Object.fromEntries(infos.map((i) => [i.derived.address, {
    txs: i.txs as unknown as MockTx[],
    utxos: i.utxos,
    fundedSats: i.addressData!.chain_stats.funded_txo_sum,
    fundedCount: i.addressData!.chain_stats.funded_txo_count,
  }])));
}

/** Screenshot of an element through a full-page clip, so the sticky header never covers it. */
async function shot(page: Page, el: import("@playwright/test").Locator, path: string) {
  const box = (await el.boundingBox())!;
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path, fullPage: true, clip: { x: box.x, y: box.y + scrollY, width: box.width, height: box.height } });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("xpub-privacy-ack", "1");
    localStorage.setItem("analysis-settings", JSON.stringify({ walletGapLimit: 2 }));
  });
  await mockMempoolApi(page);
  await mockTesterWallet(page);
});

for (const width of [1440, 390]) {
  test(`tester wallet at ${width}px: one verdict per coin, legend sums and wraps, small coins first`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/#xpub=${ZPUB}`);
    await expect(page.getByText("Wallet Privacy Audit")).toBeVisible({ timeout: 20_000 });

    // Coin origins: every UTXO in exactly one class, legend inside its card
    const origins = page.getByTestId("coin-origins");
    await expect(origins).toContainText("11 UTXOs");
    await expect(origins.getByText("CoinJoin change", { exact: true })).toBeVisible();
    const legend = origins.getByRole("list");
    const overflow = await legend.evaluate((el) => {
      const box = el.closest("section")!.getBoundingClientRect();
      return [...el.children].some((li) => li.getBoundingClientRect().right > box.right + 0.5);
    });
    expect(overflow).toBe(false);
    await shot(page, origins, `test-results/wa-origins-${width}.png`);

    // UTXO list: the CoinJoin change coin is CoinJoin change (not mixed), with a Path column
    await page.getByRole("button", { name: /Coins \(UTXOs\)/ }).click();
    const list = page.getByTestId("utxo-list");
    const cjRow = list.getByTestId("utxo-row").filter({ hasText: "15,240,920 sats" });
    await expect(cjRow.getByText("CoinJoin change", { exact: true })).toBeVisible();
    await expect(cjRow.getByText("Mixed (CoinJoin)")).toHaveCount(0);
    await expect(cjRow.getByTitle(`Change chain, index ${CJ_INDEX} (m/84'/0'/0'/1/${CJ_INDEX})`)).toHaveCount(1);
    await expect(list.getByRole("columnheader", { name: "Path" })).toHaveCount(1);
    // Every coin comes from the same payments (two wallet outputs each): one probable group, said once
    await expect(list.getByTestId("utxo-all-linked")).toContainText("All 11 coins are probably linked");
    await expect(list.getByText(/^Group /)).toHaveCount(0);
    await shot(page, list, `test-results/wa-utxos-${width}.png`);

    // Coin selection: 600,000 sats at 5 sat/vB
    await page.getByRole("button", { name: /Coin Selection Advisor/ }).click();
    await page.getByLabel("Amount (sats)").fill("600000");
    await page.getByRole("button", { name: "Suggest selection" }).click();
    const first = page.locator("[data-testid^='coin-plan-']").first();
    await expect(first.getByText("Recommended")).toBeVisible();
    await expect(first.getByText("591,429 sats")).toBeVisible();
    await expect(first.getByText("134,361 sats")).toBeVisible();
    await expect(first.getByTestId("plan-reason")).toHaveText("Joins coins an observer can probably already link.");
    const single = page.getByTestId("coin-plan-single-coin");
    await expect(single.getByText("99,000,000 sats")).toBeVisible();
    await expect(single.getByTestId("plan-reason")).toHaveText("Leaves change 164x the payment: most of the coin's value stays on change linked to this payment.");
    await expect(page.getByText("15,240,920 sats", { exact: true }).locator("xpath=ancestor::section[starts-with(@data-testid,'coin-plan-')]")).toHaveCount(0);
    await shot(page, page.getByTestId("coin-selector"), `test-results/wa-selector-${width}.png`);
  });
}
