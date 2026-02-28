import { type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const FIXTURES_DIR = path.join(
  __dirname,
  "../../src/lib/analysis/heuristics/__tests__/fixtures/api-responses",
);

/** Map of txid -> fixture filename (without .json) */
const TX_MAP: Record<string, string> = {
  "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2": "whirlpool-coinjoin",
  "fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e": "wabisabi-coinjoin",
  "4f112abd2eefe3484a7bbf7c1731f784cba19de677468835145e9c448fb18b7d": "joinmarket-coinjoin",
  "0bf67b1f05326afbd613e11631a2b86466ac7e255499f6286e31b9d7d889cee7": "taproot-op-return",
  "60a20bd93aa49ab4b28d514ec10b06e1829ce6818ec06cd3aabd013ebcdc4bb1": "bare-multisig",
  "8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684": "op-return-charley",
  "0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4": "simple-legacy-p2pkh",
  "3d81a6b95903dd457d45a2fc998acc42fe96f59ef01157bdcbc331fe451c8d9e": "batch-withdrawal-143",
  "655c533bf059721cec9d3d70b3171a07997991a02fedfa1c9b593abc645e1cc5": "dust-attack-555",
  "37777defed8717c581b4c0509329550e344bdc14ac38f71fc050096887e535c8": "taproot-script-path",
};

/** Map of address -> fixture name prefix */
const ADDR_MAP: Record<string, string> = {
  "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa": "satoshi-genesis",
};

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf-8");
}

/**
 * Intercept all mempool.space API calls and return fixture data.
 * Unknown txids/addresses get a 404.
 */
export async function mockMempoolApi(page: Page) {
  // Transaction endpoints
  await page.route("**/api/tx/**/hex", async (route) => {
    // Return empty hex - rawHex is optional for analysis
    await route.fulfill({ status: 200, body: "", contentType: "text/plain" });
  });

  await page.route("**/api/tx/**", async (route) => {
    const url = route.request().url();
    // Skip /hex routes (handled above)
    if (url.endsWith("/hex")) {
      await route.fallback();
      return;
    }
    const txid = url.split("/api/tx/")[1]?.split("/")[0]?.split("?")[0];
    const fixture = txid ? TX_MAP[txid] : undefined;
    if (fixture) {
      await route.fulfill({
        status: 200,
        body: readFixture(fixture),
        contentType: "application/json",
      });
    } else {
      await route.fulfill({ status: 404, body: "Transaction not found" });
    }
  });

  // Address endpoints
  await page.route("**/api/address/**/utxo", async (route) => {
    const url = route.request().url();
    const addr = url.split("/api/address/")[1]?.split("/")[0];
    const prefix = addr ? ADDR_MAP[addr] : undefined;
    if (prefix) {
      await route.fulfill({
        status: 200,
        body: readFixture(`${prefix}-utxos`),
        contentType: "application/json",
      });
    } else {
      await route.fulfill({ status: 200, body: "[]", contentType: "application/json" });
    }
  });

  await page.route("**/api/address/**/txs/**", async (route) => {
    // Pagination endpoint - return empty array (we only serve first page)
    await route.fulfill({ status: 200, body: "[]", contentType: "application/json" });
  });

  await page.route("**/api/address/**/txs", async (route) => {
    const url = route.request().url();
    const addr = url.split("/api/address/")[1]?.split("/")[0];
    const prefix = addr ? ADDR_MAP[addr] : undefined;
    if (prefix) {
      await route.fulfill({
        status: 200,
        body: readFixture(`${prefix}-txs`),
        contentType: "application/json",
      });
    } else {
      await route.fulfill({ status: 200, body: "[]", contentType: "application/json" });
    }
  });

  await page.route("**/api/address/**", async (route) => {
    const url = route.request().url();
    // Skip /txs and /utxo (handled above)
    if (url.includes("/txs") || url.includes("/utxo")) {
      await route.fallback();
      return;
    }
    const addr = url.split("/api/address/")[1]?.split("/")[0]?.split("?")[0];
    const prefix = addr ? ADDR_MAP[addr] : undefined;
    if (prefix) {
      await route.fulfill({
        status: 200,
        body: readFixture(`${prefix}-address`),
        contentType: "application/json",
      });
    } else {
      await route.fulfill({ status: 404, body: "Address not found" });
    }
  });
}
