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
  // 13 heuristics * 50ms tick each = 650ms needed
  await vi.advanceTimersByTimeAsync(1000);
  return promise;
}

/** Run analyzeAddress with fake timer advancement */
async function runAddrAnalysis(
  addr: MempoolAddress,
  utxos: MempoolUtxo[],
  txs: MempoolTransaction[],
) {
  const promise = analyzeAddress(addr, utxos, txs);
  // 4 address heuristics * 50ms tick = 200ms needed
  await vi.advanceTimersByTimeAsync(500);
  return promise;
}

describe("golden test cases - transactions", () => {
  it.each([
    ["Whirlpool CoinJoin", whirlpoolTx, "A+", 100],
    ["WabiSabi CoinJoin", wabisabiTx, "A+", 100],
    ["JoinMarket CoinJoin", joinmarketTx, "B", 84],
    ["Taproot + OP_RETURN", taprootOpReturnTx, "C", 57],
    ["Bare multisig", bareMultisigTx, "F", 19],
    ["OP_RETURN charley loves heidi", opReturnCharleyTx, "D", 45],
    ["Simple legacy P2PKH", simpleLegacyTx, "C", 65],
    ["Batch withdrawal 143 outputs", batchWithdrawalTx, "C", 63],
    ["Dust attack 555 sats", dustAttackTx, "D", 37],
    ["Taproot script-path spend", taprootScriptPathTx, "C", 56],
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
