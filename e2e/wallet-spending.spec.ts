import { test, expect, type Page } from "@playwright/test";
import { mockExtraTxs, mockMempoolApi, mockWalletAddresses, type MockTx } from "./helpers/mock-api";
import { parseXpub, deriveOneAddress } from "../src/lib/bitcoin/descriptor";
import { History } from "../src/lib/analysis/__tests__/fixtures/wallet-history";

// BIP-84 test vector account zpub (m/84'/0'/0'), as in wallet-coin-selection.spec.ts
const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const parsed = parseXpub(ZPUB);
/** BIP350 test vector (P2TR): the recipient, who once paid the wallet 133,000 sats. */
const RECIPIENT = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";

/** Two coins: 133,000 from the recipient and 104,000 (closer to the payment) from someone else. */
async function mockWallet(page: Page) {
  const a0 = deriveOneAddress(parsed, 0, 0).address;
  const a1 = deriveOneAddress(parsed, 0, 1).address;
  const h = new History();
  h.tx([{ address: RECIPIENT, value: 140_000 }], [{ address: a0, value: 133_000 }], 100);
  h.receive(a1, 104_000, 101);
  const infos = h.infos([{ address: a0, isChange: false, index: 0 }, { address: a1, isChange: false, index: 1 }]);
  await mockExtraTxs(page, h.txs as unknown as MockTx[]);
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
  await mockWallet(page);
});

const SHOTS = process.env.WF_SHOTS ?? "test-results";

/** Screenshot of an element through a full-page clip, so the sticky header never covers it. */
async function shot(page: Page, el: import("@playwright/test").Locator, path: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = (await el.boundingBox())!;
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path, fullPage: true, clip: { x: box.x, y: box.y + scrollY, width: box.width, height: box.height } });
}

for (const width of [1440, 390]) {
  test(`spending decision tree at ${width}px: recipient's coin preferred, alerts, round change`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/#xpub=${ZPUB}`);
    await expect(page.getByText("Wallet Privacy Audit")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /Coin Selection Advisor/ }).click();
    const selector = page.getByTestId("coin-selector");
    await selector.getByLabel("Recipient address (optional)").fill(RECIPIENT);
    await expect(selector.getByRole("button", { name: "Check if this address was used before" })).toBeVisible();
    await selector.getByLabel("Amount (sats)").fill("100000");
    await selector.getByRole("button", { name: "Suggest selection" }).click();

    // Rule 1: the coin the recipient sent comes first, though 104,000 is closer
    const first = selector.locator("[data-testid^='coin-plan-']").first();
    await expect(first.getByText("Recommended")).toBeVisible();
    await expect(first.getByText("133,000 sats", { exact: true })).toBeVisible();
    await expect(first.getByTestId("plan-reason")).toHaveText(/^The recipient already knows these coins/);
    await expect(first.getByTestId("plan-path").getByRole("listitem").first()).toContainText("Coins the recipient already knows: used");

    // Rules 6 and 7: reused, round, type mismatch
    await expect(selector.getByTestId("spend-alert-reused-history")).toContainText("Avoid sending to a reused address");
    await expect(selector.getByTestId("spend-alert-round")).toContainText("100,000 sats is a round number");
    await expect(selector.getByTestId("spend-alert-type-mismatch")).toContainText("is P2TR and this wallet uses P2WPKH");

    // Rule 8: the round-change variant (32,300 change at 5 sat/vB, nudged to 30,000)
    await expect(first.getByTestId("round-change")).toContainText("Round change: +2,300 sats fee so the change also looks round");

    // The recipient lives in the hash only
    expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("to")).toBe(RECIPIENT);
    await expect(selector.getByRole("link", { name: "Spending checklist" })).toHaveAttribute("href", "/guide/#spending-checklist");

    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(sw, `scrollWidth ${sw} > innerWidth ${iw}`).toBeLessThanOrEqual(iw);
    await shot(page, selector, `${SHOTS}/wf-selector-${width}.png`);
  });
}
