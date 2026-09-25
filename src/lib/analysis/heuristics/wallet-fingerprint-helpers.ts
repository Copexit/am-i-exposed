import type { MempoolVin } from "@/lib/api/types";
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
 * R length in bytes if `hex` is a strict DER ECDSA signature followed by a
 * sighash byte, else null. Pubkeys, scripts and Schnorr signatures do not
 * satisfy the nested length fields.
 */
function derRLength(hex: string): number | null {
  const byteLen = hex.length / 2;
  if (byteLen === 64 || byteLen === 65) return null; // Schnorr (BIP340)
  const byte = (i: number) => parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  if (byte(0) !== 0x30 || byte(1) + 3 !== byteLen || byte(2) !== 0x02) return null;
  const rLen = byte(3);
  if (byte(4 + rLen) !== 0x02 || 4 + rLen + 2 + byte(5 + rLen) !== byteLen - 1) return null;
  return rLen;
}

/**
 * Detect low-R signatures from the inputs' witness stacks and scriptSig pushes.
 *
 * Bitcoin Core since 0.17 grinds nonces so R always fits in 32 bytes (saving
 * 1 byte). Other wallets produce a 33-byte R about 50% of the time.
 *
 * Returns true only if at least two DER signatures are present and every DER
 * signature has R <= 32 bytes (a single low-R signature happens by chance
 * about half the time, so it is not evidence of grinding). Taproot (Schnorr) inputs carry no DER
 * signatures and are ignored.
 */
export function detectLowRSignatures(vin: MempoolVin[]): boolean {
  let totalSigs = 0;
  for (const v of vin) {
    if (v.is_coinbase) continue;
    const scriptSigPushes = v.scriptsig_asm ? v.scriptsig_asm.split(" ") : [];
    for (const item of [...(v.witness ?? []), ...scriptSigPushes]) {
      if (!/^30(?:[0-9a-f]{2})+$/i.test(item)) continue;
      const rLen = derRLength(item);
      if (rLen === null) continue;
      if (rLen > 0x20) return false;
      totalSigs++;
    }
  }
  return totalSigs >= 2;
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
