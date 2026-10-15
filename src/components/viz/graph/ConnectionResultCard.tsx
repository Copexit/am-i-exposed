"use client";

import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { probColor } from "../shared/linkabilityColors";
import type { ConnectionPath } from "@/lib/graph/connection-search";
import type { PathScore } from "@/lib/graph/path-scoring";

export type AddResult = { added: number; skipped: number };

interface ConnectionResultCardProps {
  path: ConnectionPath;
  score: PathScore;
  onAdd: (path: ConnectionPath) => Promise<AddResult>;
}

/** Arrow between hops i and i+1, pointing the way the coins moved; diagonal next to a bend. */
function arrow(path: ConnectionPath, i: number): string {
  const { kind, pivot } = path;
  if (pivot === undefined) return "→";
  // shared-ancestor: coins flow away from the pivot; shared-descendant: toward it
  const towardRight = kind === "shared-ancestor" ? i >= pivot : i < pivot;
  if (i === pivot - 1) return kind === "shared-ancestor" ? "↙" : "↘";
  if (i === pivot) return kind === "shared-ancestor" ? "↘" : "↙";
  return towardRight ? "→" : "←";
}

const pct = (p: number) => `${p >= 0.995 ? 100 : p < 0.01 && p > 0 ? "<1" : Math.round(p * 100)}%`;

export function ConnectionResultCard({ path, score, onAdd }: ConnectionResultCardProps) {
  const { t } = useTranslation();
  const [added, setAdded] = useState<AddResult | null>(null);
  const [adding, setAdding] = useState(false);
  const byTxid = new Map(score.hops.map((h) => [h.txid, h]));
  const links = path.hops.length - 1;
  // Bent paths: the pivot sits a row above (common ancestor) or below (common descendant) the rest
  const bend = path.pivot === undefined ? 0 : path.kind === "shared-ancestor" ? -1 : 1;

  const tierLabel = {
    deterministic: t("graph.connection.tierDeterministic", { defaultValue: "Deterministic" }),
    likely: t("graph.connection.tierLikely", { defaultValue: "Likely" }),
    weak: t("graph.connection.tierWeak", { defaultValue: "Weak" }),
    ambiguous: t("graph.connection.tierAmbiguous", { defaultValue: "Ambiguous" }),
  }[score.tier];

  const handleAdd = async () => {
    setAdding(true);
    try {
      setAdded(await onAdd(path));
    } finally {
      setAdding(false);
    }
  };

  return (
    <li className="rounded-lg border border-card-border bg-surface-inset p-2.5 space-y-2" data-testid="connection-card">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-foreground font-medium">
          {t("graph.connection.links", { count: links, defaultValue: "{{count}} hop" })}
        </span>
        <span className="inline-flex items-center gap-1 text-muted">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: probColor(score.compound) }} aria-hidden />
          {tierLabel}
          <span className="font-mono tabular-nums text-foreground">{pct(score.compound)}</span>
        </span>
      </div>

      <ol
        className={`flex flex-wrap items-center gap-x-1 gap-y-3 ${bend ? "py-2" : ""}`}
        aria-label={t("graph.connection.hopStrip", { defaultValue: "Transactions on this path" })}
      >
        {path.hops.map((hop, i) => {
          const s = byTxid.get(hop.txid);
          const atPivot = i === path.pivot;
          const shift = atPivot ? (bend < 0 ? "-translate-y-2" : "translate-y-2") : "";
          return (
            <Fragment key={hop.txid}>
              {i > 0 && <li aria-hidden className="text-muted text-xs select-none">{arrow(path, i - 1)}</li>}
              <li
                className={`flex flex-col items-center ${shift}`}
                title={s ? `${hop.txid} - ${pct(s.probability)}` : hop.txid}
              >
                <span
                  className={`font-mono text-[11px] px-1.5 py-0.5 rounded border ${atPivot ? "border-dashed" : ""} text-foreground/80`}
                  style={{ borderColor: s ? probColor(s.probability) : "var(--hairline-strong)" }}
                >
                  {hop.txid.slice(0, 6)}
                </span>
                {s && <span className="font-mono text-[10px] tabular-nums text-muted">{pct(s.probability)}</span>}
              </li>
            </Fragment>
          );
        })}
      </ol>

      {(score.estimated || path.unverified) && (
        <ul className="text-[11px] text-muted space-y-0.5">
          {score.estimated && (
            <li>{t("graph.connection.estimated", { defaultValue: "Some hops are estimates: no Boltzmann matrix is computed for them." })}</li>
          )}
          {path.unverified && (
            <li className="text-severity-medium">
              {t("graph.connection.unverified", { defaultValue: "One hop was not checked for CoinJoin because the budget ran out." })}
            </li>
          )}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || (added !== null && added.skipped === 0)}
          className="text-xs px-2.5 py-1.5 min-h-8 rounded-lg border border-card-border text-muted hover:text-foreground hover:border-muted transition-colors cursor-pointer disabled:cursor-default disabled:opacity-60"
        >
          {added && added.skipped === 0
            ? t("graph.connection.added", { defaultValue: "Added" })
            : t("graph.connection.addToGraph", { defaultValue: "Add to graph" })}
        </button>
        {added && added.skipped > 0 && (
          <span className="text-[11px] text-severity-medium" role="status">
            {t("graph.connection.skipped", { count: added.skipped, defaultValue: "{{count}} transaction not added (node limit or fetch error)" })}
          </span>
        )}
      </div>
    </li>
  );
}
