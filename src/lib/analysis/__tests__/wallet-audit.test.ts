import { describe, it, expect } from "vitest";
import { auditWallet, type WalletAddressInfo } from "../wallet-audit";
import type { MempoolAddress, MempoolUtxo } from "@/lib/api/types";
import type { DerivedAddress } from "@/lib/bitcoin/descriptor";

function makeAddr(
  address: string,
  index: number,
  txCount: number,
  utxos: MempoolUtxo[] = [],
  isChange = false,
): WalletAddressInfo {
  const addressData: MempoolAddress = {
    address,
    chain_stats: {
      funded_txo_count: txCount,
      funded_txo_sum: 100_000,
      spent_txo_count: 0,
      spent_txo_sum: 0,
      tx_count: txCount,
    },
    mempool_stats: {
      funded_txo_count: 0,
      funded_txo_sum: 0,
      spent_txo_count: 0,
      spent_txo_sum: 0,
      tx_count: 0,
    },
  };

  const derived: DerivedAddress = {
    path: `${isChange ? 1 : 0}/${index}`,
    address,
    isChange,
    index,
  };

  return {
    derived,
    addressData,
    txs: [],
    utxos,
  };
}

function makeUtxo(value: number, txid = "abc123"): MempoolUtxo {
  return {
    txid,
    vout: 0,
    status: { confirmed: true, block_height: 800000, block_time: 1700000000, block_hash: "" },
    value,
  };
}

describe("auditWallet", () => {
  it("detects address reuse", () => {
    const addresses: WalletAddressInfo[] = [
      makeAddr("bc1qaddr0", 0, 3), // reused
      makeAddr("bc1qaddr1", 1, 3), // reused
      makeAddr("bc1qaddr2", 2, 1), // not reused
      makeAddr("bc1qaddr3", 3, 1), // not reused
    ];

    const result = auditWallet(addresses);
    const reuseFinding = result.findings.find(f => f.id === "wallet-address-reuse");
    expect(reuseFinding).toBeDefined();
    expect(reuseFinding?.params?.reusedCount).toBe(2);
    expect(reuseFinding?.params?.totalReceived).toBe(4);
    expect(result.reusedAddresses).toBe(2);
    expect(result.activeAddresses).toBe(4);
  });

  it("detects dust UTXOs", () => {
    const addresses: WalletAddressInfo[] = [
      makeAddr("bc1qaddr0", 0, 1, [makeUtxo(100), makeUtxo(200), makeUtxo(300)]),
      makeAddr("bc1qaddr1", 1, 1, [makeUtxo(50_000)]),
    ];

    const result = auditWallet(addresses);
    const dustFinding = result.findings.find(f => f.id === "wallet-dust-utxos");
    expect(dustFinding).toBeDefined();
    expect(dustFinding?.params?.dustCount).toBe(3);
    expect(result.dustUtxos).toBe(3);
    expect(result.totalUtxos).toBe(4);
  });

  it("detects toxic change", () => {
    const addresses: WalletAddressInfo[] = [
      makeAddr("bc1qaddr0", 0, 1, [
        makeUtxo(1000, "a"),
        makeUtxo(2000, "b"),
        makeUtxo(3000, "c"),
        makeUtxo(5000, "d"),
      ]),
    ];

    const result = auditWallet(addresses);
    const toxicFinding = result.findings.find(f => f.id === "wallet-toxic-change");
    expect(toxicFinding).toBeDefined();
    expect(toxicFinding?.params?.toxicCount).toBe(4);
  });

  it("rewards no address reuse", () => {
    const addresses: WalletAddressInfo[] = Array.from({ length: 6 }, (_, i) =>
      makeAddr(`bc1qaddr${i}`, i, 1),
    );

    const result = auditWallet(addresses);
    const noReuse = result.findings.find(f => f.id === "wallet-no-reuse");
    expect(noReuse).toBeDefined();
    expect(noReuse?.severity).toBe("good");
    expect(result.reusedAddresses).toBe(0);
  });

  it("detects mixed script types", () => {
    const addresses: WalletAddressInfo[] = [
      makeAddr("bc1qaddr0", 0, 1, [makeUtxo(50_000)]),
      makeAddr("3addr1xxx", 1, 1, [makeUtxo(50_000)]),
    ];

    const result = auditWallet(addresses);
    const mixedFinding = result.findings.find(f => f.id === "wallet-mixed-script-utxos");
    expect(mixedFinding).toBeDefined();
    expect(mixedFinding?.params?.scriptTypes).toBe(2);
  });

  it("calculates total balance correctly", () => {
    const addresses: WalletAddressInfo[] = [
      makeAddr("bc1qaddr0", 0, 1, [makeUtxo(100_000), makeUtxo(200_000)]),
      makeAddr("bc1qaddr1", 1, 1, [makeUtxo(50_000)]),
    ];

    const result = auditWallet(addresses);
    expect(result.totalBalance).toBe(350_000);
    expect(result.totalUtxos).toBe(3);
  });

  it("returns score between 0 and 100", () => {
    const addresses: WalletAddressInfo[] = [
      makeAddr("bc1qaddr0", 0, 5), // heavily reused
      makeAddr("bc1qaddr1", 1, 1),
    ];

    const result = auditWallet(addresses);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(["A+", "B", "C", "D", "F"]).toContain(result.grade);
  });
});
