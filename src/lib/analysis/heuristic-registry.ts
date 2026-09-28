import {
  analyzeRoundAmounts,
  analyzeChangeDetection,
  analyzeCioh,
  analyzeCoinJoin,
  analyzeEntropy,
  analyzeFees,
  analyzeOpReturn,
  analyzeAddressReuse,
  analyzeUtxos,
  analyzeAddressType,
  analyzeWalletFingerprint,
  analyzeAnonymitySet,
  analyzeTiming,
  analyzeScriptTypeMix,
  analyzeSpendingPattern,
  analyzeDustOutputs,
  analyzeCoinbase,
  analyzeMultisigDetection,
  analyzePeelChain,
  analyzeConsolidation,
  analyzeUnnecessaryInput,
  analyzeCoinJoinPremix,
  analyzeBip69,
  analyzeBip47Notification,
  analyzeExchangePattern,
  analyzeRecurringPayment,
  analyzeCoinSelection,
  analyzeWitnessData,
  analyzeHighActivityAddress,
  analyzePostMix,
  analyzeEntityDetection,
  analyzeRicochet,
  analyzeUtxoAgeSpread,
  analyzeDustSpending,
} from "./heuristics";
import type { TxHeuristic, AddressHeuristic } from "./heuristics/types";
import { TX_HEURISTIC_META, ADDRESS_HEURISTIC_META } from "./heuristic-steps";

// --- Transaction heuristics (ids/labels live in heuristic-steps) ---

const TX_FNS: Record<(typeof TX_HEURISTIC_META)[number]["id"], TxHeuristic> = {
  "coinbase": analyzeCoinbase,
  "h1": analyzeRoundAmounts,
  "h2": analyzeChangeDetection,
  "h3": analyzeCioh,
  "h4": analyzeCoinJoin,
  "h5": analyzeEntropy,
  "h6": analyzeFees,
  "h7": analyzeOpReturn,
  "h11": analyzeWalletFingerprint,
  "anon": analyzeAnonymitySet,
  "timing": analyzeTiming,
  "script": analyzeScriptTypeMix,
  "dust": analyzeDustOutputs,
  "dust-spend": analyzeDustSpending,
  "h17": analyzeMultisigDetection,
  "peel": analyzePeelChain,
  "consolidation": analyzeConsolidation,
  "unnecessary": analyzeUnnecessaryInput,
  "tx0": analyzeCoinJoinPremix,
  "bip69": analyzeBip69,
  "bip47": analyzeBip47Notification,
  "exchange": analyzeExchangePattern,
  "coinsel": analyzeCoinSelection,
  "witness": analyzeWitnessData,
  "postmix": analyzePostMix,
  "entity": analyzeEntityDetection,
  "ricochet": analyzeRicochet,
  "utxo-age": analyzeUtxoAgeSpread,
};

export const TX_HEURISTICS = TX_HEURISTIC_META.map((m) => ({ ...m, fn: TX_FNS[m.id] }));

// --- Address heuristics ---

const ADDRESS_FNS: Record<(typeof ADDRESS_HEURISTIC_META)[number]["id"], AddressHeuristic> = {
  "h8": analyzeAddressReuse,
  "h9": analyzeUtxos,
  "h10": analyzeAddressType,
  "spending": analyzeSpendingPattern,
  "recurring": analyzeRecurringPayment,
  "highactivity": analyzeHighActivityAddress,
};

export const ADDRESS_HEURISTICS = ADDRESS_HEURISTIC_META.map((m) => ({ ...m, fn: ADDRESS_FNS[m.id] }));

/**
 * Delay between diagnostic-loader steps. 50ms in the browser for the visible
 * step-by-step effect; 0 in Node (CLI, MCP server) and in tests, including
 * DOM-environment tests. Override with setTickDelay.
 */
let tickDelayMs = typeof window !== "undefined" && process.env.NODE_ENV !== "test" ? 50 : 0;

export function setTickDelay(ms: number): void {
  tickDelayMs = ms;
}

/** Yield to the event loop so the UI can update (no-op when the delay is 0). */
export function tick(): Promise<void> {
  if (tickDelayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, tickDelayMs));
}
