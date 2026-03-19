"use client";

import { motion } from "motion/react";
import { Group } from "@visx/group";
import { Text } from "@visx/text";
import { SVG_COLORS, ANIMATION_DEFAULTS } from "./shared/svgConstants";
import { formatSats } from "@/lib/format";
import type { SankeyComputedNode } from "./shared/sankeyTypes";
import type { NodeDatum } from "./FlowChart";

interface FlowNodeProps {
  node: SankeyComputedNode<NodeDatum>;
  index: number;
  marginH: number;
  reducedMotion: boolean | null;
  lang: string;
  nodeStyle: { fill: string; filter?: string };
  isClickable: boolean;
  onHoverEnter: (n: SankeyComputedNode<NodeDatum>, e: React.MouseEvent) => void;
  onHoverLeave: () => void;
  onAddressClick?: (address: string) => void;
  /** Translation function from react-i18next */
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export function FlowNode({
  node: n,
  index: i,
  marginH,
  reducedMotion,
  lang,
  nodeStyle,
  isClickable,
  onHoverEnter,
  onHoverLeave,
  onAddressClick,
  t,
}: FlowNodeProps) {
  const nw = n.x1 - n.x0;
  const nh = Math.max(2, n.y1 - n.y0);
  const isInput = n.side === "input";

  // Label outside the sankey area
  const labelX = isInput ? n.x0 - 8 : n.x1 + 8;
  const labelAnchor = isInput ? "end" as const : "start" as const;

  // Expand hitbox: extend into the label area for easier hover/touch
  const hitboxPad = 80;
  const hitboxX = isInput ? n.x0 - hitboxPad : n.x0;
  const hitboxW = nw + hitboxPad;
  const hitboxH = Math.max(nh, 20);
  const hitboxY = n.y0 - (hitboxH - nh) / 2;

  return (
    <Group key={n.id}>
      {/* Invisible expanded hitbox for hover/touch */}
      <rect
        x={hitboxX}
        y={hitboxY}
        width={hitboxW}
        height={hitboxH}
        fill="transparent"
        cursor={isClickable ? "pointer" : "default"}
        tabIndex={isClickable ? 0 : undefined}
        role={isClickable ? "button" : undefined}
        aria-label={isClickable ? t("viz.flow.scanAddress", { address: n.fullAddress, defaultValue: `Scan ${n.fullAddress}` }) : undefined}
        className={isClickable ? "outline-none focus-visible:outline-2 focus-visible:outline-bitcoin" : ""}
        onMouseEnter={(e: React.MouseEvent) => {
          onHoverEnter(n, e);
        }}
        onMouseLeave={onHoverLeave}
        onClick={() => { if (n.fullAddress && onAddressClick) onAddressClick(n.fullAddress); }}
        onKeyDown={(e: React.KeyboardEvent) => {
          if ((e.key === "Enter" || e.key === " ") && n.fullAddress && onAddressClick) {
            e.preventDefault();
            onAddressClick(n.fullAddress);
          }
        }}
      />

      <motion.rect
        x={n.x0}
        y={n.y0}
        width={nw}
        height={nh}
        fill={nodeStyle.fill}
        filter={nodeStyle.filter}
        rx={2}
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: i * ANIMATION_DEFAULTS.stagger, duration: ANIMATION_DEFAULTS.duration }}
        style={{ pointerEvents: "none" }}
      />

      {/* Address label */}
      <Text
        x={labelX}
        y={n.y0 + nh / 2 - (nh > 10 ? 6 : 0)}
        textAnchor={labelAnchor}
        verticalAnchor="middle"
        fontSize={11}
        fontFamily="var(--font-geist-mono), monospace"
        fill={isClickable ? SVG_COLORS.bitcoin : SVG_COLORS.foreground}
        style={{ pointerEvents: "none" as const, textDecoration: isClickable ? "underline" : "none" }}
      >
        {n.label}
      </Text>

      {/* Entity label - shown in place of value when entity is known */}
      {n.entityName ? (
        <Text
          x={labelX}
          y={n.y0 + nh / 2 + (nh > 10 ? 8 : 12)}
          textAnchor={labelAnchor}
          verticalAnchor="middle"
          fontSize={nh > 10 ? 10 : 9}
          fontWeight={700}
          fill={SVG_COLORS.critical}
          style={{ pointerEvents: "none" as const }}
          width={Math.min(marginH - 10, 140)}
        >
          {n.entityName}
        </Text>
      ) : (
        <Text
          x={labelX}
          y={n.y0 + nh / 2 + (nh > 10 ? 8 : 12)}
          textAnchor={labelAnchor}
          verticalAnchor="middle"
          fontSize={nh > 10 ? 10 : 9}
          fill={SVG_COLORS.muted}
          style={{ pointerEvents: "none" as const }}
        >
          {formatSats(n.displayValue, lang)}
        </Text>
      )}

      {/* Annotation badge (change, dust) - clickable to scroll to finding */}
      {n.annotation && !isInput && (
        <Text
          x={labelX}
          y={n.y0 + nh / 2 + (nh > 10 ? 20 : 10)}
          textAnchor={labelAnchor}
          verticalAnchor="middle"
          fontSize={9}
          fontWeight="bold"
          fill={n.annotationColor ?? SVG_COLORS.high}
          style={{ cursor: n.annotationFindingId ? "pointer" : "default" }}
          onClick={() => {
            if (n.annotationFindingId) {
              const el = document.querySelector(`[data-finding-id="${n.annotationFindingId}"]`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }}
        >
          {n.annotation}
        </Text>
      )}

      {/* Anon set badge */}
      {!isInput && n.anonSet && n.anonSet >= 2 && !n.annotation && (
        <Text
          x={labelX}
          y={n.y0 + nh / 2 + (nh > 10 ? 20 : 10)}
          textAnchor={labelAnchor}
          verticalAnchor="middle"
          fontSize={10}
          fill={n.anonColor ?? SVG_COLORS.muted}
          fontFamily="var(--font-geist-mono), monospace"
        >
          {`[${n.anonSet}x]`}
        </Text>
      )}

      {/* Spent/unspent indicator dot */}
      {!isInput && n.side === "output" && n.spent != null && (
        <circle
          cx={n.x1 + 3}
          cy={n.y0 + nh / 2}
          r={3}
          fill={n.spent ? SVG_COLORS.critical : SVG_COLORS.good}
          fillOpacity={0.8}
          style={{ pointerEvents: "none" }}
        />
      )}
    </Group>
  );
}
