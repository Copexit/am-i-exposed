import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";

/**
 * Temporal Correlation Detection
 *
 * Analyzes transaction timing patterns for an address's history:
 * - Burst detection: multiple txs within a short window (< 2 hours)
 * - Regular pattern detection: recurring intervals suggest automated behavior
 * - Time-of-day clustering: consistent timezone/schedule patterns
 *
 * These temporal signals strengthen deanonymization when combined with
 * other heuristics (CIOH, change detection, etc.).
 */

interface TimeBucket {
  start: number; // unix timestamp
  end: number;
  txids: string[];
}

/**
 * Detect temporal patterns in a list of transactions associated with an address.
 * Returns findings about suspicious timing correlations.
 */
export function analyzeTemporalCorrelation(
  txs: MempoolTransaction[],
): Finding[] {
  const findings: Finding[] = [];

  // Need at least 3 confirmed txs with timestamps
  const confirmedTxs = txs.filter(
    (tx) => tx.status.confirmed && tx.status.block_time,
  );
  if (confirmedTxs.length < 3) return findings;

  // Sort by block time ascending
  const sorted = [...confirmedTxs].sort(
    (a, b) => a.status.block_time! - b.status.block_time!,
  );

  // ── Burst detection: find clusters of txs within 2-hour windows ─────────
  const BURST_WINDOW = 2 * 60 * 60; // 2 hours in seconds
  const bursts = findBursts(sorted, BURST_WINDOW);

  if (bursts.length > 0) {
    const largestBurst = bursts.reduce((max, b) =>
      b.txids.length > max.txids.length ? b : max,
    );

    if (largestBurst.txids.length >= 5) {
      findings.push({
        id: "temporal-burst-high",
        severity: "high",
        confidence: "medium",
        title: `${largestBurst.txids.length} transactions within 2 hours`,
        description:
          `${largestBurst.txids.length} transactions from this address were confirmed ` +
          "within a 2-hour window. This burst pattern is characteristic of automated " +
          "software, batch processing, or panic-driven activity. Chain analysts use " +
          "temporal correlation to link transactions to the same entity even across " +
          "different addresses.",
        recommendation:
          "Space transactions across different blocks and times. Avoid sending multiple " +
          "transactions in quick succession, as the timing correlation links them " +
          "regardless of address separation.",
        scoreImpact: -5,
        params: {
          burstSize: largestBurst.txids.length,
          totalBursts: bursts.length,
        },
      });
    } else if (largestBurst.txids.length >= 3) {
      findings.push({
        id: "temporal-burst-moderate",
        severity: "medium",
        confidence: "medium",
        title: `${largestBurst.txids.length} transactions within 2 hours`,
        description:
          `${largestBurst.txids.length} transactions were confirmed within a 2-hour ` +
          "window. This temporal clustering can help analysts correlate activity " +
          "from this address with other on-chain behavior.",
        recommendation:
          "Consider spacing transactions over longer periods to reduce temporal correlation.",
        scoreImpact: -2,
        params: {
          burstSize: largestBurst.txids.length,
          totalBursts: bursts.length,
        },
      });
    }
  }

  // ── Regular interval detection ──────────────────────────────────────────
  // Require 8+ transactions for regular-pattern detection to avoid false
  // positives on small samples that happen to be evenly spaced
  if (sorted.length >= 8) {
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(sorted[i].status.block_time! - sorted[i - 1].status.block_time!);
    }

    // Check for regular intervals (coefficient of variation < 0.3)
    const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    if (mean > 0) {
      const variance =
        intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      const cv = stdDev / mean;

      if (cv < 0.3 && mean < 7 * 24 * 60 * 60) {
        // Regular pattern within weekly frequency
        const avgHours = Math.round(mean / 3600);
        const intervalLabel =
          avgHours >= 24
            ? `~${Math.round(avgHours / 24)} days`
            : `~${avgHours} hours`;

        findings.push({
          id: "temporal-regular-pattern",
          severity: "medium",
          confidence: "medium",
          title: `Regular transaction pattern detected (${intervalLabel} interval)`,
          description:
            `Transactions from this address follow a regular pattern with an average ` +
            `interval of ${intervalLabel} (CV=${cv.toFixed(2)}). Regular patterns suggest ` +
            "automated payments, scheduled transfers, or habitual behavior that helps " +
            "analysts predict future activity and confirm entity linkage.",
          recommendation:
            "Randomize transaction timing. Automated or scheduled payments should " +
            "add random delays to break predictable patterns.",
          scoreImpact: -3,
          params: { intervalHours: avgHours, cv: Number(cv.toFixed(2)) },
        });
      }
    }
  }

  return findings;
}

/**
 * Find clusters of transactions within a time window.
 * Uses a sliding window approach.
 */
function findBursts(
  sortedTxs: MempoolTransaction[],
  windowSecs: number,
): TimeBucket[] {
  const bursts: TimeBucket[] = [];
  let i = 0;

  while (i < sortedTxs.length) {
    const windowStart = sortedTxs[i].status.block_time!;
    const windowEnd = windowStart + windowSecs;

    // Collect all txs within this window
    const bucket: string[] = [];
    let j = i;
    while (j < sortedTxs.length && sortedTxs[j].status.block_time! <= windowEnd) {
      bucket.push(sortedTxs[j].txid);
      j++;
    }

    if (bucket.length >= 3) {
      bursts.push({
        start: windowStart,
        end: windowEnd,
        txids: bucket,
      });
      // Skip past this burst to avoid overlapping detections
      i = j;
    } else {
      i++;
    }
  }

  return bursts;
}
