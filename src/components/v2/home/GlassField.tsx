"use client";

import { useEffect, useRef, type RefObject } from "react";
import { COLORS, V2_LIGHT_PALETTE, hexToRgba } from "@/lib/palette";
import { useV2Palette } from "../useV2Palette";
import { sampleEvenly, type FieldUtxo } from "./field-labels";

/** Pre-formatted, translated label for one UTXO (built once by the parent). */
export interface FieldLabel {
  title: string;
  sub: string;
  color: string;
}

export interface GlassFieldProps {
  utxos: readonly FieldUtxo[];
  labels: readonly FieldLabel[];
  captions: { inView: (n: number) => string; locked: string; hubTitle: string; hubSub: string };
  /** When true the lens parks over `lockTarget` (the scan input). */
  locked: boolean;
  lockTarget: RefObject<HTMLElement | null>;
  /** Labels are never drawn over children of `[data-keepout]` elements inside this one (hero text and controls). */
  avoid: RefObject<HTMLElement | null>;
  /** Receives the number of distinct UTXOs the lens has labelled so far. */
  counter: RefObject<HTMLElement | null>;
}

interface Path { ax: number; ay: number; bx: number; by: number; c1: number; c2: number; len: number }
interface Particle { u: number; p: Path; t: number; sp: number; seen: boolean; x: number; y: number; x0: number; y0: number }

const MAG = 1.7;
const ORANGE = COLORS.bitcoin;

function bz(p: Path, t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p.ax + b * p.c1 + c * p.c2 + d * p.bx, (a + b) * p.ay + (c + d) * p.by];
}

/**
 * "Glass Mempool": the hero background. Each particle is one real UTXO of the
 * bundled WabiSabi CoinJoin (inputs stream into the tx bar, outputs stream
 * out). A lens follows the pointer (or roams on touch / idle) and labels the
 * UTXOs under it with facts derived from their values. Decorative only: the
 * page works fully without it (aria-hidden, no interaction required).
 */
export function GlassField({ utxos, labels, captions, locked, lockTarget, avoid, counter }: GlassFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const P = useV2Palette();
  const live = useRef({ labels, captions, locked });
  useEffect(() => { live.current = { labels, captions, locked }; }, [labels, captions, locked]);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const host = cv.parentElement!;
    const RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    const mono = getComputedStyle(cv).fontFamily || "ui-monospace, monospace";
    let W = 0, H = 0, hub = { x: 0, y0: 0, y1: 0 };
    let parts: Particle[] = [], dim: HTMLCanvasElement | null = null, bright: HTMLCanvasElement | null = null;
    let seenCount = 0, time = 9000;
    const L = { x: 0, y: 0, r: 130, tx: 0, ty: 0, tr: 130, lockA: 0, vis: 1 };
    let topInset = 12;
    let ptr: [number, number] | null = null, ptrT = -1e9;
    let seed = 21_000_000;
    const rnd = () => ((seed = (Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x6d2b79f5) | 0) >>> 0) / 4294967296;

    const layer = (paths: Path[], alpha: number, bar: boolean) => {
      const o = document.createElement("canvas");
      o.width = W * DPR; o.height = H * DPR;
      const g = o.getContext("2d")!;
      g.scale(DPR, DPR);
      g.strokeStyle = hexToRgba(P.muted, alpha);
      g.lineWidth = 1;
      g.beginPath();
      for (const p of paths) { g.moveTo(p.ax, p.ay); g.bezierCurveTo(p.c1, p.ay, p.c2, p.by, p.bx, p.by); }
      g.stroke();
      // The tx bar only shows under the lens (in the open field it read as a stray line).
      if (bar) { g.fillStyle = hexToRgba(P.foreground, Math.min(1, alpha * 3)); g.fillRect(hub.x - 1.5, hub.y0, 3, hub.y1 - hub.y0); }
      return o;
    };

    const build = () => {
      W = host.clientWidth; H = host.clientHeight;
      if (!W || !H) return;
      cv.width = W * DPR; cv.height = H * DPR;
      seed = 21_000_000;
      const mob = W < 700;
      hub = { x: W * (mob ? 0.88 : 0.8), y0: H * 0.2, y1: H * 0.8 };
      const cap = Math.min(mob ? 220 : 600, Math.round((W * H) / (mob ? 1400 : 1800)));
      const chosen = sampleEvenly(utxos.map((_, i) => i), cap);
      const nIn = chosen.filter((i) => utxos[i]!.side === "in").length;
      let kIn = 0, kOut = 0;
      const nOut = chosen.length - nIn;
      const paths: Path[] = [];
      parts = chosen.map((u) => {
        const isIn = utxos[u]!.side === "in";
        const k = isIn ? kIn++ : kOut++;
        const barY = hub.y0 + ((k + 0.5) / (isIn ? nIn : nOut)) * (hub.y1 - hub.y0);
        const edgeY = -20 + rnd() * (H + 40);
        const p: Path = isIn
          ? { ax: -30, ay: edgeY, bx: hub.x, by: barY, c1: 0, c2: 0, len: 0 }
          : { ax: hub.x, ay: barY, bx: W + 30, by: edgeY, c1: 0, c2: 0, len: 0 };
        const dx = p.bx - p.ax;
        p.c1 = p.ax + dx * 0.5; p.c2 = p.bx - dx * 0.5;
        p.len = Math.hypot(dx, p.by - p.ay) * 1.15;
        paths.push(p);
        return { u, p, t: rnd(), sp: 22 + rnd() * 40, seen: false, x: 0, y: 0, x0: 0, y0: 0 };
      });
      seenCount = 0;
      dim = layer(paths, 0.05, false);
      bright = layer(paths, 0.36, true);
      if (!L.x) { L.x = W * 0.78; L.y = H * 0.3; }
    };

    const target = (now: number) => {
      const mob = W < 700;
      L.tr = mob ? 88 : 140;
      const el = lockTarget.current;
      if (live.current.locked && el) {
        const r = el.getBoundingClientRect(), h = cv.getBoundingClientRect();
        L.tx = r.left - h.left + r.width / 2; L.ty = r.top - h.top + r.height / 2;
        L.tr = Math.min(r.width * 0.5 + 24, 380);
      } else if (RM) {
        L.tx = W * (mob ? 0.74 : 0.8); L.ty = H * (mob ? 0.1 : 0.3);
      } else if (ptr && now - ptrT < 3500) {
        [L.tx, L.ty] = ptr;
      } else {
        const s = time * 0.001;
        L.tx = W * 0.5 + W * 0.4 * Math.cos(s * 0.19);
        L.ty = H * 0.5 + H * 0.36 * Math.sin(s * 0.31 + 0.8);
      }
      if (!live.current.locked) {
        // Lens, ticks and spilled labels stay inside the canvas and below the sticky header.
        const m = L.tr + 34;
        L.tx = Math.max(L.tr + 20, Math.min(W - L.tr - 20, L.tx));
        L.ty = Math.max(topInset + m, Math.min(H - m, L.ty));
      }
    };
    const inKeepOut = (x: number, y: number, pad: number) =>
      keepOut.some((r) => x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad);

    let keepOut: DOMRect[] = [];
    const tagBox = (x: number, y: number, title: string, sub: string, color: string) => {
      ctx.font = `500 11px ${mono}`;
      const w = Math.max(ctx.measureText(title).width, ctx.measureText(sub).width) + 18;
      const bx = x + w > W - 8 ? x - w - 20 : x;
      if (y < topInset || y + 32 > H - 4) return false;
      if (keepOut.some((r) => bx < r.right + 6 && bx + w > r.left - 6 && y < r.bottom + 6 && y + 32 > r.top - 6)) return false;
      ctx.fillStyle = hexToRgba(P.background, 0.92); ctx.fillRect(bx, y, w, 32);
      ctx.fillStyle = color; ctx.fillRect(bx, y, 2, 32);
      ctx.strokeStyle = hexToRgba(P.foreground, 0.08); ctx.strokeRect(bx + 0.5, y + 0.5, w - 1, 31);
      ctx.fillStyle = P.foreground; ctx.fillText(title, bx + 9, y + 13);
      ctx.font = `400 10px ${mono}`; ctx.fillStyle = P.muted; ctx.fillText(sub, bx + 9, y + 26);
      return true;
    };

    const frame = (dt: number, now: number) => {
      if (!W || !dim || !bright) return;
      const { labels: lab, captions: cap, locked: lk } = live.current;
      // Page text blocks (labels, dots and, on phones, the lens itself stay off them) and the header overlap.
      const h = cv.getBoundingClientRect();
      keepOut = avoid.current
        ? [...avoid.current.querySelectorAll("[data-keepout] > *")].map((el) => { const r = el.getBoundingClientRect(); return new DOMRect(r.left - h.left, r.top - h.top, r.width, r.height); })
        : [];
      const hdr = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
      topInset = Math.max(0, hdr - h.top) + 12;
      target(now);
      const k = RM ? 1 : 1 - Math.pow(0.001, (dt / 1000) * 1.4);
      L.x += (L.tx - L.x) * k; L.y += (L.ty - L.y) * k; L.r += (L.tr - L.r) * k;
      L.lockA += ((lk ? 1 : 0) - L.lockA) * k;
      // Phones: the text fills the hero, so the lens fades to a ghost while it passes behind text.
      L.vis += ((W < 700 && !lk && inKeepOut(L.x, L.y, L.r * 0.4) ? 0.12 : 1) - L.vis) * (RM ? 1 : k);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(dim, 0, 0, W, H);
      const R = L.r, R2 = (R / MAG) ** 2, inLens: Particle[] = [];
      ctx.lineCap = "round"; ctx.lineWidth = 1.4;
      ctx.strokeStyle = hexToRgba(P.muted, 0.32);
      ctx.beginPath();
      const seen: Particle[] = [];
      for (const p of parts) {
        if (!RM) { p.t += (p.sp * dt) / 1000 / p.p.len; if (p.t >= 1) p.t -= 1; }
        [p.x, p.y] = bz(p.p, p.t);
        [p.x0, p.y0] = bz(p.p, Math.max(0, p.t - 0.03));
        const dx = p.x - L.x, dy = p.y - L.y;
        if (dx * dx + dy * dy < R2) {
          inLens.push(p);
          if (!p.seen && !RM && L.lockA < 0.5 && L.vis > 0.9) { p.seen = true; seenCount++; }
        }
        if (p.seen) seen.push(p); else { ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x, p.y); }
      }
      ctx.stroke();
      // Once labelled, a UTXO stays marked: the label follows the coin.
      ctx.strokeStyle = hexToRgba(COLORS.bitcoin, 0.34);
      ctx.beginPath();
      for (const p of seen) { ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x, p.y); }
      ctx.stroke();

      // The lens: darkened glass, magnified bright paths, scanlines.
      ctx.save();
      ctx.globalAlpha = L.vis;
      ctx.beginPath(); ctx.arc(L.x, L.y, R, 0, 7); ctx.clip();
      ctx.fillStyle = hexToRgba(P.background, 0.66); ctx.fillRect(L.x - R, L.y - R, R * 2, R * 2);
      const gl = ctx.createRadialGradient(L.x, L.y - R * 0.4, R * 0.1, L.x, L.y, R);
      gl.addColorStop(0, hexToRgba(COLORS.bitcoin, 0.08)); gl.addColorStop(1, hexToRgba(P.background, 0.5));
      ctx.fillStyle = gl; ctx.fillRect(L.x - R, L.y - R, R * 2, R * 2);
      ctx.save();
      ctx.translate(L.x, L.y); ctx.scale(MAG, MAG); ctx.translate(-L.x, -L.y);
      ctx.drawImage(bright, 0, 0, W, H);
      ctx.restore();
      ctx.fillStyle = hexToRgba(P.foreground, 0.025);
      for (let y = L.y - R; y < L.y + R; y += 3) ctx.fillRect(L.x - R, y, R * 2, 1);
      const marks: { p: Particle; mx: number; my: number }[] = [];
      for (const p of inLens) {
        const mx = L.x + (p.x - L.x) * MAG, my = L.y + (p.y - L.y) * MAG;
        if (inKeepOut(mx, my, 4)) continue;
        ctx.fillStyle = lab[p.u]?.color ?? P.muted;
        ctx.globalAlpha = 0.9 * L.vis;
        ctx.beginPath(); ctx.arc(mx, my, 1.6 + Math.log10(utxos[p.u]!.value + 10) / 3.2, 0, 7); ctx.fill();
        marks.push({ p, mx, my });
      }
      ctx.globalAlpha = L.vis;
      const hdx = hub.x - L.x, hmy = L.y + ((hub.y0 + hub.y1) / 2 - L.y) * MAG;
      const showHub = Math.abs(hdx) < R / MAG && !marks.length;
      if (Math.abs(hdx) < R / MAG) {
        ctx.fillStyle = P.foreground;
        ctx.fillRect(L.x + hdx * MAG - 2, L.y + (hub.y0 - L.y) * MAG, 4, (hub.y1 - hub.y0) * MAG);
      }
      ctx.restore();

      // Labels spill over the rim like sticky notes.
      ctx.globalAlpha = L.vis;
      const max = L.lockA > 0.3 || L.vis < 0.9 ? 0 : W < 700 ? 3 : 6;
      const placed: [number, number][] = [];
      marks.sort((a, b) => a.p.u - b.p.u);
      for (const m of marks) {
        if (placed.length >= max) break;
        const bx = m.mx + 10, by = m.my - 24;
        if (placed.some(([x, y]) => Math.abs(x - bx) < 160 && Math.abs(y - by) < 36)) continue;
        const l = lab[m.p.u];
        if (!l || !tagBox(bx, by, l.title, l.sub, l.color)) continue;
        placed.push([bx, by]);
        ctx.strokeStyle = l.color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(m.mx, m.my, 6, 0, 7); ctx.stroke();
      }
      if (showHub && max) tagBox(L.x + hdx * MAG + 12, hmy - 16, cap.hubTitle, cap.hubSub, P.severityGood);

      // Rim, ticks and caption.
      const ring = L.lockA > 0.5 ? ORANGE : hexToRgba(COLORS.bitcoin, 0.55);
      ctx.lineWidth = 1.25; ctx.strokeStyle = ring;
      ctx.beginPath(); ctx.arc(L.x, L.y, R, 0, 7); ctx.stroke();
      ctx.lineWidth = 6; ctx.strokeStyle = hexToRgba(COLORS.bitcoin, 0.16);
      ctx.beginPath(); ctx.arc(L.x, L.y, R + 4, 0, 7); ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = ring;
      ctx.beginPath();
      const rot = time * 0.0002;
      for (let i = 0; i < 24; i++) {
        const a = rot + (i * Math.PI) / 12, len = i % 6 ? 5 : 11;
        ctx.moveTo(L.x + Math.cos(a) * (R + 8), L.y + Math.sin(a) * (R + 8));
        ctx.lineTo(L.x + Math.cos(a) * (R + 8 + len), L.y + Math.sin(a) * (R + 8 + len));
      }
      ctx.stroke();
      if (W >= 700 || L.lockA > 0.5) {
        ctx.font = `500 10px ${mono}`; ctx.fillStyle = P === V2_LIGHT_PALETTE ? P.bitcoinText : ring; ctx.textAlign = "center";
        ctx.fillText(L.lockA > 0.5 ? cap.locked : cap.inView(inLens.length), L.x, L.y + R + 30);
        ctx.textAlign = "left";
      }
      ctx.globalAlpha = 1;
      if (counter.current) counter.current.textContent = String(seenCount);
    };

    let raf = 0, last = 0, inView = true;
    const loop = (now: number) => {
      const dt = Math.min(50, now - (last || now));
      last = now; time += dt;
      frame(dt, now);
      raf = requestAnimationFrame(loop);
    };
    const start = () => { if (RM || raf || !inView || document.hidden) return; last = 0; raf = requestAnimationFrame(loop); };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const still = () => {
      L.tx = L.x = W * (W < 700 ? 0.74 : 0.8); L.ty = L.y = H * (W < 700 ? 0.1 : 0.3);
      ptr = null;
      frame(16, 0);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = cv.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom) return;
      ptr = [e.clientX - r.left, e.clientY - r.top]; ptrT = performance.now();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      const r = cv.getBoundingClientRect();
      ptr = [e.clientX - r.left, e.clientY - r.top]; ptrT = performance.now();
    };
    const onVis = () => (document.hidden ? stop() : start());
    const io = new IntersectionObserver(([e]) => { inView = !!e?.isIntersecting; if (inView) start(); else stop(); });
    let rt: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (host.clientWidth !== W || host.clientHeight !== H) { build(); if (RM) still(); } }, 120);
    });

    build();
    if (RM) void document.fonts.ready.then(still);
    else start();
    window.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    io.observe(cv);
    ro.observe(host);
    return () => {
      stop(); clearTimeout(rt); io.disconnect(); ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerdown", onDown);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [utxos, lockTarget, avoid, counter, P]);

  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full -z-10 pointer-events-none font-mono" />;
}
