/**
 * `scan psbt` and MCP scan_psbt encode PSBT addresses for the selected network,
 * like the web (parsePSBT(input, network)).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("@/lib/bitcoin/psbt", async (orig) => {
  const real = await orig<typeof import("@/lib/bitcoin/psbt")>();
  return { ...real, parsePSBT: vi.fn(real.parsePSBT) };
});

import { parsePSBT } from "@/lib/bitcoin/psbt";
import { scanPsbt } from "../src/commands/scan-psbt";
import { createMcpServer } from "../src/mcp/server";

// prettier-ignore
const PSBT = "cHNidP8BAFICAAAAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAD/////AZBfAQAAAAAAFgAUzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc0AAAAAAAEBH6CGAQAAAAAAFgAUq6urq6urq6urq6urq6urq6urq6sAAA==";

beforeEach(() => { vi.mocked(parsePSBT).mockClear(); });

describe("PSBT network", () => {
  it("scan psbt --network testnet4 encodes tb1 addresses", async () => {
    const out: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((s: string) => { out.push(s); });
    await scanPsbt(PSBT, { json: true, network: "testnet4", entities: false, color: true } as never);
    log.mockRestore();
    expect(vi.mocked(parsePSBT).mock.calls[0]?.[1]).toBe("testnet4");
    expect(vi.mocked(parsePSBT).mock.results[0]?.value.tx.vout[0].scriptpubkey_address).toMatch(/^tb1/);
    expect(JSON.parse(out[out.length - 1] ?? "{}").network).toBe("testnet4");
  });

  it("MCP scan_psbt takes a network", async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await createMcpServer().connect(serverT);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientT);
    await client.callTool({ name: "scan_psbt", arguments: { psbt: PSBT, network: "signet" } });
    await client.close();
    expect(vi.mocked(parsePSBT).mock.calls[0]?.[1]).toBe("signet");
  });
});
