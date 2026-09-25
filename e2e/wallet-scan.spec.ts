import { test, expect } from "@playwright/test";
import { loadTxFixture, mockExtraTxs, mockMempoolApi, mockWalletAddresses } from "./helpers/mock-api";

// BIP-84 test vector account zpub and its first receive address (m/84'/0'/0'/0/0)
const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const FIRST_ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";

// One tx paying the first receive address: the P2PKH fixture with output 0
// redirected to the wallet and a fresh txid.
const fundingTx = loadTxFixture("simple-legacy-p2pkh");
fundingTx.txid = "ab".repeat(32);
Object.assign(fundingTx.vout[0]!, {
  scriptpubkey_address: FIRST_ADDRESS,
  scriptpubkey_type: "v0_p2wpkh",
});
const FUNDED_SATS = fundingTx.vout[0]!.value as number;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Skip the third-party-API privacy prompt; a gap limit of 2 keeps the scan
    // inside the hosted-API burst window (no 9 s throttle delays).
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

const stat = (page: import("@playwright/test").Page, name: string) =>
  page.getByText(name, { exact: true }).locator("xpath=following-sibling::div");

test("xpub scan finds the one funded address and renders the wallet audit", async ({ page }) => {
  const requested = new Set<string>();
  page.on("request", (req) => {
    const addr = req.url().split("/api/address/")[1]?.split("/")[0];
    if (addr) requested.add(addr);
  });

  await page.goto(`/#xpub=${ZPUB}`);

  await expect(page.getByText("Wallet Privacy Audit")).toBeVisible({ timeout: 20_000 });
  await expect(stat(page, "Active addresses")).toHaveText("1");
  await expect(stat(page, "Total transactions")).toHaveText("1");
  await expect(stat(page, "Total UTXOs")).toHaveText("1");
  await expect(stat(page, "Total balance")).toHaveText("39,852,779 sats"); // FUNDED_SATS

  // Receive chain: index 0 (used) + 2 unused; change chain: 2 unused
  expect(requested.has(FIRST_ADDRESS)).toBe(true);
  expect(requested.size).toBe(5);
});
