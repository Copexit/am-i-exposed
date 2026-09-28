import type { HeuristicTranslator } from "./heuristics/types";

/**
 * Heuristic step ids and labels for the diagnostic loader. Kept apart from the
 * heuristic implementations (heuristic-registry) so UI that only needs the list
 * (home page check count, scan screen) does not pull the analysis engine.
 */
export const TX_HEURISTIC_META = [
  { id: "coinbase", label: "Coinbase detection" },
  { id: "h1", label: "Round amounts" },
  { id: "h2", label: "Change detection" },
  { id: "h3", label: "Common input ownership" },
  { id: "h4", label: "CoinJoin detection" },
  { id: "h5", label: "Transaction entropy" },
  { id: "h6", label: "Fee fingerprinting" },
  { id: "h7", label: "OP_RETURN metadata" },
  { id: "h11", label: "Wallet fingerprinting" },
  { id: "anon", label: "Anonymity sets" },
  { id: "timing", label: "Timing analysis" },
  { id: "script", label: "Script type analysis" },
  { id: "dust", label: "Dust output detection" },
  { id: "dust-spend", label: "Dust spending detection" },
  { id: "h17", label: "Multisig/escrow detection" },
  { id: "peel", label: "Peel chain detection" },
  { id: "consolidation", label: "Consolidation patterns" },
  { id: "unnecessary", label: "Unnecessary inputs" },
  { id: "tx0", label: "CoinJoin premix (tx0)" },
  { id: "bip69", label: "BIP69 ordering" },
  { id: "bip47", label: "BIP47 notification detection" },
  { id: "exchange", label: "Exchange pattern detection" },
  { id: "coinsel", label: "Coin selection patterns" },
  { id: "witness", label: "Witness data analysis" },
  { id: "postmix", label: "Post-mix consolidation" },
  { id: "entity", label: "Known entity detection" },
  { id: "ricochet", label: "Ricochet detection" },
  { id: "utxo-age", label: "UTXO age spread" },
] as const;

export const ADDRESS_HEURISTIC_META = [
  { id: "h8", label: "Address reuse" },
  { id: "h9", label: "UTXO analysis" },
  { id: "h10", label: "Address type" },
  { id: "spending", label: "Spending patterns" },
  { id: "recurring", label: "Recurring payment detection" },
  { id: "highactivity", label: "High activity detection" },
] as const;

export interface HeuristicStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done";
  impact?: number; // cumulative score impact after this step completes
}

const CHAIN_STEPS = [
  { id: "chain-backward", label: "Input provenance analysis" },
  { id: "chain-forward", label: "Output destination analysis" },
  { id: "chain-cluster", label: "Address clustering" },
  { id: "chain-spending", label: "Spending pattern analysis" },
  { id: "chain-entity", label: "Entity proximity scan" },
  { id: "chain-taint", label: "Taint flow analysis" },
] as const;

export function getTxHeuristicSteps(t?: HeuristicTranslator): HeuristicStep[] {
  return [
    ...TX_HEURISTIC_META.map((h) => ({
      id: h.id,
      label: t ? t(`step.${h.id}.label`, { defaultValue: h.label }) : h.label,
      status: "pending" as const,
    })),
    ...CHAIN_STEPS.map((h) => ({
      id: h.id,
      label: t ? t(`step.${h.id}.label`, { defaultValue: h.label }) : h.label,
      status: "pending" as const,
    })),
  ];
}

export function getAddressHeuristicSteps(t?: HeuristicTranslator): HeuristicStep[] {
  return ADDRESS_HEURISTIC_META.map((h) => ({
    id: h.id,
    label: t ? t(`step.${h.id}.label`, { defaultValue: h.label }) : h.label,
    status: "pending" as const,
  }));
}
