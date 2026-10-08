import { test, expect, type Page } from "@playwright/test";
import { loadTxFixture, mockExtraTxs, mockMempoolApi, mockWalletAddresses } from "./helpers/mock-api";

// Umbrel mode: nginx serves /api/local-info and proxies /api/* to the node's mempool.
// The app asks the node which chain it serves (genesis hash of /api/block-height/0).
const GENESIS = {
  mainnet: "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
  signet: "00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6",
  regtest: "0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206",
};

async function mockUmbrel(page: Page, genesis: string | null) {
  await page.route("**/api/local-info", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mempoolPort: "3006", mempoolOnion: "", mempoolExternalUrl: "" }) }));
  await page.route("**/api/blocks/tip/height", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "850000" }));
  await page.route("**/api/block-height/0", (route) =>
    route.fulfill(genesis ? { status: 200, contentType: "text/plain", body: genesis } : { status: 404, body: "Not found" }));
}

/** Wallet scan setup: `address` (first p2wpkh receive address of the key) holds one funded output. */
async function mockWallet(page: Page, address: string) {
  const fundingTx = loadTxFixture("simple-legacy-p2pkh");
  fundingTx.txid = "cd".repeat(32);
  Object.assign(fundingTx.vout[0]!, { scriptpubkey_address: address, scriptpubkey_type: "v0_p2wpkh" });
  const sats = fundingTx.vout[0]!.value as number;
  await page.addInitScript(() => {
    localStorage.setItem("analysis-settings", JSON.stringify({ walletGapLimit: 2 }));
  });
  await mockMempoolApi(page);
  await mockExtraTxs(page, [fundingTx]);
  await mockWalletAddresses(page, {
    [address]: { txs: [fundingTx], utxos: [{ txid: fundingTx.txid, vout: 0, value: sats, status: fundingTx.status }], fundedSats: sats },
  });
}

const stat = (page: Page, name: string) =>
  page.getByText(name, { exact: true }).locator("xpath=following-sibling::*[1]");

/** Every mempool request of the page, to check none left the node. */
function trackApi(page: Page) {
  const urls: string[] = [];
  page.on("request", (req) => { if (req.url().includes("/api/")) urls.push(req.url()); });
  return urls;
}

// m/84'/1'/0' of a fixed seed, and its first receive address
const TPUB = "tpubDDPRy5xWxJTuVmsh7YRzK8o2EdMWgn4t41fTLxXRgyRN7EKvN2L8BKCFC1gUfPu8Xp6rr667Yc26zrXsiBZsgBc8dQiYnhPNk2Q7CsBrer5";
const TPUB_FIRST = "tb1q72xweewm4uvlkgzevmewy0dk3mmpymgr3n58qx";

test("signet Umbrel: a tpub wallet scans on the local node", async ({ page }) => {
  await mockWallet(page, TPUB_FIRST);
  await mockUmbrel(page, GENESIS.signet);
  const urls = trackApi(page);

  await page.goto(`/#xpub=${TPUB}`);

  await expect(page.getByText("Wallet Privacy Audit")).toBeVisible({ timeout: 20_000 });
  await expect(stat(page, "Active addresses")).toHaveText("1");
  await expect(page.getByText(/connected backend serves/)).toHaveCount(0);
  // Only the local node was asked
  expect(urls.length).toBeGreaterThan(0);
  expect(urls.every((u) => u.startsWith("http://localhost"))).toBe(true);

  // The selector shows the node's network, the others are disabled
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const select = page.getByLabel("Select Bitcoin network");
  await expect(select).toHaveValue("signet");
  await expect(select.locator("option[value=mainnet]")).toBeDisabled();
  await expect(select.locator("option[value=testnet4]")).toBeDisabled();
});

// BIP-84 test vector account zpub and its first receive address
const ZPUB = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const ZPUB_FIRST = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";

test("mainnet Umbrel: an xpub wallet scans as before; a tpub is refused naming Mainnet", async ({ page }) => {
  await mockWallet(page, ZPUB_FIRST);
  await mockUmbrel(page, GENESIS.mainnet);

  await page.goto(`/#xpub=${ZPUB}`);
  await expect(page.getByText("Wallet Privacy Audit")).toBeVisible({ timeout: 20_000 });
  await expect(stat(page, "Active addresses")).toHaveText("1");

  // A fresh load (not a hash change), so the scan starts once the node is known
  await page.goto("about:blank");
  await page.goto(`/#xpub=${TPUB}`);
  await expect(page.getByText("This key belongs to Testnet/Signet, but the connected backend serves Mainnet.", { exact: false })).toBeVisible({ timeout: 20_000 });
});

test("regtest Umbrel: an unsupported-network message names the chain", async ({ page }) => {
  await mockMempoolApi(page);
  await mockUmbrel(page, GENESIS.regtest);
  await page.goto("/");
  const dialog = page.getByRole("alertdialog", { name: "Unsupported Network" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText("serves Regtest, which is not supported");
});

test("Umbrel whose network cannot be verified: mainnet assumed, with a notice", async ({ page }) => {
  await mockMempoolApi(page);
  await mockUmbrel(page, null);
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "Network could not be verified; assuming Mainnet." })).toBeVisible({ timeout: 10_000 });
});
