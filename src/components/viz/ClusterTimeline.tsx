"use client";

import { useMemo } from "react";
import { Group } from "@visx/group";
import { Text } from "@visx/text";
import { BarStack } from "@visx/shape";
import { ParentSize } from "@visx/responsive";
import { scaleBand, scaleLinear, scaleOrdinal } from "@visx/scale";
import { motion } from "motion/react";
import { SVG_COLORS } from "./shared/svgConstants";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { formatSats } from "@/lib/format";
import type { MempoolTransaction } from "@/lib/api/types";

/**
 * OXT-style cluster activity timeline.
 *
 * Shows temporal activity for a set of transactions grouped by time bucket.
 * Sent/received volumes are stacked as bars, with hover tooltips.
 */

interface ClusterTimelineProps {
  /** All transactions in the cluster */
  txs: MempoolTransaction[];
  /** Address being analyzed (to determine sent vs received) */
  targetAddress: string;
  /** Click on a time bucket to see txs in that period */
  onBucketClick?: (txids: string[]) => void;
}

interface TimeBucket {
  label: string;
  startTime: number;
  sent: number;
  received: number;
  txCount: number;
  txids: string[];
}

interface TooltipData {
  label: string;
  sent: number;
  received: number;
  txCount: number;
}

const MARGIN = { top: 30, right: 16, bottom: 40, left: 60 };
const BAR_PADDING = 0.25;
const KEYS = ["received", "sent"] as const;
const COLORS: Record<string, string> = {
  received: SVG_COLORS.good,
  sent: SVG_COLORS.high,
};

function bucketTransactions(txs: MempoolTransaction[], targetAddress: string): TimeBucket[] {
  // Sort by block time
  const timed = txs
    .filter((tx) => tx.status?.block_time)
    .sort((a, b) => (a.status.block_time ?? 0) - (b.status.block_time ?? 0));

  if (timed.length === 0) return [];

  const firstTime = timed[0].status.block_time!;
  const lastTime = timed[timed.length - 1].status.block_time!;
  const span = lastTime - firstTime;

  // Choose bucket size based on time span
  let bucketSize: number;
  let formatLabel: (t: number) => string;

  if (span < 86400 * 7) {
    // Less than a week - hourly buckets
    bucketSize = 3600;
    formatLabel = (t) => {
      const d = new Date(t * 1000);
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`;
    };
  } else if (span < 86400 * 90) {
    // Less than 3 months - daily buckets
    bucketSize = 86400;
    formatLabel = (t) => {
      const d = new Date(t * 1000);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    };
  } else if (span < 86400 * 365 * 2) {
    // Less than 2 years - weekly buckets
    bucketSize = 86400 * 7;
    formatLabel = (t) => {
      const d = new Date(t * 1000);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    };
  } else {
    // Monthly buckets
    bucketSize = 86400 * 30;
    formatLabel = (t) => {
      const d = new Date(t * 1000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    };
  }

  // Build buckets
  const buckets = new Map<number, TimeBucket>();

  for (const tx of timed) {
    const time = tx.status.block_time!;
    const bKey = Math.floor(time / bucketSize) * bucketSize;

    if (!buckets.has(bKey)) {
      buckets.set(bKey, {
        label: formatLabel(bKey),
        startTime: bKey,
        sent: 0,
        received: 0,
        txCount: 0,
        txids: [],
      });
    }

    const bucket = buckets.get(bKey)!;
    bucket.txCount++;
    bucket.txids.push(tx.txid);

    // Determine if this tx is sending or receiving for the target
    const inputValue = tx.vin
      .filter((v) => v.prevout?.scriptpubkey_address === targetAddress)
      .reduce((sum, v) => sum + (v.prevout?.value ?? 0), 0);
    const outputValue = tx.vout
      .filter((v) => v.scriptpubkey_address === targetAddress)
      .reduce((sum, v) => sum + v.value, 0);

    if (inputValue > outputValue) {
      bucket.sent += inputValue - outputValue;
    } else {
      bucket.received += outputValue - inputValue;
    }
  }

  return [...buckets.values()].sort((a, b) => a.startTime - b.startTime);
}

function Timeline({
  width,
  txs,
  targetAddress,
  onBucketClick,
}: {
  width: number;
  txs: MempoolTransaction[];
  targetAddress: string;
  onBucketClick?: (txids: string[]) => void;
}) {
  const tooltip = useChartTooltip<TooltipData>();
  const buckets = useMemo(() => bucketTransactions(txs, targetAddress), [txs, targetAddress]);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const height = 200;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const xScale = useMemo(
    () =>
      scaleBand<string>({
        domain: buckets.map((b) => b.label),
        range: [0, innerWidth],
        padding: BAR_PADDING,
      }),
    [buckets, innerWidth],
  );

  const maxVal = useMemo(
    () => Math.max(...buckets.map((b) => b.sent + b.received), 1),
    [buckets],
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, maxVal],
        range: [innerHeight, 0],
        nice: true,
      }),
    [maxVal, innerHeight],
  );

  const colorScale = useMemo(
    () =>
      scaleOrdinal<string, string>({
        domain: [...KEYS],
        range: [COLORS.received, COLORS.sent],
      }),
    [],
  );

  if (buckets.length === 0) return null;

  // Show max ~20 x-axis labels to avoid overlap
  const labelInterval = Math.max(1, Math.ceil(buckets.length / 20));

  return (
    <div className="relative" style={{ position: "relative" }}>
      <svg width={width} height={height}>
        <ChartDefs />
        <Group top={MARGIN.top} left={MARGIN.left}>
          {/* Y axis grid lines */}
          {yScale.ticks(4).map((tick) => (
            <g key={tick}>
              <line
                x1={0}
                x2={innerWidth}
                y1={yScale(tick)}
                y2={yScale(tick)}
                stroke={SVG_COLORS.cardBorder}
                strokeOpacity={0.3}
              />
              <Text
                x={-8}
                y={yScale(tick)}
                fontSize={9}
                fill={SVG_COLORS.muted}
                textAnchor="end"
                verticalAnchor="middle"
              >
                {formatSats(tick)}
              </Text>
            </g>
          ))}

          {/* Stacked bars */}
          <BarStack<TimeBucket, string>
            data={buckets}
            keys={[...KEYS]}
            x={(d) => d.label}
            xScale={xScale}
            yScale={yScale}
            color={colorScale}
          >
            {(barStacks) =>
              barStacks.map((barStack) =>
                barStack.bars.map((bar) => (
                  <motion.rect
                    key={`${barStack.key}-${bar.index}`}
                    x={bar.x}
                    y={bar.y}
                    width={bar.width}
                    height={Math.max(0, bar.height)}
                    fill={bar.color}
                    fillOpacity={0.7}
                    rx={2}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 0.3, delay: bar.index * 0.02 }}
                    style={{ transformOrigin: `${bar.x + bar.width / 2}px ${innerHeight}px`, cursor: onBucketClick ? "pointer" : "default" }}
                    onMouseEnter={() => {
                      const bucket = buckets[bar.index];
                      tooltip.showTooltip({
                        tooltipData: {
                          label: bucket.label,
                          sent: bucket.sent,
                          received: bucket.received,
                          txCount: bucket.txCount,
                        },
                        tooltipLeft: bar.x + bar.width / 2 + MARGIN.left,
                        tooltipTop: bar.y + MARGIN.top - 8,
                      });
                    }}
                    onMouseLeave={tooltip.hideTooltip}
                    onClick={() => {
                      const bucket = buckets[bar.index];
                      onBucketClick?.(bucket.txids);
                    }}
                  />
                )),
              )
            }
          </BarStack>

          {/* X axis labels */}
          {buckets.map((bucket, i) => {
            if (i % labelInterval !== 0) return null;
            return (
              <Text
                key={bucket.label}
                x={(xScale(bucket.label) ?? 0) + xScale.bandwidth() / 2}
                y={innerHeight + 16}
                fontSize={9}
                fill={SVG_COLORS.muted}
                textAnchor="middle"
                angle={buckets.length > 12 ? -45 : 0}
              >
                {bucket.label}
              </Text>
            );
          })}
        </Group>
      </svg>

      {tooltip.tooltipOpen && tooltip.tooltipData && (
        <ChartTooltip top={tooltip.tooltipTop} left={tooltip.tooltipLeft}>
          <div className="space-y-1">
            <div className="font-medium">{tooltip.tooltipData.label}</div>
            <div className="text-xs" style={{ color: COLORS.received }}>
              Received: {formatSats(tooltip.tooltipData.received)}
            </div>
            <div className="text-xs" style={{ color: COLORS.sent }}>
              Sent: {formatSats(tooltip.tooltipData.sent)}
            </div>
            <div className="text-xs" style={{ color: SVG_COLORS.muted }}>
              {tooltip.tooltipData.txCount} tx{tooltip.tooltipData.txCount !== 1 ? "s" : ""}
            </div>
          </div>
        </ChartTooltip>
      )}
    </div>
  );
}

export function ClusterTimeline({ txs, targetAddress, onBucketClick }: ClusterTimelineProps) {
  if (txs.length < 2) return null;

  // Compute summary stats
  const timedTxs = txs.filter((tx) => tx.status?.block_time);
  if (timedTxs.length < 2) return null;

  const sortedTimes = timedTxs
    .map((tx) => tx.status.block_time!)
    .sort((a, b) => a - b);
  const firstSeen = new Date(sortedTimes[0] * 1000);
  const lastSeen = new Date(sortedTimes[sortedTimes.length - 1] * 1000);

  // Total sent/received
  let totalSent = 0;
  let totalReceived = 0;
  for (const tx of txs) {
    const inputValue = tx.vin
      .filter((v) => v.prevout?.scriptpubkey_address === targetAddress)
      .reduce((sum, v) => sum + (v.prevout?.value ?? 0), 0);
    const outputValue = tx.vout
      .filter((v) => v.scriptpubkey_address === targetAddress)
      .reduce((sum, v) => sum + v.value, 0);
    if (inputValue > outputValue) totalSent += inputValue - outputValue;
    else totalReceived += outputValue - inputValue;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35 }}
      className="rounded-xl border border-white/5 bg-surface-inset p-4 space-y-3"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-white/70">
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="8" width="3" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="5" y="5" width="3" height="9" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="9" y="3" width="3" height="11" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="13" y="6" width="3" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        Activity Timeline
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="space-y-0.5">
          <div className="text-white/40">Transactions</div>
          <div className="text-white/80 font-medium">{txs.length}</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-white/40">Active period</div>
          <div className="text-white/80 font-medium">
            {firstSeen.toLocaleDateString()} - {lastSeen.toLocaleDateString()}
          </div>
        </div>
        <div className="space-y-0.5">
          <div className="text-white/40" style={{ color: COLORS.received }}>Total received</div>
          <div className="text-white/80 font-medium">{formatSats(totalReceived)}</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-white/40" style={{ color: COLORS.sent }}>Total sent</div>
          <div className="text-white/80 font-medium">{formatSats(totalSent)}</div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-white/50">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: COLORS.received, opacity: 0.7 }} />
          Received
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: COLORS.sent, opacity: 0.7 }} />
          Sent
        </span>
      </div>

      <ParentSize debounceTime={100}>
        {({ width }) => width > 0 ? (
          <Timeline
            width={width}
            txs={txs}
            targetAddress={targetAddress}
            onBucketClick={onBucketClick}
          />
        ) : null}
      </ParentSize>
    </motion.div>
  );
}
