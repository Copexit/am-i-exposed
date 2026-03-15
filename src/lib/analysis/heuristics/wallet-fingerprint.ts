import type { TxHeuristic } from "./types";
import type { Finding, Severity } from "@/lib/types";
import { WHIRLPOOL_DENOMS } from "@/lib/constants";
import { isCoinbase } from "./tx-utils";

/**
 * H11: Wallet Fingerprinting
 *
 * Analyzes raw transaction metadata to identify wallet software:
 * - nVersion: 1 (legacy/Wasabi) vs 2 (BIP68-compliant)
 * - nLockTime: 0, block height (exact / randomized / +1)
 * - nSequence: per-input analysis + mixed detection
 * - BIP69: Lexicographic input/output ordering
 * - Low-R signatures: Bitcoin Core >= 0.17 grinds for 32-byte R values
 *
 * Uses a multi-signal decision tree for accurate wallet identification
 * instead of single-signal labeling.
 *
 * Impact: -2 to -8
 */
export const analyzeWalletFingerprint: TxHeuristic = (tx, rawHex) => {
  const findings: Finding[] = [];

  // Skip coinbase transactions (mining pool software fingerprinting is not meaningful here)
  if (isCoinbase(tx)) return { findings };

  const signals: string[] = [];

  // ── Collect raw signal flags ──────────────────────────────────────────────

  const isVersion1 = tx.version === 1;

  // nLockTime categories
  const locktimeZero = tx.locktime === 0;
  let locktimeBlockExact = false;
  let locktimeBlockRandomized = false;
  let locktimeBlockPlus1 = false;
  let locktimeBlockGeneral = false; // set to block height but can't determine delta

  if (!locktimeZero && tx.locktime > 0 && tx.locktime < 500_000_000) {
    if (tx.status.confirmed && tx.status.block_height) {
      const delta = tx.status.block_height - tx.locktime;
      if (delta === 0 || delta === 1) {
        locktimeBlockExact = true;
      } else if (delta >= 2 && delta <= 100) {
        locktimeBlockRandomized = true;
      } else if (delta === -1) {
        locktimeBlockPlus1 = true;
      } else {
        locktimeBlockGeneral = true;
      }
    } else {
      // Unconfirmed or no block_height available
      locktimeBlockGeneral = true;
    }
  }

  // nSequence analysis
  const nonCoinbaseVin = tx.vin.filter((v) => !v.is_coinbase);
  const sequences = nonCoinbaseVin.map((v) => v.sequence);
  const uniqueSequences = new Set(sequences);
  const mixedSequence = uniqueSequences.size > 1;

  const allMaxMinus1 = sequences.every((s) => s === 0xfffffffe);
  const allMaxMinus2 = sequences.every((s) => s === 0xfffffffd);
  const allMax = sequences.every((s) => s === 0xffffffff);
  const allZero = sequences.length > 0 && sequences.every((s) => s === 0);

  // BIP69 check (require >= 3 on each side to reduce false positives)
  let isBip69 = false;
  if (tx.vin.length >= 3 && tx.vout.length >= 3) {
    isBip69 = checkBip69(tx);
  }

  // Low-R signature detection
  let hasLowR = false;
  if (rawHex) {
    hasLowR = detectLowRSignatures(rawHex, nonCoinbaseVin.length);
  }

  // ── Build human-readable signal list ──────────────────────────────────────
  // Note: nVersion=1 and nLockTime=0 are NOT counted as main signals because
  // they're too common in old transactions to be useful fingerprints. They're
  // surfaced as separate informational sub-findings (h11-legacy-version,
  // h11-no-locktime) and used in the wallet identification decision tree.

  if (locktimeBlockRandomized) {
    signals.push("nLockTime randomized (Bitcoin Core >= 0.11 anti-fee-sniping)");
  } else if (locktimeBlockPlus1) {
    signals.push("nLockTime=block_height+1 (unusual pattern)");
  } else if (locktimeBlockExact || locktimeBlockGeneral) {
    signals.push("nLockTime set to block height (anti-fee-sniping)");
  }

  if (mixedSequence) {
    signals.push("Mixed nSequence across inputs (fingerprint leak)");
  } else if (allZero) {
    signals.push("nSequence=0x00000000 (very conspicuous, almost nobody uses this)");
  } else if (allMaxMinus2) {
    signals.push("nSequence=0xfffffffd (RBF enabled)");
  } else if (allMaxMinus1) {
    signals.push("nSequence=0xfffffffe (RBF disabled, anti-fee-sniping)");
  } else if (allMax) {
    signals.push("nSequence=0xffffffff (legacy, no locktime/RBF)");
  }

  if (isBip69) {
    signals.push("BIP69 lexicographic ordering");
  }

  if (hasLowR) {
    signals.push("Low-R signatures (Bitcoin Core >= 0.17)");
  }

  // ── Wallet identification decision tree ───────────────────────────────────

  let walletGuess: string | null = null;

  // Check CoinJoin patterns first (most specific)
  if (isBip69) {
    const isWhirlpoolPattern = detectWhirlpoolPattern(tx);
    const isLargeCoinJoin = tx.vin.length >= 20 && tx.vout.length >= 20;

    if (isWhirlpoolPattern) {
      walletGuess = "Ashigaru/Sparrow (Whirlpool)";
    } else if (isLargeCoinJoin) {
      walletGuess = "Wasabi Wallet (WabiSabi)";
    } else if (allMax && locktimeZero) {
      // BIP69 + nSequence=0xffffffff + locktime=0: Samourai/Ashigaru non-CoinJoin
      walletGuess = "Ashigaru/Samourai";
    } else if (allMaxMinus2) {
      // BIP69 + RBF: Electrum pattern
      walletGuess = "Electrum";
    } else if (allMaxMinus1) {
      // BIP69 + no-RBF: Sparrow/Ashigaru
      walletGuess = "Sparrow/Ashigaru";
    } else {
      walletGuess = "Electrum (or BIP69-compatible)";
    }
  }

  // nVersion=1 + nLockTime=0 + nSequence=0xffffffff is consistent with Wasabi Wallet
  // non-CoinJoin spends, BUT also matches all pre-BIP68 legacy transactions.
  // Cannot distinguish reliably - do not assign wallet guess.
  // Wasabi CoinJoins are detected via the BIP69 + large CoinJoin branch above.

  // Bitcoin Core high confidence: randomized locktime + Low-R
  if (!walletGuess && locktimeBlockRandomized && hasLowR) {
    walletGuess = "Bitcoin Core";
  }

  // Bitcoin Core medium confidence: block height locktime + Low-R + NOT BIP69
  if (!walletGuess && (locktimeBlockExact || locktimeBlockGeneral) && hasLowR && !isBip69) {
    walletGuess = "Bitcoin Core";
  }

  // Ambiguous: block height locktime + no Low-R + no BIP69
  // Many wallets match: Core, Sparrow, Electrum, Ashigaru, Trezor...
  // Only label when we have a distinguishing signal
  if (!walletGuess && (locktimeBlockExact || locktimeBlockGeneral || locktimeBlockRandomized)) {
    if (allMaxMinus2 && !isBip69) {
      // RBF + locktime + no BIP69: could be Core, Sparrow, or Electrum
      // Too ambiguous to label a single wallet
      walletGuess = null;
    } else if (allMaxMinus1 && !isBip69) {
      // no-RBF + locktime: could be Core (older), Sparrow, Trezor
      walletGuess = null;
    }
  }

  // ── Sub-findings for specific field values ────────────────────────────────

  // nVersion=1 is a standalone privacy signal (narrows to Wasabi/legacy)
  // Impact is 0 because the main h11-wallet-fingerprint finding already accounts for it
  if (isVersion1) {
    findings.push({
      id: "h11-legacy-version",
      severity: "low",
      confidence: "deterministic",
      title: "Legacy transaction version (nVersion=1)",
      description:
        "This transaction uses nVersion=1, which is uncommon in modern wallets. " +
        "This narrows identification to legacy software or Wasabi Wallet.",
      recommendation:
        "Use a wallet that creates nVersion=2 transactions (BIP68-compliant). " +
        "Most modern wallets (Bitcoin Core, Sparrow, Electrum, Ashigaru) use nVersion=2.",
      scoreImpact: 0,
    });
  }

  // nLockTime=0 is a standalone privacy signal (no anti-fee-sniping)
  // Impact is 0 because the main h11-wallet-fingerprint finding already accounts for it
  if (locktimeZero) {
    findings.push({
      id: "h11-no-locktime",
      severity: "low",
      confidence: "deterministic",
      title: "No anti-fee-sniping protection (nLockTime=0)",
      description:
        "This transaction has nLockTime=0, meaning it lacks anti-fee-sniping protection. " +
        "Most modern wallets set nLockTime to the current block height. " +
        "Not using it fingerprints the wallet and slightly weakens network security.",
      recommendation:
        "Use a wallet that sets nLockTime to the current block height " +
        "(Bitcoin Core, Sparrow, Electrum, and Ashigaru all do this).",
      scoreImpact: 0,
    });
  }

  // Mixed nSequence is a clear fingerprint leak
  // Impact is 0 because the main h11-wallet-fingerprint finding already accounts for it
  if (mixedSequence) {
    findings.push({
      id: "h11-mixed-sequence",
      severity: "low",
      confidence: "deterministic",
      title: "Mixed nSequence values across inputs",
      description:
        "This transaction uses different nSequence values across its inputs. " +
        "Consistent nSequence values are expected from a single wallet. Mixed values " +
        "may indicate coin control with manual overrides or multi-party construction.",
      recommendation:
        "Standard wallets use uniform nSequence across all inputs. " +
        "If using coin control, ensure sequence values are consistent.",
      scoreImpact: 0,
    });
  }

  if (signals.length === 0) return { findings };

  // ── Main fingerprint finding ──────────────────────────────────────────────

  let severity: Severity;
  let impact: number;

  if (walletGuess === "Bitcoin Core") {
    // Large anonymity set (~40% of network) - still identifiable but common
    severity = "low";
    impact = -5;
  } else if (walletGuess === "Electrum" || walletGuess === "Electrum (or BIP69-compatible)") {
    // Moderate anonymity set - BIP69 ordering is a strong fingerprint
    severity = "medium";
    impact = -6;
  } else if (walletGuess === "Ashigaru/Samourai" || walletGuess === "Ashigaru/Sparrow (Whirlpool)" || walletGuess === "Sparrow/Ashigaru") {
    // Niche privacy wallets - small anonymity set narrows identification
    severity = "medium";
    impact = -7;
  } else if (walletGuess === "Wasabi Wallet" || walletGuess === "Wasabi Wallet (WabiSabi)") {
    // Wasabi's nVersion=1 pattern is very distinctive - small anonymity set
    severity = "medium";
    impact = -7;
  } else if (walletGuess) {
    // Unknown/rare wallet - very small anonymity set
    severity = "medium";
    impact = -8;
  } else if (signals.length >= 3) {
    // Multiple signals but no wallet match - still narrows identification
    severity = "low";
    impact = -5;
  } else {
    // Minimal fingerprint signals
    severity = "low";
    impact = -3;
  }

  // i18next context for variant key selection
  const context = walletGuess
    ? "identified"
    : signals.length === 1
      ? "signals_one"
      : "signals_other";

  const title = walletGuess
    ? `Wallet fingerprint: likely ${walletGuess}`
    : `${signals.length} wallet fingerprinting signal${signals.length > 1 ? "s" : ""} detected`;

  // Anonymity set context for the description
  const anonSetNote = getAnonymitySetNote(walletGuess);

  const description = walletGuess
    ? `Transaction metadata reveals wallet characteristics: ${signals.join("; ")}. ` +
      `These signals are consistent with ${walletGuess}. ${anonSetNote}`
    : `Transaction metadata reveals wallet characteristics: ${signals.join("; ")}. ` +
      `Wallet identification helps chain analysts narrow down the software used, ` +
      `which combined with other data can aid in deanonymization.`;

  findings.push({
    id: "h11-wallet-fingerprint",
    severity,
    confidence: "medium",
    title,
    params: {
      ...(walletGuess ? { walletGuess } : {}),
      signalCount: signals.length,
      signals: signals.join("; "),
      context,
    },
    description,
    recommendation:
      "Every wallet leaves a fingerprint - the goal is not invisibility but blending in. " +
      "Wallets with millions of users (Bitcoin Core, Sparrow, Electrum) create large anonymity sets " +
      "where your transaction looks like millions of others. Niche wallets create small sets that " +
      "narrow identification. The fingerprint itself is unavoidable; what matters is how many " +
      "people share it.",
    scoreImpact: impact,
  });

  return { findings };
};

/** Provide anonymity set context for each wallet family. */
function getAnonymitySetNote(walletGuess: string | null): string {
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


/** Detect Whirlpool CoinJoin pattern: 5+ equal outputs at known denominations (5-10 total outputs). */
function detectWhirlpoolPattern(
  tx: { vin: Array<{ txid: string; vout: number }>; vout: Array<{ value: number; scriptpubkey: string }> },
): boolean {
  // Filter to spendable outputs (exclude OP_RETURN)
  const spendable = tx.vout.filter((o) => !o.scriptpubkey.startsWith("6a"));
  if (spendable.length < 5 || spendable.length > 10) return false;
  for (const denom of WHIRLPOOL_DENOMS) {
    const matchCount = spendable.filter((o) => o.value === denom).length;
    if (matchCount >= 5 && spendable.length - matchCount <= 1) return true;
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
