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
 * Unknown txids/addresses get a 404; every other external request is aborted.
 */
export async function mockMempoolApi(page: Page) {
  // Registered first so it has the lowest priority: anything not handled by
  // a specific mock below (or served by the local static server) is aborted,
  // so tests can never reach the real network.
  await page.route(
    (url) => url.hostname !== "localhost",
    (route) => route.abort("blockedbyclient"),
  );

  // Transaction endpoints (order matters: specific routes before catch-all)
  await page.route("**/api/tx/**/hex", async (route) => {
    await route.fulfill({ status: 200, body: "", contentType: "text/plain" });
  });

  await page.route("**/api/tx/**/outspends", async (route) => {
    const url = route.request().url();
    const txid = url.split("/api/tx/")[1]?.split("/")[0]?.split("?")[0];
    const fixture = txid ? TX_MAP[txid] : undefined;
    if (fixture) {
      const tx = JSON.parse(readFixture(fixture));
      const outspends = (tx.vout as unknown[]).map(() => ({ spent: false }));
      await route.fulfill({
        status: 200,
        body: JSON.stringify(outspends),
        contentType: "application/json",
      });
    } else {
      await route.fulfill({ status: 404, body: "Transaction not found" });
    }
  });

  await page.route("**/api/tx/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/hex") || url.includes("/outspends")) {
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

/** Read a fixture from the api-responses directory as parsed JSON. */
export function loadTxFixture(name: string): MockTx {
  return JSON.parse(readFixture(name)) as MockTx;
}

export interface MockTx {
  txid: string;
  vin: { txid: string; vout: number; prevout: Record<string, unknown> | null }[];
  vout: Record<string, unknown>[];
  [key: string]: unknown;
}

const json = (body: unknown) => ({
  status: 200,
  body: JSON.stringify(body),
  contentType: "application/json",
});

/** Split ".../api/<kind>/<id>/<sub>/<more>?q" into [id, sub, more]. */
function apiPath(url: string, kind: "tx" | "address"): string[] {
  return url.split(`/api/${kind}/`)[1]?.split("?")[0]?.split("/") ?? [];
}

/**
 * Serve extra, test-built transactions on /api/tx/<txid> and their outspends
 * (all unspent). Call after mockMempoolApi so these routes take priority;
 * other txids fall through to the fixture mocks.
 */
export async function mockExtraTxs(page: Page, txs: MockTx[]) {
  const byId = new Map(txs.map((tx) => [tx.txid, tx]));
  await page.route("**/api/tx/**", async (route) => {
    const [txid, sub] = apiPath(route.request().url(), "tx");
    const tx = txid ? byId.get(txid) : undefined;
    if (!tx || (sub && sub !== "outspends")) return route.fallback();
    await route.fulfill(json(sub ? tx.vout.map(() => ({ spent: false })) : tx));
  });
}

export interface MockAddressData {
  txs: MockTx[];
  utxos: unknown[];
  fundedSats: number;
}

/**
 * Wallet scan mock: every address is an empty, unused address except the
 * ones in `funded`. Call after mockMempoolApi so these routes take priority.
 */
export async function mockWalletAddresses(page: Page, funded: Record<string, MockAddressData>) {
  await page.route("**/api/address/**", async (route) => {
    const [addr, sub, more] = apiPath(route.request().url(), "address");
    if (!addr) return route.fallback();
    const data = funded[addr];
    if (sub === "txs") return route.fulfill(json(more || !data ? [] : data.txs));
    if (sub === "utxo") return route.fulfill(json(data?.utxos ?? []));
    const n = data ? data.txs.length : 0;
    const sats = data?.fundedSats ?? 0;
    await route.fulfill(json({
      address: addr,
      chain_stats: { funded_txo_count: n, funded_txo_sum: sats, spent_txo_count: 0, spent_txo_sum: 0, tx_count: n },
      mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
    }));
  });
}

const OBSERVATORY_FIXTURES = path.join(__dirname, "../../src/lib/observatory/__tests__/fixtures");
const readObservatory = (name: string) =>
  fs.readFileSync(path.join(OBSERVATORY_FIXTURES, `${name}.json`), "utf-8");

/**
 * Observatory mock: the hosted Cloudflare Worker's whirlpool JSON routes and
 * the LiquiSabi JSON-RPC `dashboard` call, served from the unit-test fixtures.
 */
export async function mockObservatoryApi(page: Page) {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  await page.route("https://coinjoin-stats.copexit.workers.dev/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const { pathname } = new URL(req.url());
    let body: string | null = null;
    if (pathname === "/whirlpool/summary") body = readObservatory("whirlpool-summary");
    else if (pathname === "/whirlpool/charts") body = readObservatory("whirlpool-charts");
    else if (pathname === "/whirlpool/txs") body = readObservatory("whirlpool-txs");
    else if (pathname === "/liquisabi/api") {
      const { id } = req.postDataJSON() as { id: number };
      body = `{"jsonrpc":"2.0","id":${id},"result":${readObservatory("liquisabi-dashboard")}}`;
    }
    if (body === null) return route.fulfill({ status: 404, headers: cors, body: "not found" });
    await route.fulfill({ status: 200, headers: cors, body, contentType: "application/json" });
  });
}
