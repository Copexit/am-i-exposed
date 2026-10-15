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
  await expect(status).toContainText("Saved scan ");
  await expect(status).toContainText("Refreshing...");
  await expect(stat(page, "Total balance")).toHaveText("39,852,779 sats");
  release();
  // Phase 1 renders, then phase 2 verifies the one saved coin in the background
  await expect(status).toHaveText("Up to date (coins verified 1/1)", { timeout: 15_000 });
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

  // One click reopens it from the saved scan; the API prompt says it is a bookmarked wallet
  const release = await holdRefresh(page);
  await page.evaluate(() => sessionStorage.removeItem("xpub-privacy-ack"));
  await item.getByRole("button").first().click();
  await expect(page.getByTestId("xpub-warn-bookmarked")).toContainText('This is your bookmarked wallet "Savings". It will be checked against mempool.space');
  await page.getByRole("button", { name: "I understand the risk, proceed" }).click();
  await expect(page.getByTestId("saved-scan-status")).toContainText("Saved scan ");
  await expect(stat(page, "Total balance")).toHaveText("39,852,779 sats");
  release();
  await expect(page.getByTestId("saved-scan-status")).toHaveText("Up to date (coins verified 1/1)", { timeout: 15_000 });

  // Survives a reload (localStorage)
  await page.goto("/");
  await page.getByRole("tab", { name: /Bookmarks/ }).click();
  await expect(page.getByTestId("wallet-bookmark-item")).toContainText("Savings");
});

test("wallet key lock: a locked bookmark asks for the password, then the wallet scan starts", async ({ page }) => {
  const PASSWORD = "correct horse battery";
  await page.goto(`/#xpub=${ZPUB}`);
  await expect(stat(page, "Total balance")).toHaveText("39,852,779 sats", { timeout: 20_000 });
  await page.getByRole("button", { name: "Bookmark this wallet" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("e.g. Savings").fill("Savings");
  await dialog.getByRole("checkbox", { name: "I understand" }).check();
  await dialog.getByRole("button", { name: "Save bookmark" }).click();
  await expect(page.getByRole("button", { name: "Bookmarked" })).toBeVisible();

  // Turn the lock on in the settings
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Settings" });
  const lock = panel.getByTestId("wallet-lock-settings");
  await lock.getByTestId("wallet-lock-enable").click();
  await expect(lock).toContainText("The password cannot be recovered");
  await expect(lock).toContainText("It does not protect against malware on this device");
  await lock.getByTestId("wallet-lock-password").fill(PASSWORD);
  await lock.getByTestId("wallet-lock-password-repeat").fill(PASSWORD);
  await lock.getByTestId("wallet-lock-submit").click();
  await expect(lock.getByTestId("wallet-lock-status")).toContainText("unlocked in this tab", { timeout: 15_000 });
  await expect(lock.getByTestId("wallet-lock-now")).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(ZPUB);

  // A reload locks again: the row shows the name and script type, never a key
  await page.reload();
  await page.getByRole("tab", { name: /Bookmarks/ }).click();
  const item = page.getByTestId("wallet-bookmark-item");
  await expect(item).toContainText("Savings");
  await expect(item).toContainText("p2wpkh");
  await expect(item).not.toContainText("zpub");
  const apiCalls: string[] = [];
  page.on("request", (req) => { if (req.url().includes("wallet-locked")) apiCalls.push(req.url()); });
  await item.getByRole("button").first().click();
  const prompt = page.getByTestId("unlock-wallets-prompt");
  await prompt.getByTestId("unlock-wallets-password").fill("wrong password");
  await prompt.getByTestId("unlock-wallets-submit").click();
  await expect(prompt.getByText("Wrong password. Try again.")).toBeVisible({ timeout: 15_000 });
  await prompt.getByTestId("unlock-wallets-password").fill(PASSWORD);
  await prompt.getByTestId("unlock-wallets-submit").click();
  await expect(stat(page, "Total balance")).toHaveText("39,852,779 sats", { timeout: 20_000 });
  expect(apiCalls).toEqual([]);
});
