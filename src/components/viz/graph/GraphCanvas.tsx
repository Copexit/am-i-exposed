"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { motion } from "motion/react";
import { Text } from "@visx/text";
import { SVG_COLORS } from "../shared/svgConstants";
import { probColor } from "../shared/linkabilityColors";
import { ChartDefs } from "../shared/ChartDefs";
import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { SCROLL_MARGIN_X, SCROLL_MARGIN_Y, MIN_ZOOM, MAX_ZOOM, ENTITY_CATEGORY_COLORS } from "./constants";
import { DUST_THRESHOLD } from "@/lib/constants";
import { layoutGraph, getNodeColor } from "./layout";
import { edgePath, getEdgeMaxProb, portAwareEdgePath } from "./edge-utils";
import { getScriptTypeColor, getScriptTypeDash, getEdgeThickness, isTimestampLocktime, getLockTimeRx, hexagonPoints, getVersionFill } from "./scriptStyles";
import { buildPortPositionMap } from "./portLayout";
import { GraphMinimap } from "./GraphMinimap";
import { ExpandedNode } from "./ExpandedNode";
import { computeDeterministicChains, buildDetChainEdgeSet } from "./deterministicChains";
import { detectToxicMerges, buildToxicMergeSet } from "./toxicChange";
import { computeEntropyPropagation, entropyColor } from "./privacyGradient";
import type { GraphCanvasProps, LayoutNode } from "./types";

export function GraphCanvas({
  nodes,
  rootTxid,
  rootTxids,
  walletUtxos,
  nodeCount,
  maxNodes,
  loading,
  onExpandInput,
  onExpandOutput,
  onCollapse,
  containerWidth,
  containerHeight,
  tooltip,
  scrollRef,
  filter,
  hoveredNode,
  setHoveredNode,
  selectedNode,
  setSelectedNode,
  focusedNode,
  setFocusedNode,
  heatMap,
  heatMapActive,
  isFullscreen,
  viewTransform,
  onViewTransformChange,
  linkabilityEdgeMode,
  fingerprintMode,
  entropyGradientMode,
  changeOutputs,
  rootBoltzmannResult,
  expandedNodeTxid,
  onToggleExpand,
  onExpandPortInput,
  onExpandPortOutput,
  outspendCache,
  onLayoutComplete,
  boltzmannCache,
}: GraphCanvasProps) {
  const atCapacity = nodeCount >= maxNodes;
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [hoveredPort, setHoveredPort] = useState<string | null>(null);
  // Suppress tooltips on touch devices (conflicts with tap-to-expand sidebar)
  const isTouchRef = useRef(false);
  useEffect(() => {
    const onTouch = () => { isTouchRef.current = true; };
    window.addEventListener("touchstart", onTouch, { once: true, passive: true });
    return () => window.removeEventListener("touchstart", onTouch);
  }, []);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panRef = useRef({ active: false, startX: 0, startY: 0, vtX: 0, vtY: 0, scale: 1 });
  const pinchRef = useRef({ active: false, startDist: 0, startScale: 1, midX: 0, midY: 0 });
  const viewTransformRef = useRef(viewTransform);
  viewTransformRef.current = viewTransform;
  const [isPanning, setIsPanning] = useState(false);

  // Convert graph coordinates to screen coordinates (accounts for scroll or view transform)
  const toScreen = useCallback((gx: number, gy: number) => {
    if (viewTransform) {
      return { x: gx * viewTransform.scale + viewTransform.x, y: gy * viewTransform.scale + viewTransform.y };
    }
    const sx = scrollRef.current?.scrollLeft ?? 0;
    const sy = scrollRef.current?.scrollTop ?? 0;
    return { x: gx - sx, y: gy - sy };
  }, [viewTransform, scrollRef]);
  const { layoutNodes, edges, width, height, nodePositions } = useMemo(
    () => layoutGraph(nodes, rootTxid, filter, rootTxids, expandedNodeTxid),
    [nodes, rootTxid, filter, rootTxids, expandedNodeTxid],
  );

  // Report visible count to parent (eliminates redundant layout call)
  useEffect(() => {
    onLayoutComplete?.({ visibleCount: layoutNodes.length });
  }, [layoutNodes.length, onLayoutComplete]);

  // Build port position map for expanded node (used for edge routing)
  const portPositions = useMemo(
    () => buildPortPositionMap(expandedNodeTxid ?? null, nodes, nodePositions),
    [expandedNodeTxid, nodes, nodePositions],
  );

  // Compute max edge value for thickness scaling and resolve script types per edge
  const { maxEdgeValue, edgeScriptInfo } = useMemo(() => {
    let maxVal = 0;
    const info = new Map<string, { scriptType: string; value: number }>();
    for (const edge of edges) {
      const sourceNode = nodes.get(edge.fromTxid);
      if (!sourceNode || !edge.outputIndices?.length) continue;
      const outIdx = edge.outputIndices[0];
      const vout = sourceNode.tx.vout[outIdx];
      if (vout) {
        const val = vout.value;
        if (val > maxVal) maxVal = val;
        const key = `e-${edge.fromTxid}-${edge.toTxid}`;
        info.set(key, { scriptType: vout.scriptpubkey_type, value: val });
      }
    }
    return { maxEdgeValue: maxVal, edgeScriptInfo: info };
  }, [edges, nodes]);

  // Compute deterministic link chains for overlay rendering
  const detChainEdges = useMemo(() => {
    if (!boltzmannCache || boltzmannCache.size === 0) return new Set<string>();
    const chains = computeDeterministicChains(nodes, boltzmannCache);
    return buildDetChainEdgeSet(chains);
  }, [nodes, boltzmannCache]);

  // Compute entropy propagation (effective entropy per edge)
  const entropyEdges = useMemo(() => {
    if (!entropyGradientMode || !boltzmannCache || boltzmannCache.size === 0) return null;
    return computeEntropyPropagation(nodes, rootTxid, boltzmannCache);
  }, [entropyGradientMode, nodes, rootTxid, boltzmannCache]);

  // Detect toxic change merges (CoinJoin change spent with mixed output)
  const toxicMergeNodes = useMemo(() => {
    const merges = detectToxicMerges(nodes);
    return buildToxicMergeSet(merges);
  }, [nodes]);

  const svgWidth = Math.max(containerWidth, width);
  const svgHeight = Math.max(isFullscreen ? (containerHeight ?? height) : height, 150);

  // Edges connected to hovered node
  const hoveredEdges = useMemo(() => {
    if (!hoveredNode) return null;
    const set = new Set<string>();
    for (const e of edges) {
      if (e.fromTxid === hoveredNode || e.toTxid === hoveredNode) {
        set.add(`e-${e.fromTxid}-${e.toTxid}`);
      }
    }
    return set;
  }, [hoveredNode, edges]);

  // Focus spotlight: nodes/edges connected to the expanded (sidebar) node
  const focusSpotlight = useMemo(() => {
    if (!expandedNodeTxid) return null;
    const connectedNodes = new Set<string>([expandedNodeTxid]);
    const connectedEdges = new Set<string>();
    for (const e of edges) {
      if (e.fromTxid === expandedNodeTxid || e.toTxid === expandedNodeTxid) {
        connectedNodes.add(e.fromTxid);
        connectedNodes.add(e.toTxid);
        connectedEdges.add(`e-${e.fromTxid}-${e.toTxid}`);
      }
    }
    return { nodes: connectedNodes, edges: connectedEdges };
  }, [expandedNodeTxid, edges]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't capture keys when typing in an input element
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (!focusedNode && layoutNodes.length > 0) {
      setFocusedNode(layoutNodes[0].txid);
      return;
    }
    if (!focusedNode) return;

    const current = layoutNodes.find((n) => n.txid === focusedNode);
    if (!current) return;

    const sameDepth = layoutNodes.filter((n) => n.depth === current.depth);
    const currentIdx = sameDepth.findIndex((n) => n.txid === focusedNode);
    const gn = nodes.get(focusedNode);

    switch (e.key) {
      // ─── Navigation ──────────────────────
      case "ArrowUp": {
        e.preventDefault();
        if (currentIdx > 0) setFocusedNode(sameDepth[currentIdx - 1].txid);
        break;
      }
      case "ArrowDown": {
        e.preventDefault();
        if (currentIdx < sameDepth.length - 1) setFocusedNode(sameDepth[currentIdx + 1].txid);
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        const prevDepth = layoutNodes
          .filter((n) => n.depth < current.depth)
          .sort((a, b) => b.depth - a.depth)[0];
        if (prevDepth) setFocusedNode(prevDepth.txid);
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        const nextDepth = layoutNodes
          .filter((n) => n.depth > current.depth)
          .sort((a, b) => a.depth - b.depth)[0];
        if (nextDepth) setFocusedNode(nextDepth.txid);
        break;
      }

      // ─── Actions ─────────────────────────
      case "Enter": {
        // Toggle expand/collapse UTXO ports on focused node
        e.preventDefault();
        if (onToggleExpand) onToggleExpand(focusedNode);
        break;
      }
      case " ": {
        // Space: same as Enter (expand ports)
        e.preventDefault();
        if (onToggleExpand) onToggleExpand(focusedNode);
        break;
      }
      case "e": {
        // Expand first available input (backward)
        e.preventDefault();
        if (!gn || atCapacity) break;
        const inputIdx = gn.tx.vin.findIndex((v) => !v.is_coinbase && !nodes.has(v.txid));
        if (inputIdx >= 0) onExpandInput(focusedNode, inputIdx);
        break;
      }
      case "r": {
        // Expand first available output (forward)
        e.preventDefault();
        if (!gn || atCapacity) break;
        const consumedOutputs = new Set<number>();
        for (const [, n] of nodes) {
          for (const vin of n.tx.vin) {
            if (vin.txid === focusedNode && vin.vout !== undefined) consumedOutputs.add(vin.vout);
          }
        }
        const outIdx = gn.tx.vout.findIndex((v, i) =>
          !consumedOutputs.has(i) && v.scriptpubkey_type !== "op_return" && v.value > 0,
        );
        if (outIdx >= 0) onExpandOutput(focusedNode, outIdx);
        break;
      }
      case "d": {
        // Double-expand: expand up to 5 in each direction
        e.preventDefault();
        if (!gn || atCapacity) break;
        let dExpanded = 0;
        for (let i = 0; i < gn.tx.vin.length && dExpanded < 5; i++) {
          if (!gn.tx.vin[i].is_coinbase && !nodes.has(gn.tx.vin[i].txid)) {
            onExpandInput(focusedNode, i); dExpanded++;
          }
        }
        dExpanded = 0;
        for (let i = 0; i < gn.tx.vout.length && dExpanded < 5; i++) {
          if (gn.tx.vout[i].scriptpubkey_type !== "op_return" && gn.tx.vout[i].value > 0) {
            onExpandOutput(focusedNode, i); dExpanded++;
          }
        }
        break;
      }
      case "x":
      case "Delete":
      case "Backspace": {
        // Collapse focused node
        e.preventDefault();
        if (focusedNode !== rootTxid) {
          onCollapse(focusedNode);
          setFocusedNode(rootTxid);
        }
        break;
      }
      case "Escape": {
        // Collapse expanded node ports
        e.preventDefault();
        if (expandedNodeTxid && onToggleExpand) {
          onToggleExpand(expandedNodeTxid);
        }
        break;
      }
    }
  }, [focusedNode, layoutNodes, nodes, rootTxid, atCapacity, onExpandInput, onExpandOutput, onCollapse, setFocusedNode, onToggleExpand, expandedNodeTxid]);

  // Auto-scroll to keep focused node visible
  useEffect(() => {
    if (!focusedNode || !scrollRef.current) return;
    const node = layoutNodes.find((n) => n.txid === focusedNode);
    if (!node) return;
    const el = scrollRef.current;
    const nodeCenter = node.x + node.width / 2;
    const nodeMiddle = node.y + node.height / 2;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;

    if (nodeCenter < viewLeft + SCROLL_MARGIN_X || nodeCenter > viewRight - SCROLL_MARGIN_X) {
      el.scrollLeft = nodeCenter - el.clientWidth / 2;
    }
    if (nodeMiddle < viewTop + SCROLL_MARGIN_Y || nodeMiddle > viewBottom - SCROLL_MARGIN_Y) {
      el.scrollTop = nodeMiddle - el.clientHeight / 2;
    }
  }, [focusedNode, layoutNodes, scrollRef]);

  // Auto-scroll to center the root transaction node(s) on first render only
  const hasCentered = useRef(false);
  useEffect(() => {
    if (hasCentered.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const rootNodes = layoutNodes.filter((n) => n.isRoot);
    if (rootNodes.length === 0) return;
    hasCentered.current = true;
    const avgX = rootNodes.reduce((s, n) => s + n.x + n.width / 2, 0) / rootNodes.length;
    el.scrollLeft = avgX - el.clientWidth / 2;
  }, [layoutNodes, scrollRef]);

  // Handle double-click: expand all connected UTXOs (up to 5 per direction)
  const handleNodeDoubleClick = useCallback((node: LayoutNode) => {
    if (atCapacity) return;
    // Expand backward: first 5 non-coinbase inputs not already in graph
    let expanded = 0;
    for (let i = 0; i < node.tx.vin.length && expanded < 5; i++) {
      const vin = node.tx.vin[i];
      if (!vin.is_coinbase && !nodes.has(vin.txid)) {
        onExpandInput(node.txid, i);
        expanded++;
      }
    }
    // Expand forward: first 5 spendable outputs not already consumed
    expanded = 0;
    const consumedOutputs = new Set<number>();
    for (const [, n] of nodes) {
      for (const vin of n.tx.vin) {
        if (vin.txid === node.txid && vin.vout !== undefined) consumedOutputs.add(vin.vout);
      }
    }
    for (let i = 0; i < node.tx.vout.length && expanded < 5; i++) {
      if (consumedOutputs.has(i)) continue;
      if (node.tx.vout[i].scriptpubkey_type === "op_return" || node.tx.vout[i].value === 0) continue;
      onExpandOutput(node.txid, i);
      expanded++;
    }
  }, [nodes, atCapacity, onExpandInput, onExpandOutput]);

  // Handle node click - toggle expansion (UTXO ports) or floating analysis panel
  const handleNodeClick = useCallback((node: LayoutNode, currentSelected: string | null) => {
    // If expansion is available, toggle the expanded UTXO port view
    if (onToggleExpand) {
      onToggleExpand(node.txid);
      return;
    }
    // Fallback: toggle floating analysis panel
    if (currentSelected === node.txid) {
      setSelectedNode(null);
      return;
    }
    const pos = toScreen(node.x + node.width / 2, node.y);
    setSelectedNode({
      txid: node.txid,
      x: pos.x,
      y: pos.y,
    });
  }, [setSelectedNode, toScreen, onToggleExpand]);

  // Minimap scroll handler
  const [scrollPos, setScrollPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => setScrollPos({ left: el.scrollLeft, top: el.scrollTop });
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [scrollRef]);

  const handleMinimapClick = useCallback((x: number, y: number) => {
    if (viewTransform && onViewTransformChange) {
      const cw = containerWidth;
      const ch = containerHeight ?? 600;
      onViewTransformChange({ ...viewTransform, x: cw / 2 - x * viewTransform.scale, y: ch / 2 - y * viewTransform.scale });
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = x - el.clientWidth / 2;
    el.scrollTop = y - el.clientHeight / 2;
  }, [scrollRef, viewTransform, onViewTransformChange, containerWidth, containerHeight]);

  // ─── Pan handlers (fullscreen transform mode) ────────────

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (!viewTransform || !onViewTransformChange || e.button !== 0) return;
    e.preventDefault();
    panRef.current = { active: true, startX: e.clientX, startY: e.clientY, vtX: viewTransform.x, vtY: viewTransform.y, scale: viewTransform.scale };
    setIsPanning(true);
    setSelectedNode(null);
  }, [viewTransform, onViewTransformChange, setSelectedNode]);

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      if (!panRef.current.active) return;
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      onViewTransformChange?.({ scale: panRef.current.scale, x: panRef.current.vtX + dx, y: panRef.current.vtY + dy });
    };
    const onUp = () => { panRef.current.active = false; setIsPanning(false); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [isPanning, onViewTransformChange]);

  // Wheel-to-zoom (fullscreen transform mode)
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
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!viewTransform, onViewTransformChange]);

  // Touch gestures: single-finger pan, two-finger pinch-to-zoom
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
            panRef.current = { active: true, startX: pendingPan.startX, startY: pendingPan.startY, vtX: pendingPan.vtX, vtY: pendingPan.vtY, scale: pendingPan.scale };
            pendingPan = null;
            setIsPanning(true);
            setSelectedNode(null);
          }
        }

        if (panRef.current.active) {
          e.preventDefault();
          const dx = t.clientX - panRef.current.startX;
          const dy = t.clientY - panRef.current.startY;
          onViewTransformChange({ scale: panRef.current.scale, x: panRef.current.vtX + dx, y: panRef.current.vtY + dy });
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

  return (
    <div
      ref={wrapperRef}
      className="relative"
      style={{ minWidth: svgWidth, ...(viewTransform ? { touchAction: "none" } : {}) }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <svg
        ref={svgRef}
        width={viewTransform ? containerWidth : svgWidth}
        height={viewTransform ? (containerHeight ?? svgHeight) : svgHeight}
        className="overflow-visible"
        style={viewTransform ? { cursor: isPanning ? "grabbing" : "grab", touchAction: "none" } : undefined}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedNode(null);
        }}
      >
        <ChartDefs />
        <defs>
          {/* Ambient dot grid pattern */}
          <pattern id="grid-dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="12" cy="12" r="0.5" fill="white" fillOpacity={0.04} />
          </pattern>
          <marker id="arrow-graph" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L12,4 L0,8" fill={SVG_COLORS.muted} fillOpacity={0.7} />
          </marker>
          <marker id="arrow-graph-start" markerWidth="12" markerHeight="8" refX="1" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            <path d="M0,0 L12,4 L0,8" fill={SVG_COLORS.muted} fillOpacity={0.7} />
          </marker>
          <marker id="arrow-graph-consolidation" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L12,4 L0,8" fill={SVG_COLORS.critical} fillOpacity={0.7} />
          </marker>
          <marker id="arrow-graph-consolidation-start" markerWidth="12" markerHeight="8" refX="1" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            <path d="M0,0 L12,4 L0,8" fill={SVG_COLORS.critical} fillOpacity={0.7} />
          </marker>
          {/* Contextual glow auras */}
          <filter id="aura-root" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3">
              <animate attributeName="stdDeviation" values="2;4;2" dur="3s" repeatCount="indefinite" />
            </feGaussianBlur>
          </filter>
          <filter id="aura-coinjoin" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3">
              <animate attributeName="stdDeviation" values="2;3.5;2" dur="2.5s" repeatCount="indefinite" />
            </feGaussianBlur>
          </filter>
          <filter id="aura-ofac" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3">
              <animate attributeName="stdDeviation" values="1.5;4;1.5" dur="1.2s" repeatCount="indefinite" />
            </feGaussianBlur>
          </filter>
        </defs>
        <style>{`
          .graph-btn circle { transition: fill-opacity 0.15s, stroke-width 0.15s, filter 0.15s; }
          .graph-btn:hover circle { fill-opacity: 1; stroke-width: 2.5; filter: brightness(1.4); }
          @keyframes flow-particle {
            0% { offset-distance: 0%; opacity: 0; }
            10% { opacity: 0.8; }
            90% { opacity: 0.8; }
            100% { offset-distance: 100%; opacity: 0; }
          }
          @keyframes entropy-pulse {
            0%, 100% { stroke-opacity: var(--ep-min); }
            50% { stroke-opacity: var(--ep-max); }
          }
          .graph-btn:hover text { fill-opacity: 1; }
        `}</style>

        {viewTransform && (
          <rect
            width={containerWidth}
            height={containerHeight ?? svgHeight}
            fill="black"
            fillOpacity={0}
            pointerEvents="all"
            onMouseDown={handlePanStart}
          />
        )}

        <g transform={viewTransform ? `translate(${viewTransform.x},${viewTransform.y}) scale(${viewTransform.scale})` : undefined}>

        {/* Ambient dot grid background */}
        <rect
          x={-100}
          y={-100}
          width={width + 200}
          height={height + 200}
          fill="url(#grid-dots)"
          pointerEvents="none"
        />

        {/* Edges */}
        {edges.map((edge) => {
          const edgeKey = `e-${edge.fromTxid}-${edge.toTxid}`;
          const hasPortRouting = expandedNodeTxid && (edge.fromTxid === expandedNodeTxid || edge.toTxid === expandedNodeTxid);
          const d = hasPortRouting
            ? portAwareEdgePath(edge, portPositions, nodes as Map<string, { tx: { vin: Array<{ txid: string; vout: number }> } }>)
            : edgePath(edge);
          const midX = (edge.x1 + edge.x2) / 2;

          const isHoveredViaNode = hoveredEdges?.has(edgeKey);
          const isHoveredDirect = hoveredEdgeKey === edgeKey;
          const isHovered = isHoveredViaNode || isHoveredDirect;
          const isDimmedByHover = hoveredNode && !isHoveredViaNode;
          const isConsolidation = edge.consolidationCount >= 2;

          // Linkability edge coloring: check boltzmannCache for ANY source tx
          let linkabilityColor: string | null = null;
          let linkabilityMaxProb = -1;
          if (linkabilityEdgeMode && edge.outputIndices?.length) {
            const cachedResult = boltzmannCache?.get(edge.fromTxid) ?? (edge.fromTxid === rootTxid ? rootBoltzmannResult : null);
            const mat = cachedResult?.matLnkProbabilities;
            if (mat && mat.length > 0) {
              linkabilityMaxProb = getEdgeMaxProb(mat, edge.outputIndices);
              if (linkabilityMaxProb <= 0) return null;
              linkabilityColor = probColor(linkabilityMaxProb);
            }
          }

          // Script type encoding: color, dash, and thickness from UTXO data
          const scriptInfo = edgeScriptInfo.get(edgeKey);
          const scriptColor = scriptInfo ? getScriptTypeColor(scriptInfo.scriptType) : null;
          const scriptDash = scriptInfo ? getScriptTypeDash(scriptInfo.scriptType) : undefined;
          const scriptThickness = scriptInfo ? getEdgeThickness(scriptInfo.value, maxEdgeValue) : undefined;

          // Check if any output index on this edge is change-marked
          const isChangeMarked = changeOutputs && edge.outputIndices?.some(
            (oi) => changeOutputs.has(`${edge.fromTxid}:${oi}`),
          );

          // Check if this edge carries dust-level value
          const isDust = scriptInfo && scriptInfo.value > 0 && scriptInfo.value <= DUST_THRESHOLD;

          // Entropy gradient mode: override edge color with effective entropy
          const entropyEntry = entropyEdges?.get(edgeKey);
          const entropyColorVal = entropyEntry ? entropyColor(entropyEntry.normalized) : null;

          const strokeColor = entropyColorVal
            ?? linkabilityColor
            ?? (isChangeMarked ? "#d97706" : (isConsolidation ? SVG_COLORS.critical : (scriptColor ?? SVG_COLORS.muted)));
          let strokeOpacity = entropyColorVal ? (0.4 + entropyEntry!.normalized * 0.5) : (linkabilityColor ? (0.3 + linkabilityMaxProb * 0.7) : (isChangeMarked ? 0.8 : (isConsolidation ? 0.6 : (scriptColor ? 0.55 : 0.45))));
          let strokeWidth = linkabilityColor ? 2.5 : (isChangeMarked ? 3 : (isConsolidation ? 2.5 : (scriptThickness ?? 1.5)));
          // Dust edges: visible but distinct (dashed, reduced opacity)
          let dustDash: string | undefined;
          if (isDust && !linkabilityColor && !isChangeMarked) {
            strokeOpacity = 0.3;
            strokeWidth = Math.min(strokeWidth, 1.5);
            dustDash = "2 2";
          }

          if (isHovered && !linkabilityColor) {
            strokeOpacity = isConsolidation ? 0.9 : 0.7;
            strokeWidth = isConsolidation ? 3.5 : 2.5;
          }
          // Focus spotlight: dim edges not connected to expanded node
          if (focusSpotlight && !focusSpotlight.edges.has(edgeKey)) strokeOpacity = 0.06;
          else if (isDimmedByHover) strokeOpacity = isConsolidation ? 0.2 : 0.1;

          let markerEnd: string | undefined;
          let markerStart: string | undefined;
          if (edge.isBackward) {
            markerStart = isConsolidation ? "url(#arrow-graph-consolidation-start)" : "url(#arrow-graph-start)";
          } else {
            markerEnd = isConsolidation ? "url(#arrow-graph-consolidation)" : "url(#arrow-graph)";
          }

          const edgeMaxProb = linkabilityMaxProb >= 0 ? linkabilityMaxProb : undefined;
          const hasEdgeTooltip = edgeMaxProb !== undefined || entropyEntry != null;

          return (
            <g key={edgeKey}>
              {hasEdgeTooltip && (
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  style={{ cursor: "default" }}
                  onMouseMove={() => {
                    setHoveredEdgeKey(edgeKey);
                    const eMidX = (edge.x1 + edge.x2) / 2;
                    const eMidY = (edge.y1 + edge.y2) / 2;
                    const pos = toScreen(eMidX, eMidY - 12);
                    tooltip.showTooltip({
                      tooltipData: {
                        txid: edge.fromTxid,
                        inputCount: 0, outputCount: 0, totalValue: 0,
                        isCoinJoin: false, depth: 0, fee: 0, feeRate: "",
                        confirmed: true,
                        linkProb: edgeMaxProb,
                        entropyNormalized: entropyEntry?.normalized,
                        entropyBits: entropyEntry?.effectiveEntropy,
                      },
                      tooltipLeft: pos.x,
                      tooltipTop: pos.y,
                    });
                  }}
                  onMouseLeave={() => { setHoveredEdgeKey(null); tooltip.hideTooltip(); }}
                />
              )}
              <motion.path
                d={d}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeOpacity={strokeOpacity}
                strokeDasharray={dustDash ?? scriptDash ?? undefined}
                markerEnd={markerEnd}
                markerStart={markerStart}
                style={entropyColorVal ? {
                  "--ep-min": String(Math.max(0.2, strokeOpacity - 0.15)),
                  "--ep-max": String(Math.min(1, strokeOpacity + 0.15)),
                  animation: `entropy-pulse ${1.5 + (1 - (entropyEntry?.normalized ?? 0.5)) * 2}s ease-in-out infinite`,
                  pointerEvents: "none" as const,
                } as React.CSSProperties : { pointerEvents: "none" as const }}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4 }}
              />
              {isConsolidation && (
                <Text
                  x={midX}
                  y={(edge.y1 + edge.y2) / 2 - 6}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={700}
                  fill={SVG_COLORS.critical}
                  fillOpacity={isDimmedByHover ? 0.15 : 0.85}
                  style={{ pointerEvents: "none" as const }}
                >
                  {`${edge.consolidationCount} outputs`}
                </Text>
              )}
              {/* Deterministic link badge (100%) - only for multi-input txs where determinism is non-trivial */}
              {!isConsolidation && edge.outputIndices?.length === 1 && (() => {
                const edgeBoltz = boltzmannCache?.get(edge.fromTxid) ?? (edge.fromTxid === rootTxid ? rootBoltzmannResult : null);
                if (!edgeBoltz?.deterministicLinks?.length) return null;
                // Skip 1-input txs: every link is trivially deterministic, badge adds no info
                if (edgeBoltz.nInputs <= 1) return null;
                const outIdx = edge.outputIndices![0];
                const isDeterministic = edgeBoltz.deterministicLinks.some(
                  ([oi]) => oi === outIdx,
                );
                if (!isDeterministic) return null;
                return (
                  <g style={{ pointerEvents: "none" }}>
                    <rect
                      x={midX - 16}
                      y={(edge.y1 + edge.y2) / 2 - 10}
                      width={32}
                      height={14}
                      rx={3}
                      fill="#0c0c0e"
                      fillOpacity={0.8}
                      stroke={SVG_COLORS.critical}
                      strokeWidth={0.5}
                      strokeOpacity={0.6}
                    />
                    <Text
                      x={midX}
                      y={(edge.y1 + edge.y2) / 2}
                      textAnchor="middle"
                      fontSize={8}
                      fontWeight={700}
                      fill={SVG_COLORS.critical}
                      fillOpacity={isDimmedByHover ? 0.2 : 0.9}
                    >
                      100%
                    </Text>
                  </g>
                );
              })()}
            </g>
          );
        })}

        {/* Hover overlay: re-render hovered linkability edge on top of all edges */}
        {hoveredEdgeKey && linkabilityEdgeMode && rootBoltzmannResult && (() => {
          const edge = edges.find((e) => `e-${e.fromTxid}-${e.toTxid}` === hoveredEdgeKey);
          if (!edge || edge.fromTxid !== rootTxid || !edge.outputIndices?.length) return null;
          const mat = rootBoltzmannResult.matLnkProbabilities;
          if (!mat?.length) return null;
          const maxProb = getEdgeMaxProb(mat, edge.outputIndices);
          if (maxProb <= 0) return null;
          const hasPortRouting2 = expandedNodeTxid && (edge.fromTxid === expandedNodeTxid || edge.toTxid === expandedNodeTxid);
          const d = hasPortRouting2
            ? portAwareEdgePath(edge, portPositions, nodes as Map<string, { tx: { vin: Array<{ txid: string; vout: number }> } }>)
            : edgePath(edge);
          const color = probColor(maxProb);
          return (
            <g style={{ pointerEvents: "none" }}>
              <path d={d} fill="none" stroke={color} strokeWidth={6.5} strokeOpacity={0.4} filter="url(#glow-medium)" />
              <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeOpacity={1.0}
                strokeDasharray={undefined} />
            </g>
          );
        })()}

        {/* Deterministic chain overlay - bold red lines for multi-hop certainty traces */}
        {detChainEdges.size > 0 && edges.filter((e) => detChainEdges.has(`e-${e.fromTxid}-${e.toTxid}`)).map((edge) => {
          const edgeKey = `detchain-${edge.fromTxid}-${edge.toTxid}`;
          const hasPortRouting = expandedNodeTxid && (edge.fromTxid === expandedNodeTxid || edge.toTxid === expandedNodeTxid);
          const d = hasPortRouting
            ? portAwareEdgePath(edge, portPositions, nodes as Map<string, { tx: { vin: Array<{ txid: string; vout: number }> } }>)
            : edgePath(edge);
          return (
            <g key={edgeKey} style={{ pointerEvents: "none" }}>
              <path d={d} fill="none" stroke={SVG_COLORS.critical} strokeWidth={5} strokeOpacity={0.15} filter="url(#glow-medium)" />
              <motion.path
                d={d}
                fill="none"
                stroke={SVG_COLORS.critical}
                strokeWidth={2.5}
                strokeOpacity={0.7}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.6 }}
              />
            </g>
          );
        })}

        {/* Edge flow particles (on focused/expanded node's edges) */}
        {focusSpotlight && edges.filter((e) => focusSpotlight.edges.has(`e-${e.fromTxid}-${e.toTxid}`)).map((edge) => {
          const d = (portPositions.size > 0)
            ? portAwareEdgePath(edge, portPositions, nodes)
            : edgePath(edge);
          const edgeKey = `e-${edge.fromTxid}-${edge.toTxid}`;
          const scriptInfo = edgeScriptInfo.get(edgeKey);
          const particleColor = scriptInfo ? getScriptTypeColor(scriptInfo.scriptType) : SVG_COLORS.muted;
          // 2-3 staggered particles per edge
          return [0, 1, 2].map((pi) => (
            <circle
              key={`particle-${edgeKey}-${pi}`}
              r={2}
              fill={particleColor}
              fillOpacity={0.8}
              style={{
                offsetPath: `path("${d}")`,
                animation: `flow-particle ${2 + pi * 0.3}s linear ${pi * 0.7}s infinite`,
                pointerEvents: "none" as const,
              }}
            />
          ));
        })}

        {/* Nodes */}
        {layoutNodes.map((node) => {
          const heatScore = heatMapActive ? heatMap.get(node.txid)?.score : undefined;
          const color = getNodeColor(node, heatScore);
          const totalValue = node.tx.vout.reduce((s, o) => s + o.value, 0);
          const isHovered = hoveredNode === node.txid;
          const isFocused = focusedNode === node.txid;
          const isDimmedByHover = hoveredNode && !isHovered && !hoveredEdges?.has(`e-${hoveredNode}-${node.txid}`) && !hoveredEdges?.has(`e-${node.txid}-${hoveredNode}`);
          const isConnectedToHovered = hoveredNode && (
            edges.some((e) => (e.fromTxid === hoveredNode && e.toTxid === node.txid) || (e.toTxid === hoveredNode && e.fromTxid === node.txid))
          );
          const isLoading = loading.has(node.txid);
          const isExpandedNode = node.txid === expandedNodeTxid;

          let nodeOpacity = 1;
          // Focus spotlight: dim nodes not connected to the expanded node
          if (focusSpotlight && !focusSpotlight.nodes.has(node.txid)) nodeOpacity = 0.15;
          else if (isDimmedByHover && !isConnectedToHovered) nodeOpacity = 0.3;

          // Render expanded node with UTXO ports (spring morph animation)
          if (isExpandedNode) {
            return (
              <motion.g
                key={node.txid}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: nodeOpacity, scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8 }}
              >
                <ExpandedNode
                  node={node}
                  graphNodes={nodes}
                  outspends={outspendCache?.get(node.txid)}
                  heatScore={heatScore}
                  isLoading={isLoading}
                  hoveredPort={hoveredPort}
                  onHoverPort={setHoveredPort}
                  onExpandInput={onExpandPortInput ?? onExpandInput}
                  onExpandOutput={onExpandPortOutput ?? onExpandOutput}
                  onNodeClick={() => handleNodeClick(node, selectedNode?.txid ?? null)}
                  atCapacity={atCapacity}
                />
              </motion.g>
            );
          }

          return (
            <motion.g
              key={node.txid}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: nodeOpacity,
                scale: 1,
              }}
              transition={{ duration: 0.3 }}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => {
                if (isTouchRef.current) return; // suppress tooltip on touch devices
                setHoveredNode(node.txid);
                // Suppress tooltip for the node whose sidebar is already open
                if (expandedNodeTxid === node.txid) return;
                const pos = toScreen(node.x + node.width / 2, node.y - 8);
                tooltip.showTooltip({
                  tooltipData: {
                    txid: node.txid,
                    inputCount: node.inputCount,
                    outputCount: node.outputCount,
                    totalValue,
                    isCoinJoin: node.isCoinJoin,
                    coinJoinType: node.coinJoinType,
                    entityLabel: node.entityLabel,
                    entityCategory: node.entityCategory,
                    entityOfac: node.entityOfac,
                    entityConfidence: node.entityConfidence,
                    depth: node.depth,
                    fee: node.fee,
                    feeRate: node.feeRate,
                    confirmed: node.confirmed,
                  },
                  tooltipLeft: pos.x,
                  tooltipTop: pos.y,
                });
              }}
              onMouseLeave={() => {
                setHoveredNode(null);
                tooltip.hideTooltip();
              }}
            >
              {/* Contextual glow aura (behind node) */}
              {node.isRoot && (
                <rect x={node.x - 4} y={node.y - 4} width={node.width + 8} height={node.height + 8} rx={12} fill={SVG_COLORS.bitcoin} fillOpacity={0.12} filter="url(#aura-root)" style={{ pointerEvents: "none" }} />
              )}
              {node.isCoinJoin && !node.isRoot && (
                <rect x={node.x - 3} y={node.y - 3} width={node.width + 6} height={node.height + 6} rx={11} fill={SVG_COLORS.good} fillOpacity={0.1} filter="url(#aura-coinjoin)" style={{ pointerEvents: "none" }} />
              )}
              {node.entityOfac && (
                <rect x={node.x - 3} y={node.y - 3} width={node.width + 6} height={node.height + 6} rx={11} fill={SVG_COLORS.critical} fillOpacity={0.15} filter="url(#aura-ofac)" style={{ pointerEvents: "none" }} />
              )}

              {/* Node background */}
              {fingerprintMode && isTimestampLocktime(node.tx.locktime) ? (
                <polygon
                  points={hexagonPoints(node.x, node.y, node.width, node.height)}
                  fill={getVersionFill(node.tx.version)}
                  stroke={color}
                  strokeWidth={isHovered ? 2.5 : (node.isRoot ? 2.5 : 1.5)}
                  strokeOpacity={isHovered || node.isRoot ? 1 : 0.6}
                  filter={node.isRoot ? "url(#glow-medium)" : (isHovered ? "url(#glow-subtle)" : undefined)}
                  onClick={() => handleNodeClick(node, selectedNode?.txid ?? null)}
                />
              ) : (
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={fingerprintMode ? getLockTimeRx(node.tx.locktime) : 8}
                  fill={
                    fingerprintMode ? getVersionFill(node.tx.version) :
                    heatMapActive && heatScore !== undefined ? `${color}20` :
                    SVG_COLORS.surfaceElevated
                  }
                  stroke={color}
                  strokeWidth={isHovered ? 2.5 : (node.isRoot ? 2.5 : 1.5)}
                  strokeOpacity={isHovered || node.isRoot ? 1 : 0.6}
                  filter={node.isRoot ? "url(#glow-medium)" : (isHovered ? "url(#glow-subtle)" : undefined)}
                  onClick={() => handleNodeClick(node, selectedNode?.txid ?? null)}
                />
              )}

              {/* Focused node indicator (dashed animated outline) */}
              {isFocused && (
                <rect
                  x={node.x - 3}
                  y={node.y - 3}
                  width={node.width + 6}
                  height={node.height + 6}
                  rx={10}
                  fill="none"
                  stroke={SVG_COLORS.bitcoin}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                >
                  <animate attributeName="stroke-dashoffset" values="0;8" dur="0.8s" repeatCount="indefinite" />
                </rect>
              )}

              {/* Loading pulse overlay */}
              {isLoading && (
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={8}
                  fill={color}
                  fillOpacity={0.15}
                >
                  <animate attributeName="fill-opacity" values="0.05;0.2;0.05" dur="1.2s" repeatCount="indefinite" />
                </rect>
              )}

              {/* Badge pills - right-aligned on the entity/type label line (y+44) */}
              {(() => {
                const badges: Array<{ label: string; bg: string; fg: string }> = [];
                if (node.isCoinJoin) badges.push({ label: node.coinJoinType ?? "CJ", bg: SVG_COLORS.good, fg: "#0c0c0e" });
                if (node.entityOfac) badges.push({ label: "OFAC", bg: SVG_COLORS.critical, fg: "#fff" });
                if (toxicMergeNodes.has(node.txid)) badges.push({ label: "TOXIC", bg: "#ef4444", fg: "#fff" });
                if (badges.length === 0) return null;
                let bx = node.x + node.width - 4;
                const by = node.y + 42;
                return (
                  <g style={{ pointerEvents: "none" }}>
                    {badges.reverse().map((b) => {
                      const tw = b.label.length * 5.5 + 8;
                      bx -= tw + 2;
                      return (
                        <g key={b.label} transform={`translate(${bx}, ${by})`}>
                          <rect width={tw} height={12} rx={6} fill={b.bg} fillOpacity={0.2} stroke={b.bg} strokeWidth={0.5} strokeOpacity={0.4} />
                          <text x={tw / 2} y={9} textAnchor="middle" fontSize="7" fontWeight="bold" fill={b.fg} fillOpacity={0.85}>{b.label}</text>
                        </g>
                      );
                    })}
                  </g>
                );
              })()}

              {/* Privacy score sparkline (tiny severity bars) */}
              {heatMapActive && heatMap.has(node.txid) && (() => {
                const sr = heatMap.get(node.txid)!;
                const sevCounts = { critical: 0, high: 0, medium: 0, low: 0, good: 0 };
                for (const f of sr.findings) {
                  if (f.severity in sevCounts) sevCounts[f.severity as keyof typeof sevCounts]++;
                }
                const bars = [
                  { count: sevCounts.critical, color: SVG_COLORS.critical },
                  { count: sevCounts.high, color: SVG_COLORS.high },
                  { count: sevCounts.medium, color: SVG_COLORS.medium },
                  { count: sevCounts.low, color: SVG_COLORS.low },
                  { count: sevCounts.good, color: SVG_COLORS.good },
                ].filter((b) => b.count > 0);
                const maxCount = Math.max(...bars.map((b) => b.count), 1);
                const barW = 3;
                const barGap = 1;
                const totalW = bars.length * (barW + barGap) - barGap;
                const startX = node.x + node.width - totalW - 6;
                const maxH = 16;
                const baseY = node.y + node.height - 4;
                return (
                  <g style={{ pointerEvents: "none" }}>
                    {bars.map((b, bi) => {
                      const h = Math.max(2, (b.count / maxCount) * maxH);
                      return (
                        <rect
                          key={bi}
                          x={startX + bi * (barW + barGap)}
                          y={baseY - h}
                          width={barW}
                          height={h}
                          rx={0.5}
                          fill={b.color}
                          fillOpacity={0.6}
                        />
                      );
                    })}
                  </g>
                );
              })()}

              {/* Heat map score */}
              {heatMapActive && heatScore !== undefined && (
                <Text
                  x={node.x + node.width - 20}
                  y={node.y + node.height / 2 + 6}
                  fontSize={18}
                  fontWeight={800}
                  fill={color}
                  textAnchor="middle"
                  opacity={0.9}
                >
                  {heatScore}
                </Text>
              )}

              {/* Txid label */}
              <Text
                x={node.x + 10}
                y={node.y + 20}
                fontSize={11}
                fill={color}
                fontWeight={600}
                fontFamily="monospace"
              >
                {truncateId(node.txid, 8)}
              </Text>

              {/* Summary line + tx type label */}
              <Text
                x={node.x + 10}
                y={node.y + 38}
                fontSize={10}
                fill={SVG_COLORS.muted}
              >
                {`${node.inputCount}in / ${node.outputCount}out - ${formatSats(totalValue)}`}
              </Text>
              {/* Quick tx type label - only on non-expanded nodes without entity/CJ labels */}
              {!node.entityLabel && !node.isCoinJoin && node.inputCount > 0 && node.txid !== expandedNodeTxid && (
                <Text
                  x={node.x + 10}
                  y={node.y + 50}
                  fontSize={9}
                  fill={SVG_COLORS.muted}
                  fillOpacity={0.6}
                >
                  {node.inputCount === 1 && node.outputCount === 1 ? "sweep" :
                   node.inputCount === 1 && node.outputCount === 2 ? "simple send" :
                   node.inputCount > 1 && node.outputCount === 1 ? "consolidation" :
                   node.inputCount === 1 && node.outputCount > 3 ? "batch" :
                   node.tx.vin[0]?.is_coinbase ? "coinbase" :
                   ""}
                </Text>
              )}

              {/* Entity label + category */}
              {node.entityLabel && (
                <>
                  <Text
                    x={node.x + 10}
                    y={node.y + 50}
                    fontSize={9}
                    fill={ENTITY_CATEGORY_COLORS[node.entityCategory ?? "unknown"]}
                    fontWeight={500}
                  >
                    {node.entityLabel}
                  </Text>
                </>
              )}

              {/* Wallet UTXO badge */}
              {walletUtxos?.has(node.txid) && (() => {
                const vouts = walletUtxos.get(node.txid)!;
                const utxoSats = [...vouts].reduce((sum, vi) => sum + (node.tx.vout[vi]?.value ?? 0), 0);
                return (
                  <g>
                    <rect
                      x={node.x}
                      y={node.y + node.height + 2}
                      width={node.width}
                      height={18}
                      rx={4}
                      fill={SVG_COLORS.bitcoin}
                      fillOpacity={0.15}
                      stroke={SVG_COLORS.bitcoin}
                      strokeWidth={0.5}
                      strokeOpacity={0.4}
                    />
                    <Text
                      x={node.x + node.width / 2}
                      y={node.y + node.height + 14}
                      fontSize={9}
                      fill={SVG_COLORS.bitcoin}
                      textAnchor="middle"
                      fontWeight={600}
                    >
                      {vouts.size === 1 ? `Wallet: ${formatSats(utxoSats)}` : `${vouts.size} outputs: ${formatSats(utxoSats)}`}
                    </Text>
                  </g>
                );
              })()}

              {/* Transparent click overlay (single=expand ports, double=expand all UTXOs) */}
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={8}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => handleNodeClick(node, selectedNode?.txid ?? null)}
                onDoubleClick={(e) => { e.stopPropagation(); handleNodeDoubleClick(node); }}
              />

              {/* Expand left button (backward) */}
              {!atCapacity && node.depth <= 0 && (() => {
                const idx = node.tx.vin.findIndex((v) => !v.is_coinbase && !nodes.has(v.txid));
                return idx >= 0 ? (
                  <g className="graph-btn" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onExpandInput(node.txid, idx); }}>
                    <circle cx={node.x - 6} cy={node.y + node.height / 2} r={11} fill={SVG_COLORS.surfaceElevated} stroke={color} strokeWidth={1.5} />
                    <Text x={node.x - 6} y={node.y + node.height / 2 + 5} fontSize={16} fontWeight={700} textAnchor="middle" fill={color}>+</Text>
                  </g>
                ) : null;
              })()}

              {/* Expand right button (forward) */}
              {!atCapacity && (() => {
                const consumedOutputs = new Set<number>();
                for (const [, n] of nodes) {
                  for (const vin of n.tx.vin) {
                    if (vin.txid === node.txid && vin.vout !== undefined) {
                      consumedOutputs.add(vin.vout);
                    }
                  }
                }
                for (let i = 0; i < node.tx.vout.length; i++) {
                  const out = node.tx.vout[i];
                  if (out.scriptpubkey_type === "op_return" || out.value === 0) {
                    consumedOutputs.add(i);
                  }
                }
                if (consumedOutputs.size >= node.tx.vout.length) return null;
                const idx = node.tx.vout.findIndex((_, i) => !consumedOutputs.has(i));
                return idx >= 0 ? (
                  <g className="graph-btn" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onExpandOutput(node.txid, idx); }}>
                    <circle cx={node.x + node.width + 6} cy={node.y + node.height / 2} r={11} fill={SVG_COLORS.surfaceElevated} stroke={color} strokeWidth={1.5} />
                    <Text x={node.x + node.width + 6} y={node.y + node.height / 2 + 5} fontSize={16} fontWeight={700} textAnchor="middle" fill={color}>+</Text>
                  </g>
                ) : null;
              })()}

              {/* Collapse button for non-root nodes */}
              {!node.isRoot && (
                <g className="graph-btn" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onCollapse(node.txid); }}>
                  <circle cx={node.x + node.width - 8} cy={node.y + node.height - 6} r={9} fill={SVG_COLORS.surfaceInset} stroke={SVG_COLORS.muted} strokeWidth={1} />
                  <Text x={node.x + node.width - 8} y={node.y + node.height - 2} fontSize={12} fontWeight={700} textAnchor="middle" fill={SVG_COLORS.muted}>x</Text>
                </g>
              )}
            </motion.g>
          );
        })}
        </g>
      </svg>

      {/* Minimap - only in fullscreen */}
      {isFullscreen && (() => {
        // Use actual SVG element dimensions for accurate viewport rect on mobile
        const svgRect = svgRef.current?.getBoundingClientRect();
        const actualW = svgRect?.width ?? containerWidth;
        const actualH = svgRect?.height ?? (containerHeight ?? 600);
        return (
          <GraphMinimap
            layoutNodes={layoutNodes}
            edges={edges}
            graphWidth={width}
            graphHeight={height}
            viewportWidth={viewTransform ? actualW / viewTransform.scale : actualW}
            viewportHeight={viewTransform ? actualH / viewTransform.scale : actualH}
            scrollLeft={viewTransform ? -viewTransform.x / viewTransform.scale : scrollPos.left}
            scrollTop={viewTransform ? -viewTransform.y / viewTransform.scale : scrollPos.top}
            onMinimapClick={handleMinimapClick}
            heatMap={heatMap}
            heatMapActive={heatMapActive}
          />
        );
      })()}
    </div>
  );
}
