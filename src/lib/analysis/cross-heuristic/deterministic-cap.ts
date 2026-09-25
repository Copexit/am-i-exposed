import type { Finding } from "@/lib/types";
import type { FindingId } from "@/lib/analysis/finding-metadata";

/**
 * When a deterministic (100% certain) privacy failure is present, cap the
 * score at F. Deterministic findings make all other privacy measures
 * irrelevant - one certain link reveals everything.
 */
export function applyDeterministicScoreCap(findings: Finding[]): void {
  // Only h2-same-address-io (partial self-send) is truly deterministic in the
  // Blockchair sense: change is revealed to third-party observers, leaking the
  // payment amount. Full self-sends (h2-self-send) have no external payment to
  // leak and are already heavily penalized (-15 to -25).
  const DETERMINISTIC_FINDING_IDS = new Set<FindingId>([
    "h2-same-address-io",    // Same address in input and output (partial - change revealed)
    // h2-sweep removed: 1-in-1-out sweeps are normal practice (wallet migration,
    // exact-amount payment, UTXO swap). No consolidation, no change = no privacy loss.
  ]);

  const hasDeterministicFinding = findings.some(
    (f) => DETERMINISTIC_FINDING_IDS.has(f.id) && f.scoreImpact < 0,
  );

  if (hasDeterministicFinding) {
    const totalImpact = findings.reduce((sum, f) => sum + f.scoreImpact, 0);
    const targetImpact = -46; // Ensures F from base 70

    if (totalImpact > targetImpact) {
      findings.push({
        id: "compound-deterministic-cap",
        severity: "critical",
        confidence: "deterministic",
        title: "Deterministic privacy failure - score capped",
        description:
          "A 100% certain privacy leak was detected. The score is capped at F " +
          "because no amount of positive signals can offset a deterministic identification.",
        recommendation:
          "Fix the deterministic issue before addressing other findings.",
        scoreImpact: targetImpact - totalImpact,
      });
    }
  }
}
