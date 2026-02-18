import type { TxHeuristic } from "./types";
import type { Finding, Severity } from "@/lib/types";

/**
 * H11: Wallet Fingerprinting
 *
 * Analyzes raw transaction metadata to identify wallet software:
 * - nLockTime: Bitcoin Core sets to current block height, most others use 0
 * - nVersion: 1 (legacy) vs 2 (BIP68 relative locktime)
 * - nSequence: 0xfffffffd (RBF), 0xfffffffe (no-RBF), 0xffffffff (legacy)
 * - BIP69: Lexicographic input/output ordering (Electrum pattern)
 * - Low-R signatures: Bitcoin Core since 0.17 grinds for 32-byte R values
 *
 * Research shows ~45% of transactions are identifiable by wallet.
 *
 * Impact: -2 to -8
 */
export const analyzeWalletFingerprint: TxHeuristic = (tx, rawHex) => {
  const findings: Finding[] = [];
  const signals: string[] = [];
  let walletGuess: string | null = null;

  // --- nLockTime analysis ---
  if (tx.locktime === 0) {
    signals.push("nLockTime=0 (non-Core wallet pattern)");
  } else if (tx.locktime > 0 && tx.locktime < 500_000_000) {
    // Looks like a block height - Bitcoin Core anti-fee-sniping
    signals.push("nLockTime set to block height (Bitcoin Core pattern)");
    walletGuess = "Bitcoin Core";
  }

  // --- nVersion analysis ---
  if (tx.version === 1) {
    signals.push("nVersion=1 (legacy, pre-BIP68)");
  } else if (tx.version === 2) {
    signals.push("nVersion=2 (BIP68 relative locktime support)");
  }

  // --- nSequence analysis ---
  const sequences = tx.vin
    .filter((v) => !v.is_coinbase)
    .map((v) => v.sequence);

  const allMaxMinus1 = sequences.every((s) => s === 0xfffffffe);
  const allMaxMinus2 = sequences.every((s) => s === 0xfffffffd);
  const allMax = sequences.every((s) => s === 0xffffffff);

  if (allMaxMinus2) {
    signals.push("nSequence=0xfffffffd (RBF enabled, Core/Electrum pattern)");
  } else if (allMaxMinus1) {
    signals.push("nSequence=0xfffffffe (RBF disabled, anti-fee-sniping)");
  } else if (allMax) {
    signals.push("nSequence=0xffffffff (legacy, no locktime/RBF)");
  }

  // --- BIP69 lexicographic ordering check ---
  if (tx.vin.length > 1 || tx.vout.length > 1) {
    const isBip69 = checkBip69(tx);
    if (isBip69) {
      // Whirlpool/Samourai also use BIP69 - check for CoinJoin patterns
      const isWhirlpoolPattern = detectWhirlpoolPattern(tx);
      const isLargeCoinJoin = tx.vin.length > 20 && tx.vout.length > 20;
      if (isWhirlpoolPattern) {
        signals.push("BIP69 ordering + Whirlpool pattern (Samourai/Sparrow)");
        walletGuess = "Samourai/Sparrow";
      } else if (isLargeCoinJoin) {
        signals.push("BIP69 ordering + large CoinJoin pattern (Wasabi/WabiSabi)");
        walletGuess = "Wasabi Wallet";
      } else {
        signals.push("BIP69 lexicographic ordering (Electrum/Samourai)");
        walletGuess = walletGuess ?? "Electrum";
      }
    }
  }

  // --- Low-R signature detection (from raw hex) ---
  if (rawHex) {
    const hasLowR = detectLowRSignatures(rawHex, tx.vin.length);
    if (hasLowR) {
      signals.push("Low-R signatures (Bitcoin Core >= 0.17)");
      walletGuess = "Bitcoin Core";
    }
  }

  if (signals.length === 0) return { findings };

  // Determine severity based on identifiability
  let severity: Severity;
  let impact: number;

  if (walletGuess) {
    severity = "medium";
    impact = -6;
  } else if (signals.length >= 3) {
    severity = "low";
    impact = -4;
  } else {
    severity = "low";
    impact = -2;
  }

  const title = walletGuess
    ? `Wallet fingerprint: likely ${walletGuess}`
    : `${signals.length} wallet fingerprinting signal${signals.length > 1 ? "s" : ""} detected`;

  findings.push({
    id: "h11-wallet-fingerprint",
    severity,
    title,
    description:
      `Transaction metadata reveals wallet characteristics: ${signals.join("; ")}. ` +
      (walletGuess
        ? `These signals are consistent with ${walletGuess}. `
        : "") +
      "Wallet identification helps chain analysts narrow down the software used, " +
      "which combined with other data can aid in deanonymization.",
    recommendation:
      "Wallet fingerprinting is difficult to avoid without modifying wallet software. " +
      "Taproot (P2TR) transactions help because key-path spends all look identical. " +
      "Using popular wallets with large user bases reduces the identifying power of fingerprints.",
    scoreImpact: impact,
  });

  return { findings };
};

/** Whirlpool pool denominations (in sats). */
const WHIRLPOOL_DENOMS = [100_000, 1_000_000, 5_000_000, 50_000_000];

/** Detect Whirlpool CoinJoin pattern: 5 equal outputs at known denominations, BIP69 ordered. */
function detectWhirlpoolPattern(
  tx: { vin: Array<{ txid: string; vout: number }>; vout: Array<{ value: number; scriptpubkey: string }> },
): boolean {
  if (tx.vout.length < 5) return false;
  for (const denom of WHIRLPOOL_DENOMS) {
    if (tx.vout.filter((o) => o.value === denom).length === 5) return true;
  }
  return false;
}

/**
 * Check if inputs and outputs follow BIP69 lexicographic ordering.
 * BIP69: inputs sorted by txid then vout, outputs sorted by value then scriptpubkey.
 */
function checkBip69(
  tx: { vin: Array<{ txid: string; vout: number }>; vout: Array<{ value: number; scriptpubkey: string }> },
): boolean {
  // Check input ordering
  for (let i = 1; i < tx.vin.length; i++) {
    const prev = tx.vin[i - 1];
    const curr = tx.vin[i];

    if (prev.txid > curr.txid) return false;
    if (prev.txid === curr.txid && prev.vout > curr.vout) return false;
  }

  // Check output ordering
  for (let i = 1; i < tx.vout.length; i++) {
    const prev = tx.vout[i - 1];
    const curr = tx.vout[i];

    if (prev.value > curr.value) return false;
    if (prev.value === curr.value && prev.scriptpubkey > curr.scriptpubkey)
      return false;
  }

  return true;
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
function detectLowRSignatures(rawHex: string, inputCount: number): boolean {
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
