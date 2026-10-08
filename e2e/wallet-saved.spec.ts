import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import { loadTxFixture, mockExtraTxs, mockMempoolApi, mockWalletAddresses } from "./helpers/mock-api";

// BIP-84 test vector account zpub and its first receive address (m/84'/0'/0'/0/0)
const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const FIRST_ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";

const fundingTx = loadTxFixture("simple-legacy-p2pkh");
fundingTx.txid = "ab".repeat(32);
Object.assign(fundingTx.vout[0]!, { scriptpubkey_address: FIRST_ADDRESS, scriptpubkey_type: "v0_p2wpkh" });
const FUNDED_SATS = fundingTx.vout[0]!.value as number;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("xpub-privacy-ack", "1");
    localStorage.setItem("analysis-settings", JSON.stringify({ walletGapLimit: 2 }));
  });
  await mockMempoolApi(page);
  await mockExtraTxs(page, [fundingTx]);
  await mockWalletAddresses(page, {
    [FIRST_ADDRESS]: {
      txs: [fundingTx],
      utxos: [{ txid: fundingTx.txid, vout: 0, value: FUNDED_SATS, status: fundingTx.status }],
      fundedSats: FUNDED_SATS,
    },
  });
});

const stat = (page: Page, name: string) =>
  page.getByText(name, { exact: true }).locator("xpath=following-sibling::*[1]");

/** Holds the tip-height request (the refresh's first) until released, so the saved state is observable. */
async function holdRefresh(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route("**/api/blocks/tip/height", async (route) => {
    await gate;
    await route.fulfill({ body: "900000", contentType: "text/plain" });
  });
  return release;
}

test("a scanned wallet reopens at once from its saved scan, then refreshes to up to date", async ({ page }) => {
  await page.goto(`/#xpub=${ZPUB}`);
  await expect(stat(page, "Total balance")).toHaveText("39,852,779 sats", { timeout: 20_000 });
  await expect(page.getByTestId("saved-scan-status")).toHaveText("Saved on this device");

  const release = await holdRefresh(page);
  const historyFetches: string[] = [];
  page.on("request", (req) => { if (/\/api\/address\/[^/]+\/txs/.test(req.url())) historyFetches.push(req.url()); });
  await page.reload();

  const status = page.getByTestId("saved-scan-status");
  await expect(status).toContainText("Saved scan from");
  await expect(status).toContainText("Refreshing...");
  await expect(stat(page, "Total balance")).toHaveText("39,852,779 sats");
  release();
  await expect(status).toHaveText("Up to date", { timeout: 15_000 });
  // The quick refresh never walks address histories again
  expect(historyFetches).toEqual([]);
});

test("wallet bookmark: privacy dialog, one-click reopen, export excludes wallets by default", async ({ page }) => {
  await page.goto(`/#xpub=${ZPUB}`);
  await expect(stat(page, "Total balance")).toHaveText("39,852,779 sats", { timeout: 20_000 });

  await page.getByRole("button", { name: "Bookmark this wallet" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("never on a shared or public computer");
  const save = dialog.getByRole("button", { name: "Save bookmark" });
  await expect(save).toBeDisabled();
  await dialog.getByPlaceholder("e.g. Savings").fill("Savings");
  await dialog.getByRole("checkbox", { name: "I understand" }).check();
  await save.click();
  await expect(page.getByRole("button", { name: "Bookmarked" })).toBeVisible();

  // Home: the bookmark shows the name and a masked key, never the full key
  await page.getByRole("button", { name: /New scan/ }).first().click();
  await page.getByRole("tab", { name: /Bookmarks/ }).click();
  const item = page.getByTestId("wallet-bookmark-item");
  await expect(item).toContainText("Savings");
  await expect(item).toContainText("zpub6rFR...GutZYs");
  await expect(item).not.toContainText(ZPUB);

  // Export: wallets excluded unless unticked
  await page.getByRole("button", { name: "Export bookmarks as JSON" }).click();
  const prompt = page.getByTestId("export-wallets-prompt");
  await expect(prompt.getByRole("checkbox", { name: "Exclude wallets" })).toBeChecked();
  const [download] = await Promise.all([page.waitForEvent("download"), prompt.getByRole("button", { name: "Export" }).click()]);
  const file = readFileSync((await download.path())!, "utf-8");
  expect(file).not.toContain(ZPUB);

  // One click reopens it from the saved scan
  const release = await holdRefresh(page);
  await item.getByRole("button").first().click();
  await expect(page.getByTestId("saved-scan-status")).toContainText("Saved scan from");
  await expect(stat(page, "Total balance")).toHaveText("39,852,779 sats");
  release();
  await expect(page.getByTestId("saved-scan-status")).toHaveText("Up to date", { timeout: 15_000 });

  // Survives a reload (localStorage)
  await page.goto("/");
  await page.getByRole("tab", { name: /Bookmarks/ }).click();
  await expect(page.getByTestId("wallet-bookmark-item")).toContainText("Savings");
});
