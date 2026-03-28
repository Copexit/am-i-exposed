import type { Severity, ConfidenceLevel, AdversaryTier, TemporalityClass } from "@/lib/types";

export const SEVERITY_STYLES: Record<
  Severity,
  { dot: string; label: string; text: string; border: string; glow?: string }
> = {
  critical: {
    dot: "bg-severity-critical",
    label: "Critical",
    text: "text-severity-critical",
    border: "border-l-severity-critical",
    glow: "shadow-[inset_4px_0_12px_-4px_rgba(239,68,68,0.25)]",
  },
  high: {
    dot: "bg-severity-high",
    label: "High",
    text: "text-severity-high",
    border: "border-l-severity-high",
    glow: "shadow-[inset_4px_0_12px_-4px_rgba(249,115,22,0.2)]",
  },
  medium: {
    dot: "bg-severity-medium",
    label: "Medium",
    text: "text-severity-medium",
    border: "border-l-severity-medium",
  },
  low: {
    dot: "bg-severity-low",
    label: "Low",
    text: "text-severity-low",
    border: "border-l-severity-low",
  },
  good: {
    dot: "bg-severity-good",
    label: "Good",
    text: "text-severity-good",
    border: "border-l-severity-good",
  },
};

export const CONFIDENCE_STYLES: Record<ConfidenceLevel, { label: string; className: string; tooltip: string }> = {
  deterministic: { label: "Definite", className: "bg-severity-critical/25 text-severity-critical border-severity-critical", tooltip: "This finding is mathematically certain - no ambiguity" },
  high: { label: "Likely", className: "bg-severity-high/20 text-severity-high border-severity-high", tooltip: "Strong evidence supports this finding, but not absolute certainty" },
  medium: { label: "Possible", className: "bg-severity-medium/20 text-severity-medium border-severity-medium", tooltip: "Moderate evidence - this pattern is suggestive but could have other explanations" },
  low: { label: "Hint", className: "bg-severity-low/20 text-severity-low border-severity-low", tooltip: "Weak signal - may indicate a pattern but could easily be coincidence" },
};

export const ADVERSARY_STYLES: Record<AdversaryTier, { label: string; className: string }> = {
  passive_observer: { label: "Public", className: "bg-muted/20 text-muted border-card-border" },
  kyc_exchange: { label: "KYC", className: "bg-severity-medium/20 text-severity-medium border-severity-medium" },
  state_adversary: { label: "State", className: "bg-severity-critical/20 text-severity-critical border-severity-critical" },
};

export const TEMPORALITY_STYLES: Record<TemporalityClass, { label: string; className: string }> = {
  historical: { label: "Past", className: "bg-severity-low/15 text-severity-low border-severity-low" },
  ongoing_pattern: { label: "Pattern", className: "bg-severity-medium/20 text-severity-medium border-severity-medium" },
  active_risk: { label: "Active", className: "bg-severity-critical/20 text-severity-critical border-severity-critical" },
};

export const SEVERITY_TOOLTIPS: Record<Severity, string> = {
  critical: "Severe privacy failure - immediate action recommended",
  high: "Significant privacy concern - should be addressed",
  medium: "Notable privacy issue - worth improving",
  low: "Minor privacy signal - low risk but worth noting",
  good: "Positive privacy property - helps protect your privacy",
};

export const ADVERSARY_DESCRIPTIONS: Record<AdversaryTier, string> = {
  passive_observer: "anyone reading the public blockchain",
  kyc_exchange: "exchanges or services with identity data",
  state_adversary: "intelligence-grade chain analysis",
};

export const TEMPORALITY_DESCRIPTIONS: Record<TemporalityClass, string> = {
  historical: "This is already on-chain and cannot be undone.",
  ongoing_pattern: "This is a behavioral pattern that can be changed going forward.",
  active_risk: "This involves unspent funds and can be addressed right now.",
};

export const CONFIDENCE_DESCRIPTIONS: Record<ConfidenceLevel, string> = {
  deterministic: "This finding is mathematically certain from the transaction structure.",
  high: "Strong on-chain evidence supports this finding.",
  medium: "This pattern is suggestive but could have other explanations.",
  low: "Weak signal that could easily be coincidence.",
};

/** Human-readable labels for change detection sub-heuristic signal keys. */
export const CHANGE_SIGNAL_LABELS: Record<string, { i18nKey: string; defaultLabel: string }> = {
  address_type:      { i18nKey: "signal.addressType",      defaultLabel: "Address type mismatch" },
  round_amount:      { i18nKey: "signal.roundAmount",      defaultLabel: "Round BTC amount" },
  round_usd_amount:  { i18nKey: "signal.roundUsd",         defaultLabel: "Round USD amount" },
  round_eur_amount:  { i18nKey: "signal.roundEur",         defaultLabel: "Round EUR amount" },
  value_disparity:   { i18nKey: "signal.valueDisparity",   defaultLabel: "Large value disparity" },
  unnecessary_input: { i18nKey: "signal.unnecessaryInput", defaultLabel: "Unnecessary input" },
  optimal_change:    { i18nKey: "signal.optimalChange",    defaultLabel: "Optimal change position" },
  shadow_change:     { i18nKey: "signal.shadowChange",     defaultLabel: "Shadow change (tiny remainder)" },
  fresh_address:     { i18nKey: "signal.freshAddress",     defaultLabel: "Fresh vs. heavily reused address" },
};
