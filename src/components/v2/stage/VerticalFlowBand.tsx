"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { probColor } from "@/components/viz/shared/linkabilityColors";
import type { BoltzmannLookup } from "@/components/viz/buildFlowGraph";
import { layoutVerticalFlow, type StageRow as Row } from "./stage-layout";

const H = 132;
const BAR = 5;

interface VerticalFlowBandProps {
  inRows: Row[];
  outRows: Row[];
  tones: Map<string, { color: string; toned: boolean }>;
  /** Linkability mode with real Boltzmann probabilities. */
  lookup: BoltzmannLookup | null;
  linkMode: boolean;
  activeKey: string | null;
  hotKeys: ReadonlySet<string>;
  onActivate: (key: string | null) => void;
}

/**
 * The transaction flow for narrow screens, rotated 90 degrees: input segments
 * on a top bar, output segments on a bottom bar (list order, sized by value),
 * value ribbons meeting in the middle, or Boltzmann links in linkability mode.
 * Tapping a segment highlights its row and flow.
 */
export function VerticalFlowBand({ inRows, outRows, tones, lookup, linkMode, activeKey, hotKeys, onActivate }: VerticalFlowBandProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const flow = useMemo(
    () => (width > 0 ? layoutVerticalFlow(inRows.map((r) => ({ key: r.key, value: r.value })), outRows.map((r) => ({ key: r.key, value: r.value })), { width, height: H - BAR * 2 }) : null),
    [width, inRows, outRows],
  );
  const bars = useMemo(() => new Map(flow?.ribbons.map((r) => [r.key, r.bar]) ?? []), [flow]);

  const links = useMemo(() => {
    if (!flow || !lookup || !linkMode) return [];
    const out: { key: string; d: string; p: number; ends: [string, string] }[] = [];
    for (const a of inRows) for (const b of outRows) {
      if (a.kind !== "io" || b.kind !== "io") continue;
      if (activeKey && activeKey !== a.key && activeKey !== b.key) continue;
      const p = lookup.getProb(a.io.index, b.io.index);
      const ba = bars.get(a.key), bb = bars.get(b.key);
      if (p <= 0 || !ba || !bb) continue;
      const x0 = (ba[0] + ba[1]) / 2, x1 = (bb[0] + bb[1]) / 2, h = H - BAR * 2;
      out.push({ key: `${a.key}>${b.key}`, d: `M${x0} 0 C${x0} ${h * 0.5}, ${x1} ${h * 0.5}, ${x1} ${h}`, p, ends: [a.key, b.key] });
    }
    return out;
  }, [flow, lookup, linkMode, inRows, outRows, bars, activeKey]);

  const dimAll = activeKey !== null || hotKeys.size > 0;
  const lit = (key: string) => key === activeKey || hotKeys.has(key);

  return (
    <div ref={ref} className="px-3" aria-hidden="true">
      {flow && (
        <svg width={width} height={H} className="block overflow-visible">
          <g transform={`translate(0 ${BAR})`}>
            {!linkMode && flow.ribbons.map((r) => {
              const tone = tones.get(r.key)!;
              const op = dimAll ? (lit(r.key) ? 0.8 : 0.08) : tone.toned ? 0.45 : 0.26;
              return <path key={r.key} d={r.d} style={{ fill: tone.color, fillOpacity: op, transition: "fill-opacity 150ms ease-out" }} />;
            })}
            {!linkMode && (
              <rect x={flow.junction.x0} y={flow.junction.y - 2} width={flow.junction.x1 - flow.junction.x0} height={4} rx={2} style={{ fill: "var(--foreground)", fillOpacity: 0.55 }} />
            )}
            {links.map((l) => (
              <path
                key={l.key}
                d={l.d}
                fill="none"
                strokeLinecap="round"
                style={{
                  stroke: probColor(l.p),
                  strokeWidth: 1 + l.p * 3,
                  strokeOpacity: activeKey === null || l.ends.includes(activeKey) ? 0.35 + l.p * 0.6 : 0.06,
                }}
              />
            ))}
          </g>
          {flow.ribbons.map((r) => {
            const tone = tones.get(r.key)!;
            const y = r.side === "input" ? 0 : H - BAR;
            return (
              <rect
                key={`bar-${r.key}`}
                x={r.bar[0]}
                y={y}
                width={Math.max(1, r.bar[1] - r.bar[0])}
                height={BAR}
                rx={1.5}
                onClick={() => onActivate(activeKey === r.key ? null : r.key)}
                style={{ fill: tone.toned ? tone.color : "var(--muted)", fillOpacity: dimAll && !lit(r.key) ? 0.25 : 0.9, cursor: "pointer" }}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
