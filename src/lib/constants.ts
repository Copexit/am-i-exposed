import type { Grade } from "@/lib/types";
import { COLORS } from "@/lib/palette";

/** Number of satoshis per bitcoin. */
export const SATS_PER_BTC = 100_000_000;

/** Coinos pay page accepting Bitcoin and Lightning. */
export const COINOS_PAY_URL = "https://coinos.io/pay/exposed";

/** Basic format validation for Bitcoin addresses (all networks). */
export const ADDR_RE = /^[a-zA-Z0-9]{25,90}$/;

/** Format validation for transaction IDs (64 hex chars). */
export const TXID_RE = /^[a-fA-F0-9]{64}$/;

/**
 * Small output threshold in satoshis for anonymity set estimation and general
 * "tiny output" filtering. This is deliberately broader than the Bitcoin protocol
 * dust limit (294 sats for P2WPKH, 546 for P2PKH) because outputs under 1000 sats
 * are economically negligible and unlikely to be real payments - they add noise
 * to anonymity set calculations. The per-type protocol dust limits are enforced
 * separately in the dust-output heuristic (dust-output.ts).
 */
export const DUST_THRESHOLD = 1000;

/**
 * P2PKH dust limit in satoshis (Bitcoin Core's minimum relay output value
 * for legacy script types). Used for UTXO hygiene checks in wallet analysis.
 */
export const P2PKH_DUST_LIMIT = 546;

/** Toxic change threshold in satoshis. UTXOs below this value but above dust
 * are considered "toxic change" - economically marginal and privacy-risky. */
export const TOXIC_CHANGE_THRESHOLD = 10_000;

/** Whirlpool coordinator era. */
export type WhirlpoolEra = "samourai" | "ashigaru";

/** Pool metadata for a Whirlpool denomination. */
export interface WhirlpoolPool {
  /** Pool denomination in satoshis. */
  sats: number;
  /** Coordinator/wallet ecosystem that runs this pool. */
  era: WhirlpoolEra;
  /** Unix seconds when this pool became available. */
  activeFrom: number;
  /** Unix seconds when this pool was retired (undefined = still active). */
  retiredAt?: number;
}

/** April 24 2024 00:00:00 UTC - Samourai Wallet seizure. */
export const SAMOURAI_SEIZURE_TS = 1713916800;

/** June 23 2025 00:00:00 UTC - Ashigaru Whirlpool launch. */
export const ASHIGARU_LAUNCH_TS = 1750636800;

/**
 * Whirlpool pool registry. Samourai-era and Ashigaru-era pool sizes are
 * disjoint sets, so the denomination alone is a deterministic signal of
 * which coordinator/wallet ecosystem produced the transaction.
 */
export const WHIRLPOOL_POOLS: WhirlpoolPool[] = [
  { sats: 100_000, era: "samourai", activeFrom: 1609459200, retiredAt: SAMOURAI_SEIZURE_TS }, // 0.001 BTC, added 2021
  { sats: 1_000_000, era: "samourai", activeFrom: 1555632000, retiredAt: SAMOURAI_SEIZURE_TS }, // 0.01 BTC, since 2019-04-19
  { sats: 5_000_000, era: "samourai", activeFrom: 1555632000, retiredAt: SAMOURAI_SEIZURE_TS }, // 0.05 BTC, since 2019
  { sats: 50_000_000, era: "samourai", activeFrom: 1555632000, retiredAt: 1672531200 }, // 0.5 BTC, retired 2023
  { sats: 2_500_000, era: "ashigaru", activeFrom: ASHIGARU_LAUNCH_TS }, // 0.025 BTC
  { sats: 25_000_000, era: "ashigaru", activeFrom: ASHIGARU_LAUNCH_TS }, // 0.25 BTC
];

/** Flat array of pool sizes - kept for "is this a known whirlpool denom" boolean checks. */
export const WHIRLPOOL_DENOMS: number[] = WHIRLPOOL_POOLS.map((p) => p.sats);

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
  "A+": COLORS.severityGood,
  B: COLORS.severityLow,
  C: COLORS.severityMedium,
  D: COLORS.severityHigh,
  F: COLORS.severityCritical,
};

/**
 * Grade colors as CSS custom properties for display type and marks (dial,
 * bars): follow the theme. Light defines brighter --fill-* hues (3:1 for
 * large type and graphics); elsewhere the severity color is used.
 */
export const GRADE_VAR: Record<Grade, string> = {
  "A+": "var(--fill-good, var(--severity-good))",
  B: "var(--fill-low, var(--severity-low))",
  C: "var(--fill-medium, var(--severity-medium))",
  D: "var(--fill-high, var(--severity-high))",
  F: "var(--fill-critical, var(--severity-critical))",
};

/** Grade colors for small text (AA shades in every theme). */
export const GRADE_TEXT_VAR: Record<Grade, string> = {
  "A+": "var(--severity-good)",
  B: "var(--severity-low)",
  C: "var(--severity-medium)",
  D: "var(--severity-high)",
  F: "var(--severity-critical)",
};

/** Look up grade text color, returning fallback for unknown grades. */
export function gradeColor(grade: string, fallback = "text-muted"): string {
  return GRADE_COLORS[grade as Grade] ?? fallback;
}

/** Shared Tailwind class for ghost-style action buttons (share, export, bookmark, etc.). */
export const ACTION_BTN_CLASS =
  "inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer px-3 py-2 min-h-[44px] rounded-lg border border-card-border hover:border-muted/50 bg-surface-elevated/50 focus-visible:ring-2 focus-visible:ring-bitcoin focus-visible:outline-none";

/** Example transactions/addresses for the home page and ScanHistory examples tab. */
export interface ExampleItem {
  labelKey: string;
  labelDefault: string;
  hint: string;
  hintColor: string;
  input: string;
}

export const EXAMPLES: ExampleItem[] = [
  // Home cards (Home.tsx SPECIMEN_KEYS), one per grade band: A+, C, D, F
  {
    labelKey: "page.example_whirlpool",
    labelDefault: "Whirlpool (Ashigaru)",
    hint: "A+",
    hintColor: "text-severity-good",
    input: "5f0080e3f0acfde005b9c7149f12880be273eea01ca3a3b867f642ac9bf273cc",
  },
  {
    labelKey: "page.example_sweep",
    labelDefault: "Sweep",
    hint: "C",
    hintColor: "text-severity-medium",
    input: "8cbe332206ffc1ea3f3ffb6aeb5ac7306310bd991260de0e09845a45f70af85a",
  },
  {
    labelKey: "page.example_consolidation",
    labelDefault: "Consolidation",
    hint: "D",
    hintColor: "text-severity-high",
    input: "40b88e16fe9881eb89df76265ccf2d46abfd1071a94dae8e413efc0d83d3df18",
  },
  {
    // Simple payment whose change returns to the input address
    labelKey: "page.example_reuse",
    labelDefault: "Address reuse",
    hint: "F",
    hintColor: "text-severity-critical",
    input: "4c18b982836006cbe54661942f632f10b9cc0072e97a32feeea77abd8c7c8c3c",
  },
  // CoinJoins
  {
    labelKey: "page.example_joinmarket",
    labelDefault: "JoinMarket CoinJoin",
    hint: "A+",
    hintColor: "text-severity-good",
    input: "6cb2433f28177a3b07073a0eb34a527ba6d7dd7483cccb394f88321373c0ed20",
  },
  {
    labelKey: "page.example_wasabi",
    labelDefault: "Wasabi CoinJoin",
    hint: "A+",
    hintColor: "text-severity-good",
    input: "95799bd39aea897c9b1bdbebd79d4c7bf7d0a7b02425636e8df5283ae6bee144",
  },
  {
    // Live grade includes chain findings (CoinJoin ancestry and forward chain)
    labelKey: "page.example_stonewall",
    labelDefault: "Stonewall",
    hint: "A+",
    hintColor: "text-severity-good",
    input: "19a79be39c05a0956c7d1f9f28ee6f1091096247b0906b6a8536dd7f400f2358",
  },
  {
    // Whirlpool output spent alone (1-in-1-out): CoinJoin input, no change, no merge
    labelKey: "page.example_postmix",
    labelDefault: "Post-mix spend",
    hint: "B",
    hintColor: "text-severity-low",
    input: "8c04765862e8b6d9c122e83cc361e21ab24f0f4c1f48a37385620b917d0d041c",
  },
  // Teaching cases
  {
    labelKey: "page.example_dust",
    labelDefault: "Dust attack",
    hint: "C",
    hintColor: "text-severity-medium",
    input: "65551b775ea3bf580667c12629fa776514f9a76a57f04dd735e878dba76dbbdc",
  },
  {
    labelKey: "page.example_coinbase",
    labelDefault: "Coinbase",
    hint: "C",
    hintColor: "text-severity-medium",
    input: "6c7edc23fde3cd48aa7aaa5ed3c2a64cf605f4d3364d820d3be54a721b64b92a",
  },
  {
    labelKey: "page.example_opreturn",
    labelDefault: "OP_RETURN data",
    hint: "D",
    hintColor: "text-severity-high",
    input: "8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684",
  },
  {
    labelKey: "page.example_batch",
    labelDefault: "Batch payment",
    hint: "F",
    hintColor: "text-severity-critical",
    input: "aefda8a740b3afd49b23412eaae746224977db24be31706c050e24e950e96271",
  },
  {
    labelKey: "page.example_wikileaks",
    labelDefault: "WikiLeaks address",
    hint: "F",
    hintColor: "text-severity-critical",
    input: "1HB5XMLmzFVj8ALj6mfBsbifRoD4miY36v",
  },
  {
    labelKey: "page.example_satoshi",
    labelDefault: "Satoshi's address",
    hint: "F",
    hintColor: "text-severity-critical",
    input: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  },
  // Destination checks and the wallet audit
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
    // Destination check (no grade for an unused address), like the OFAC card
    hint: "Low risk",
    hintColor: "text-severity-good",
    input: "bc1pes5mfje89xdr6uh4qu6p4m0r8d6nz3tvgagtwgv99yalqwzyhdzqrl3mnu",
  },
  {
    labelKey: "page.example_wallet",
    labelDefault: "Wallet audit (zpub)",
    hint: "Wallet",
    hintColor: "text-bitcoin",
    input: "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs",
  },
];

/** Truncate a string showing first 8 and last `tailLen` characters. */
export function truncateId(s: string, tailLen = 4): string {
  if (s.length <= 8 + tailLen + 3) return s;
  return `${s.slice(0, 8)}...${s.slice(-tailLen)}`;
}
