import { describe, it, expect, beforeEach } from "vitest";
import { buildCluster, classifyClusterSize } from "../clustering";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";
import { WHIRLPOOL_DENOMS } from "@/lib/constants";
import type { MempoolTransaction } from "@/lib/api/types";

beforeEach(() => resetAddrCounter());

describe("classifyClusterSize", () => {
  it("classifies single address", () => {
    expect(classifyClusterSize(1)).toBe("single");
  });

  it("classifies small cluster", () => {
    expect(classifyClusterSize(2)).toBe("small");
    expect(classifyClusterSize(3)).toBe("small");
  });

  it("classifies typical cluster", () => {
    expect(classifyClusterSize(4)).toBe("typical");
    expect(classifyClusterSize(10)).toBe("typical");
  });

  it("classifies active cluster", () => {
    expect(classifyClusterSize(11)).toBe("active");
    expect(classifyClusterSize(50)).toBe("active");
  });

  it("classifies service cluster", () => {
    expect(classifyClusterSize(51)).toBe("service");
    expect(classifyClusterSize(500)).toBe("service");
  });

  it("classifies exchange cluster", () => {
    expect(classifyClusterSize(501)).toBe("exchange");
    expect(classifyClusterSize(10000)).toBe("exchange");
  });
});

describe("buildCluster", () => {
  it("returns single-address cluster when no co-inputs", () => {
    const addr = "bc1qseed000000000000000000000000000000000";
    // tx where addr is only input
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addr, value: 100000 } })],
      vout: [makeVout()],
    });

    const txsByAddress = new Map<string, MempoolTransaction[]>();
    txsByAddress.set(addr, [tx]);

    const result = buildCluster(addr, txsByAddress);

    expect(result.clusterAddresses.size).toBe(1);
    expect(result.clusterAddresses.has(addr)).toBe(true);
    expect(result.riskTier).toBe("single");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("good");
    expect(result.findings[0].scoreImpact).toBe(3);
  });

  it("clusters co-input addresses via CIOH", () => {
    const addrA = "bc1qaddr_a0000000000000000000000000000000";
    const addrB = "bc1qaddr_b0000000000000000000000000000000";
    const addrC = "bc1qaddr_c0000000000000000000000000000000";

    // tx1: addrA and addrB co-spent as inputs
    const tx1 = makeTx({
      txid: "1".repeat(64),
      vin: [
        makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addrA, value: 50000 } }),
        makeVin({ prevout: { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addrB, value: 50000 } }),
      ],
      vout: [makeVout()],
    });

    // tx2: addrB and addrC co-spent (depth 2 expansion)
    const tx2 = makeTx({
      txid: "2".repeat(64),
      vin: [
        makeVin({ prevout: { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addrB, value: 30000 } }),
        makeVin({ prevout: { scriptpubkey: "0014ccc", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addrC, value: 30000 } }),
      ],
      vout: [makeVout()],
    });

    const txsByAddress = new Map<string, MempoolTransaction[]>();
    txsByAddress.set(addrA, [tx1]);
    txsByAddress.set(addrB, [tx1, tx2]);
    txsByAddress.set(addrC, [tx2]);

    const result = buildCluster(addrA, txsByAddress, 2);

    expect(result.clusterAddresses.size).toBe(3);
    expect(result.clusterAddresses.has(addrA)).toBe(true);
    expect(result.clusterAddresses.has(addrB)).toBe(true);
    expect(result.clusterAddresses.has(addrC)).toBe(true);
    expect(result.riskTier).toBe("small");
  });

  it("excludes CoinJoin transactions from clustering", () => {
    const addrA = "bc1qaddr_a0000000000000000000000000000000";
    const addrB = "bc1qaddr_b0000000000000000000000000000000";
    const denom = WHIRLPOOL_DENOMS[0];

    // Whirlpool CoinJoin - should NOT cluster these addresses
    const cjTx = makeTx({
      txid: "c".repeat(64),
      vin: [
        makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addrA, value: denom + 5000 } }),
        makeVin({ prevout: { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addrB, value: denom + 5000 } }),
        makeVin(),
        makeVin(),
        makeVin(),
      ],
      vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    });

    const txsByAddress = new Map<string, MempoolTransaction[]>();
    txsByAddress.set(addrA, [cjTx]);
    txsByAddress.set(addrB, [cjTx]);

    const result = buildCluster(addrA, txsByAddress);

    // Should NOT cluster because it's a CoinJoin
    expect(result.clusterAddresses.size).toBe(1);
    expect(result.clusterAddresses.has(addrB)).toBe(false);
  });

  it("respects maxDepth limit", () => {
    const addrA = "bc1qaddr_a0000000000000000000000000000000";
    const addrB = "bc1qaddr_b0000000000000000000000000000000";
    const addrC = "bc1qaddr_c0000000000000000000000000000000";

    const tx1 = makeTx({
      txid: "1".repeat(64),
      vin: [
        makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addrA, value: 50000 } }),
        makeVin({ prevout: { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addrB, value: 50000 } }),
      ],
      vout: [makeVout()],
    });

    const tx2 = makeTx({
      txid: "2".repeat(64),
      vin: [
        makeVin({ prevout: { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addrB, value: 30000 } }),
        makeVin({ prevout: { scriptpubkey: "0014ccc", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addrC, value: 30000 } }),
      ],
      vout: [makeVout()],
    });

    const txsByAddress = new Map<string, MempoolTransaction[]>();
    txsByAddress.set(addrA, [tx1]);
    txsByAddress.set(addrB, [tx1, tx2]);
    txsByAddress.set(addrC, [tx2]);

    // Depth 1: should only find A and B (not expand to C)
    const result = buildCluster(addrA, txsByAddress, 1);

    expect(result.clusterAddresses.size).toBe(2);
    expect(result.clusterAddresses.has(addrA)).toBe(true);
    expect(result.clusterAddresses.has(addrB)).toBe(true);
    expect(result.clusterAddresses.has(addrC)).toBe(false);
  });

  it("does not cluster addresses only seen as outputs", () => {
    const addrA = "bc1qaddr_a0000000000000000000000000000000";
    const addrOut = "bc1qaddr_out000000000000000000000000000";

    // tx where addrA is input and addrOut is output (NOT input)
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addrA, value: 100000 } })],
      vout: [makeVout({ scriptpubkey_address: addrOut })],
    });

    const txsByAddress = new Map<string, MempoolTransaction[]>();
    txsByAddress.set(addrA, [tx]);

    const result = buildCluster(addrA, txsByAddress);

    expect(result.clusterAddresses.size).toBe(1);
    expect(result.clusterAddresses.has(addrOut)).toBe(false);
  });

  it("generates appropriate severity for large clusters", () => {
    const seed = "bc1qseed000000000000000000000000000000000";

    // Create a tx with many co-inputs (simulating a large cluster)
    const coAddrs = Array.from({ length: 15 }, (_, i) =>
      `bc1qco_addr_${i.toString().padStart(31, "0")}`,
    );

    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: seed, value: 10000 } }),
        ...coAddrs.map((addr) =>
          makeVin({ prevout: { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addr, value: 10000 } }),
        ),
      ],
      vout: [makeVout()],
    });

    const txsByAddress = new Map<string, MempoolTransaction[]>();
    txsByAddress.set(seed, [tx]);

    const result = buildCluster(seed, txsByAddress, 1);

    expect(result.clusterAddresses.size).toBe(16); // seed + 15 co-addrs
    expect(result.riskTier).toBe("active");
    expect(result.findings[0].severity).toBe("medium");
    expect(result.findings[0].scoreImpact).toBe(-5);
  });
});
