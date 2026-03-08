import { describe, it, expect, beforeEach } from "vitest";
import { tracePeelChain } from "../peel-chain-trace";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";
import type { MempoolTransaction } from "@/lib/api/types";

beforeEach(() => resetAddrCounter());

function makePeelTx(
  txid: string,
  paymentValue: number,
  changeValue: number,
  fee: number,
  changeAddress?: string,
): MempoolTransaction {
  return makeTx({
    txid,
    fee,
    vin: [
      makeVin({
        txid: "parent_" + txid,
        prevout: {
          scriptpubkey: "",
          scriptpubkey_asm: "",
          scriptpubkey_type: "v0_p2wpkh",
          scriptpubkey_address: "bc1qinput",
          value: paymentValue + changeValue + fee,
        },
      }),
    ],
    vout: [
      makeVout({ value: paymentValue, scriptpubkey_address: "bc1qpay_" + txid }),
      makeVout({
        value: changeValue,
        scriptpubkey_address: changeAddress ?? "bc1qchange_" + txid,
      }),
    ],
    status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
  });
}

describe("tracePeelChain", () => {
  it("traces a 4-hop peel chain", () => {
    const tx1 = makePeelTx("t1", 10_000, 90_000, 1_000);
    const tx2 = makePeelTx("t2", 15_000, 74_000, 1_000);
    const tx3 = makePeelTx("t3", 20_000, 53_000, 1_000);
    const tx4 = makePeelTx("t4", 10_000, 42_000, 1_000);

    const childMap = new Map<string, MempoolTransaction>();
    childMap.set("t1", tx2);
    childMap.set("t2", tx3);
    childMap.set("t3", tx4);

    const result = tracePeelChain(tx1, childMap);
    expect(result.hops).toHaveLength(4);
    expect(result.totalPeeled).toBe(55_000); // 10k + 15k + 20k + 10k
    expect(result.remainingBalance).toBe(42_000);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].id).toBe("peel-chain-trace");
  });

  it("detects address reuse in peel chain", () => {
    const reusedAddr = "bc1qreused";
    const tx1 = makePeelTx("t1", 10_000, 90_000, 1_000, reusedAddr);
    const tx2 = makePeelTx("t2", 15_000, 74_000, 1_000, reusedAddr);
    const tx3 = makePeelTx("t3", 20_000, 53_000, 1_000, reusedAddr);
    const tx4 = makePeelTx("t4", 10_000, 42_000, 1_000, reusedAddr);

    const childMap = new Map<string, MempoolTransaction>();
    childMap.set("t1", tx2);
    childMap.set("t2", tx3);
    childMap.set("t3", tx4);

    const result = tracePeelChain(tx1, childMap);
    expect(result.hops).toHaveLength(4);
    // Hops 2-4 should have addressReused = true (first hop establishes the address)
    expect(result.hops.filter((h) => h.addressReused).length).toBe(3);
    expect(result.findings[0].params?.reusedAddresses).toBe(3);
  });

  it("stops at CoinJoin break", () => {
    const tx1 = makePeelTx("t1", 10_000, 90_000, 1_000);

    // tx2 is a CoinJoin (many inputs/outputs)
    const coinjoinTx = makeTx({
      txid: "cj",
      vin: Array.from({ length: 5 }, () => makeVin()),
      vout: Array.from({ length: 5 }, () => makeVout({ value: 50_000 })),
    });

    const childMap = new Map<string, MempoolTransaction>();
    childMap.set("t1", coinjoinTx);

    const result = tracePeelChain(tx1, childMap);
    expect(result.hops).toHaveLength(1);
    expect(result.hops[0].chainBreak).toBe(true);
    expect(result.hops[0].breakReason).toBe("CoinJoin");
  });

  it("returns short chain finding for 2-3 hops", () => {
    const tx1 = makePeelTx("t1", 10_000, 90_000, 1_000);
    const tx2 = makePeelTx("t2", 15_000, 74_000, 1_000);
    const tx3 = makePeelTx("t3", 20_000, 53_000, 1_000);

    const childMap = new Map<string, MempoolTransaction>();
    childMap.set("t1", tx2);
    childMap.set("t2", tx3);

    const result = tracePeelChain(tx1, childMap);
    expect(result.hops).toHaveLength(3);
    expect(result.findings[0].id).toBe("peel-chain-trace-short");
  });

  it("stops when output ratio is not asymmetric", () => {
    // tx with equal outputs (not a peel chain hop)
    const tx = makeTx({
      txid: "equal",
      vout: [
        makeVout({ value: 50_000 }),
        makeVout({ value: 50_000 }),
      ],
    });

    const result = tracePeelChain(tx, new Map());
    expect(result.hops).toHaveLength(0);
  });

  it("respects maxHops limit", () => {
    const childMap = new Map<string, MempoolTransaction>();
    let balance = 1_000_000;

    // Create a long chain
    for (let i = 0; i < 25; i++) {
      const payment = 10_000;
      const fee = 1_000;
      balance -= payment + fee;
      if (i < 24) {
        childMap.set(`t${i}`, makePeelTx(`t${i + 1}`, 10_000, balance - 11_000, fee));
      }
    }

    const startTx = makePeelTx("t0", 10_000, 978_000, 1_000);
    const result = tracePeelChain(startTx, childMap, undefined, 5);
    expect(result.hops.length).toBeLessThanOrEqual(5);
  });
});
