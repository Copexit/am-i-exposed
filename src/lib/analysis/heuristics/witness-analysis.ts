import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { isCoinbase } from "./tx-utils";

/**
 * Witness Data Analysis
 *
 * Analyzes SegWit witness data for privacy-relevant patterns:
 * - Uniform witness padding (good - some wallets pad to fixed sizes)
 * - Unusual witness stack depth (fingerprints wallet software)
 * - Empty witness fields where witness is expected
 * - Mixed witness/non-witness inputs
 *
 * Impact: -1 to -3
 */
export const analyzeWitnessData: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // Skip coinbase
  if (isCoinbase(tx)) return { findings };

  const witnessInputs = tx.vin.filter((v) => v.witness && v.witness.length > 0);
  const nonWitnessInputs = tx.vin.filter(
    (v) => !v.witness || v.witness.length === 0,
  );

  // No witness data at all - legacy tx, nothing to analyze
  if (witnessInputs.length === 0) return { findings };

  // Mixed witness / non-witness inputs (not just script type mismatch - witness
  // level mixing reveals upgrade path or multi-wallet construction)
  if (nonWitnessInputs.length > 0 && witnessInputs.length > 0) {
    findings.push({
      id: "witness-mixed-types",
      severity: "low",
      confidence: "deterministic",
      title: "Mixed witness and non-witness inputs",
      description:
        `This transaction has ${witnessInputs.length} SegWit input(s) with witness data ` +
        `and ${nonWitnessInputs.length} legacy input(s) without. ` +
        "Mixing input types reveals an upgrade path or multi-wallet construction, " +
        "which can fingerprint the entity behind the transaction.",
      recommendation:
        "Use a single address type for all inputs. Migrate legacy UTXOs " +
        "to SegWit (bech32) before spending them alongside native SegWit inputs.",
      scoreImpact: -1,
      params: {
        witnessCount: witnessInputs.length,
        nonWitnessCount: nonWitnessInputs.length,
      },
    });
  }

  // Analyze witness stack depths across inputs
  const stackDepths = witnessInputs.map((v) => v.witness!.length);
  const uniqueDepths = new Set(stackDepths);

  // Unusual witness stack depth (> 4 items suggests multisig or complex script)
  const maxDepth = Math.max(...stackDepths);
  if (maxDepth > 4) {
    findings.push({
      id: "witness-deep-stack",
      severity: "low",
      confidence: "medium",
      title: `Unusual witness stack depth (${maxDepth} items)`,
      description:
        `At least one input has a witness stack with ${maxDepth} items. ` +
        "Standard single-sig P2WPKH uses 2 items (signature + pubkey), P2WSH " +
        "multisig uses 3-4. Deeper stacks indicate complex scripts (HTLC, " +
        "timelock, or custom smart contracts) that fingerprint the spending conditions.",
      recommendation:
        "Complex witness structures are more identifiable on-chain. When possible, " +
        "use standard P2WPKH (native SegWit) for routine transactions.",
      scoreImpact: -1,
      params: { maxDepth },
    });
  }

  // Mixed witness stack depths across inputs (different signing schemes)
  if (uniqueDepths.size > 1 && witnessInputs.length >= 2) {
    findings.push({
      id: "witness-mixed-depths",
      severity: "low",
      confidence: "medium",
      title: "Mixed witness stack depths across inputs",
      description:
        `Witness stacks have varying depths (${[...uniqueDepths].sort().join(", ")} items). ` +
        "This indicates inputs are being spent under different spending conditions, " +
        "which can help analysts distinguish between UTXOs from different sources.",
      recommendation:
        "For better privacy, spend UTXOs with the same script type and complexity together.",
      scoreImpact: -1,
      params: { depths: [...uniqueDepths].sort().join(",") },
    });
  }

  // Uniform witness sizes (potential padding - good privacy practice)
  if (witnessInputs.length >= 2) {
    const witnessSizes = witnessInputs.map((v) =>
      v.witness!.reduce((sum, item) => sum + item.length, 0),
    );
    const allSameSize = witnessSizes.every((s) => s === witnessSizes[0]);

    // Standard P2WPKH has uniform witness (sig + pubkey are ~same length).
    // Only flag padding if it's NOT the standard pattern (depth 2 with
    // similar sizes is normal P2WPKH, not intentional padding).
    const isStandardP2wpkh = stackDepths.every((d) => d === 2);

    if (allSameSize && !isStandardP2wpkh && uniqueDepths.size === 1) {
      findings.push({
        id: "witness-uniform-size",
        severity: "good",
        confidence: "medium",
        title: "Uniform witness data sizes detected",
        description:
          "All witness stacks have identical total sizes, suggesting intentional " +
          "padding for privacy. Some privacy-focused wallets pad witness data to " +
          "fixed sizes to prevent size-based fingerprinting.",
        recommendation:
          "This is a positive privacy practice. Continue using this wallet's witness handling.",
        scoreImpact: 1,
        params: { size: witnessSizes[0] },
      });
    }
  }

  // Detect Schnorr signatures (64-byte witness items in P2TR inputs)
  const taprootInputs = tx.vin.filter(
    (v) => v.prevout?.scriptpubkey_type === "v1_p2tr" && v.witness && v.witness.length > 0,
  );
  const ecdsaInputs = tx.vin.filter(
    (v) =>
      v.prevout?.scriptpubkey_type &&
      ["v0_p2wpkh", "v0_p2wsh"].includes(v.prevout.scriptpubkey_type) &&
      v.witness &&
      v.witness.length > 0,
  );

  if (taprootInputs.length > 0 && ecdsaInputs.length > 0) {
    findings.push({
      id: "witness-mixed-sig-types",
      severity: "medium",
      confidence: "deterministic",
      title: "Mixed Schnorr and ECDSA signatures",
      description:
        `This transaction uses ${taprootInputs.length} Taproot input(s) with Schnorr signatures ` +
        `and ${ecdsaInputs.length} SegWit v0 input(s) with ECDSA signatures. ` +
        "Mixing signature types strongly fingerprints a wallet in transition from " +
        "SegWit v0 to Taproot, or a multi-wallet construction.",
      recommendation:
        "Complete the migration to Taproot (P2TR) for all UTXOs before spending " +
        "them together. Mixed signature types are very distinctive on-chain.",
      scoreImpact: -2,
      params: {
        taprootCount: taprootInputs.length,
        ecdsaCount: ecdsaInputs.length,
      },
    });
  }

  return { findings };
};
