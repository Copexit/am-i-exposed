/**
 * MCP scan_transaction must run the same pipeline as `scan tx`,
 * so an agent and a CLI user get the same grade for the same tx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { MempoolTransaction } from "@/lib/api/types";
import simpleLegacyTx from "@/lib/analysis/heuristics/__tests__/fixtures/api-responses/simple-legacy-p2pkh.json";

const tx = simpleLegacyTx as unknown as MempoolTransaction;
const mockFetch = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal("fetch", mockFetch);

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

let captured: string[] = [];
const originalLog = console.log;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string | URL | Request) => {
    const u = url.toString();
    if (u.endsWith("/hex")) return new Response("0200000001" + "0".repeat(100), { status: 200 });
    if (u.endsWith("/outspends")) return json(tx.vout.map(() => ({ spent: false })));
    if (u.includes("/address/")) {
      const stats = { funded_txo_count: 1, funded_txo_sum: 100000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 };
      return json({ address: "x", chain_stats: stats, mempool_stats: { ...stats, funded_txo_count: 0, funded_txo_sum: 0, tx_count: 0 } });
    }
    if (u.includes("/tx/")) return json(tx);
    return new Response("Not Found", { status: 404 });
  });
  captured = [];
  console.log = (...args: unknown[]) => captured.push(args.map(String).join(" "));
});

afterEach(() => {
  console.log = originalLog;
});

async function callScanTransaction(args: Record<string, unknown>) {
  const { createMcpServer } = await import("../src/mcp/server");
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(serverT);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientT);
  const res = await client.callTool({ name: "scan_transaction", arguments: args });
  await client.close();
  const [content] = res.content as { type: string; text: string }[];
  return JSON.parse(content.text) as Record<string, unknown>;
}

describe("MCP scan_transaction", () => {
  it("agrees with `scan tx --chain-depth 1` (chain findings count toward the grade)", async () => {
    const mcp = await callScanTransaction({ txid: tx.txid, chainDepth: 1 });

    const { scanTx } = await import("../src/commands/scan-tx");
    await scanTx(tx.txid, { json: true, network: "mainnet", entities: false, color: true, chainDepth: "1" } as never);
    const cli = JSON.parse(captured[captured.length - 1]) as Record<string, unknown>;

    const ids = (r: Record<string, unknown>) => (r.findings as { id: string }[]).map((f) => f.id);
    expect(ids(mcp).some((id) => id.startsWith("chain-"))).toBe(true);
    expect(mcp.score).toBe(cli.score);
    expect(mcp.grade).toBe(cli.grade);
    expect(ids(mcp)).toEqual(ids(cli));
    expect(mcp.chainAnalysis).toEqual(cli.chainAnalysis);
  });
});
