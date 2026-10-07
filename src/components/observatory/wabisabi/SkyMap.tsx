"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, X } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { MAX_LIVE_PARTICLES, REPLAY_SECONDS, replayTime, type Scene, type SkyEvent, type Star } from "@/lib/observatory/sky-model";
import { coordinatorColorVar } from "@/lib/observatory/coordinator-palette";
import { TXID_RE } from "@/lib/constants";
import { fmtBtc, fmtCount } from "@/lib/observatory/obs-format";
import type { Period } from "@/lib/observatory/wabisator-client";
import { usePeriodLabel } from "./StatsStrip";
import {
  SkyClock, createDynamics, drawBackdrop, drawFrame, layoutSky, pulseAt, resolvePalette, step,
  type SkyFonts, type SkyLayout, type SkyPalette,
} from "./sky-renderer";

// ---------- small hooks ----------

/** A live media query. False on the server and where matchMedia is missing. */
export function useMedia(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
    mq?.addEventListener?.("change", cb);
    return () => mq?.removeEventListener?.("change", cb);
  }, [query]);
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * The replay clock: progress runs 0 to 1 over REPLAY_SECONDS[period], then the map is live.
 * The clock object is mutated in place (the canvas loop reads it every frame); `progress` is a
 * 10 Hz React mirror for the timeline and the ticker. Reduced motion starts live and paused, so
 * scrubbing only moves the playhead; Play still runs the replay for the ticker and timeline.
 */
export function useSkyClock(period: Period, reduced: boolean) {
  const [clock] = useState(() => new SkyClock(REPLAY_SECONDS[period], 0, nowMs()));
  const [progress, setProgress] = useState(() => clock.progress(nowMs()));
  const [playing, setPlaying] = useState(true);
  const [seen, setSeen] = useState({ period, reduced: false });

  // A new period restarts the replay; reduced motion (known only after hydration) parks it at live.
  // Reset during render, so no frame shows the old progress.
  if (seen.period !== period || seen.reduced !== reduced) {
    setSeen({ period, reduced });
    const now = nowMs();
    if (seen.period !== period) clock.restart(REPLAY_SECONDS[period], 0, now);
    if (reduced) {
      if (clock.playing) clock.toggle(now);
      clock.jump(1, now);
    }
    setPlaying(clock.playing);
    setProgress(clock.anchor);
  }

  const live = progress >= 1;
  useEffect(() => {
    if (!playing || live) return;
    const id = setInterval(() => setProgress(clock.progress(nowMs())), 100);
    return () => clearInterval(id);
  }, [playing, live, clock]);

  const scrub = useCallback((p: number) => {
    clock.jump(p, nowMs());
    setProgress(clock.anchor);
  }, [clock]);

  const toggle = useCallback(() => {
    clock.toggle(nowMs());
    setPlaying(clock.playing);
    setProgress(clock.anchor);
  }, [clock]);

  return { clock, progress, playing, live, scrub, toggle };
}

// ---------- canvas helpers ----------

let measureCtx: CanvasRenderingContext2D | null | undefined;
function measure(text: string, font: string): number {
  if (measureCtx === undefined) measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function readTheme(): { palette: (tokens: string[]) => SkyPalette; fonts: SkyFonts } {
  const root = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const read = (n: string) => root.getPropertyValue(n) || body.getPropertyValue(n);
  const mono = body.getPropertyValue("--font-geist-mono").trim();
  return {
    palette: (tokens) => resolvePalette(read, tokens),
    fonts: { sans: body.fontFamily || "system-ui, sans-serif", mono: mono ? `${mono}, ui-monospace, monospace` : "ui-monospace, monospace" },
  };
}

const TIP = "rounded-xl border border-(--glass-border) bg-(--obs-panel) backdrop-blur-md px-3.5 py-3 text-xs shadow-(--overlay-shadow) motion-safe:animate-[obs-fade_180ms_ease-out]";

/** Positions a panel beside an anchor point, flipping and clamping so the map never clips it. */
function useAnchored(ref: React.RefObject<HTMLElement | null>, anchor: { x: number; y: number; r: number } | null, box: { w: number; h: number }, prefer: "right" | "left") {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const w = el.offsetWidth, h = el.offsetHeight, gap = anchor.r + 14, M = 8;
    const right = anchor.x + gap, left = anchor.x - gap - w;
    let x = prefer === "right" ? (right + w <= box.w - M ? right : left) : (left >= M ? left : right);
    let y = anchor.y - h / 2;
    // Too narrow for either side: sit below (or above) the star instead.
    if (x < M || x + w > box.w - M) {
      x = anchor.x - w / 2;
      y = anchor.y + gap + h <= box.h - M ? anchor.y + gap : anchor.y - gap - h;
    }
    el.style.left = `${Math.max(M, Math.min(box.w - w - M, x))}px`;
    el.style.top = `${Math.max(M, Math.min(box.h - h - M, y))}px`;
  });
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-foreground">{value}</dd>
    </div>
  );
}

function useFmt() {
  const { i18n } = useTranslation();
  const locale = i18n.language || "en";
  return {
    locale,
    btc: (v: number) => `${fmtBtc(v, locale)} BTC`,
    count: (v: number) => fmtCount(v, locale),
    time: (t: number, withDate: boolean) =>
      new Date(t * 1000).toLocaleString(locale, withDate ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" }),
  };
}

/** A CoinJoin's facts; with `onClose`, the pinned card with the analyze link. */
export function EventDetails({ event, star, withDate, onClose }: { event: SkyEvent; star: Star | undefined; withDate: boolean; onClose?: () => void }) {
  const { t } = useTranslation();
  const f = useFmt();
  return (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: coordinatorColorVar(event.star) }} />
            <span className="truncate">{star?.name ?? event.star}</span>
          </p>
          <p className="num mt-0.5 text-faint">{f.time(event.t, withDate)}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("observatory.wabisabi.event.close", { defaultValue: "Close" })}
            className="-mr-2 -mt-2 inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-bitcoin cursor-pointer"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="num text-xl leading-none text-foreground">{f.btc(event.volume)}</p>
      {event.analyzed ? (
        <dl className="space-y-1">
          <Row label={t("observatory.wabisabi.event.inputs", { defaultValue: "Inputs" })} value={f.count(event.inputs)} />
          <Row label={t("observatory.wabisabi.event.outputs", { defaultValue: "Outputs" })} value={f.count(event.outputs)} />
          <Row label={t("observatory.wabisabi.event.anonset", { defaultValue: "Anonset" })} value={event.anonset.toLocaleString(f.locale, { maximumFractionDigits: 1 })} />
          <Row label={t("observatory.wabisabi.event.feeRate", { defaultValue: "Fee rate" })} value={`${event.feeRate.toLocaleString(f.locale, { maximumFractionDigits: 2 })} sat/vB`} />
        </dl>
      ) : (
        <p className="text-muted">{t("observatory.wabisabi.event.notAnalyzed", { defaultValue: "Not analysed yet" })}</p>
      )}
      {onClose && TXID_RE.test(event.txid) && (
        <a
          href={`/#tx=${event.txid}`}
          className="mt-1 inline-flex min-h-10 items-center gap-1.5 rounded-lg text-sm font-medium text-bitcoin-text transition-colors hover:text-bitcoin focus-visible:outline-2 focus-visible:outline-bitcoin"
        >
          {t("observatory.wabisabi.event.analyze", { defaultValue: "Analyze in am-i.exposed" })}
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

function StarDetails({ star }: { star: Star }) {
  const { t } = useTranslation();
  const f = useFmt();
  return (
    <div className="space-y-2.5 min-w-48">
      <p className="flex items-center gap-2 font-medium text-foreground">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: coordinatorColorVar(star.key) }} />
        {star.name}
        <span className={`ml-auto eyebrow ${star.online ? "!text-success" : ""}`}>
          {star.online ? t("observatory.wabisabi.map.online", { defaultValue: "Online" }) : t("observatory.wabisabi.map.offline", { defaultValue: "Offline" })}
        </span>
      </p>
      <dl className="space-y-1">
        <Row label={t("observatory.wabisabi.stats.volume", { defaultValue: "Volume" })} value={f.btc(star.volume)} />
        <Row label={t("observatory.wabisabi.stats.coinjoins", { defaultValue: "CoinJoins" })} value={f.count(star.coinjoins)} />
        <Row label={t("observatory.wabisabi.map.fresh", { defaultValue: "Fresh" })} value={f.btc(star.freshBtc)} />
        <Row label={t("observatory.wabisabi.map.remixIn", { defaultValue: "Remix in" })} value={f.btc(star.remixIn)} />
        <Row label={t("observatory.wabisabi.map.remixOut", { defaultValue: "Remix out" })} value={f.btc(star.remixOut)} />
      </dl>
    </div>
  );
}

// ---------- the map ----------

/**
 * The sky's frame. Light: a deep-ink card with rounded corners. Dark: near-black, bled into the
 * page gutters, its edges dissolved into the page by the canvas vignette.
 */
export const skyCardClass = (theme: "dark" | "light") =>
  `relative isolate overflow-hidden bg-(--obs-sky) h-[60vh] min-h-[440px] sm:h-[70vh] sm:min-h-[520px] max-h-[820px] ${
    theme === "light" ? "rounded-2xl ring-1 ring-hairline shadow-(--shadow-card)" : "-mx-4 sm:-mx-6 lg:-mx-8"
  }`;

export interface SkyMapProps {
  scene: Scene;
  period: Period;
  /** The replay clock from useSkyClock. */
  clock: SkyClock;
  highlightTx: string | null;
  selected?: string | null;
  onSelectStar: (key: string) => void;
  onSelectEvent: (txid: string | null) => void;
  /** Panel on the right of the sky (desktop ticker); the stars keep clear of it. */
  aside?: ReactNode;
  /** Overlay along the bottom of the sky (the stats strip); the stars keep clear of it. */
  children?: ReactNode;
}

/**
 * The living WabiSabi map: one star per coordinator, pulses for CoinJoins, particles for fresh and
 * remixed coins. One rAF loop, paused off-screen and in hidden tabs; static under reduced motion.
 */
export function SkyMap({ scene, period, clock, highlightTx, selected = null, onSelectStar, onSelectEvent, aside, children }: SkyMapProps) {
  const { t } = useTranslation();
  const f = useFmt();
  const periodLabel = usePeriodLabel(period);
  const { theme } = useTheme();
  const reduced = useReducedMotion();

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [box, setBox] = useState({ w: 0, h: 0, bottom: 0, right: 0, dpr: 1 });
  const [fontsReady, setFontsReady] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [pulseHover, setPulseHover] = useState<string | null>(null);

  // Size: the card, the bottom overlay and the aside.
  useLayoutEffect(() => {
    const measureBox = () => {
      const el = wrapRef.current;
      if (!el) return;
      const asideW = asideRef.current?.offsetWidth ?? 0;
      setBox((b) => {
        const n = { w: el.clientWidth, h: el.clientHeight, bottom: overlayRef.current?.offsetHeight ?? 0, right: asideW, dpr: Math.min(2, window.devicePixelRatio || 1) };
        return n.w === b.w && n.h === b.h && n.bottom === b.bottom && n.right === b.right && n.dpr === b.dpr ? b : n;
      });
    };
    measureBox();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measureBox);
    for (const el of [wrapRef.current, overlayRef.current, asideRef.current]) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Colours and fonts, re-resolved on theme change and once web fonts load.
  const tokens = useMemo(() => [...new Set(scene.stars.map((s) => s.colorToken).concat("--coord-other"))], [scene.stars]);
  const tokenKey = tokens.join(",");
  const look = useMemo(() => {
    if (typeof document === "undefined") return null;
    const th = readTheme();
    return { palette: th.palette(tokenKey.split(",")), fonts: th.fonts };
    // theme and fontsReady are triggers: the values come from the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, tokenKey, fontsReady]);
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) setFontsReady((n) => n + 1); });
    return () => { alive = false; };
  }, []);

  const mobile = box.w > 0 && box.w < 640;
  const layout: SkyLayout | null = useMemo(() => {
    if (!look) return null;
    return layoutSky(
      scene,
      { w: box.w, h: box.h, inset: { top: mobile ? 28 : 36, left: mobile ? 12 : 32, right: (box.right ? box.right + 8 : 0) + (mobile ? 12 : 32), bottom: box.bottom + (mobile ? 18 : 24) }, mobile },
      look.fonts,
      (_k, v) => f.btc(v),
      measure,
    );
    // f.btc only changes with the locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, box, look, mobile, f.locale]);

  const highlightEvent = useMemo(() => (highlightTx ? scene.events.find((e) => e.txid === highlightTx) ?? null : null), [highlightTx, scene.events]);
  const pulseEvent = useMemo(() => (pulseHover ? scene.events.find((e) => e.txid === pulseHover) ?? null : null), [pulseHover, scene.events]);

  // Mutable frame state: read by the loop without re-rendering.
  const dynRef = useRef(createDynamics());
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const uiRef = useRef({ hover, selected, highlight: highlightEvent ? { key: highlightEvent.star, txid: highlightEvent.txid } : null });
  useEffect(() => {
    uiRef.current = { hover, selected, highlight: highlightEvent ? { key: highlightEvent.star, txid: highlightEvent.txid } : null };
  });
  const drawRef = useRef<(dt: number) => void>(() => {});

  // Backdrop: once per layout, theme or motion preference. Reduced motion draws its only frame here.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout || !look || box.w === 0) return;
    const { dpr } = box;
    canvas.width = Math.round(box.w * dpr);
    canvas.height = Math.round(box.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bg = (bgRef.current ??= document.createElement("canvas"));
    bg.width = canvas.width;
    bg.height = canvas.height;
    const bctx = bg.getContext("2d");
    if (bctx) {
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBackdrop(bctx, layout, { palette: look.palette, scene, reduced, bleed: theme === "dark" });
    }
    const cap = mobile ? MAX_LIVE_PARTICLES.mobile : MAX_LIVE_PARTICLES.desktop;
    drawRef.current = (dt: number) => {
      const dyn = dynRef.current;
      if (!reduced) {
        const p = clock.progress(nowMs());
        const clockT = p >= 1 ? Infinity : replayTime(p, scene);
        if (clock.playing || dyn.epoch !== clock.epoch) step(dyn, layout, scene, clockT, clock.playing ? dt : 0, cap, clock.epoch);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, box.w, box.h);
      drawFrame(ctx, layout, reduced ? createDynamics() : dyn, look.palette, bctx ? bg : null, uiRef.current);
    };
    drawRef.current(0);
  }, [layout, look, box, reduced, scene, theme, mobile, clock]);

  // Reduced motion: redraw on interaction only.
  useEffect(() => {
    if (reduced) drawRef.current(0);
  }, [reduced, hover, selected, highlightEvent]);

  // The loop: one rAF, only while on screen and the tab is visible.
  useEffect(() => {
    if (reduced) return;
    const el = wrapRef.current;
    let onScreen = true;
    let raf = 0;
    let last = 0;
    const frame = (ts: number) => {
      const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
      last = ts;
      drawRef.current(dt);
      raf = requestAnimationFrame(frame);
    };
    const sync = () => {
      const run = onScreen && document.visibilityState !== "hidden";
      if (run && !raf) { last = 0; raf = requestAnimationFrame(frame); }
      if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    };
    const io = typeof IntersectionObserver !== "undefined" && el
      ? new IntersectionObserver(([e]) => { onScreen = !!e?.isIntersecting; sync(); })
      : null;
    if (io && el) io.observe(el);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      cancelAnimationFrame(raf);
    };
  }, [reduced]);

  const pointAt = (e: React.PointerEvent | React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!layout || reduced) return;
    const { x, y } = pointAt(e);
    const id = pulseAt(layout, dynRef.current, x, y);
    if (id !== pulseHover) setPulseHover(id);
  };
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!layout || reduced) return;
    const { x, y } = pointAt(e);
    const id = pulseAt(layout, dynRef.current, x, y);
    if (id) onSelectEvent(id);
  };

  const starByKey = useMemo(() => new Map(scene.stars.map((s) => [s.key, s])), [scene.stars]);
  const hoverStar = hover ? starByKey.get(hover) : undefined;
  const hoverPx = hover ? layout?.byKey.get(hover) ?? null : null;
  const cardEvent = highlightEvent;
  const cardPx = cardEvent ? layout?.byKey.get(cardEvent.star) ?? null : null;
  const pulsePx = pulseEvent && !cardEvent ? layout?.byKey.get(pulseEvent.star) ?? null : null;
  // Panels stay in the open sky: clear of the ticker aside and the stats strip.
  const open = { w: box.w - box.right, h: box.h - box.bottom };
  useAnchored(tipRef, hoverPx ?? pulsePx, open, "right");
  useAnchored(cardRef, cardPx, open, "left");

  const top = [...scene.stars].sort((a, b) => b.volume - a.volume)[0];
  const aria = scene.empty
    ? t("observatory.wabisabi.map.ariaEmpty", { defaultValue: "CoinJoin map for the last {{period}}: no CoinJoins.", period: periodLabel })
    : t("observatory.wabisabi.map.aria", {
        defaultValue: "CoinJoin map for the last {{period}}: {{count}} CoinJoins, {{volume}} BTC. Most active coordinator: {{top}}.",
        period: periodLabel,
        count: f.count(scene.totals.Coinjoins),
        volume: fmtBtc(scene.totals.Volume, f.locale),
        top: top?.name ?? "",
      });
  const withDate = period !== 1;
  return (
    <div
      ref={wrapRef}
      data-testid="obs-sky"
      className={skyCardClass(theme)}
    >
      {/* Dark-glass tokens for everything on the sky; the card frame above keeps the page tokens. */}
      <div className="obs-sky-scope absolute inset-0">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={aria}
          className={`absolute inset-0 size-full ${pulseHover ? "cursor-pointer" : ""}`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setPulseHover(null)}
          onClick={onCanvasClick}
        />

        {scene.empty && layout && (
          <p
            className="pointer-events-none absolute inset-x-0 text-center eyebrow !text-(--obs-sky-fg)/70 motion-safe:animate-[obs-fade_400ms_ease-out]"
            style={{ top: (layout.plot.y0 + layout.plot.y1) / 2 - 6 }}
          >
            {t("observatory.wabisabi.map.empty", { defaultValue: "No CoinJoins in this period" })}
          </p>
        )}

        {layout?.stars.map((s) => {
          const star = starByKey.get(s.key)!;
          const size = Math.max(40, 2 * s.r + 12);
          return (
            <button
              key={s.key}
              type="button"
              aria-label={t("observatory.wabisabi.map.star", { defaultValue: "{{name}}, {{volume}} in the last {{period}}", name: star.name, volume: f.btc(star.volume), period: periodLabel })}
              aria-pressed={selected === s.key}
              aria-describedby={hover === s.key ? "obs-sky-tip" : undefined}
              className="absolute rounded-full bg-transparent cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--obs-sky-fg)"
              style={{ left: s.x - size / 2, top: s.y - size / 2, width: size, height: size }}
              onPointerEnter={() => setHover(s.key)}
              onPointerLeave={() => setHover((h) => (h === s.key ? null : h))}
              onFocus={() => setHover(s.key)}
              onBlur={() => setHover((h) => (h === s.key ? null : h))}
              onClick={() => onSelectStar(s.key)}
            />
          );
        })}

        {aside && (
          <div
            ref={asideRef}
            className="absolute right-0 top-0 w-[360px] overflow-hidden p-5 [mask-image:linear-gradient(to_bottom,black_85%,transparent)]"
            style={{ bottom: box.bottom }}
          >
            {aside}
          </div>
        )}

        <div ref={overlayRef} className="absolute inset-x-0 bottom-0 p-3 sm:p-5 bg-gradient-to-t from-(--obs-sky)/80 to-transparent">
          {children}
        </div>

        {(hoverStar || (pulseEvent && !cardEvent)) && (
          <div ref={tipRef} id="obs-sky-tip" role="tooltip" key={hover ?? pulseHover} className={`pointer-events-none absolute z-10 ${TIP}`} style={{ left: -9999, top: 0 }}>
            {hoverStar ? <StarDetails star={hoverStar} /> : pulseEvent && <EventDetails event={pulseEvent} star={starByKey.get(pulseEvent.star)} withDate={withDate} />}
          </div>
        )}

        {cardEvent && (
          <div
            ref={cardRef}
            key={cardEvent.txid}
            id="obs-event-card"
            tabIndex={-1}
            role="dialog"
            aria-label={t("observatory.wabisabi.event.label", { defaultValue: "CoinJoin details" })}
            className={`absolute z-20 w-64 ${TIP}`}
            style={{ left: -9999, top: 0 }}
          >
            <EventDetails event={cardEvent} star={starByKey.get(cardEvent.star)} withDate={withDate} onClose={() => onSelectEvent(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
