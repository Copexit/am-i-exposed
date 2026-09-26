"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useReducedMotion } from "motion/react";
import type { ScoreWaterfall } from "@/lib/view/waterfall";

/** Total length of the full reveal, and of the short one for cached results. */
export const REVEAL_MS = 2200;
export const REVEAL_FAST_MS = 650;

export interface RevealState {
  /** True while the sequence plays. */
  playing: boolean;
  /** 0..1 progress of the whole sequence (1 when done, skipped or disabled). */
  progress: number;
  /** Number of engine checks shown as done (0..checkCount). */
  checksDone: number;
  /** Number of waterfall steps revealed so far (0..steps.length). */
  stepsRevealed: number;
  /** Score to display now: base, then the running total, clamped to 0-100. */
  displayScore: number;
  /** Findings revealed so far (in waterfall order). Everything once done. */
  isRevealed: (findingId: string) => boolean;
  skip: () => void;
}

/**
 * Choreography of "The Reveal": plays once when a fresh result appears.
 *
 * Honest by construction: it only replays the FINAL result. The checks strip
 * ticks through the engine's real check list, and findings land in waterfall
 * order while the score walks the waterfall's real running total. Nothing is
 * shown that is not in the result. Reduced motion or `enabled: false` start at
 * the end state.
 */
export function useRevealTimeline(
  waterfall: ScoreWaterfall,
  checkCount: number,
  { enabled, fast = false }: { enabled: boolean; fast?: boolean },
): RevealState {
  const reducedMotion = useReducedMotion();
  const active = enabled && !reducedMotion;
  const [progress, setProgress] = useState(active ? 0 : 1);
  const raf = useRef<number | null>(null);

  const skip = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(1);
  }, []);

  useEffect(() => {
    if (!active) return;
    const duration = fast ? REVEAL_FAST_MS : REVEAL_MS;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setProgress(p);
      raf.current = p < 1 ? requestAnimationFrame(tick) : null;
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current !== null) cancelAnimationFrame(raf.current); };
  }, [active, fast]);

  const { steps, base, final } = waterfall;
  // Checks tick through the first 55%; findings land between 20% and 90%.
  const checksDone = Math.round(Math.min(1, progress / 0.55) * checkCount);
  const stepsP = Math.max(0, Math.min(1, (progress - 0.2) / 0.7));
  const stepsRevealed = progress >= 1 ? steps.length : Math.floor(stepsP * steps.length + 1e-9);
  const running = stepsRevealed === 0 ? base : steps[stepsRevealed - 1]!.to;
  const displayScore = progress >= 1 ? final : Math.max(0, Math.min(100, running));

  const revealedIds = new Set(steps.slice(0, stepsRevealed).map((s) => s.findingId as string));
  const done = progress >= 1;
  const isRevealed = (id: string) => done || revealedIds.has(id);

  return { playing: !done, progress, checksDone, stepsRevealed, displayScore, isRevealed, skip };
}
