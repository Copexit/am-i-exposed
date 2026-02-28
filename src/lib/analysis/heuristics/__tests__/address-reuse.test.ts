import { describe, it, expect, beforeEach } from "vitest";
import { analyzeAddressReuse } from "../address-reuse";
import { makeAddress, makeTx, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

const ADDR = "bc1q" + "a".repeat(38);

/** Helper: make txs that have outputs to the given address. */
function makeTxsToAddr(count: number, addr = ADDR) {
  return Array.from({ length: count }, () =>
    makeTx({ vout: [makeVout({ scriptpubkey_address: addr })] }),
  );
}

describe("analyzeAddressReuse", () => {
  it("detects single-use address -> h8-no-reuse, impact +3", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 1, funded_txo_sum: 100_000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 },
    });
    const txs = makeTxsToAddr(1);
    const { findings } = analyzeAddressReuse(address, [], txs);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h8-no-reuse");
    expect(findings[0].scoreImpact).toBe(3);
    expect(findings[0].severity).toBe("good");
  });

  it("detects uncertain when funded=0 but txCount > 0 -> h8-reuse-uncertain, impact 0", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 },
    });
    const { findings } = analyzeAddressReuse(address, [], []);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h8-reuse-uncertain");
    expect(findings[0].scoreImpact).toBe(0);
  });

  it("detects batch receive (funded > 1, txCount <= 1) -> h8-batch-receive, impact 0", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 3, funded_txo_sum: 300_000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 },
    });
    const txs = makeTxsToAddr(1);
    const { findings } = analyzeAddressReuse(address, [], txs);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h8-batch-receive");
    expect(findings[0].scoreImpact).toBe(0);
  });

  it("detects 2-tx reuse -> h8-address-reuse, impact -24, severity high", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 2, funded_txo_sum: 200_000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 2 },
    });
    const txs = makeTxsToAddr(2);
    const { findings } = analyzeAddressReuse(address, [], txs);
    expect(findings[0].id).toBe("h8-address-reuse");
    expect(findings[0].scoreImpact).toBe(-24);
    expect(findings[0].severity).toBe("high");
  });

  it("detects 3-4 tx reuse -> impact -32, severity critical", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 3, funded_txo_sum: 300_000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 3 },
    });
    const txs = makeTxsToAddr(3);
    const { findings } = analyzeAddressReuse(address, [], txs);
    expect(findings[0].scoreImpact).toBe(-32);
    expect(findings[0].severity).toBe("critical");
  });

  it("detects 5-9 tx reuse -> impact -45", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 5, funded_txo_sum: 500_000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 5 },
    });
    const txs = makeTxsToAddr(5);
    const { findings } = analyzeAddressReuse(address, [], txs);
    expect(findings[0].scoreImpact).toBe(-45);
  });

  it("detects 10-49 tx reuse -> impact -50", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 10, funded_txo_sum: 1_000_000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 10 },
    });
    const txs = makeTxsToAddr(10);
    const { findings } = analyzeAddressReuse(address, [], txs);
    expect(findings[0].scoreImpact).toBe(-50);
  });

  it("detects 50-99 tx reuse -> impact -58", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 50, funded_txo_sum: 5_000_000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 50 },
    });
    const txs = makeTxsToAddr(50);
    const { findings } = analyzeAddressReuse(address, [], txs);
    expect(findings[0].scoreImpact).toBe(-58);
  });

  it("detects 100-999 tx reuse -> impact -65", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 100, funded_txo_sum: 10_000_000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 100 },
    });
    const txs = makeTxsToAddr(100);
    const { findings } = analyzeAddressReuse(address, [], txs);
    expect(findings[0].scoreImpact).toBe(-65);
  });

  it("detects 1000+ tx reuse -> impact -70", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 1000, funded_txo_sum: 100_000_000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1000 },
    });
    const txs = makeTxsToAddr(1000);
    const { findings } = analyzeAddressReuse(address, [], txs);
    expect(findings[0].scoreImpact).toBe(-70);
  });

  it("sets remediation urgency to immediate for 10+ txs", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 10, funded_txo_sum: 1_000_000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 10 },
    });
    const txs = makeTxsToAddr(10);
    const { findings } = analyzeAddressReuse(address, [], txs);
    expect(findings[0].remediation?.urgency).toBe("immediate");
  });

  it("uses actualReceives as fallback when funded_txo_count is 0", () => {
    // API reports 0 funded but we can see 3 txs with outputs to this address
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 3 },
    });
    const txs = makeTxsToAddr(3);
    const { findings } = analyzeAddressReuse(address, [], txs);
    expect(findings[0].id).toBe("h8-address-reuse");
    expect(findings[0].scoreImpact).toBe(-32);
  });
});
