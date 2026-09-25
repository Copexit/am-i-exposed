"use client";

import { motion } from "motion/react";
import { Group } from "@visx/group";
import { Text } from "@visx/text";
import { SVG_COLORS, ANIMATION_DEFAULTS } from "./shared/svgConstants";
import { addressActivationProps } from "./shared/addressActivation";
import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import type { SankeyComputedNode } from "./shared/sankeyTypes";
import type { CoinJoinNodeDatum, ConsolidationData } from "./buildCoinJoinGraph";

interface CoinJoinNodeProps {
  node: SankeyComputedNode<CoinJoinNodeDatum>;
  index: number;
  margin: { left: number; right: number };
  reducedMotion: boolean | null;
  lang: string;
  onAddressClick?: (address: string) => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  consolidationData: ConsolidationData;
  outspends?: { spent?: boolean; txid?: string }[] | null;
  /** Translation function from react-i18next */
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export function CoinJoinNode({
  node: n,
  index: i,
  margin,
  reducedMotion,
  lang,
  onAddressClick,
  onMouseEnter,
  onMouseLeave,
  t,
}: CoinJoinNodeProps) {
  const nodeWidth = n.x1 - n.x0;
  const nodeHeight = Math.max(2, n.y1 - n.y0);
  const isMixer = n.side === "mixer";
  const isInput = n.side === "input";
  const isClickable = !!n.fullAddress && !!onAddressClick;

  const isTier = !!n.tierCount;
  const isConsolidated = (n.consolidatedCount ?? 0) > 0;
  const isInputConsolidated = isInput && !!n.sharedParentTxid;
  const hasLabelSpace = nodeHeight >= 14;
  const hasSubLabelSpace = nodeHeight >= 24;

  let fillColor: string;
  let glowFilter: string | undefined;
  if (isMixer) {
    fillColor = "url(#grad-mixer)";
    glowFilter = "url(#glow-medium)";
  } else if (isInput) {
    fillColor = "url(#grad-input)";
  } else if (isTier) {
    fillColor = "url(#grad-mixer)";
    glowFilter = "url(#glow-subtle)";
  } else {
    fillColor = "url(#grad-output)";
  }

  const labelX = isInput ? n.x0 - 8 : n.x1 + 10;
  const labelAnchor = isInput ? "end" : "start";
  const MARGIN = isInput ? margin.left : margin.right;
  const labelMaxWidth = MARGIN - 8;

  // Expand hitbox for easier hover/touch
  const hitboxPad = 70;
  const hitboxX = isInput ? n.x0 - hitboxPad : n.x0;
  const hitboxW = nodeWidth + hitboxPad;
  const hitboxH = Math.max(nodeHeight, 18);
  const hitboxY = n.y0 - (hitboxH - nodeHeight) / 2;

  return (
    <Group key={n.id}>
      {/* Invisible expanded hitbox for hover/touch */}
      {!isMixer && (
        <rect
          x={hitboxX}
          y={hitboxY}
          width={hitboxW}
          height={hitboxH}
          fill="transparent"
          cursor={isClickable ? "pointer" : "default"}
          tabIndex={isClickable ? 0 : undefined}
          role={isClickable ? "button" : undefined}
          aria-label={isClickable ? t("viz.cj.scanAddress", { address: n.fullAddress, defaultValue: `Scan ${n.fullAddress}` }) : undefined}
          className={isClickable ? "outline-none focus-visible:outline-2 focus-visible:outline-bitcoin" : ""}
          {...addressActivationProps(n.fullAddress, onAddressClick)}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        />
      )}

      <motion.rect
        x={n.x0}
        y={n.y0}
        width={nodeWidth}
        height={nodeHeight}
        fill={fillColor}
        filter={glowFilter}
        rx={isMixer ? 0 : 3}
        stroke={isMixer ? SVG_COLORS.good : (isConsolidated || isInputConsolidated) ? SVG_COLORS.critical : undefined}
        strokeOpacity={isMixer ? 0.5 : (isConsolidated || isInputConsolidated) ? 0.8 : undefined}
        strokeWidth={isMixer ? 1 : (isConsolidated || isInputConsolidated) ? 1.5 : undefined}
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{
          delay: i * ANIMATION_DEFAULTS.stagger,
          duration: ANIMATION_DEFAULTS.duration,
        }}
        style={isMixer ? undefined : { pointerEvents: "none" as const }}
        onMouseEnter={isMixer ? onMouseEnter : undefined}
        onMouseLeave={isMixer ? onMouseLeave : undefined}
      />

      {/* Red damage bar overlay for consolidated tiers */}
      {isConsolidated && isTier && n.tierCount && (
        <rect
          x={n.x0 + 1}
          y={n.y1 - Math.max(2, nodeHeight * (n.consolidatedCount! / n.tierCount))}
          width={nodeWidth - 2}
          height={Math.max(2, nodeHeight * (n.consolidatedCount! / n.tierCount))}
          fill={SVG_COLORS.critical}
          fillOpacity={0.4}
          rx={2}
          style={{ pointerEvents: "none" as const }}
        />
      )}

      {/* Mixer pattern overlay */}
      {isMixer && (
        <rect
          x={n.x0}
          y={n.y0}
          width={nodeWidth}
          height={nodeHeight}
          fill="url(#mixer-pattern-v2)"
        />
      )}

      {/* Mixer label */}
      {isMixer && (
        <Text
          x={n.x0 + nodeWidth / 2}
          y={n.y0 + nodeHeight / 2}
          textAnchor="middle"
          verticalAnchor="middle"
          fontSize={13}
          fill={SVG_COLORS.foreground}
          fillOpacity={0.9}
          angle={-90}
        >
          {t("viz.coinjoin.mixingZone", { defaultValue: "Mixing zone" })}
        </Text>
      )}

      {/* Label - clickable for addresses */}
      {!isMixer && labelMaxWidth > 30 && hasLabelSpace && (
        <Text
          x={labelX}
          y={n.y0 + nodeHeight / 2 - (hasSubLabelSpace ? 4 : 0)}
          textAnchor={labelAnchor}
          verticalAnchor="middle"
          fontSize={11}
          fontFamily="var(--font-geist-mono), monospace"
          fill={isClickable ? SVG_COLORS.bitcoin : n.tierCount ? SVG_COLORS.bitcoin : SVG_COLORS.foreground}
          style={{ cursor: isClickable ? "pointer" : "default", textDecoration: isClickable ? "underline" : "none", pointerEvents: "none" as const }}
          width={Math.min(labelMaxWidth, 140)}
        >
          {n.label}
        </Text>
      )}

      {/* Entity / value label or consolidation warning below address for inputs and non-tier outputs */}
      {!isMixer && !isTier && labelMaxWidth > 30 && hasSubLabelSpace && (
        isInputConsolidated ? (
          <Text
            x={labelX}
            y={n.y0 + nodeHeight / 2 + 10}
            textAnchor={labelAnchor}
            verticalAnchor="middle"
            fontSize={9}
            fontWeight={600}
            fill={SVG_COLORS.critical}
            style={{ pointerEvents: "none" as const }}
          >
            {`${n.sharedParentCount} from ${truncateId(n.sharedParentTxid!, 5)}`}
          </Text>
        ) : n.entityName ? (
          <Text
            x={labelX}
            y={n.y0 + nodeHeight / 2 + 10}
            textAnchor={labelAnchor}
            verticalAnchor="middle"
            fontSize={9}
            fontWeight={700}
            fill={SVG_COLORS.critical}
            style={{ pointerEvents: "none" as const }}
            width={Math.min(labelMaxWidth, 140)}
          >
            {n.entityName}
          </Text>
        ) : (
          <Text
            x={labelX}
            y={n.y0 + nodeHeight / 2 + 10}
            textAnchor={labelAnchor}
            verticalAnchor="middle"
            fontSize={10}
            fill={SVG_COLORS.muted}
            style={{ pointerEvents: "none" as const }}
          >
            {formatSats(n.value, lang)}
          </Text>
        )
      )}

      {/* Consolidation warning for tier outputs */}
      {!isMixer && isTier && labelMaxWidth > 30 && hasSubLabelSpace && isConsolidated && (
        <Text
          x={labelX}
          y={n.y0 + nodeHeight / 2 + 10}
          textAnchor={labelAnchor}
          verticalAnchor="middle"
          fontSize={9}
          fontWeight={600}
          fill={SVG_COLORS.critical}
          style={{ pointerEvents: "none" as const }}
        >
          {`${n.consolidatedCount} of ${n.tierCount} re-linked`}
        </Text>
      )}
    </Group>
  );
}
