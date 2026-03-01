"use client";

import { useMemo, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Pack } from "@visx/hierarchy";
import { Group } from "@visx/group";
import { Text } from "@visx/text";
import { ParentSize } from "@visx/responsive";
import { hierarchy } from "d3-hierarchy";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, DUST_THRESHOLD, ANIMATION_DEFAULTS } from "./shared/svgConstants";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import type { MempoolUtxo } from "@/lib/api/types";

interface UtxoBubbleChartProps {
  utxos: MempoolUtxo[];
}

interface UtxoNode {
  id: string;
  txid: string;
  value: number;
  confirmed: boolean;
  isDust: boolean;
  dustCount?: number;
}

interface HierarchyDatum {
  children?: UtxoNode[];
}

interface TooltipData {
  txid: string;
  value: number;
  confirmed: boolean;
  isDust: boolean;
  dustCount?: number;
  lang: string;
}

const MAX_DUST_CLUSTER = 10;

function BubbleChart({ width, height, utxos }: UtxoBubbleChartProps & { width: number; height: number }) {
  const { t, i18n } = useTranslation();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const { tooltipOpen, tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip, handleTouch } =
    useChartTooltip<TooltipData>();

  const processedData = useMemo(() => {
    const dustUtxos = utxos.filter((u) => u.value <= DUST_THRESHOLD);
    const normalUtxos = utxos.filter((u) => u.value > DUST_THRESHOLD);

    const children: UtxoNode[] = normalUtxos.map((u, i) => ({
      id: `utxo-${i}`,
      txid: u.txid,
      value: u.value,
      confirmed: u.status.confirmed,
      isDust: false,
    }));

    // Cluster dust UTXOs if > MAX_DUST_CLUSTER
    if (dustUtxos.length > MAX_DUST_CLUSTER) {
      const totalDust = dustUtxos.reduce((s, u) => s + u.value, 0);
      children.push({
        id: "dust-cluster",
        txid: "",
        value: Math.max(totalDust, 1),
        confirmed: true,
        isDust: true,
        dustCount: dustUtxos.length,
      });
    } else {
      for (let i = 0; i < dustUtxos.length; i++) {
        const u = dustUtxos[i];
        children.push({
          id: `dust-${i}`,
          txid: u.txid,
          value: Math.max(u.value, 1),
          confirmed: u.status.confirmed,
          isDust: true,
        });
      }
    }

    return children;
  }, [utxos]);

  const root = useMemo(() => {
    const h = hierarchy<HierarchyDatum | UtxoNode>({ children: processedData } as HierarchyDatum)
      .sum((d) => {
        if ("value" in d && typeof d.value === "number") {
          return Math.sqrt(d.value);
        }
        return 0;
      })
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return h;
  }, [processedData]);

  if (processedData.length === 0) return null;

  const size = Math.min(width, height);

  return (
    <div className="relative flex justify-center" ref={containerRef} onTouchStart={handleTouch}>
      <svg
        width={size}
        height={size}
        role="img"
        aria-label={t("viz.bubbles.aria", {
          count: utxos.length,
          defaultValue: `UTXO bubble chart: ${utxos.length} unspent outputs`,
        })}
      >
        <Pack<HierarchyDatum | UtxoNode>
          root={root}
          size={[size, size]}
          padding={4}
        >
          {(packData) => {
            const descendants = packData.descendants().slice(1); // Skip root
            return (
              <Group>
                {descendants.map((circle, i) => {
                  const d = circle.data as UtxoNode;
                  if (!d.id) return null;

                  let fillColor: string = SVG_COLORS.foreground;
                  let fillOpacity = 0.15;

                  if (d.isDust) {
                    fillColor = SVG_COLORS.critical;
                    fillOpacity = 0.3;
                  } else if (!d.confirmed) {
                    fillColor = SVG_COLORS.bitcoin;
                    fillOpacity = 0.25;
                  }

                  const showLabel = circle.r > 25;

                  return (
                    <Group key={d.id}>
                      <motion.circle
                        cx={circle.x}
                        cy={circle.y}
                        r={circle.r}
                        fill={fillColor}
                        fillOpacity={fillOpacity}
                        stroke={fillColor}
                        strokeOpacity={0.4}
                        strokeWidth={1}
                        initial={reducedMotion ? false : { r: 0 }}
                        animate={{ r: circle.r }}
                        transition={{
                          delay: i * ANIMATION_DEFAULTS.stagger,
                          duration: ANIMATION_DEFAULTS.duration,
                          ease: [0.4, 0, 0.2, 1],
                        }}
                        onMouseEnter={(e: React.MouseEvent) => {
                          const container = containerRef.current;
                          if (!container) return;
                          const containerRect = container.getBoundingClientRect();
                          const elemRect = (e.currentTarget as Element).getBoundingClientRect();
                          showTooltip({
                            tooltipData: {
                              txid: d.txid,
                              value: d.value,
                              confirmed: d.confirmed,
                              isDust: d.isDust,
                              dustCount: d.dustCount,
                              lang: i18n.language,
                            },
                            tooltipLeft: elemRect.left - containerRect.left + elemRect.width / 2,
                            tooltipTop: elemRect.top - containerRect.top,
                          });
                        }}
                        onMouseLeave={() => hideTooltip()}
                      />

                      {/* Pulsing effect for unconfirmed */}
                      {!d.confirmed && !d.isDust && (
                        <motion.circle
                          cx={circle.x}
                          cy={circle.y}
                          r={circle.r}
                          fill="none"
                          stroke={SVG_COLORS.bitcoin}
                          strokeWidth={1.5}
                          initial={{ opacity: 0.6 }}
                          animate={{ opacity: [0.6, 0.1, 0.6] }}
                          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                        />
                      )}

                      {/* Pulsing for dust */}
                      {d.isDust && !d.dustCount && (
                        <motion.circle
                          cx={circle.x}
                          cy={circle.y}
                          r={circle.r}
                          fill="none"
                          stroke={SVG_COLORS.critical}
                          strokeWidth={1}
                          initial={{ opacity: 0.5 }}
                          animate={{ opacity: [0.5, 0.1, 0.5] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                        />
                      )}

                      {/* Label */}
                      {showLabel && (
                        <>
                          <Text
                            x={circle.x}
                            y={circle.y - 4}
                            textAnchor="middle"
                            verticalAnchor="end"
                            fontSize={Math.min(12, Math.max(9, circle.r / 3))}
                            fill={SVG_COLORS.foreground}
                            fontFamily="var(--font-geist-mono), monospace"
                          >
                            {d.dustCount
                              ? t("viz.bubbles.dustCluster", { count: d.dustCount, defaultValue: `${d.dustCount} dust` })
                              : formatSats(d.value, i18n.language)}
                          </Text>
                          {d.txid && (
                            <Text
                              x={circle.x}
                              y={circle.y + 8}
                              textAnchor="middle"
                              verticalAnchor="start"
                              fontSize={Math.min(10, Math.max(8, circle.r / 3.5))}
                              fill={SVG_COLORS.muted}
                              fontFamily="var(--font-geist-mono), monospace"
                            >
                              {truncateId(d.txid, 4)}
                            </Text>
                          )}
                        </>
                      )}
                    </Group>
                  );
                })}
              </Group>
            );
          }}
        </Pack>
      </svg>

      {tooltipOpen && tooltipData && (
        <ChartTooltip top={tooltipTop ?? 0} left={tooltipLeft ?? 0}>
          <div className="space-y-0.5">
            <p className="font-mono text-xs" style={{ color: SVG_COLORS.foreground }}>
              {tooltipData.dustCount
                ? t("viz.bubbles.dustCluster", { count: tooltipData.dustCount, defaultValue: `${tooltipData.dustCount} dust UTXOs` })
                : formatSats(tooltipData.value, tooltipData.lang)}
            </p>
            {tooltipData.txid && (
              <p className="text-xs" style={{ color: SVG_COLORS.muted }}>
                {truncateId(tooltipData.txid, 4)}
              </p>
            )}
            <p className="text-xs" style={{ color: tooltipData.isDust ? SVG_COLORS.critical : tooltipData.confirmed ? SVG_COLORS.good : SVG_COLORS.bitcoin }}>
              {tooltipData.isDust
                ? t("viz.bubbles.dust", { defaultValue: "Dust" })
                : tooltipData.confirmed
                  ? t("viz.bubbles.confirmed", { defaultValue: "Confirmed" })
                  : t("viz.bubbles.unconfirmed", { defaultValue: "Unconfirmed" })}
            </p>
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}

export function UtxoBubbleChart({ utxos }: UtxoBubbleChartProps) {
  const { t } = useTranslation();

  if (utxos.length === 0) return null;

  return (
    <div className="w-full glass rounded-xl p-4 sm:p-6 space-y-3">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wider">
        {t("viz.bubbles.title", {
          count: utxos.length,
          defaultValue: `UTXOs (${utxos.length})`,
        })}
      </h3>
      <div style={{ minHeight: 200 }}>
        <ParentSize>
          {({ width }) => (
            <BubbleChart
              width={width}
              height={Math.min(400, Math.max(200, width * 0.6))}
              utxos={utxos}
            />
          )}
        </ParentSize>
      </div>
    </div>
  );
}
