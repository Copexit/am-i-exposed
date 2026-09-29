/**
 * Golden test cases - run the full orchestrator pipeline against real API
 * response fixtures and assert the final score and grade. These serve as
 * regression tests: if a heuristic is recalibrated intentionally, update
 * both the expected value here AND docs/testing-reference.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { analyzeTransaction, analyzeAddress } from "../orchestrator";
import type { MempoolTransaction, MempoolAddress, MempoolUtxo } from "@/lib/api/types";

// --- TX fixtures ---
import whirlpoolTx from "../heuristics/__tests__/fixtures/api-responses/whirlpool-coinjoin.json";
import wabisabiTx from "../heuristics/__tests__/fixtures/api-responses/wabisabi-coinjoin.json";
import joinmarketTx from "../heuristics/__tests__/fixtures/api-responses/joinmarket-coinjoin.json";
import taprootOpReturnTx from "../heuristics/__tests__/fixtures/api-responses/taproot-op-return.json";
import bareMultisigTx from "../heuristics/__tests__/fixtures/api-responses/bare-multisig.json";
import opReturnCharleyTx from "../heuristics/__tests__/fixtures/api-responses/op-return-charley.json";
import simpleLegacyTx from "../heuristics/__tests__/fixtures/api-responses/simple-legacy-p2pkh.json";
import batchWithdrawalTx from "../heuristics/__tests__/fixtures/api-responses/batch-withdrawal-143.json";
import dustAttackTx from "../heuristics/__tests__/fixtures/api-responses/dust-attack-555.json";
import taprootScriptPathTx from "../heuristics/__tests__/fixtures/api-responses/taproot-script-path.json";
// Example-set transactions (home page / example list)
import sweepTx from "../heuristics/__tests__/fixtures/api-responses/sweep-1in1out.json";
import consolidationTx from "../heuristics/__tests__/fixtures/api-responses/consolidation-5in1out.json";
import reuseTx from "../heuristics/__tests__/fixtures/api-responses/address-reuse-change.json";
import dust564Tx from "../heuristics/__tests__/fixtures/api-responses/dust-attack-564.json";
import batchPaymentTx from "../heuristics/__tests__/fixtures/api-responses/batch-payment.json";
import coinbaseTx from "../heuristics/__tests__/fixtures/api-responses/coinbase-6c7edc23.json";
import wabisabiLargeTx from "../heuristics/__tests__/fixtures/api-responses/wabisabi-large.json";
import joinmarket6cbTx from "../heuristics/__tests__/fixtures/api-responses/joinmarket-6cb2433f.json";
import ashigaruTx from "../heuristics/__tests__/fixtures/api-responses/whirlpool-ashigaru.json";

// --- Address fixtures ---
import satoshiAddr from "../heuristics/__tests__/fixtures/api-responses/satoshi-genesis-address.json";
import satoshiUtxos from "../heuristics/__tests__/fixtures/api-responses/satoshi-genesis-utxos.json";
import satoshiTxs from "../heuristics/__tests__/fixtures/api-responses/satoshi-genesis-txs.json";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Run analyzeTransaction with fake timer advancement */
async function runTxAnalysis(tx: MempoolTransaction) {
  const promise = analyzeTransaction(tx);
  // 27 heuristics * 50ms tick each = 1350ms needed
  await vi.advanceTimersByTimeAsync(10000);
  return promise;
}

/** Run analyzeAddress with fake timer advancement */
async function runAddrAnalysis(
  addr: MempoolAddress,
  utxos: MempoolUtxo[],
  txs: MempoolTransaction[],
) {
  const promise = analyzeAddress(addr, utxos, txs);
  // 6 address heuristics * 50ms tick = 300ms needed
  await vi.advanceTimersByTimeAsync(600);
  return promise;
}

describe("golden test cases - transactions", () => {
  it.each([
    ["Whirlpool CoinJoin", whirlpoolTx, "A+", 100],
    ["WabiSabi CoinJoin", wabisabiTx, "A+", 100],
    ["JoinMarket CoinJoin", joinmarketTx, "B", 89],
    ["Taproot + OP_RETURN", taprootOpReturnTx, "C", 56],
    ["Bare multisig", bareMultisigTx, "F", 11],
    ["OP_RETURN charley loves heidi", opReturnCharleyTx, "D", 49],
    ["Simple legacy P2PKH", simpleLegacyTx, "C", 52],
    ["Batch withdrawal 143 outputs", batchWithdrawalTx, "C", 58],
    ["Dust attack 555 sats", dustAttackTx, "F", 24],
    ["Taproot script-path spend", taprootScriptPathTx, "D", 46],
    ["Sweep 8cbe3322", sweepTx, "C", 59],
    ["Consolidation 40b88e16", consolidationTx, "C", 51],
    ["Address reuse 4c18b982", reuseTx, "F", 24],
    ["Dust attack 65551b77 (1 in, 564 out)", dust564Tx, "C", 53],
    ["Batch payment aefda8a7", batchPaymentTx, "F", 24],
    ["Coinbase 6c7edc23", coinbaseTx, "C", 70],
    ["WabiSabi 95799bd3", wabisabiLargeTx, "A+", 100],
    ["JoinMarket 6cb2433f", joinmarket6cbTx, "A+", 100],
    ["Whirlpool Ashigaru 5f0080e3", ashigaruTx, "A+", 100],
  ] as const)(
    "%s -> grade %s, score %i",
    async (_name, tx, expectedGrade, expectedScore) => {
      const result = await runTxAnalysis(tx as unknown as MempoolTransaction);
      expect(result.grade).toBe(expectedGrade);
      expect(result.score).toBe(expectedScore);
    },
  );
});

describe("golden test cases - addresses", () => {
  it("Satoshi genesis address -> grade F, score 0", async () => {
    const result = await runAddrAnalysis(
      satoshiAddr as unknown as MempoolAddress,
      satoshiUtxos as unknown as MempoolUtxo[],
      satoshiTxs as unknown as MempoolTransaction[],
    );
    expect(result.grade).toBe("F");
    expect(result.score).toBe(0);
  });
});
