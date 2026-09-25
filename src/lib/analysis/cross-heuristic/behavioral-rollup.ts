import type { Finding } from "@/lib/types";

/**
 * Behavioral fingerprint rollup: when multiple behavioral sub-signals fire
 * together, emit a compound finding capturing the elevated re-identification
 * risk. Individual findings are behavioral patterns (ongoing_pattern) that
 * independently have low-medium impact, but together create a strong
 * wallet fingerprint that re-identifies the user across chain scans.
 */
export function applyBehavioralRollup(findings: Finding[]): void {
  const behavioralIds = [
    "h11-wallet-fingerprint",
    "h6-round-fee-rate",
    "h6-rbf-signaled",
    "h6-fee-segwit-miscalc",
    "bip69-detected",
    "h-coin-selection-bnb",
    "h-coin-selection-value-asc",
    "h-coin-selection-value-desc",
    "witness-mixed-types",
    "witness-deep-stack",
    "witness-mixed-depths",
    "witness-mixed-sig-types",
  ];

  const firedSignals = findings.filter(
    (f) => behavioralIds.includes(f.id) && f.scoreImpact !== 0,
  );

  if (firedSignals.length >= 2) {
    const isCritical = firedSignals.length >= 4;
    const signalNames = firedSignals.map((f) => f.id).join(", ");
    findings.push({
      id: "behavioral-fingerprint-rollup",
      severity: isCritical ? "critical" : "high",
      confidence: "high",
      title: `Wallet re-identifiable via ${firedSignals.length} behavioral signals`,
      description:
        `${firedSignals.length} independent behavioral fingerprints fire together: ${signalNames}. ` +
        "Each signal alone is low-risk, but combined they create a strong wallet fingerprint " +
        "that can re-identify this wallet across the blockchain even without address linkage." +
        (isCritical
          ? " With 4+ signals, re-identification confidence is very high."
          : ""),
      recommendation:
        "Switch to a wallet with better fingerprint randomization. " +
        "Use different fee estimation, randomize output ordering, and avoid consistent " +
        "coin selection patterns. Sparrow and Bitcoin Core offer good fingerprint diversity.",
      scoreImpact: isCritical ? -12 : -6,
      params: {
        signalCount: firedSignals.length,
        signals: signalNames,
        ...(isCritical ? { context: "strong" } : {}),
      },
      adversaryTiers: ["passive_observer"],
      temporality: "ongoing_pattern",
    });
  }
}
