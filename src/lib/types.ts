export type InputType = "txid" | "address" | "invalid";

export type AddressType = "p2pkh" | "p2sh" | "p2wpkh" | "p2tr" | "unknown";

export type Severity = "critical" | "high" | "medium" | "low" | "good";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  scoreImpact: number;
}

export interface ScoringResult {
  score: number;
  grade: Grade;
  findings: Finding[];
}

export type Grade = "A+" | "B" | "C" | "D" | "F";
