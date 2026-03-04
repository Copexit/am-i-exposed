import type { Grade } from "@/lib/types";

/** Lightning address for tips / Value4Value. */
export const LN_ADDRESS = "woozycuticle72@walletofsatoshi.com";

/** Basic format validation for Bitcoin addresses (all networks). */
export const ADDR_RE = /^[a-zA-Z0-9]{25,90}$/;

/** Format validation for transaction IDs (64 hex chars). */
export const TXID_RE = /^[a-fA-F0-9]{64}$/;

/** Dust threshold in satoshis - outputs below this are flagged as potential dust. */
export const DUST_THRESHOLD = 1000;

/** Whirlpool pool denominations in satoshis. */
export const WHIRLPOOL_DENOMS = [
  50_000, // 0.0005 BTC
  100_000, // 0.001 BTC
  1_000_000, // 0.01 BTC
  5_000_000, // 0.05 BTC
  50_000_000, // 0.5 BTC (retired 2023)
];

/** Grade-to-Tailwind text color mapping for use in components. */
export const GRADE_COLORS: Record<Grade, string> = {
  "A+": "text-severity-good",
  B: "text-severity-low",
  C: "text-severity-medium",
  D: "text-severity-high",
  F: "text-severity-critical",
};

/** Grade-to-Tailwind badge color mapping (background + text). */
export const GRADE_BADGE_COLORS: Record<Grade, string> = {
  "A+": "bg-severity-good/15 text-severity-good",
  B: "bg-severity-low/15 text-severity-low",
  C: "bg-severity-medium/15 text-severity-medium",
  D: "bg-severity-high/15 text-severity-high",
  F: "bg-severity-critical/15 text-severity-critical",
};

/** Grade-to-hex color mapping for Canvas/non-CSS contexts (share cards, glow effects). */
export const GRADE_HEX: Record<Grade, string> = {
  "A+": "#28d065",
  B: "#3b82f6",
  C: "#eab308",
  D: "#f97316",
  F: "#ef4444",
};

/** Look up grade text color, returning fallback for unknown grades. */
export function gradeColor(grade: string, fallback = "text-muted"): string {
  return GRADE_COLORS[grade as Grade] ?? fallback;
}

/** Look up grade badge color, returning fallback for unknown grades. */
export function gradeBadgeColor(grade: string, fallback = "text-muted"): string {
  return GRADE_BADGE_COLORS[grade as Grade] ?? fallback;
}

/** Example transactions/addresses for the home page and ScanHistory examples tab. */
export interface ExampleItem {
  labelKey: string;
  labelDefault: string;
  hint: string;
  hintColor: string;
  input: string;
}

export const EXAMPLES: ExampleItem[] = [
  {
    labelKey: "page.example_whirlpool",
    labelDefault: "Whirlpool 5x5",
    hint: "A+",
    hintColor: "text-severity-good",
    input: "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2",
  },
  {
    labelKey: "page.example_whirlpool_8x8",
    labelDefault: "Whirlpool 8x8",
    hint: "A+",
    hintColor: "text-severity-good",
    input: "f82fa771e355ef46e9744da2407f677ea4372d85b61b4a4d735d88a85798dfc4",
  },
  {
    labelKey: "page.example_whirlpool_9x9",
    labelDefault: "Whirlpool 9x9",
    hint: "A+",
    hintColor: "text-severity-good",
    input: "f540e8d8636bd706cb9c2f5733d26ccfdb151b76d663b2d346785e62c352b282",
  },
  {
    labelKey: "page.example_wabisabi",
    labelDefault: "WabiSabi CoinJoin",
    hint: "A+",
    hintColor: "text-severity-good",
    input: "fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e",
  },
  {
    labelKey: "page.example_satoshi",
    labelDefault: "Satoshi's address",
    hint: "F",
    hintColor: "text-severity-critical",
    input: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  },
  {
    labelKey: "page.example_stonewall",
    labelDefault: "Stonewall",
    hint: "B",
    hintColor: "text-severity-low",
    input: "19a79be39c05a0956c7d1f9f28ee6f1091096247b0906b6a8536dd7f400f2358",
  },
  {
    labelKey: "page.example_joinmarket",
    labelDefault: "JoinMarket CoinJoin",
    hint: "A+",
    hintColor: "text-severity-good",
    input: "6cb2433f28177a3b07073a0eb34a527ba6d7dd7483cccb394f88321373c0ed20",
  },
  {
    labelKey: "page.example_opreturn",
    labelDefault: "OP_RETURN data",
    hint: "D",
    hintColor: "text-severity-high",
    input: "8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684",
  },
  {
    labelKey: "page.presend_sanctioned",
    labelDefault: "OFAC sanctioned",
    hint: "Critical",
    hintColor: "text-severity-critical",
    input: "12QtD5BFwRsdNsAZY76UVE1xyCGNTojH9h",
  },
  {
    labelKey: "page.presend_fresh",
    labelDefault: "Fresh address",
    hint: "A",
    hintColor: "text-severity-good",
    input: "bc1pes5mfje89xdr6uh4qu6p4m0r8d6nz3tvgagtwgv99yalqwzyhdzqrl3mnu",
  },
];

/** Truncate a string showing first 8 and last `tailLen` characters. */
export function truncateId(s: string, tailLen = 4): string {
  if (s.length <= 8 + tailLen + 3) return s;
  return `${s.slice(0, 8)}...${s.slice(-tailLen)}`;
}
