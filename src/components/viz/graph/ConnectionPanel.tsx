"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Crosshair, Loader2 } from "lucide-react";
import { useNetwork } from "@/context/NetworkContext";
import { parseEndpoint, type useConnectionSearch } from "@/hooks/useConnectionSearch";
import { DEFAULT_CONNECTION_OPTIONS, type ConnectionKind, type ConnectionPath } from "@/lib/graph/connection-search";
import { scorePath } from "@/lib/graph/path-scoring";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import { CloseIcon } from "./icons";
import { ConnectionResultCard, type AddResult } from "./ConnectionResultCard";

interface ConnectionPanelProps {
  from: string;
  to: string;
  onFieldChange: (field: "from" | "to", value: string) => void;
  pickMode: boolean;
  onTogglePick: () => void;
  onClose: () => void;
  search: ReturnType<typeof useConnectionSearch>;
  boltzmannCache: ReadonlyMap<string, BoltzmannWorkerResult>;
  /** Adds paths in order and returns the totals. */
  onAddPaths: (paths: ConnectionPath[]) => Promise<AddResult>;
}

/** Tailwind's sm breakpoint: below it the panel is a bottom sheet. */
export const SM_BREAKPOINT = 640;
/** Canvas width the desktop panel covers (w-80 plus its right-2 offset and a gap). */
export const CONNECTION_PANEL_INSET = 336;

/** Budget fields: [default, min, max]. */
const BOUNDS = {
  maxHops: [DEFAULT_CONNECTION_OPTIONS.maxHops, 1, 8],
  maxTxs: [DEFAULT_CONNECTION_OPTIONS.maxTxs, 20, 600],
  seconds: [DEFAULT_CONNECTION_OPTIONS.timeoutMs / 1000, 10, 120],
} as const;
type BudgetKey = keyof typeof BOUNDS;
type Budget = Record<BudgetKey, number>;

const clamp = (k: BudgetKey, v: number) => Math.min(BOUNDS[k][2], Math.max(BOUNDS[k][1], Math.round(v) || BOUNDS[k][0]));

const KIND_ORDER: ConnectionKind[] = ["direct", "a-funds-b", "b-funds-a", "shared-ancestor", "shared-descendant"];

const inputClass = "w-full min-w-0 h-9 px-2 rounded-lg border border-card-border bg-surface-inset text-xs font-mono text-foreground placeholder:text-muted/60 outline-none focus:border-bitcoin/60";
const btnClass = "text-xs px-3 py-1.5 min-h-9 rounded-lg border transition-colors cursor-pointer";

export function ConnectionPanel(props: ConnectionPanelProps) {
  const { from, to, onFieldChange, pickMode, onTogglePick, onClose, search, boltzmannCache, onAddPaths } = props;
  const { t } = useTranslation();
  const { network } = useNetwork();
  const [budget, setBudget] = useState<Budget>({ maxHops: BOUNDS.maxHops[0], maxTxs: BOUNDS.maxTxs[0], seconds: BOUNDS.seconds[0] });
  const [stopAtCoinJoins, setStopAtCoinJoins] = useState(true);
  const [errors, setErrors] = useState<{ from?: string; to?: string }>({});
  const running = search.status === "running";
  const [addAllResult, setAddAllResult] = useState<AddResult | null>(null);

  // Focus moves into the panel on open (the panel itself, so a phone keyboard does not pop up)
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => sectionRef.current?.focus(), []);

  const invalid = t("graph.connection.invalidInput", { defaultValue: "Enter a txid or an address for this network." });

  const run = (b: Budget) => {
    const a = parseEndpoint(from, network);
    const z = parseEndpoint(to, network);
    const same = a && z && a.value === z.value;
    setErrors({
      from: a ? undefined : invalid,
      to: !z ? invalid : same ? t("graph.connection.sameEndpoints", { defaultValue: "From and To are the same." }) : undefined,
    });
    if (!a || !z || same) return;
    setBudget(b);
    setAddAllResult(null);
    void search.start(a, z, {
      ...DEFAULT_CONNECTION_OPTIONS,
      maxHops: b.maxHops,
      maxTxs: b.maxTxs,
      timeoutMs: b.seconds * 1000,
      stopAtCoinJoins,
    });
  };

  const deeper = () => run({
    maxHops: clamp("maxHops", budget.maxHops * 2),
    maxTxs: clamp("maxTxs", budget.maxTxs * 2),
    seconds: clamp("seconds", budget.seconds * 2),
  });

  // Grouped by kind, shortest first within each (pruning can emit out of order)
  const groups = useMemo(() => KIND_ORDER.map((kind) => ({
    kind,
    items: search.results
      .filter((p) => p.kind === kind)
      .sort((x, y) => x.hops.length - y.hops.length)
      .map((path) => ({ path, score: scorePath(path, search.txs, boltzmannCache) })),
  })).filter((g) => g.items.length > 0), [search.results, search.txs, boltzmannCache]);

  const addAll = async () => {
    setAddAllResult(await onAddPaths(groups.flatMap((g) => g.items.map((i) => i.path))));
  };
  const addOne = (path: ConnectionPath) => onAddPaths([path]);

  const kindLabel: Record<ConnectionKind, string> = {
    "direct": t("graph.connection.kindDirect", { defaultValue: "Direct spend" }),
    "a-funds-b": t("graph.connection.kindAFundsB", { defaultValue: "From funds To" }),
    "b-funds-a": t("graph.connection.kindBFundsA", { defaultValue: "To funds From" }),
    "shared-ancestor": t("graph.connection.kindSharedAncestor", { defaultValue: "Common source" }),
    "shared-descendant": t("graph.connection.kindSharedDescendant", { defaultValue: "Spent together later" }),
  };

  const summary = search.summary;
  const stopReason = summary && {
    done: t("graph.connection.stopDone", { defaultValue: "Every branch was followed to its end." }),
    hops: t("graph.connection.stopHops", { count: budget.maxHops, defaultValue: "Stopped at {{count}} hop per side." }),
    budget: t("graph.connection.stopBudget", { count: budget.maxTxs, defaultValue: "Stopped at the budget of {{count}} transaction." }),
    time: t("graph.connection.stopTime", { count: budget.seconds, defaultValue: "Stopped at the time limit of {{count}} second." }),
    aborted: t("graph.connection.stopAborted", { defaultValue: "Search cancelled." }),
  }[summary.stoppedBy];
  const canGoDeeper = !!summary && (summary.stoppedBy === "hops" || summary.stoppedBy === "budget" || summary.stoppedBy === "time")
    && (budget.maxHops < BOUNDS.maxHops[2] || budget.maxTxs < BOUNDS.maxTxs[2] || budget.seconds < BOUNDS.seconds[2]);

  const field = (key: "from" | "to", label: string) => (
    <div className="space-y-1">
      <label htmlFor={`connection-${key}`} className="text-xs text-muted">{label}</label>
      <div className="flex gap-1.5">
        <input
          id={`connection-${key}`}
          value={key === "from" ? from : to}
          onChange={(e) => onFieldChange(key, e.target.value)}
          placeholder={t("graph.connection.placeholder", { defaultValue: "txid or address" })}
          aria-invalid={!!errors[key]}
          aria-describedby={errors[key] ? `connection-${key}-error` : undefined}
          className={inputClass}
          spellCheck={false}
          autoComplete="off"
          disabled={running}
        />
        {key === "to" && (
          <button
            type="button"
            onClick={onTogglePick}
            aria-pressed={pickMode}
            disabled={running}
            className={`${btnClass} shrink-0 px-2 ${pickMode ? "text-bitcoin border-bitcoin/40 bg-bitcoin/10" : "text-muted hover:text-foreground border-card-border"}`}
            title={t("graph.connection.pick", { defaultValue: "Pick a node in the graph" })}
            aria-label={t("graph.connection.pick", { defaultValue: "Pick a node in the graph" })}
          >
            <Crosshair size={14} />
          </button>
        )}
      </div>
      {errors[key] && <p id={`connection-${key}-error`} className="text-[11px] text-severity-critical">{errors[key]}</p>}
    </div>
  );

  const budgetField = (key: BudgetKey, label: string) => (
    <label className="flex items-center justify-between gap-2 text-xs text-muted">
      <span>{label}</span>
      <input
        type="number"
        min={BOUNDS[key][1]}
        max={BOUNDS[key][2]}
        value={budget[key]}
        onChange={(e) => setBudget((b) => ({ ...b, [key]: Number(e.target.value) }))}
        onBlur={() => setBudget((b) => ({ ...b, [key]: clamp(key, b[key]) }))}
        disabled={running}
        className="w-20 h-8 px-2 rounded-lg border border-card-border bg-surface-inset text-xs font-mono tabular-nums text-foreground outline-none focus:border-bitcoin/60"
      />
    </label>
  );

  return (
    <section
      aria-label={t("graph.connection.title", { defaultValue: "Find connection" })}
      data-testid="connection-panel"
      ref={sectionRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (pickMode) onTogglePick(); else onClose();
      }}
      className="outline-none absolute z-30 inset-x-0 bottom-0 max-h-[75%] rounded-t-xl sm:inset-x-auto sm:right-2 sm:top-2 sm:bottom-2 sm:w-80 sm:max-h-none sm:rounded-xl border border-card-border bg-card-bg/95 backdrop-blur-xl shadow-(--shadow-pop) flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border shrink-0">
        <h2 className="text-sm font-medium text-foreground">{t("graph.connection.title", { defaultValue: "Find connection" })}</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-foreground transition-colors p-1.5 cursor-pointer"
          aria-label={t("common.close", { defaultValue: "Close" })}
        >
          <CloseIcon size={14} />
        </button>
      </div>

      {/* Phone: in pick mode the sheet shrinks to this row so the graph can be tapped */}
      {pickMode && (
        <div className="sm:hidden flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-bitcoin" role="status">
          <span>{t("graph.connection.pickHintTouch", { defaultValue: "Tap a node in the graph to use it as To." })}</span>
          <button type="button" onClick={onTogglePick} className={`${btnClass} shrink-0 text-muted hover:text-foreground border-card-border`}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </button>
        </div>
      )}

      <div className={`flex-1 min-h-0 overflow-y-auto p-3 space-y-3 ${pickMode ? "max-sm:hidden" : ""}`}>
        <form
          className="space-y-2.5"
          onSubmit={(e) => { e.preventDefault(); if (!running) run(budget); }}
        >
          {field("from", t("graph.connection.from", { defaultValue: "From" }))}
          {field("to", t("graph.connection.to", { defaultValue: "To" }))}
          {pickMode && (
            <p className="text-[11px] text-bitcoin" role="status">
              {t("graph.connection.pickHint", { defaultValue: "Click a node in the graph to use it as To. Esc cancels." })}
            </p>
          )}

          <details className="text-xs">
            <summary className="cursor-pointer text-muted hover:text-foreground select-none py-1">
              {t("graph.connection.budgets", { defaultValue: "Budgets" })}
            </summary>
            <div className="space-y-2 pt-2">
              {budgetField("maxHops", t("graph.connection.maxHops", { defaultValue: "Max hops per side" }))}
              {budgetField("maxTxs", t("graph.connection.maxTxs", { defaultValue: "Max transactions fetched" }))}
              {budgetField("seconds", t("graph.connection.seconds", { defaultValue: "Time limit (seconds)" }))}
              <label className="flex items-center gap-2 text-muted">
                <input type="checkbox" checked={stopAtCoinJoins} onChange={(e) => setStopAtCoinJoins(e.target.checked)} disabled={running} className="accent-bitcoin" />
                {t("graph.connection.stopAtCoinJoins", { defaultValue: "Stop at CoinJoins" })}
              </label>
              <p className="text-[11px] text-muted/80">
                {t("graph.connection.requestHint", { defaultValue: "Each fetched transaction is a request to the configured backend. The public mempool.space is rate limited, so the defaults are modest." })}
              </p>
            </div>
          </details>

          {running ? (
            <button type="button" onClick={search.cancel} className={`${btnClass} w-full text-foreground border-card-border hover:border-muted`}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
          ) : (
            <button type="submit" className={`${btnClass} w-full font-medium bg-bitcoin text-black border-bitcoin hover:bg-bitcoin-hover`}>
              {t("graph.connection.start", { defaultValue: "Find connection" })}
            </button>
          )}
        </form>

        {running && (
          <div className="flex items-start gap-2 text-[11px] text-muted" role="status" data-testid="connection-progress">
            <Loader2 size={12} className="text-bitcoin animate-spin shrink-0 mt-0.5" />
            <span className="font-mono tabular-nums">
              {t("graph.connection.progress", {
                fetched: search.progress?.txsFetched ?? 0,
                max: budget.maxTxs,
                hopsA: search.progress?.depthA ?? 0,
                hopsB: search.progress?.depthB ?? 0,
                seconds: Math.floor((search.progress?.elapsedMs ?? 0) / 1000),
                defaultValue: "{{fetched}}/{{max}} transactions, hops {{hopsA}} + {{hopsB}}, {{seconds}} s",
              })}
            </span>
          </div>
        )}

        {search.resolveError && (
          <p className="text-[11px] text-severity-medium" role="status">
            {search.resolveError === "failed"
              ? t("graph.connection.resolveFailed", { defaultValue: "The address history could not be loaded." })
              : t("graph.connection.resolveEmpty", { defaultValue: "The address has no transactions." })}
          </p>
        )}

        {search.addressFallback && (
          <p className="text-[11px] text-severity-medium" role="status">
            {t("graph.connection.addressFallback", { defaultValue: "The address history could not be loaded from this server, so only transactions that pay or spend the address along the way were matched." })}
          </p>
        )}

        {summary && (
          <div className="space-y-1 text-[11px] text-muted" role="status" data-testid="connection-summary">
            {groups.length === 0 && summary.stoppedBy !== "aborted" && (
              <p className="text-foreground text-xs">
                {t("graph.connection.noPath", { count: budget.maxHops, defaultValue: "No path found within {{count}} hop per side." })}
              </p>
            )}
            <p>
              {stopReason}{" "}
              {t("graph.connection.fetched", { count: summary.txsFetched, defaultValue: "{{count}} transaction fetched." })}
            </p>
            {summary.coinJoinStops > 0 && (
              <p>{t("graph.connection.coinJoinStops", { count: summary.coinJoinStops, defaultValue: "{{count}} CoinJoin was not followed through." })}</p>
            )}
            {summary.branchLimited > 0 && (
              <p>{t("graph.connection.branchLimited", { count: summary.branchLimited, defaultValue: "{{count}} transaction was too wide to expand." })}</p>
            )}
            {summary.fetchErrors > 0 && (
              <p className="text-severity-medium">
                {t("graph.connection.fetchErrors", { count: summary.fetchErrors, defaultValue: "{{count}} request failed, so the results may be incomplete." })}
              </p>
            )}
            {canGoDeeper && (
              <button type="button" onClick={deeper} className={`${btnClass} mt-1 text-muted hover:text-foreground border-card-border`}>
                {t("graph.connection.deeper", { defaultValue: "Search deeper" })}
              </button>
            )}
          </div>
        )}

        {groups.length > 0 && (
          <div className="space-y-3">
            {!running && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void addAll()} className={`${btnClass} text-muted hover:text-foreground border-card-border`}>
                  {t("graph.connection.addAll", { defaultValue: "Add all to graph" })}
                </button>
                {addAllResult && (
                  <span className="text-[11px] text-muted" role="status">
                    {t("graph.connection.addedCount", { count: addAllResult.added, defaultValue: "{{count}} transaction added." })}
                    {addAllResult.skipped > 0 && (
                      <span className="text-severity-medium">
                        {" "}{t("graph.connection.skipped", { count: addAllResult.skipped, defaultValue: "{{count}} transaction not added (node limit or fetch error)" })}
                      </span>
                    )}
                  </span>
                )}
              </div>
            )}
            {groups.map((g) => (
              <div key={g.kind} className="space-y-1.5">
                <h3 className="text-xs font-medium text-muted">{kindLabel[g.kind]}</h3>
                <ul className="space-y-2">
                  {g.items.map(({ path, score }) => (
                    <ConnectionResultCard key={path.hops.map((h) => h.txid).join()} path={path} score={score} onAdd={addOne} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
