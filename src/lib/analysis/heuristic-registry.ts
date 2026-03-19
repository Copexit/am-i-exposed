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
} from "./heuristics";

// --- Transaction heuristics ---

export const TX_HEURISTICS = [
  { id: "coinbase", label: "Coinbase detection", fn: analyzeCoinbase },
  { id: "h1", label: "Round amounts", fn: analyzeRoundAmounts },
  { id: "h2", label: "Change detection", fn: analyzeChangeDetection },
  { id: "h3", label: "Common input ownership", fn: analyzeCioh },
  { id: "h4", label: "CoinJoin detection", fn: analyzeCoinJoin },
  { id: "h5", label: "Transaction entropy", fn: analyzeEntropy },
  { id: "h6", label: "Fee fingerprinting", fn: analyzeFees },
  { id: "h7", label: "OP_RETURN metadata", fn: analyzeOpReturn },
  { id: "h11", label: "Wallet fingerprinting", fn: analyzeWalletFingerprint },
  { id: "anon", label: "Anonymity sets", fn: analyzeAnonymitySet },
  { id: "timing", label: "Timing analysis", fn: analyzeTiming },
  { id: "script", label: "Script type analysis", fn: analyzeScriptTypeMix },
  { id: "dust", label: "Dust output detection", fn: analyzeDustOutputs },
  { id: "h17", label: "Multisig/escrow detection", fn: analyzeMultisigDetection },
  { id: "peel", label: "Peel chain detection", fn: analyzePeelChain },
  { id: "consolidation", label: "Consolidation patterns", fn: analyzeConsolidation },
  { id: "unnecessary", label: "Unnecessary inputs", fn: analyzeUnnecessaryInput },
  { id: "tx0", label: "CoinJoin premix (tx0)", fn: analyzeCoinJoinPremix },
  { id: "bip69", label: "BIP69 ordering", fn: analyzeBip69 },
  { id: "bip47", label: "BIP47 notification detection", fn: analyzeBip47Notification },
  { id: "exchange", label: "Exchange pattern detection", fn: analyzeExchangePattern },
  { id: "coinsel", label: "Coin selection patterns", fn: analyzeCoinSelection },
  { id: "witness", label: "Witness data analysis", fn: analyzeWitnessData },
  { id: "postmix", label: "Post-mix consolidation", fn: analyzePostMix },
  { id: "entity", label: "Known entity detection", fn: analyzeEntityDetection },
  { id: "ricochet", label: "Ricochet detection", fn: analyzeRicochet },
] as const;

export const ADDRESS_HEURISTICS = [
  { id: "h8", label: "Address reuse", fn: analyzeAddressReuse },
  { id: "h9", label: "UTXO analysis", fn: analyzeUtxos },
  { id: "h10", label: "Address type", fn: analyzeAddressType },
  { id: "spending", label: "Spending patterns", fn: analyzeSpendingPattern },
  { id: "recurring", label: "Recurring payment detection", fn: analyzeRecurringPayment },
  { id: "highactivity", label: "High activity detection", fn: analyzeHighActivityAddress },
] as const;

/** Yield to the event loop so the UI can update. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}
