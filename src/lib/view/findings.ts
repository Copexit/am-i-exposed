import type { AdversaryTier, Finding, Severity, TemporalityClass } from "@/lib/types";
import { highestAdversaryTier } from "@/lib/analysis/finding-metadata";

export const ADVERSARY_TIERS: readonly AdversaryTier[] = ["passive_observer", "kyc_exchange", "state_adversary"];
export const TEMPORALITIES: readonly TemporalityClass[] = ["historical", "ongoing_pattern", "active_risk"];

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, good: 4 };

/** Most severe first, then larger absolute impact first (same order as calculateScore). */
export function compareFindings(a: Finding, b: Finding): number {
  const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (sev !== 0) return sev;
  return Math.abs(b.scoreImpact) - Math.abs(a.scoreImpact);
}

/**
 * Findings that describe the analysis itself (a fetch failed, a trace timed
 * out), not the user's privacy. Shown as analysis notices, never counted as
 * issues. Only zero-impact ones qualify: anything that moves the score stays
 * a regular finding.
 */
const STATUS_IDS: ReadonlySet<string> = new Set([
  "analysis-incomplete",
  "chain-trace-partial",
  "api-incomplete-prevout",
  "address-utxos-unavailable",
  "wallet-scan-partial",
  "partial-history-unavailable",
  "partial-history-partial",
]);

export function isStatusFinding(f: Finding): boolean {
  return f.scoreImpact === 0 && STATUS_IDS.has(f.id);
}

/**
 * Findings shown to the user. Hides findings suppressed for CoinJoin context
 * (scoreImpact 0, context "coinjoin") and the chain-trace-summary metadata
 * record, and analysis status notices (see isStatusFinding). Hidden findings
 * never carry score impact, so the score is unaffected.
 */
export function visibleFindings(findings: readonly Finding[]): Finding[] {
  return findings.filter(
    (f) => !(f.scoreImpact === 0 && String(f.params?.context ?? "").includes("coinjoin"))
      && f.id !== "chain-trace-summary"
      && !isStatusFinding(f),
  );
}

export interface FindingFilterState {
  adversary: ReadonlySet<AdversaryTier>;
  temporality: ReadonlySet<TemporalityClass>;
}

/**
 * Apply adversary/temporality filters. A finding without tier metadata always
 * passes, so filtering can never hide an unclassified finding.
 */
export function filterFindings(findings: readonly Finding[], state: FindingFilterState): Finding[] {
  return findings.filter((f) => {
    if (!f.adversaryTiers?.length || !f.temporality) return true;
    return state.adversary.has(highestAdversaryTier(f.adversaryTiers)) && state.temporality.has(f.temporality);
  });
}

/** A finding that helps privacy: severity "good", or any finding that raised the score. */
export function isStrength(f: Finding): boolean {
  return f.severity === "good" || f.scoreImpact > 0;
}

export interface FindingGroups {
  /** critical + high issues */
  leaks: Finding[];
  /** medium + low issues */
  minor: Finding[];
  /** good findings and anything that raised the score */
  strengths: Finding[];
}

export function groupFindings(findings: readonly Finding[]): FindingGroups {
  const sorted = [...findings].sort(compareFindings);
  return {
    leaks: sorted.filter((f) => !isStrength(f) && (f.severity === "critical" || f.severity === "high")),
    minor: sorted.filter((f) => !isStrength(f) && (f.severity === "medium" || f.severity === "low")),
    strengths: sorted.filter(isStrength),
  };
}

export interface FindingCounts {
  /** Findings that are not strengths (see isStrength). */
  issues: number;
  strengths: number;
  /** Most severe issue severity, or null when there are no issues. */
  worst: Exclude<Severity, "good"> | null;
  /** Issues whose damage is already on chain. */
  historical: number;
  /** Issues that repeat until a habit changes. */
  ongoing: number;
  /** Issues exploitable right now. */
  active: number;
}

export function countFindings(findings: readonly Finding[]): FindingCounts {
  const issues = findings.filter((f) => !isStrength(f));
  const worst = [...issues].sort(compareFindings)[0]?.severity ?? null;
  return {
    issues: issues.length,
    strengths: findings.length - issues.length,
    worst: worst as FindingCounts["worst"],
    historical: issues.filter((f) => f.temporality === "historical").length,
    ongoing: issues.filter((f) => f.temporality === "ongoing_pattern").length,
    active: issues.filter((f) => f.temporality === "active_risk").length,
  };
}

export interface ExposureRow {
  findingId: Finding["id"];
  severity: Severity;
  tiers: ReadonlySet<AdversaryTier>;
  temporality: TemporalityClass | null;
}

export interface ExposureMatrix {
  rows: ExposureRow[];
  /** Issues (non-good findings) each adversary tier can exploit. */
  perTier: Record<AdversaryTier, number>;
}

/**
 * Tiers are cumulative (docs/adr-finding-tiers.md): a more capable adversary
 * can do everything a less capable one can. So every tier at or above the
 * least capable tier listed on a finding can exploit it.
 */
export function exploitingTiers(listed: readonly AdversaryTier[]): Set<AdversaryTier> {
  const min = Math.min(...listed.map((t) => ADVERSARY_TIERS.indexOf(t)).filter((i) => i >= 0));
  return new Set(ADVERSARY_TIERS.filter((_, i) => i >= min));
}

/** Who can exploit what: one row per issue that carries tier metadata. */
export function buildExposureMatrix(findings: readonly Finding[]): ExposureMatrix {
  const rows = [...findings]
    .filter((f) => !isStrength(f) && f.adversaryTiers?.length)
    .sort(compareFindings)
    .map((f) => ({
      findingId: f.id,
      severity: f.severity,
      tiers: exploitingTiers(f.adversaryTiers!),
      temporality: f.temporality ?? null,
    }));
  const perTier = Object.fromEntries(
    ADVERSARY_TIERS.map((tier) => [tier, rows.filter((r) => r.tiers.has(tier)).length]),
  ) as Record<AdversaryTier, number>;
  return { rows, perTier };
}
