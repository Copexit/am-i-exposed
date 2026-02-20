export type InputType = "txid" | "address" | "invalid";

export type AnalysisMode = "scan" | "check";

export type AddressType = "p2pkh" | "p2sh" | "p2wpkh" | "p2wsh" | "p2tr" | "unknown";

export type Severity = "critical" | "high" | "medium" | "low" | "good";

export interface Remediation {
  steps: string[];
  tools?: { name: string; url: string }[];
  urgency: "immediate" | "soon" | "when-convenient";
}

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
}

export interface ScoringResult {
  score: number;
  grade: Grade;
  findings: Finding[];
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
