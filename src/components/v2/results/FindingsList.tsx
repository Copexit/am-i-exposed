"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import type { AdversaryTier, Finding, TemporalityClass } from "@/lib/types";
import { ADVERSARY_TIERS, TEMPORALITIES, filterFindings, groupFindings } from "@/lib/view/findings";
import { Collapse } from "@/components/ui/Collapse";
import { FindingItem } from "./FindingItem";

const ADVERSARY_LABEL: Record<AdversaryTier, [string, string]> = {
  passive_observer: ["adversary.passive_observer", "Public"],
  kyc_exchange: ["adversary.kyc_exchange", "KYC"],
  state_adversary: ["adversary.state_adversary", "State"],
};
const TEMPORALITY_LABEL: Record<TemporalityClass, [string, string]> = {
  historical: ["temporality.historical", "Past"],
  ongoing_pattern: ["temporality.ongoing_pattern", "Pattern"],
  active_risk: ["temporality.active_risk", "Active"],
};

interface FindingsListProps {
  visible: Finding[];
  /** Section title override (defaults to "{{count}} findings"). */
  title?: string;
  openIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  highlightId: string | null;
  onHover: (id: string | null) => void;
  onTxClick?: (txid: string) => void;
}

function toggleIn<T>(set: ReadonlySet<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) { if (next.size > 1) next.delete(v); } else next.add(v);
  return next;
}

/**
 * L1 findings: Leaks (critical + high) open by default, Minor signals and
 * Strengths collapsed with counts. Filters narrow what is listed, never the score.
 */
export function FindingsList({ visible, title, openIds, onToggle, highlightId, onHover, onTxClick }: FindingsListProps) {
  const { t } = useTranslation();
  const [adversary, setAdversary] = useState<ReadonlySet<AdversaryTier>>(new Set(ADVERSARY_TIERS));
  const [temporality, setTemporality] = useState<ReadonlySet<TemporalityClass>>(new Set(TEMPORALITIES));
  const [showFilters, setShowFilters] = useState(false);
  // When a group above is empty, the next one starts open (classic tier rule),
  // so there is always something useful in view.
  const initial = groupFindings(visible);
  const [minorOpen, setMinorOpen] = useState(initial.leaks.length === 0);
  const [strengthsOpen, setStrengthsOpen] = useState(initial.leaks.length === 0 && initial.minor.length === 0);

  const filtering = adversary.size < ADVERSARY_TIERS.length || temporality.size < TEMPORALITIES.length;
  const groups = useMemo(
    () => groupFindings(filtering ? filterFindings(visible, { adversary, temporality }) : visible),
    [visible, filtering, adversary, temporality],
  );
  // A finding opened from elsewhere (waterfall, stage) must be visible: open its group.
  const minorForced = groups.minor.some((f) => openIds.has(f.id));
  const strengthsForced = groups.strengths.some((f) => openIds.has(f.id));

  const renderItems = (items: Finding[]) => (
    <div>
      {items.map((f) => (
        <FindingItem
          key={f.id}
          finding={f}
          open={openIds.has(f.id)}
          onToggle={onToggle}
          highlighted={highlightId === f.id}
          dimmed={highlightId !== null && highlightId !== f.id}
          onHover={onHover}
          onTxClick={onTxClick}
        />
      ))}
    </div>
  );

  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-md text-xs border transition-colors ${active ? "border-hairline-strong text-foreground bg-surface-2" : "border-hairline text-faint hover:text-muted"}`}
    >
      {label}
    </button>
  );

  const groupHeader = (label: string, count: number, open: boolean, onClick: () => void, id: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={id}
      className="w-full flex items-center justify-between py-3 text-left group"
    >
      <span className="text-sm text-muted group-hover:text-foreground transition-colors">
        {label} <span className="v2-num text-faint ml-1">{count}</span>
      </span>
      <ChevronDown size={15} className={`text-faint transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
  );

  const issues = groups.leaks.length + groups.minor.length;
  const strengthCount = groups.strengths.length;

  return (
    <section id="v2-findings" aria-labelledby="v2-findings-title" className="space-y-4" data-testid="v2-findings">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="v2-eyebrow mb-2">{t("v2.results.findingsEyebrow", { defaultValue: "Evidence" })}</p>
          <h2 id="v2-findings-title" className="text-xl font-semibold tracking-tight">
            {title ?? t("v2.results.findingsSummary", { issues, strengths: strengthCount, defaultValue: "Issues {{issues}} · Strengths {{strengths}}" })}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={`inline-flex items-center gap-2 text-xs px-3 py-2 rounded-md border transition-colors ${filtering ? "border-bitcoin/50 text-bitcoin" : "border-hairline text-muted hover:text-foreground"}`}
        >
          <SlidersHorizontal size={13} aria-hidden="true" />
          {filtering ? t("v2.results.filtersActive", { defaultValue: "Filtered" }) : t("v2.results.filters", { defaultValue: "Filter" })}
        </button>
      </header>

      <Collapse open={showFilters}>
        <div className="rounded-lg bg-surface-1 border border-hairline p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted w-24">{t("v2.results.filterWho", { defaultValue: "Who can see it" })}</span>
            {ADVERSARY_TIERS.map((a) => chip(adversary.has(a), t(ADVERSARY_LABEL[a][0], { defaultValue: ADVERSARY_LABEL[a][1] }), () => setAdversary((s) => toggleIn(s, a))))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted w-24">{t("v2.results.filterWhen", { defaultValue: "When" })}</span>
            {TEMPORALITIES.map((c) => chip(temporality.has(c), t(TEMPORALITY_LABEL[c][0], { defaultValue: TEMPORALITY_LABEL[c][1] }), () => setTemporality((s) => toggleIn(s, c))))}
          </div>
          <p className="text-xs text-faint">{t("v2.results.filterNote", { defaultValue: "Filters change what is listed. The score always includes every finding." })}</p>
        </div>
      </Collapse>

      {groups.leaks.length > 0 ? (
        <div className="rounded-xl bg-surface-1 border border-hairline px-1">
          <p className="v2-eyebrow px-4 pt-4 pb-1 text-severity-high/80">{t("v2.results.leaks", { defaultValue: "Leaks" })}</p>
          {renderItems(groups.leaks)}
        </div>
      ) : (
        <p className="text-sm text-muted">{t("v2.results.noLeaks", { defaultValue: "No critical or high severity leaks." })}</p>
      )}

      {groups.minor.length > 0 && (
        <div className="border-t border-hairline">
          {groupHeader(t("v2.results.minor", { defaultValue: "Minor signals" }), groups.minor.length, minorOpen || minorForced, () => setMinorOpen((v) => !v), "v2-findings-minor")}
          <Collapse open={minorOpen || minorForced}>
            <div id="v2-findings-minor" className="rounded-xl bg-surface-1 border border-hairline px-1 mb-2">{renderItems(groups.minor)}</div>
          </Collapse>
        </div>
      )}

      {groups.strengths.length > 0 && (
        <div className="border-t border-hairline">
          {groupHeader(t("v2.results.strengths", { defaultValue: "Privacy strengths" }), groups.strengths.length, strengthsOpen || strengthsForced, () => setStrengthsOpen((v) => !v), "v2-findings-strengths")}
          <Collapse open={strengthsOpen || strengthsForced}>
            <div id="v2-findings-strengths" className="rounded-xl bg-surface-1 border border-hairline px-1">{renderItems(groups.strengths)}</div>
          </Collapse>
        </div>
      )}
    </section>
  );
}
