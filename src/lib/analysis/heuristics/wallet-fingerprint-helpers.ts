import type { Severity } from "@/lib/types";
import type { WhirlpoolPool } from "@/lib/constants";

/** Provide anonymity set context for each wallet family. */
export function getAnonymitySetNote(walletGuess: string | null): string {
  if (!walletGuess) return "";

  if (walletGuess === "Bitcoin Core") {
    return (
      "Bitcoin Core has the largest user base - this fingerprint is shared by millions of " +
      "transactions, making it one of the least identifying patterns."
    );
  }
  if (walletGuess.startsWith("Electrum")) {
    return (
      "Electrum has a moderate user base. Its BIP69 ordering creates a recognizable " +
      "but not uncommon pattern."
    );
  }
  if (walletGuess.includes("Wasabi")) {
    return (
      "Wasabi's nVersion=1 + nLockTime=0 combination is distinctive and shared by " +
      "fewer transactions, making it more identifying."
    );
  }
  if (walletGuess.includes("Ashigaru") || walletGuess.includes("Samourai")) {
    return (
      "The Samourai/Ashigaru fingerprint pattern narrows identification to a " +
      "privacy-focused but smaller user base."
    );
  }
  if (walletGuess.includes("Sparrow")) {
    return (
      "Sparrow shares many fingerprint traits with Bitcoin Core, giving it a " +
      "relatively large combined anonymity set."
    );
  }
  return (
    "Wallet identification helps chain analysts narrow down the software used, " +
    "which combined with other data can aid in deanonymization."
  );
}

/**
 * Detect low-R signatures in raw transaction hex.
 *
 * Bitcoin Core since 0.17 grinds nonces to produce 32-byte R values
 * (R < 0x80...) to save 1 byte. Most other wallets produce 33-byte R values
 * about 50% of the time.
 *
 * We check witness/scriptsig data for DER-encoded signatures where R is
 * exactly 32 bytes (the first byte of R is < 0x80).
 */
export function detectLowRSignatures(rawHex: string, inputCount: number): boolean {
  if (inputCount === 0) return false;

  // Quick heuristic: look for DER signature patterns in the hex
  // DER sig: 30 [len] 02 [rlen] [R...] 02 [slen] [S...]
  // Low-R means rlen = 0x20 (32 bytes)
  let lowRCount = 0;
  let totalSigs = 0;

  // Find all DER signatures in the raw hex
  const derPattern = /30[0-9a-f]{2}02([0-9a-f]{2})/gi;
  let match;

  while ((match = derPattern.exec(rawHex)) !== null) {
    const rLen = parseInt(match[1], 16);
    totalSigs++;
    if (rLen === 0x20) lowRCount++;
  }

  // If all signatures have low-R and there are enough to be meaningful
  return totalSigs >= inputCount && lowRCount === totalSigs && totalSigs > 0;
}

/** Collected signal flags from transaction metadata. */
export interface FingerprintSignals {
  isVersion1: boolean;
  locktimeZero: boolean;
  locktimeBlockExact: boolean;
  locktimeBlockRandomized: boolean;
  locktimeBlockPlus1: boolean;
  locktimeBlockGeneral: boolean;
  allMax: boolean;
  allMaxMinus1: boolean;
  allMaxMinus2: boolean;
  allZero: boolean;
  mixedSequence: boolean;
  isBip69: boolean;
  hasLowR: boolean;
}

/** Determine severity and score impact from the wallet guess and signal count. */
export function scoreFingerprintSeverity(
  walletGuess: string | null,
  signalCount: number,
): { severity: Severity; impact: number } {
  if (walletGuess === "Bitcoin Core") {
    return { severity: "low", impact: -5 };
  }
  if (walletGuess === "Electrum" || walletGuess === "Electrum (or BIP69-compatible)") {
    return { severity: "medium", impact: -6 };
  }
  if (
    walletGuess === "Ashigaru/Samourai" ||
    walletGuess === "Samourai / Sparrow (Whirlpool)" ||
    walletGuess === "Ashigaru Terminal (Whirlpool)" ||
    walletGuess === "Sparrow/Ashigaru"
  ) {
    return { severity: "medium", impact: -7 };
  }
  if (walletGuess === "Wasabi Wallet" || walletGuess === "Wasabi Wallet (WabiSabi)") {
    return { severity: "medium", impact: -7 };
  }
  if (walletGuess) {
    return { severity: "medium", impact: -8 };
  }
  if (signalCount >= 3) {
    return { severity: "low", impact: -5 };
  }
  return { severity: "low", impact: -3 };
}

/**
 * Identify the most likely wallet software from collected fingerprint signals.
 * Returns null if no confident identification can be made.
 */
export function identifyWallet(
  signals: FingerprintSignals,
  spendableValues: number[],
  vinLength: number,
  voutLength: number,
  detectWhirlpool: (values: number[]) => { pool: WhirlpoolPool } | null,
): string | null {
  const {
    locktimeZero, locktimeBlockExact, locktimeBlockGeneral, locktimeBlockRandomized,
    allMax, allMaxMinus1, allMaxMinus2,
    isBip69, hasLowR,
  } = signals;

  let walletGuess: string | null = null;

  // Check CoinJoin patterns first (most specific)
  if (isBip69) {
    const whirlpoolMatch = detectWhirlpool(spendableValues);
    const isLargeCoinJoin = vinLength >= 20 && voutLength >= 20;

    if (whirlpoolMatch) {
      walletGuess = whirlpoolMatch.pool.era === "ashigaru"
        ? "Ashigaru Terminal (Whirlpool)"
        : "Samourai / Sparrow (Whirlpool)";
    } else if (isLargeCoinJoin) {
      walletGuess = "Wasabi Wallet (WabiSabi)";
    } else if (allMax && locktimeZero) {
      walletGuess = "Ashigaru/Samourai";
    } else if (allMaxMinus2) {
      walletGuess = "Electrum";
    } else if (allMaxMinus1) {
      walletGuess = "Sparrow/Ashigaru";
    } else {
      walletGuess = "Electrum (or BIP69-compatible)";
    }
  }

  // Bitcoin Core high confidence: randomized locktime + Low-R
  if (!walletGuess && locktimeBlockRandomized && hasLowR) {
    walletGuess = "Bitcoin Core";
  }

  // Bitcoin Core medium confidence: block height locktime + Low-R + NOT BIP69
  if (!walletGuess && (locktimeBlockExact || locktimeBlockGeneral) && hasLowR && !isBip69) {
    walletGuess = "Bitcoin Core";
  }

  // Ambiguous: block height locktime + no Low-R + no BIP69
  if (!walletGuess && (locktimeBlockExact || locktimeBlockGeneral || locktimeBlockRandomized)) {
    if (allMaxMinus2 && !isBip69) {
      walletGuess = null;
    } else if (allMaxMinus1 && !isBip69) {
      walletGuess = null;
    }
  }

  return walletGuess;
}
