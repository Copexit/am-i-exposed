import type { TxHeuristic } from "./types";
import type { Finding, Severity } from "@/lib/types";
import { WHIRLPOOL_DENOMS } from "@/lib/constants";

/**
 * H11: Wallet Fingerprinting
 *
 * Analyzes raw transaction metadata to identify wallet software:
 * - nLockTime: Bitcoin Core sets to current block height, most others use 0
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

  // Skip coinbase transactions (mining pool software fingerprinting is not meaningful here)
  if (tx.vin.some((v) => v.is_coinbase)) return { findings };

  const signals: string[] = [];
  let walletGuess: string | null = null;

  // --- nLockTime analysis ---
  // nLockTime=0 is too common (~40-50% of all txs) to be a useful fingerprint.
  // Only flag the positive signal: block-height locktime (Bitcoin Core anti-fee-sniping).
  if (tx.locktime > 0 && tx.locktime < 500_000_000) {
    // Looks like a block height - Bitcoin Core anti-fee-sniping
    // Sparrow also uses the same pattern (based on bitcoinj/Bitcoin Core signing)
    signals.push("nLockTime set to block height (Bitcoin Core / Sparrow pattern)");
    walletGuess = "Bitcoin Core / Sparrow";
  }

  // nVersion is too generic to be a useful fingerprint: nearly all modern
  // wallets use version 2 (BIP68), and version 1 just means older software.
  // Neither value narrows wallet identification meaningfully.

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
  // Require at least 2 on each side and at least one side >= 3 to reduce false positives.
  // 1-input + 3-output has ~16.7% chance of random BIP69 compliance (too noisy).
  // 2-input + 3-output: ~8.3% false positive rate (acceptable).
  // Require both sides >= 3 to reduce false positive rate to ~2.8% (1/36)
  if (tx.vin.length >= 3 && tx.vout.length >= 3) {
    const isBip69 = checkBip69(tx);
    if (isBip69) {
      // Whirlpool/Samourai also use BIP69 - check for CoinJoin patterns
      const isWhirlpoolPattern = detectWhirlpoolPattern(tx);
      const isLargeCoinJoin = tx.vin.length >= 20 && tx.vout.length >= 20;
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
      // Low-R grinding is specific to Bitcoin Core (since 0.17) - Sparrow does not do this
      signals.push("Low-R signatures (Bitcoin Core >= 0.17)");
      walletGuess = "Bitcoin Core";
    }
  }

  if (signals.length === 0) return { findings };

  // Determine severity based on identifiability
  let severity: Severity;
  let impact: number;

  if (walletGuess === "Bitcoin Core / Sparrow") {
    // Bitcoin Core and Sparrow share nLockTime and nSequence patterns.
    // This large combined user base means the fingerprint is less
    // identifying - reduced severity. (Low-R grinding narrows to Bitcoin
    // Core specifically, which is handled by the walletGuess branch below.)
    severity = "low";
    impact = -3;
  } else if (walletGuess) {
    severity = "medium";
    impact = -6;
  } else if (signals.length >= 3) {
    severity = "low";
    impact = -4;
  } else {
    severity = "low";
    impact = -2;
  }

  // Use i18next context param for variant key selection:
  // walletGuess present -> context: "identified" -> title_identified
  // no walletGuess, 1 signal -> context: "signals_one" -> title_signals_one
  // no walletGuess, >1 signals -> context: "signals_other" -> title_signals_other
  const context = walletGuess
    ? "identified"
    : signals.length === 1
      ? "signals_one"
      : "signals_other";

  const title = walletGuess
    ? `Wallet fingerprint: likely ${walletGuess}`
    : `${signals.length} wallet fingerprinting signal${signals.length > 1 ? "s" : ""} detected`;

  const description = walletGuess
    ? `Transaction metadata reveals wallet characteristics: ${signals.join("; ")}. These signals are consistent with ${walletGuess}. Wallet identification helps chain analysts narrow down the software used, which combined with other data can aid in deanonymization.`
    : `Transaction metadata reveals wallet characteristics: ${signals.join("; ")}. Wallet identification helps chain analysts narrow down the software used, which combined with other data can aid in deanonymization.`;

  findings.push({
    id: "h11-wallet-fingerprint",
    severity,
    title,
    params: {
      ...(walletGuess ? { walletGuess } : {}),
      signalCount: signals.length,
      signals: signals.join("; "),
      context,
    },
    description,
    recommendation:
      "Wallet fingerprinting is difficult to avoid without modifying wallet software. " +
      "Taproot (P2TR) transactions help because key-path spends all look identical. " +
      "Using popular wallets with large user bases reduces the identifying power of fingerprints. " +
      "Bitcoin Core and Sparrow share the same signing patterns, so their combined user base makes this fingerprint less unique.",
    scoreImpact: impact,
  });

  return { findings };
};


/** Detect Whirlpool CoinJoin pattern: 5 equal outputs at known denominations (5-8 total outputs). */
function detectWhirlpoolPattern(
  tx: { vin: Array<{ txid: string; vout: number }>; vout: Array<{ value: number; scriptpubkey: string }> },
): boolean {
  // Filter to spendable outputs (exclude OP_RETURN)
  const spendable = tx.vout.filter((o) => !o.scriptpubkey.startsWith("6a"));
  if (spendable.length < 5 || spendable.length > 6) return false;
  for (const denom of WHIRLPOOL_DENOMS) {
    if (spendable.filter((o) => o.value === denom).length === 5) return true;
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
