"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown } from "lucide-react";
import { probColor } from "@/components/viz/shared/linkabilityColors";
import type { BoltzmannLookup } from "@/components/viz/buildFlowGraph";
import type { MempoolTransaction } from "@/lib/api/types";
import type { Severity } from "@/lib/types";
import { layoutFlow, curve, type StageRow as Row, type StageSide, type Port } from "./stage-layout";
import { bestLinkProb, type TxReadings } from "./analyst";
import { StageRow } from "./StageRow";
import { useStage } from "./StageContext";

export interface StageDiagramProps {
  tx: MempoolTransaction;
  inRows: Row[];
  outRows: Row[];
  stacked: boolean;
  usdPrice?: number | null;
  /** Real Boltzmann link probabilities, when computed. */
  lookup: BoltzmannLookup | null;
  /** Linkability mode: draw links by probability instead of value ribbons. */
  linkMode: boolean;
  /** Analyst view readings, or null when the view is off. */
  readings: TxReadings | null;
  onAddressClick?: (address: string) => void;
  onShowMore: (side: StageSide) => void;
}

const SEV_RANK: Severity[] = ["critical", "high", "medium", "low", "good"];
/** Above this many input x output pairs, only the active row's links are drawn. */
const MAX_LINKS = 2500;

/** Flow color of a row: its most severe finding-backed tag, green for anon sets, neutral otherwise. */
function rowTone(row: Row): { color: string; toned: boolean } {
  if (row.kind === "more") return { color: "var(--muted)", toned: false };
  const sev = SEV_RANK.find((s) => row.tags.some((t) => t.source.kind === "finding" && t.severity === s));
  if (sev && sev !== "good") return { color: `var(--severity-${sev})`, toned: true };
  if (row.kind === "tier" || row.tags.some((t) => t.kind === "anon-set") || sev === "good") return { color: "var(--severity-good)", toned: true };
  return { color: "var(--muted)", toned: false };
}

const gradId = (side: StageSide, color: string) => `stg-${side}-${color.replace(/[^a-z]/gi, "")}`;

function usePorts(ref: React.RefObject<HTMLDivElement | null>, midRef: React.RefObject<HTMLDivElement | null>, enabled: boolean, deps: unknown) {
  const [state, setState] = useState<{ ports: Map<string, number>; width: number; height: number }>({ ports: new Map(), width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const ports = new Map<string, number>();
      el.querySelectorAll<HTMLElement>("[data-port]").forEach((n) => {
        const r = n.getBoundingClientRect();
        ports.set(n.dataset.port!, r.top - box.top + r.height / 2);
      });
      setState({ ports, width: midRef.current?.getBoundingClientRect().width ?? 0, height: box.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => ro.disconnect();
  }, [ref, midRef, enabled, deps]);
  return state;
}

export function StageDiagram({ tx, inRows, outRows, stacked, usdPrice, lookup, linkMode, readings, onAddressClick, onShowMore }: StageDiagramProps) {
  const { t } = useTranslation();
  const { highlightFindingId, onFindingClick, isRevealed } = useStage();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const { ports, width, height } = usePorts(gridRef, midRef, !stacked, `${inRows.length}:${outRows.length}:${!!readings}:${linkMode}`);

  const all = useMemo(() => [...inRows, ...outRows], [inRows, outRows]);
  const active = all.find((r) => r.key === activeKey) ?? null;
  const hotKeys = useMemo(() => new Set(highlightFindingId
    ? all.filter((r) => r.kind !== "more" && r.tags.some((t) => t.source.kind === "finding" && t.source.findingId === highlightFindingId)).map((r) => r.key)
    : []), [all, highlightFindingId]);
  const onActivate = useCallback((key: string | null) => setActiveKey(key), []);

  const probOf = (row: Row): number | null => {
    if (!lookup || !linkMode || !active || active.kind !== "io" || row.kind !== "io" || active.side === row.side) return null;
    return active.side === "input" ? lookup.getProb(active.io.index, row.io.index) : lookup.getProb(row.io.index, active.io.index);
  };
  const sums = { input: inRows.reduce((s, r) => s + r.value, 0), output: outRows.reduce((s, r) => s + r.value, 0) };

  const flow = useMemo(() => {
    if (stacked || linkMode || width <= 0) return null;
    const toPorts = (rows: Row[]): Port[] => rows.flatMap((r) => (ports.has(r.key) ? [{ key: r.key, y: ports.get(r.key)!, value: r.value }] : []));
    return layoutFlow(toPorts(inRows), toPorts(outRows), { width, maxBand: 36, maxJunction: Math.min(280, height * 0.6) });
  }, [stacked, linkMode, width, height, ports, inRows, outRows]);
  const portWidths = useMemo(() => new Map(flow?.ribbons.map((r) => [r.key, r.width]) ?? []), [flow]);
  const tones = useMemo(() => new Map(all.map((r) => [r.key, rowTone(r)])), [all]);

  const links = useMemo(() => {
    if (stacked || !lookup || !linkMode || width <= 0) return [];
    const ins = inRows.filter((r) => r.kind === "io" && ports.has(r.key));
    const outs = outRows.filter((r) => r.kind === "io" && ports.has(r.key));
    const drawAll = ins.length * outs.length <= MAX_LINKS;
    const out: { key: string; d: string; p: number; unreliable: boolean; ends: [string, string] }[] = [];
    for (const a of ins) for (const b of outs) {
      if (a.kind !== "io" || b.kind !== "io") continue;
      if (!drawAll && activeKey !== a.key && activeKey !== b.key) continue;
      const p = lookup.getProb(a.io.index, b.io.index);
      if (p <= 0) continue;
      out.push({ key: `${a.key}>${b.key}`, d: curve(0, ports.get(a.key)!, width, ports.get(b.key)!), p, unreliable: lookup.timedOut && p < 1, ends: [a.key, b.key] });
    }
    return out;
  }, [stacked, lookup, linkMode, width, ports, inRows, outRows, activeKey]);

  const renderRow = (row: Row) => {
    const outIdx = row.kind === "io" ? [row.io.index] : row.kind === "tier" ? row.members.map((m) => m.index) : [];
    const reading = readings && row.side === "output" && outIdx.length ? readings.outputs.get(outIdx[0]!) ?? null : null;
    const best = lookup && reading?.kind === "blinded"
      ? Math.max(...outIdx.map((o) => bestLinkProb(lookup.getProb, tx.vin.length, o)))
      : null;
    const prob = probOf(row);
    return (
      <StageRow
        key={row.key}
        row={row}
        tx={tx}
        usdPrice={usdPrice}
        stacked={stacked}
        active={row.key === activeKey || hotKeys.has(row.key)}
        dimmed={prob !== null && prob <= 0}
        linkProb={prob}
        reading={reading}
        bestProb={best}
        share={sums[row.side] > 0 ? row.value / sums[row.side] : 0}
        tone={tones.get(row.key)!.color}
        portWidth={linkMode ? 2 : portWidths.get(row.key)}
        onActivate={onActivate}
        onAddressClick={onAddressClick}
        onShowMore={onShowMore}
      />
    );
  };

  const cluster = readings?.cluster && isRevealed(readings.cluster.findingId) ? readings.cluster : null;
  const inputsCol = (
    <div className={`relative flex flex-col gap-1 min-w-0 ${cluster ? "rounded-xl border border-dashed border-bitcoin/45 p-1 pt-7" : ""}`}>
      {cluster && (
        <button
          type="button"
          onClick={() => onFindingClick?.(cluster.findingId)}
          className="absolute top-1.5 left-3 text-[11px] text-bitcoin hover:underline cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-bitcoin"
        >
          {t("v2.stage.analyst.cluster", { n: cluster.inputCount, defaultValue: "Read as one owner: {{n}} inputs (common input ownership)" })}
        </button>
      )}
      {inRows.map(renderRow)}
    </div>
  );
  const outputsCol = <div className="flex flex-col gap-1 min-w-0">{outRows.map(renderRow)}</div>;
  const eyebrow = (side: StageSide) => side === "input"
    ? t("v2.stage.inputs", { n: tx.vin.length, defaultValue: "Inputs · {{n}}" })
    : t("v2.stage.outputs", { n: tx.vout.length, defaultValue: "Outputs · {{n}}" });

  if (stacked) {
    return (
      <div className="flex flex-col gap-2">
        <p className="v2-eyebrow px-3">{eyebrow("input")}</p>
        {inputsCol}
        <div aria-hidden="true" className="flex items-center gap-2 px-3 py-1 text-muted">
          <ArrowDown size={14} />
          <span className="flex-1 h-px bg-hairline" />
        </div>
        <p className="v2-eyebrow px-3">{eyebrow("output")}</p>
        {outputsCol}
      </div>
    );
  }

  const dimAll = activeKey !== null || hotKeys.size > 0;
  const gradients = [...new Set([...tones.values()].map((x) => x.color))]
    .flatMap((color) => (["input", "output"] as const).map((side) => [gradId(side, color), color, side] as const));
  const isLit = (key: string) => key === activeKey || hotKeys.has(key);
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(72px,24%)_minmax(0,1fr)] mb-2">
        <p className="v2-eyebrow px-3">{eyebrow("input")}</p>
        <span />
        <p className="v2-eyebrow px-3">{eyebrow("output")}</p>
      </div>
      {/* Long lists align to the top so the first rows of both sides stay in view. */}
      <div ref={gridRef} className={`grid grid-cols-[minmax(0,1fr)_minmax(72px,24%)_minmax(0,1fr)] ${Math.max(inRows.length, outRows.length) > 14 ? "items-start" : "items-center"}`}>
        {inputsCol}
        <div ref={midRef} className="self-stretch relative">
          {width > 0 && (
            <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden="true">
              {flow && (
                <>
                  <defs>
                    {gradients.map(([id, color, side]) => (
                      <linearGradient key={id} id={id}>
                        <stop offset="0%" stopColor={side === "input" ? "var(--muted)" : color} stopOpacity={side === "input" ? 0.35 : 0.45} />
                        <stop offset="100%" stopColor={color} stopOpacity={side === "input" ? 0.7 : 1} />
                      </linearGradient>
                    ))}
                  </defs>
                  {flow.ribbons.map((r) => {
                    const tone = tones.get(r.key)!;
                    const op = dimAll ? (isLit(r.key) ? 0.85 : 0.1) : tone.toned ? 0.5 : 0.32;
                    return (
                      <path
                        key={r.key}
                        d={r.d}
                        fill={`url(#${gradId(r.side, tone.color)})`}
                        style={{ fillOpacity: op, transition: "fill-opacity 150ms ease-out" }}
                      />
                    );
                  })}
                  <rect x={flow.junction.x - 2} y={flow.junction.y0 - 2} width={4} height={Math.max(4, flow.junction.y1 - flow.junction.y0 + 4)} rx={2} style={{ fill: "var(--foreground)", fillOpacity: 0.6 }} />
                </>
              )}
              {links.map((l) => {
                const lit = activeKey === null || l.ends.includes(activeKey);
                return (
                  <path
                    key={l.key}
                    d={l.d}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={l.unreliable ? "3 4" : undefined}
                    style={{
                      stroke: l.unreliable ? "var(--hairline-strong)" : probColor(l.p),
                      strokeWidth: 1 + l.p * 3,
                      strokeOpacity: lit ? 0.35 + l.p * 0.6 : 0.06,
                      transition: "stroke-opacity 150ms ease-out",
                    }}
                  />
                );
              })}
            </svg>
          )}
        </div>
        {outputsCol}
      </div>
    </div>
  );
}
