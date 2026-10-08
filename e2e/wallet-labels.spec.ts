import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockExtraTxs, mockMempoolApi, mockWalletAddresses, type MockTx } from "./helpers/mock-api";
import { parseXpub, deriveOneAddress } from "../src/lib/bitcoin/descriptor";
import { testerHistory } from "../src/lib/analysis/__tests__/fixtures/wallet-history";

// BIP-84 test vector account zpub (m/84'/0'/0'), as in wallet-coin-selection.spec.ts
const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const parsed = parseXpub(ZPUB);
const CJ_INDEX = 20;
const txid = (n: number) => n.toString(16).padStart(64, "0");

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

/**
 * The tester's 11 coins: 591,429 is [KYC], 134,361 is [noKYC], the CoinJoin change is
 * toxic and frozen, and the 8 large coins are frozen (kept), so a 600,000 sats payment
 * can only merge the KYC coin with the noKYC one.
 */
const LABELS = [
  `{"type":"output","ref":"${txid(10)}:1","label":"[KYC] Bitstamp · withdrawal","origin":"wpkh([73c5da0a/84h/0h/0h])","value":591429}`,
  `{"type":"output","ref":"${txid(11)}:1","label":"[noKYC] Bisq · trade 7"}`,
  `{"type":"output","ref":"${txid(12)}:5","label":"[tóxico] CoinJoin change","spendable":false}`,
  ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `{"type":"output","ref":"${txid(n)}:1","label":"[noKYC] savings","spendable":false}`),
  `{"type":"addr","ref":"${deriveOneAddress(parsed, 1, 16).address}","label":"[KYC] Bitstamp · given for the withdrawal"}`,
  `{"type":"tx","ref":"${"e".repeat(64)}","label":"another wallet"}`,
  `{"type":"output","ref":"oops","label":"bad ref"}`,
].join("\n");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("xpub-privacy-ack", "1");
    localStorage.setItem("analysis-settings", JSON.stringify({ walletGapLimit: 2 }));
  });
  await mockMempoolApi(page);
  await mockTesterWallet(page);
});

const SHOTS = process.env.WB_SHOTS ?? "test-results";

/** Screenshot of an element through a full-page clip, so the sticky header never covers it. */
async function shot(page: Page, el: import("@playwright/test").Locator, path: string) {
  await el.scrollIntoViewIfNeeded();
  const box = (await el.boundingBox())!;
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path, fullPage: true, clip: { x: box.x, y: box.y + scrollY, width: box.width, height: box.height } });
}

/** No horizontal page scroll (checked at every width, the point is 390 px). */
async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, `scrollWidth ${sw} > innerWidth ${iw}`).toBeLessThanOrEqual(iw);
}

for (const width of [1440, 390]) {
  test(`labels at ${width}px: import, chips, KYC + noKYC warning, export`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/#xpub=${ZPUB}`);
    await expect(page.getByText("Wallet Privacy Audit")).toBeVisible({ timeout: 20_000 });

    // Import a file
    await page.getByRole("button", { name: /Labels \(BIP329\)/ }).click();
    const panel = page.getByTestId("labels-panel");
    await panel.locator("input[type=file]").setInputFiles({ name: "sparrow.jsonl", mimeType: "application/jsonl", buffer: Buffer.from(LABELS) });
    await expect(panel.getByTestId("labels-summary")).toHaveText(/^13 labels read: \d+ on current coins, \d+ on past transactions and addresses, 1 for other wallets, 1 invalid$/);
    await expect(panel.getByRole("link", { name: "Labeling recommendations" })).toHaveAttribute("href", "/guide/#labeling-coins");
    await shot(page, panel, `${SHOTS}/wb-panel-${width}.png`);

    // Chips and labels on the coins
    await page.getByRole("button", { name: /Coins \(UTXOs\)/ }).click();
    const list = page.getByTestId("utxo-list");
    const kycRow = list.getByTestId("utxo-row").filter({ hasText: "591,429 sats" });
    await expect(kycRow.getByTestId("label-tag-kyc")).toBeVisible();
    await expect(kycRow.getByText("[KYC] Bitstamp · withdrawal")).toBeVisible();
    await expect(list.getByTestId("utxo-row").filter({ hasText: "134,361 sats" }).getByTestId("label-tag-nokyc")).toBeVisible();
    const cjRow = list.getByTestId("utxo-row").filter({ hasText: "15,240,920 sats" });
    await expect(cjRow.getByTestId("label-tag-toxic")).toBeVisible();
    await expect(cjRow.getByText("Frozen", { exact: true })).toBeVisible();
    await shot(page, list, `${SHOTS}/wb-utxos-${width}.png`);
    // A tag's toggletip: its meaning and the guide link, and still no horizontal scroll at phone width
    for (const chip of await list.locator("[data-testid^='label-tag-']").all()) {
      await chip.focus();
      await expect(list.getByTestId("label-tag-tip")).toBeVisible();
      await noHorizontalScroll(page);
    }
    await expect(list.getByTestId("label-tag-tip").getByRole("link", { name: "Labeling recommendations" })).toHaveAttribute("href", "/guide/#labeling-coins");
    await page.keyboard.press("Escape");
    await list.getByRole("button", { name: "Group by label" }).click();
    await expect(list.getByTestId("utxo-label-group")).toHaveCount(4);
    await noHorizontalScroll(page);
    await shot(page, list, `${SHOTS}/wb-groups-${width}.png`);

    // Coin selector: frozen coins left out, the only plan merges KYC with noKYC
    await page.getByRole("button", { name: /Coin Selection Advisor/ }).click();
    await page.getByLabel("Amount (sats)").fill("600000");
    await page.getByRole("button", { name: "Suggest selection" }).click();
    const plan = page.locator("[data-testid^='coin-plan-']").first();
    await expect(plan.getByText(/Merges \[KYC\] coins with \[noKYC\] coins/)).toBeVisible();
    await expect(plan.getByTestId("plan-label-rules")).toContainText("KYC kept apart from no-KYC");
    await expect(page.getByLabel("Include frozen coins (9)")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, page.getByTestId("coin-selector"), `${SHOTS}/wb-selector-${width}.png`);

    // Export
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("labels-export").click()]);
    expect(download.suggestedFilename()).toMatch(/^[0-9a-f]{8}-labels\.jsonl$/);
    const lines = readFileSync((await download.path())!, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    const byRef = new Map(lines.map((l) => [`${l.type}:${l.ref}`, l]));
    // User labels kept as imported, extra fields included; automatic part appended where it applies
    expect(byRef.get(`output:${txid(10)}:1`)).toMatchObject({ label: "[KYC] Bitstamp · withdrawal", origin: "wpkh([73c5da0a/84h/0h/0h])", value: 591429 });
    expect(byRef.get(`output:${txid(12)}:5`)).toMatchObject({ label: "[tóxico] CoinJoin change | aie: toxic change", spendable: false });
    expect(byRef.get(`tx:${"e".repeat(64)}`)).toMatchObject({ label: "another wallet" });
    expect(lines.every((l) => typeof l.type === "string" && typeof l.ref === "string")).toBe(true);

    // Addresses show their tags; the guide link lands on the labeling section
    await page.getByRole("button", { name: /^Addresses/ }).click();
    await expect(page.locator("#wallet-addresses").getByTestId("label-tag-kyc")).toBeVisible();
    await shot(page, page.locator("#wallet-addresses"), `${SHOTS}/wb-addresses-${width}.png`);
    await noHorizontalScroll(page);
    await page.getByRole("link", { name: "Labeling recommendations" }).click();
    const section = page.locator("section").filter({ has: page.locator("#labeling-coins") });
    await expect(section.getByRole("heading", { name: "Labeling recommendations" })).toBeInViewport({ timeout: 5_000 });
    await shot(page, section, `${SHOTS}/wb-guide-${width}.png`);
  });
}
