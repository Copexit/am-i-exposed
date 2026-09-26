import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { isCoinbase, getSpendableOutputs } from "./tx-utils";
import { detectWhirlpool } from "./coinjoin-detectors";
import { checkBip69Ordering } from "./bip69";
import {
  detectLowRSignatures,
  getAnonymitySetNote,
  identifyWallet,
  scoreFingerprintSeverity,
  type FingerprintSignals,
} from "./wallet-fingerprint-helpers";

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
export const analyzeWalletFingerprint: TxHeuristic = (tx) => {
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
  let locktimeBlockGeneral = false;

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
  const isBip69 = tx.vin.length >= 3 && tx.vout.length >= 3 && checkBip69Ordering(tx);

  // Low-R signature detection
  const hasLowR = detectLowRSignatures(tx.vin);

  // ── Build human-readable signal list ──────────────────────────────────────

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

  // ── Sub-findings for specific field values ────────────────────────────────

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

  // ── Wallet identification ─────────────────────────────────────────────────

  const fpSignals: FingerprintSignals = {
    isVersion1, locktimeZero,
    locktimeBlockExact, locktimeBlockRandomized, locktimeBlockPlus1, locktimeBlockGeneral,
    allMax, allMaxMinus1, allMaxMinus2, allZero, mixedSequence, isBip69, hasLowR,
  };

  const spendableValues = getSpendableOutputs(tx.vout).map((o) => o.value);
  const walletGuess = identifyWallet(
    fpSignals, spendableValues, tx.vin.length, tx.vout.length, detectWhirlpool,
  );

  // ── Main fingerprint finding ──────────────────────────────────────────────

  const { severity, impact } = scoreFingerprintSeverity(walletGuess, signals.length);
  const anonSetNote = getAnonymitySetNote(walletGuess);

  const context = walletGuess
    ? "identified"
    : signals.length === 1
      ? "signals_one"
      : "signals_other";

  const title = walletGuess
    ? `Wallet fingerprint: likely ${walletGuess}`
    : `${signals.length} wallet fingerprinting signal${signals.length > 1 ? "s" : ""} detected`;

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
