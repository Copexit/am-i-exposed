import { describe, it, expect, vi } from "vitest";
import { base64 } from "@scure/base";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt } from "@/lib/input/__tests__/fixtures";
import { parseLocalTx } from "@/lib/input/local-tx";
import { runLocalAnalysis, LookupFailedError } from "../run-local-analysis";

vi.mock("@/lib/analysis/boltzmann-compute", () => ({
  isAutoComputable: () => true,
  computeBoltzmann: vi.fn().mockResolvedValue(null),
}));

const deps = { lookup: null, signal: new AbortController().signal, boltzmannTimeoutMs: 1000, isCustomApi: false };

describe("runLocalAnalysis", () => {
  it("never reports timing-unconfirmed for a local tx", async () => {
    const local = parseLocalTx(base64.encode(buildPsbt({ sign: false }).toPSBT()), "mainnet");
    const r = await runLocalAnalysis(local, deps);
    expect(r.result.findings.some((f) => f.id === "timing-unconfirmed")).toBe(false);
  });

  it("lists missing amounts instead of silently skipping (raw tx, no lookup)", async () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    const r = await runLocalAnalysis(parseLocalTx(bytesToHex(t.extract()), "mainnet"), deps);
    const f = r.result.findings.find((x) => x.id === "local-needs-amounts");
    expect(f?.params).toEqual({ count: 1 });
    expect(r.lookedUp).toBe(false);
  });

  it("patches prevouts from looked-up parents and computes the fee", async () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    const local = parseLocalTx(bytesToHex(t.extract()), "mainnet");
    const parentId = local.tx.vin[0]!.txid;
    const parent = {
      txid: parentId, vin: [], status: { confirmed: true, block_height: 800_000 },
      vout: [{ value: 100_000, scriptpubkey: "0014" + "00".repeat(20), scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", scriptpubkey_asm: "" }],
    };
    const lookup = {
      getTransaction: vi.fn().mockResolvedValue(parent),
      getAddress: vi.fn().mockResolvedValue({ chain_stats: { tx_count: 3 }, mempool_stats: { tx_count: 0 } }),
    };
    const r = await runLocalAnalysis(local, { ...deps, lookup: lookup as never });
    expect(lookup.getTransaction).toHaveBeenCalledWith(parentId, expect.anything());
    expect(r.tx.vin[0]!.prevout?.value).toBe(100_000);
    expect(r.tx.fee).toBe(1_000);
    expect(r.outputTxCounts?.size).toBe(2);
    expect(r.result.findings.some((f) => f.id === "local-needs-amounts")).toBe(false);
    expect(local.tx.vin[0]!.prevout).toBeNull(); // input LocalTx untouched
  });

  describe("lookup failures", () => {
    const setup = () => {
      const t = buildPsbt({ sign: true }); t.finalize();
      const local = parseLocalTx(bytesToHex(t.extract()), "mainnet");
      return { local, parentId: local.tx.vin[0]!.txid };
    };

    it("throws LookupFailedError when every request fails", async () => {
      const { local } = setup();
      const lookup = { getTransaction: vi.fn().mockRejectedValue(new Error("down")), getAddress: vi.fn().mockRejectedValue(new Error("down")) };
      await expect(runLocalAnalysis(local, { ...deps, lookup: lookup as never })).rejects.toBeInstanceOf(LookupFailedError);
    });

    it("resolves on a partial failure", async () => {
      const { local, parentId } = setup();
      const parent = {
        txid: parentId, vin: [], status: { confirmed: true, block_height: 800_000 },
        vout: [{ value: 100_000, scriptpubkey: "0014" + "00".repeat(20), scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", scriptpubkey_asm: "" }],
      };
      const lookup = { getTransaction: vi.fn().mockResolvedValue(parent), getAddress: vi.fn().mockRejectedValue(new Error("down")) };
      const r = await runLocalAnalysis(local, { ...deps, lookup: lookup as never });
      expect(r.tx.vin[0]!.prevout?.value).toBe(100_000);
    });
  });
});
