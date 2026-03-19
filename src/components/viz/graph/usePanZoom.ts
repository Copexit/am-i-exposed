import { useRef, useEffect, useState, useCallback } from "react";
import type { ViewTransform } from "./types";
import { MIN_ZOOM, MAX_ZOOM } from "./constants";

interface UsePanZoomOptions {
  viewTransform?: ViewTransform;
  onViewTransformChange?: (vt: ViewTransform) => void;
  /** Called when pan starts to dismiss interactive state (tooltip, selection, etc.). */
  onPanStart?: () => void;
  /** Called on each wheel-zoom event (e.g. to hide tooltips). */
  onWheel?: () => void;
}

interface UsePanZoomReturn {
  svgRef: React.RefObject<SVGSVGElement | null>;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  isPanning: boolean;
  /** Attach to the invisible pan-capture rect's onMouseDown. */
  handlePanStart: (e: React.MouseEvent) => void;
}

/**
 * Hook that manages pan (mouse drag + single-finger touch), pinch-to-zoom
 * (two-finger touch), and wheel-to-zoom interactions for a fullscreen
 * SVG graph canvas.
 *
 * Only activates when `viewTransform` and `onViewTransformChange` are provided
 * (i.e. the canvas is in fullscreen / transform mode).
 */
export function usePanZoom({
  viewTransform,
  onViewTransformChange,
  onPanStart,
  onWheel,
}: UsePanZoomOptions): UsePanZoomReturn {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panRef = useRef({ active: false, startX: 0, startY: 0, vtX: 0, vtY: 0, scale: 1 });
  const pinchRef = useRef({ active: false, startDist: 0, startScale: 1, midX: 0, midY: 0 });
  const viewTransformRef = useRef(viewTransform);
  viewTransformRef.current = viewTransform;
  const [isPanning, setIsPanning] = useState(false);

  // ─── Mouse pan ─────────────────────────────────────────────────

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (!viewTransform || !onViewTransformChange || e.button !== 0) return;
    e.preventDefault();
    panRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      vtX: viewTransform.x,
      vtY: viewTransform.y,
      scale: viewTransform.scale,
    };
    setIsPanning(true);
    onPanStart?.();
  }, [viewTransform, onViewTransformChange, onPanStart]);

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      if (!panRef.current.active) return;
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      onViewTransformChange?.({
        scale: panRef.current.scale,
        x: panRef.current.vtX + dx,
        y: panRef.current.vtY + dy,
      });
    };
    const onUp = () => {
      panRef.current.active = false;
      setIsPanning(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isPanning, onViewTransformChange]);

  // ─── Wheel-to-zoom ────────────────────────────────────────────

  useEffect(() => {
    if (!viewTransform || !onViewTransformChange) return;
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const vt = viewTransformRef.current;
      if (!vt) return;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const gx = (cx - vt.x) / vt.scale;
      const gy = (cy - vt.y) / vt.scale;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vt.scale * factor));
      onViewTransformChange({ x: cx - gx * ns, y: cy - gy * ns, scale: ns });
      onWheel?.();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!viewTransform, onViewTransformChange]);

  // ─── Touch gestures: single-finger pan + two-finger pinch ─────

  useEffect(() => {
    if (!viewTransform || !onViewTransformChange) return;
    const el = wrapperRef.current;
    if (!el) return;

    const PAN_THRESHOLD = 8;
    const dist = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    let pendingPan: { startX: number; startY: number; vtX: number; vtY: number; scale: number } | null = null;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pendingPan = null;
        const vt = viewTransformRef.current;
        if (!vt) return;
        const t0 = e.touches[0], t1 = e.touches[1];
        const rect = el.getBoundingClientRect();
        pinchRef.current = {
          active: true,
          startDist: dist(t0, t1),
          startScale: vt.scale,
          midX: (t0.clientX + t1.clientX) / 2 - rect.left,
          midY: (t0.clientY + t1.clientY) / 2 - rect.top,
        };
        panRef.current.active = false;
      } else if (e.touches.length === 1) {
        const vt = viewTransformRef.current;
        if (!vt) return;
        const t = e.touches[0];
        pendingPan = { startX: t.clientX, startY: t.clientY, vtX: vt.x, vtY: vt.y, scale: vt.scale };
        pinchRef.current.active = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (pinchRef.current.active && e.touches.length === 2) {
        e.preventDefault();
        const vt = viewTransformRef.current;
        if (!vt) return;
        const t0 = e.touches[0], t1 = e.touches[1];
        const curDist = dist(t0, t1);
        const ratio = curDist / pinchRef.current.startDist;
        const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchRef.current.startScale * ratio));
        const { midX, midY } = pinchRef.current;
        const gx = (midX - vt.x) / vt.scale;
        const gy = (midY - vt.y) / vt.scale;
        onViewTransformChange({ x: midX - gx * ns, y: midY - gy * ns, scale: ns });
      } else if (e.touches.length === 1) {
        const t = e.touches[0];

        if (pendingPan && !panRef.current.active) {
          const moved = Math.hypot(t.clientX - pendingPan.startX, t.clientY - pendingPan.startY);
          if (moved >= PAN_THRESHOLD) {
            panRef.current = {
              active: true,
              startX: pendingPan.startX,
              startY: pendingPan.startY,
              vtX: pendingPan.vtX,
              vtY: pendingPan.vtY,
              scale: pendingPan.scale,
            };
            pendingPan = null;
            setIsPanning(true);
            onPanStart?.();
          }
        }

        if (panRef.current.active) {
          e.preventDefault();
          const dx = t.clientX - panRef.current.startX;
          const dy = t.clientY - panRef.current.startY;
          onViewTransformChange({
            scale: panRef.current.scale,
            x: panRef.current.vtX + dx,
            y: panRef.current.vtY + dy,
          });
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      pendingPan = null;
      if (e.touches.length < 2) pinchRef.current.active = false;
      if (e.touches.length === 0) {
        panRef.current.active = false;
        setIsPanning(false);
      }
      if (e.touches.length === 1 && !pinchRef.current.active) {
        const vt = viewTransformRef.current;
        if (!vt) return;
        const t = e.touches[0];
        pendingPan = { startX: t.clientX, startY: t.clientY, vtX: vt.x, vtY: vt.y, scale: vt.scale };
      }
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: false });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!viewTransform, onViewTransformChange]);

  return { svgRef, wrapperRef, isPanning, handlePanStart };
}
