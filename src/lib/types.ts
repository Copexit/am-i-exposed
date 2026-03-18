export type InputType = "txid" | "address" | "xpub" | "psbt" | "invalid";

export type AddressType = "p2pkh" | "p2sh" | "p2wpkh" | "p2wsh" | "p2tr" | "unknown";

export type Severity = "critical" | "high" | "medium" | "low" | "good";

export interface Remediation {
  keyPrefix?: string;
  qualifier?: string;
  steps: string[];
  tools?: { name: string; url: string }[];
  urgency: "immediate" | "soon" | "when-convenient";
}

export type ConfidenceLevel = "deterministic" | "high" | "medium" | "low";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  scoreImpact: number;
  /** Interpolation values for i18n translation of title/description/recommendation */
  params?: Record<string, string | number>;
  remediation?: Remediation;
  /** How certain is this finding? Deterministic = 100%, heuristic = probabilistic. */
  confidence?: ConfidenceLevel;
}

export type TxType =
  | "whirlpool-coinjoin"
  | "wabisabi-coinjoin"
  | "joinmarket-coinjoin"
  | "generic-coinjoin"
  | "stonewall"
  | "simplified-stonewall"
  | "tx0-premix"
  | "bip47-notification"
  | "ricochet"
  | "consolidation"
  | "exchange-withdrawal"
  | "batch-payment"
  | "self-transfer"
  | "peel-chain"
  | "coinbase"
  | "simple-payment"
  | "unknown";

export interface ScoringResult {
  score: number;
  grade: Grade;
  findings: Finding[];
  /** Classified transaction type based on detected patterns */
  txType?: TxType;
}

export type Grade = "A+" | "B" | "C" | "D" | "F";

export interface TxAnalysisResult {
  txid: string;
  tx: import("@/lib/api/types").MempoolTransaction;
  findings: Finding[];
  score: number;
  grade: Grade;
  /** Whether the analyzed address is an input, output, or both in this tx */
  role: "sender" | "receiver" | "both";
}
