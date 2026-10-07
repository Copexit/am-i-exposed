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
  "6cb2433f28177a3b07073a0eb34a527ba6d7dd7483cccb394f88321373c0ed20": "joinmarket-multi-input",
  "0bf67b1f05326afbd613e11631a2b86466ac7e255499f6286e31b9d7d889cee7": "taproot-op-return",
  "60a20bd93aa49ab4b28d514ec10b06e1829ce6818ec06cd3aabd013ebcdc4bb1": "bare-multisig",
  "8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684": "op-return-charley",
  "0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4": "simple-legacy-p2pkh",
  "3d81a6b95903dd457d45a2fc998acc42fe96f59ef01157bdcbc331fe451c8d9e": "batch-withdrawal-143",
  "655c533bf059721cec9d3d70b3171a07997991a02fedfa1c9b593abc645e1cc5": "dust-attack-555",
  "37777defed8717c581b4c0509329550e344bdc14ac38f71fc050096887e535c8": "taproot-script-path",
  "40b88e16fe9881eb89df76265ccf2d46abfd1071a94dae8e413efc0d83d3df18": "consolidation-5in1out",
};

/** Map of address -> fixture name prefix */
const ADDR_MAP: Record<string, string> = {
  "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa": "satoshi-genesis",
};

/**
 * Recorded API responses (path -> body) for the home example cards, captured
 * by `node scripts/capture-fixtures.mjs --home`. Served before the defaults.
 */
const HOME_DIR = path.join(FIXTURES_DIR, "home");
const RECORDED: Record<string, unknown> = Object.assign(
  {},
  ...fs.readdirSync(HOME_DIR).map((f) => JSON.parse(fs.readFileSync(path.join(HOME_DIR, f), "utf-8")) as Record<string, unknown>),
);

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
    const recorded = RECORDED[`/tx/${url.split("/api/tx/")[1]?.split("?")[0]}`];
    if (recorded) return route.fulfill(json(recorded));
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
    const recorded = RECORDED[`/tx/${txid}`];
    if (recorded) return route.fulfill(json(recorded));
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
export async function mockExtraTxs(page: Page, txs: { txid: string; vout: unknown[] }[]) {
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
  /** Funded output count (defaults to txs.length, which marks a receive-then-spend address as reused) */
  fundedCount?: number;
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
    const txCount = data ? data.txs.length : 0;
    const n = data?.fundedCount ?? txCount;
    const sats = data?.fundedSats ?? 0;
    await route.fulfill(json({
      address: addr,
      chain_stats: { funded_txo_count: n, funded_txo_sum: sats, spent_txo_count: 0, spent_txo_sum: 0, tx_count: txCount },
      mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
    }));
  });
}

const OBSERVATORY_FIXTURES = path.join(__dirname, "../../src/lib/observatory/__tests__/fixtures");
const readObservatory = (name: string) =>
  fs.readFileSync(path.join(OBSERVATORY_FIXTURES, `${name}.json`), "utf-8");

const readWabiAgg = (name: string) =>
  fs.readFileSync(path.join(OBSERVATORY_FIXTURES, "wabisator", `${name}.json`), "utf-8");

/**
 * Observatory mock: the hosted Cloudflare Worker's whirlpool JSON routes and the Wabisator
 * aggregate JSON-RPC methods (flow-map, coordinators-status, volume-history, rounds-paginated),
 * served from the unit-test fixtures. Returns every Wabisator request body, as received.
 * (A later mockWabisator route takes priority for the same URL.)
 */
export async function mockObservatoryApi(page: Page): Promise<string[]> {
  const bodies: string[] = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  await page.route("https://coinjoin-stats.copexit.workers.dev/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const { pathname } = new URL(req.url());
    let body: string | null = null;
    if (pathname === "/svc/whirlpoolstats/summary") body = readObservatory("whirlpool-summary");
    else if (pathname === "/svc/whirlpoolstats/charts") body = readObservatory("whirlpool-charts");
    else if (pathname === "/svc/whirlpoolstats/txs") body = readObservatory("whirlpool-txs");
    else if (pathname === "/svc/wabisator/api.php") {
      bodies.push(req.postData() ?? "");
      const rpc = req.postDataJSON() as { id: number; method: string; params: { since?: number; until?: number } };
      const { since, until } = rpc.params;
      const fixture =
        rpc.method === "flow-map" ? (until !== undefined && since !== undefined && until - since === 86400 ? "flow-map-1d" : "flow-map-7d")
        : rpc.method === "coordinators-status" ? "coordinators-status"
        : rpc.method === "volume-history" ? "volume-history"
        : rpc.method === "rounds-paginated" ? "rounds-kruw"
        : null;
      if (fixture) body = JSON.stringify({ ...JSON.parse(readWabiAgg(fixture)), id: rpc.id });
    }
    else body = p2pBody(pathname, new URL(req.url()).searchParams);
    if (body === null) return route.fulfill({ status: 404, headers: cors, body: "not found" });
    await route.fulfill({ status: 200, headers: cors, body, contentType: "application/json" });
  });
  return bodies;
}

const P2P_FIXTURES = path.join(__dirname, "../../src/lib/observatory/__tests__/fixtures/p2p");
const readP2p = (name: string) => fs.readFileSync(path.join(P2P_FIXTURES, name), "utf-8");
/** Recorded 2026-10-07 16:35 UTC; Nostr offers expire against the visitor clock, so P2P specs pin it here. */
export const P2P_FIXTURE_TIME = new Date(1791386100 * 1000 + 60_000);

/**
 * P2P routes from the recorded fixtures. The browser verifies every Nostr signature and the
 * redacted order files do not verify, so both order snapshots are the untouched signed sample
 * (6 RoboSats, 6 Mostro events); Mostro info is unredacted and verifies; trades are served as is.
 */
function p2pBody(pathname: string, query: URLSearchParams): string | null {
  switch (pathname) {
    case "/svc/robosats-nostr/orders":
    case "/svc/mostro-nostr/orders":
      return readP2p("nostr/signed-sample.json");
    case "/svc/mostro-nostr/info": return readP2p("nostr/mostro-info.json");
    case "/svc/mostro-nostr/trades": return readP2p("nostr/mostro-trades.json");
    case "/svc/robosats-temple/api/info/": return readP2p("robosats/temple-info.json");
    case "/svc/robosats-lake/api/info/": return readP2p("robosats/lake-info.json");
    case "/svc/robosats-temple/api/limits/":
    case "/svc/robosats-lake/api/limits/": return readP2p("robosats/temple-limits.json");
    case "/svc/robosats-temple/api/historical/": return readP2p("robosats/temple-historical.json");
    case "/svc/robosats-lake/api/historical/": return readP2p("robosats/lake-historical.json");
    case "/svc/hodlhodl/api/v1/offers":
      return readP2p(Number(query.get("pagination[offset]") ?? 0) >= 500 ? "hodlhodl/offers-500.json" : "hodlhodl/offers-0.json");
    default: return null;
  }
}

/** Makes one P2P worker route answer 502 (register after mockObservatoryApi: the newest route wins). */
export async function failP2pRoute(page: Page, pathname: string): Promise<void> {
  await page.route(`https://coinjoin-stats.copexit.workers.dev${pathname}**`, (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } })
      : route.fulfill({ status: 502, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: '{"error":{"code":"UPSTREAM_DOWN"}}' }));
}

const WABISATOR_FIXTURES = path.join(__dirname, "../../src/lib/services/__tests__/fixtures");
const readWabisator = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(WABISATOR_FIXTURES, `wabisator-${name}.json`), "utf-8")) as {
    result: Record<string, unknown> & { Query?: string; Matches?: { TxId: string }[]; Transaction?: Record<string, unknown> | null };
  };

/**
 * Wabisator JSON-RPC mock (via the hosted relay). `known` maps a txid to the
 * fixture its `search`/`coinjoin` calls are answered from (query rewritten to
 * that txid); every other txid is answered as unknown. `limitOutOf` truncates
 * the post-mix OutOf list. Returns the JSON-RPC methods received, in order.
 */
export async function mockWabisator(
  page: Page,
  known: Record<string, "coinjoin" | "postmix"> = {},
  opts: { limitOutOf?: number } = {},
): Promise<string[]> {
  const methods: string[] = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  await page.route("https://coinjoin-stats.copexit.workers.dev/svc/wabisator/api.php", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const rpc = req.postDataJSON() as { id: number; method: string; params: { query?: string; txId?: string } };
    methods.push(rpc.method);
    const txid = rpc.params.query ?? rpc.params.txId ?? "";
    const kind = known[txid];
    let env;
    if (rpc.method === "coinjoin") {
      env = readWabisator("coinjoin");
    } else {
      env = readWabisator(kind === "coinjoin" ? "search-coinjoin" : kind === "postmix" ? "search-postmix" : "search-unknown");
      env.result.Query = txid;
      for (const m of env.result.Matches ?? []) m.TxId = txid;
      if (env.result.Transaction) env.result.Transaction.TxId = txid;
      const t = env.result.Transaction as { OutOf?: unknown[] } | null | undefined;
      if (kind === "postmix" && opts.limitOutOf !== undefined && t?.OutOf) t.OutOf = t.OutOf.slice(0, opts.limitOutOf);
    }
    await route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ ...env, id: rpc.id }) });
  });
  return methods;
}
