"use client";

import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play } from "lucide-react";
import { replayTime, type Scene } from "@/lib/observatory/sky-model";
import type { Period } from "@/lib/observatory/wabisator-client";

export interface TimelineProps {
  scene: Scene;
  period: Period;
  progress: number;
  playing: boolean;
  live: boolean;
  onScrub: (p: number) => void;
  onTogglePlay: () => void;
  onPeriod: (p: Period) => void;
  /** Extra controls after the period switch (the Map/Table toggle). */
  extra?: ReactNode;
}

const PERIODS: Period[] = [1, 7, 30];
const BTN = "inline-flex items-center justify-center min-h-10 rounded-lg transition-colors duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin";

/**
 * The replay timeline: the period's volume histogram doubling as a scrubber (played part
 * brighter, a thin playhead), play/pause, the LIVE pill and the period switch.
 */
export function Timeline({ scene, period, progress, playing, live, onScrub, onTogglePlay, onPeriod, extra }: TimelineProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const max = Math.max(0, ...scene.bins.map((b) => b.volume));
  // sqrt keeps quiet hours visible next to the busiest one.
  const heights = scene.bins.map((b) => (b.volume > 0 && max > 0 ? 8 + 92 * Math.sqrt(b.volume / max) : 3));
  const withDate = period !== 1;
  const fmt = (sec: number) =>
    new Date(sec * 1000).toLocaleString(locale, withDate ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
  const fmtEnd = (sec: number) => new Date(sec * 1000).toLocaleString(locale, withDate ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const nowLabel = live ? t("observatory.wabisabi.timeline.now", { defaultValue: "Now" }) : fmt(replayTime(progress, scene));
  const pct = `${(progress * 100).toFixed(2)}%`;

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    onScrub(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const stepBy = e.key === "ArrowRight" || e.key === "ArrowUp" ? 0.01
      : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -0.01
      : e.key === "PageUp" ? 0.1
      : e.key === "PageDown" ? -0.1
      : null;
    if (e.key === "Home") { e.preventDefault(); return onScrub(0); }
    if (e.key === "End") { e.preventDefault(); return onScrub(1); }
    if (stepBy === null) return;
    e.preventDefault();
    onScrub(Math.max(0, Math.min(1, progress + stepBy)));
  };

  const bars = (cls: string) => heights.map((h, i) => <span key={i} className={`flex-1 rounded-t-[1.5px] ${cls}`} style={{ height: `${h}%` }} />);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label={t("observatory.wabisabi.timeline.scrub", { defaultValue: "Replay position" })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-valuetext={nowLabel}
          onKeyDown={onKey}
          onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); fromPointer(e); }}
          onPointerMove={(e) => { if (dragging.current) fromPointer(e); }}
          onPointerUp={(e) => { dragging.current = false; e.currentTarget.releasePointerCapture?.(e.pointerId); }}
          onPointerCancel={() => { dragging.current = false; }}
          className="group relative h-12 sm:h-14 cursor-ew-resize touch-none select-none rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bitcoin"
        >
          <div aria-hidden="true" className="absolute inset-0 flex items-end gap-[0.5px] sm:gap-px">{bars("bg-muted/25")}</div>
          {/* The played part: the same bars, brighter, clipped at the playhead. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 flex items-end gap-[0.5px] sm:gap-px transition-[clip-path] duration-100 ease-linear"
            style={{ clipPath: `inset(0 calc(100% - ${pct}) 0 0)` }}
          >
            {bars("bg-foreground/70")}
          </div>
          <div aria-hidden="true" className="absolute inset-y-0 -ml-px w-0.5 transition-[left] duration-100 ease-linear" style={{ left: pct }}>
            <span className="absolute inset-y-[-4px] left-0 w-px bg-foreground" />
            <span className="absolute -top-1.5 -left-[3px] size-[7px] rounded-full bg-foreground ring-2 ring-background transition-transform duration-200 group-hover:scale-125" />
          </div>
        </div>
        <div aria-hidden="true" className="num flex justify-between text-[11px] text-faint">
          <span>{fmtEnd(scene.since)}</span>
          <span>{fmtEnd(scene.until)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? t("observatory.wabisabi.timeline.pause", { defaultValue: "Pause" }) : t("observatory.wabisabi.timeline.play", { defaultValue: "Play" })}
            className={`${BTN} size-10 shrink-0 rounded-full border border-hairline-strong bg-surface-1 text-foreground hover:bg-surface-2`}
          >
            {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" className="translate-x-px" />}
          </button>
          <span className="num text-sm text-foreground whitespace-nowrap" aria-live="off">{nowLabel}</span>
          <button
            type="button"
            data-testid="obs-live-pill"
            aria-pressed={live}
            onClick={() => { if (!live) onScrub(1); }}
            title={live ? undefined : t("observatory.wabisabi.timeline.goLive", { defaultValue: "Jump to live" })}
            className={`${BTN} gap-2 px-3 eyebrow !leading-none ${live ? "!text-success bg-success/10 ring-1 ring-success/30 cursor-default" : "hover:!text-foreground ring-1 ring-hairline"}`}
          >
            <span aria-hidden="true" className={`size-1.5 rounded-full ${live ? "bg-success motion-safe:animate-pulse" : "ring-1 ring-current"}`} />
            {t("observatory.wabisabi.timeline.live", { defaultValue: "Live" })}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t("observatory.wabisabi.timeline.period", { defaultValue: "Period" })} className="inline-flex gap-1 p-1 rounded-lg bg-surface-inset border border-card-border">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                onClick={() => onPeriod(p)}
                className={`${BTN} num px-3 text-sm ${period === p ? "bg-surface-elevated text-foreground shadow-sm ring-1 ring-hairline-strong" : "text-muted hover:text-foreground"}`}
              >
                {t(`observatory.wabisabi.period.${p}`, { defaultValue: p === 1 ? "24 h" : `${p} d` })}
              </button>
            ))}
          </div>
          {extra}
        </div>
      </div>
    </div>
  );
}
