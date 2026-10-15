"use client";

import { useTranslation } from "react-i18next";
import { CloseIcon } from "./icons";
import type { NodeFilter } from "./types";

interface FilterChipsProps {
  filter: NodeFilter;
  onToggleFilter: (key: keyof NodeFilter) => void;
  hiddenCount: number;
  onShowHidden: () => void;
  isolate: { count: number; hops: 1 | 2 } | null;
  onClearIsolate: () => void;
}

/** One removable chip per active view constraint; nothing when none is active. */
export function FilterChips({ filter, onToggleFilter, hiddenCount, onShowHidden, isolate, onClearIsolate }: FilterChipsProps) {
  const { t } = useTranslation();
  const chips: { id: string; label: string; onRemove: () => void }[] = [];
  if (!filter.showCoinJoin) chips.push({ id: "coinjoin", label: t("graph.chips.coinJoinHidden", { defaultValue: "CoinJoins hidden" }), onRemove: () => onToggleFilter("showCoinJoin") });
  if (!filter.showEntity) chips.push({ id: "entity", label: t("graph.chips.entityHidden", { defaultValue: "Entities hidden" }), onRemove: () => onToggleFilter("showEntity") });
  if (!filter.showStandard) chips.push({ id: "standard", label: t("graph.chips.standardHidden", { defaultValue: "Standard txs hidden" }), onRemove: () => onToggleFilter("showStandard") });
  if (hiddenCount > 0) chips.push({ id: "hidden", label: t("graph.chips.hidden", { count: hiddenCount, defaultValue: "{{count}} hidden" }), onRemove: onShowHidden });
  if (isolate) {
    chips.push({
      id: "isolate",
      label: isolate.hops === 1
        ? t("graph.chips.isolated1", { count: isolate.count, defaultValue: "Isolated: 1 hop around {{count}} nodes" })
        : t("graph.chips.isolated2", { count: isolate.count, defaultValue: "Isolated: 2 hops around {{count}} nodes" }),
      onRemove: onClearIsolate,
    });
  }
  if (chips.length === 0) return null;

  return (
    <ul aria-label={t("graph.chips.title", { defaultValue: "Active view filters" })} className="flex flex-wrap items-center gap-1.5" data-testid="graph-filter-chips">
      {chips.map((c) => (
        <li key={c.id} className="inline-flex items-center gap-1 pl-2.5 rounded-full border border-hairline-strong bg-surface-2 text-xs text-foreground">
          <span>{c.label}</span>
          <button
            type="button"
            onClick={c.onRemove}
            aria-label={t("graph.chips.remove", { name: c.label, defaultValue: "Clear filter: {{name}}" })}
            className="inline-flex items-center justify-center min-h-8 min-w-8 rounded-full text-muted hover:text-foreground cursor-pointer"
          >
            <CloseIcon size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}
