"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Finding } from "@/lib/types";
import { visibleFindings, isStatusFinding } from "@/lib/view/findings";
import { findingKeys } from "@/lib/finding-utils";
import { FindingsList } from "@/components/v2/results/FindingsList";

/**
 * The v2 findings list for flows without a transaction view model (wallet
 * audit, destination check): same groups, filters and detail as tx results.
 */
export function V2FindingGroups({ findings, onTxClick }: {
  findings: readonly Finding[];
  onTxClick?: (txid: string) => void;
}) {
  const { t } = useTranslation();
  const visible = useMemo(() => visibleFindings(findings), [findings]);
  const status = useMemo(() => findings.filter(isStatusFinding), [findings]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const notices = status.length > 0 && (
    <div className="rounded-lg border border-severity-medium/25 bg-severity-medium/5 px-4 py-3 space-y-2" data-testid="v2-analysis-notices">
      {status.map((f) => (
        <div key={f.id}>
          <p className="text-sm text-severity-medium">{t(findingKeys(f.id, "title", f.params), { ...f.params, defaultValue: f.title })}</p>
          <p className="text-xs text-muted">{t(findingKeys(f.id, "description", f.params), { ...f.params, defaultValue: f.description })}</p>
        </div>
      ))}
    </div>
  );

  if (visible.length === 0) {
    return (
      <div className="space-y-4">
        {notices}
        <p className="text-sm text-muted">
          {t("v2.flows.noFindings", { defaultValue: "No findings were produced for this scan." })}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {notices}
      <FindingsList
      visible={visible}
      openIds={openIds}
      onToggle={toggle}
      highlightId={hoverId}
      onHover={setHoverId}
      onTxClick={onTxClick}
      />
    </div>
  );
}
