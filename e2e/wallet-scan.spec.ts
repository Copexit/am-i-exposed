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

// The value element right after the label (a dd).
const stat = (page: import("@playwright/test").Page, name: string) =>
  page.getByText(name, { exact: true }).locator("xpath=following-sibling::*[1]");

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

// The same account as a bare "xpub" (legacy prefix, as most wallets export it)
const XPUB =
  "xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V";

test("bare xpub: address type detected from history, other types offered", async ({ page }) => {
  await page.goto(`/#xpub=${XPUB}`);

  await expect(page.getByText("Wallet Privacy Audit")).toBeVisible({ timeout: 20_000 });
  await expect(stat(page, "Total balance")).toHaveText("39,852,779 sats");
  await expect(page.getByText("Address type detected from on-chain history")).toBeVisible();
  await expect(page.getByRole("button", { name: "p2tr", exact: true })).toBeVisible();
  // Gap limit 2 (set in beforeEach) is below the standard 20: offered a full rescan
  const row = page.getByTestId("rescan-gap-row");
  for (const n of ["20", "100", "300", "1000"]) await expect(row.getByRole("button", { name: n, exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/bare-xpub.png", fullPage: false });
  // Rescanning with 100 re-runs the scan; 20 is below it, so only 300 and 1000 remain offered
  await row.getByRole("button", { name: "100", exact: true }).click();
  await expect(page.getByText("Wallet Privacy Audit")).toBeVisible({ timeout: 20_000 });
  await expect(stat(page, "Total balance")).toHaveText("39,852,779 sats", { timeout: 60_000 });
  await expect(page.getByTestId("rescan-gap-row").getByRole("button", { name: "20", exact: true })).toHaveCount(0);
});

// BIP-84 test vector: second receive address and first change address
const SECOND_ADDRESS = "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g";
const CHANGE_ADDRESS = "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el";

/** A copy of the funding tx paying `value` to `address`, with its own txid. */
function payTo(txidByte: string, address: string, value: number) {
  const tx = structuredClone(fundingTx);
  tx.txid = txidByte.repeat(32);
  Object.assign(tx.vout[0]!, { scriptpubkey_address: address, value });
  return tx;
}

/** Five coins on three addresses: no single coin pays 700,000 sats, the wallet does. */
async function mockMultiCoinWallet(page: import("@playwright/test").Page) {
  const own = [payTo("c1", FIRST_ADDRESS, 300_000), payTo("c2", FIRST_ADDRESS, 250_000), payTo("c3", FIRST_ADDRESS, 200_000)];
  const other = payTo("d1", SECOND_ADDRESS, 600_000);
  const change = payTo("e1", CHANGE_ADDRESS, 500_000);
  const utxo = (tx: typeof other) => ({ txid: tx.txid, vout: 0, value: tx.vout[0]!.value, status: tx.status });
  await mockExtraTxs(page, [...own, other, change]);
  await mockWalletAddresses(page, {
    [FIRST_ADDRESS]: { txs: own, utxos: own.map(utxo), fundedSats: 750_000 },
    [SECOND_ADDRESS]: { txs: [other], utxos: [utxo(other)], fundedSats: 600_000 },
    [CHANGE_ADDRESS]: { txs: [change], utxos: [utxo(change)], fundedSats: 500_000 },
  });
}

test("coin selection advisor: multi-coin plans when no single coin pays", async ({ page }) => {
  await mockMultiCoinWallet(page);
  await page.goto(`/#xpub=${ZPUB}`);
  await expect(stat(page, "Total balance")).toHaveText("1,850,000 sats", { timeout: 20_000 });

  await page.getByRole("button", { name: /Coin Selection Advisor/ }).click();
  await page.getByLabel("Amount (sats)").fill("700000");
  await page.getByRole("button", { name: "Suggest selection" }).click();

  const same = page.getByTestId("coin-plan-same-origin");
  await expect(same).toBeVisible();
  await expect(same.getByText("Recommended")).toBeVisible();
  await expect(same.getByRole("list").first().getByRole("listitem")).toHaveCount(3);
  await expect(page.getByTestId("coin-plan-multi-coin").getByText(/Joins 2 unrelated origins/)).toBeVisible();
  await expect(page.getByText("Advanced: Stonewall")).toBeVisible();
  await expect(page.getByText(/Not enough funds/)).toHaveCount(0);

  // Above the whole balance: insufficient, with the shortfall
  await page.getByLabel("Amount (sats)").fill("2000000");
  await page.getByRole("button", { name: "Suggest selection" }).click();
  await expect(page.getByText(/Not enough funds\. The spendable balance is 1,850,000 sats/)).toBeVisible();
});

test("coins (UTXOs) section lists every coin, sortable, with totals and scan links", async ({ page }) => {
  await mockMultiCoinWallet(page);
  const height = (fundingTx.status as { block_height: number }).block_height;
  await page.route("**/api/blocks/tip/height", (route) => route.fulfill({ body: String(height + 9), contentType: "text/plain" }));
  await page.goto(`/#xpub=${ZPUB}`);
  await expect(stat(page, "Total balance")).toHaveText("1,850,000 sats", { timeout: 20_000 });

  await page.getByRole("button", { name: /Coins \(UTXOs\)/ }).click();
  const list = page.getByTestId("utxo-list");
  const amounts = list.getByTestId("utxo-amount");
  await expect(amounts).toHaveText(["600,000 sats", "500,000 sats", "300,000 sats", "250,000 sats", "200,000 sats"]);
  await expect(list.getByTestId("utxo-total")).toContainText("1,850,000 sats");

  const changeRow = list.getByTestId("utxo-row").nth(1);
  await expect(changeRow.getByText("change", { exact: true })).toBeVisible();
  await expect(changeRow.getByText("1/0", { exact: true })).toBeVisible();
  await expect(changeRow.getByText("10 confirmations")).toBeVisible();
  await expect(list.getByTestId("utxo-row").nth(2).getByText("Reused address")).toBeVisible();

  await list.getByRole("button", { name: "Amount, largest first" }).click();
  await expect(amounts.first()).toHaveText("200,000 sats");

  // The outpoint opens a scan of the funding tx in place
  await list.getByRole("button", { name: `Scan the funding transaction of ${"e1".repeat(32)}:0` }).click();
  await expect(page).toHaveURL(new RegExp(`#tx=${"e1".repeat(32)}`));
});

test("coin selection advisor: a no-change set of already linked coins comes first, other options follow", async ({ page }) => {
  await mockMultiCoinWallet(page);
  await page.goto(`/#xpub=${ZPUB}`);
  await expect(stat(page, "Total balance")).toHaveText("1,850,000 sats", { timeout: 20_000 });

  await page.getByRole("button", { name: /Coin Selection Advisor/ }).click();
  await page.getByLabel("Amount (sats)").fill("449000");
  await page.getByRole("button", { name: "Suggest selection" }).click();

  // 250,000 + 200,000 on one address pay it with no change: recommended; options with less fee are still listed
  const noChange = page.locator("[data-testid^='coin-plan-']").first();
  await expect(noChange).toHaveAttribute("data-testid", "coin-plan-no-change");
  await expect(noChange.getByText("Recommended", { exact: true })).toBeVisible();
  await expect(noChange.getByText(/so no change output is created that anyone can follow/)).toBeVisible();
  await expect(noChange.getByTestId("plan-reason")).toHaveText("Links nothing new and leaves no change.");
});

const OUTSIDE_1 = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const OUTSIDE_2 = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

/** A wallet-built tx spending `inputs` (outputs of earlier mock txs) to `outputs`. */
function spend(txidByte: string, inputs: { tx: typeof fundingTx; vout: number }[], outputs: { address: string; value: number }[]) {
  const tx = structuredClone(fundingTx);
  tx.txid = txidByte.repeat(32);
  tx.vin = inputs.map(({ tx: parent, vout }) => ({ ...structuredClone(fundingTx.vin[0]!), txid: parent.txid, vout, prevout: { ...parent.vout[vout]! } }));
  tx.vout = outputs.map((o) => ({ ...structuredClone(fundingTx.vout[0]!), scriptpubkey_address: o.address, scriptpubkey_type: "v0_p2wpkh", value: o.value }));
  return tx;
}

test("wallet heuristics: change merged with a receipt is flagged and links to the tx", async ({ page }) => {
  const r1 = payTo("c1", FIRST_ADDRESS, 300_000);
  const r2 = payTo("d1", SECOND_ADDRESS, 600_000);
  const p1 = spend("e1", [{ tx: r1, vout: 0 }], [{ address: OUTSIDE_1, value: 200_000 }, { address: CHANGE_ADDRESS, value: 99_000 }]);
  const m1 = spend("f1", [{ tx: p1, vout: 1 }, { tx: r2, vout: 0 }], [{ address: OUTSIDE_2, value: 690_000 }]);
  await mockExtraTxs(page, [r1, r2, p1, m1]);
  await mockWalletAddresses(page, {
    [FIRST_ADDRESS]: { txs: [p1, r1], utxos: [], fundedSats: 300_000, fundedCount: 1 },
    [SECOND_ADDRESS]: { txs: [m1, r2], utxos: [], fundedSats: 600_000, fundedCount: 1 },
    [CHANGE_ADDRESS]: { txs: [m1, p1], utxos: [], fundedSats: 99_000, fundedCount: 1 },
  });

  await page.goto(`/#xpub=${ZPUB}`);
  await expect(page.getByText("Wallet Privacy Audit")).toBeVisible({ timeout: 20_000 });
  // A medium finding sits in the collapsed "Minor signals" group (the round payment's
  // change exposure is the open, high one)
  await page.getByRole("button", { name: /Minor signals/ }).click();
  const finding = page.getByRole("button", { name: /1 spend merged change with other coins/ });
  await expect(finding).toBeVisible();
  await finding.click();
  const refs = page.getByTestId("finding-tx-refs");
  await expect(refs).toBeVisible();
  await refs.getByRole("button").first().click();
  await expect(page).toHaveURL(new RegExp(`#tx=${"f1".repeat(32)}`));
});
