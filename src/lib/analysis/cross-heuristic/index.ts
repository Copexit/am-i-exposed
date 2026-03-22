import type { Finding, TxType } from "@/lib/types";
import { isCoinJoinFinding } from "../heuristics/coinjoin";
import { suppressFinding } from "./utils";
import { applyCoinJoinSuppressions } from "./coinjoin-suppressions";
import { applyCompoundScoringAdjustments } from "./compound-scoring";
import { applyWalletContradictionRules } from "./wallet-rules";
import { applyBehavioralRollup } from "./behavioral-rollup";
import { applyDeterministicScoreCap } from "./deterministic-cap";

/**
 * Suppress findings that are structural properties of multisig spending
 * rather than privacy leaks. Multisig inputs inherently use different script
 * types (P2SH/P2WSH) from single-sig outputs.
 */
function applyMultisigSuppressions(findings: Finding[]): void {
  const hasMultisig = findings.some((f) => f.id.startsWith("h17-"));
  if (!hasMultisig) return;

  for (const f of findings) {
    if (f.id === "script-mixed") {
      suppressFinding(f, "multisig");
    }
    // Multisig inherently combines UTXOs from different signing participants.
    // CIOH and consolidation findings are structural, not privacy leaks.
    if (f.id === "h3-cioh") {
      suppressFinding(f, "multisig");
    }
    if (f.id.startsWith("consolidation-")) {
      suppressFinding(f, "multisig");
    }
  }
}

/**
 * Deduplicate and reduce overlapping consolidation/CIOH/entropy findings.
 * When multiple heuristics describe the same underlying multi-input pattern,
 * keep the most informative one and suppress the rest.
 */
function applyConsolidationDedup(findings: Finding[], isCoinJoin: boolean): void {
  // CIOH + consolidation + unnecessary input dedup: when CIOH fires on a
  // non-CoinJoin tx, the consolidation and unnecessary-input findings are
  // redundant (they describe the same multi-input problem).
  const ciohFinding = findings.find((f) => f.id === "h3-cioh" && f.scoreImpact < 0);
  if (ciohFinding && !isCoinJoin) {
    for (const f of findings) {
      if (f.id === "unnecessary-input") {
        suppressFinding(f, "cioh-covers");
      }
      if (f.id.startsWith("consolidation-") && f.scoreImpact < -2) {
        f.params = { ...f.params, context: "cioh-covers" };
        f.scoreImpact = -2;
      }
    }
  }

  // Consolidation triple-penalty reduction: when h2-self-send fires as a
  // consolidation (N-in, 1-out to self), zero-entropy (h5) is inherent and
  // adds no information beyond what CIOH already captures. Suppress it.
  const isConsolidationSelfSend = findings.some(
    (f) => f.id === "h2-self-send" && f.params?.allMatch === 1,
  );
  if (isConsolidationSelfSend) {
    for (const f of findings) {
      if (f.id === "h5-zero-entropy" || f.id === "h5-zero-entropy-sweep") {
        suppressFinding(f, "consolidation");
      }
    }
  }

  // Entropy sweep is fully redundant when consolidation-fan-in already exists.
  // Both say "N inputs consolidated into 1 output, all linked." Remove it
  // entirely so the findings list stays focused.
  if (findings.some((f) => f.id === "consolidation-fan-in")) {
    const idx = findings.findIndex((f) => f.id === "h5-zero-entropy-sweep");
    if (idx !== -1) findings.splice(idx, 1);
  }
}

/**
 * Cross-heuristic intelligence: adjust findings based on interactions
 * between different heuristics. This runs after all heuristics complete.
 */
export function applyCrossHeuristicRules(findings: Finding[]): void {
  const isCoinJoin = findings.some(isCoinJoinFinding);
  const isStonewall = findings.some(
    (f) => (f.id === "h4-stonewall" || f.id === "h4-simplified-stonewall") && f.scoreImpact > 0,
  );

  // 1. CoinJoin/Stonewall suppression
  if (isCoinJoin) {
    applyCoinJoinSuppressions(findings, isStonewall);
  }

  // Note: exchange-withdrawal-pattern is NOT suppressed for CoinJoin because
  // it structurally cannot overlap: exchange withdrawals require <= 2 inputs
  // while all CoinJoin types (Whirlpool, WabiSabi, JoinMarket, Stonewall)
  // require 3+ inputs. Explicit suppression is unnecessary.

  // 2. Multisig suppression
  applyMultisigSuppressions(findings);

  // 3. Consolidation/CIOH/entropy deduplication
  applyConsolidationDedup(findings, isCoinJoin);

  // 4. Compound scoring adjustments (RBF, corroboration, post-mix entity)
  applyCompoundScoringAdjustments(findings);

  // 5. Wallet fingerprint contradiction detection
  applyWalletContradictionRules(findings);

  // 6. Behavioral fingerprint rollup
  applyBehavioralRollup(findings);

  // 7. Deterministic score cap (must be last - adjusts final score)
  applyDeterministicScoreCap(findings);
}

/**
 * Classify a transaction based on detected findings.
 * Priority: most specific pattern first, fallback to structural patterns.
 */
export function classifyTransactionType(findings: Finding[]): TxType {
  const has = (id: string) => findings.some((f) => f.id === id && f.scoreImpact !== 0);
  const hasAny = (id: string) => findings.some((f) => f.id === id);

  // CoinJoin variants (most specific first)
  if (hasAny("h4-whirlpool")) return "whirlpool-coinjoin";
  if (findings.some((f) => f.id === "h4-coinjoin" && f.params?.isWabiSabi === 1)) return "wabisabi-coinjoin";
  if (hasAny("h4-wasabi1")) return "wasabi1-coinjoin";
  if (hasAny("h4-joinmarket")) return "joinmarket-coinjoin";
  if (hasAny("h4-coinjoin")) return "generic-coinjoin";

  // Samourai/Ashigaru specific patterns
  if (hasAny("h4-stonewall")) return "stonewall";
  if (hasAny("h4-simplified-stonewall")) return "simplified-stonewall";
  if (hasAny("tx0-premix")) return "tx0-premix";
  if (hasAny("bip47-notification")) return "bip47-notification";
  if (hasAny("ricochet-hop0") || hasAny("chain-ricochet")) return "ricochet";

  // Coinbase
  if (hasAny("coinbase-transaction")) return "coinbase";

  // Structural patterns
  if (hasAny("h2-self-send")) return "self-transfer";
  if (has("consolidation-fan-in")) return "consolidation";
  if (has("exchange-withdrawal-pattern")) return "exchange-withdrawal";
  if (has("consolidation-fan-out")) return "batch-payment";
  if (has("peel-chain")) return "peel-chain";

  return "simple-payment";
}
