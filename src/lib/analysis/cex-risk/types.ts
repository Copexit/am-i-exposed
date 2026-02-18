export interface OfacCheckResult {
  checked: boolean;
  sanctioned: boolean;
  matchedAddresses: string[];
  lastUpdated: string;
}

export interface ChainalysisIdentification {
  category: string;
  name: string | null;
  description: string | null;
  url: string | null;
}

export interface ChainalysisCheckResult {
  status: "idle" | "loading" | "done" | "error";
  sanctioned: boolean;
  identifications: ChainalysisIdentification[];
  matchedAddresses: string[];
  error?: string;
}
