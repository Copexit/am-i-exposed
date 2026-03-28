"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { useTheme } from "@/hooks/useTheme";
import { ChartDefs } from "../shared/ChartDefs";
import { SCROLL_MARGIN_X, SCROLL_MARGIN_Y } from "./constants";
import { GraphSvgDefs } from "./GraphSvgDefs";
import { GraphMinimap } from "./GraphMinimap";
import { GraphEdges } from "./GraphEdges";
import { GraphEdgeLabels } from "./GraphEdgeLabels";
import { usePanZoom } from "./usePanZoom";
import { useNodeDragging } from "./useNodeDragging";
import { useKeyboardNavigation } from "./useKeyboardNavigation";
import { useLabelEditor } from "./useLabelEditor";
import { useGraphLayout } from "./useGraphLayout";
import { GraphAnnotations } from "./GraphAnnotations";
import { GraphNodeRenderer } from "./GraphNodeRenderer";
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
  nodePositionOverrides,
  onNodePositionChange,
  annotations,
  annotateMode,
  onAnnotationsChange,
  nodeLabels,
  onSetNodeLabel,
  edgeLabels,
  onSetEdgeLabel,
}: GraphCanvasProps) {
  // Subscribe to theme changes so SVG_COLORS proxy resolves fresh values on re-render
  useTheme();
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

  // ─── Node dragging ──────────────────────────────────────────────
  const { draggingTxid, handleNodeMouseDown, handleNodeTouchStart, justDraggedRef } = useNodeDragging({
    onNodePositionChange,
    viewTransform,
    annotateMode,
  });

  // ─── Inline label editing (node/edge annotations) ──────────
  const {
    editingLabel, editLabelText, setEditLabelText,
    startEditNodeLabel, startEditEdgeLabel, commitLabel,
  } = useLabelEditor({ nodeLabels, edgeLabels, onSetNodeLabel, onSetEdgeLabel });

  // Pan/zoom/pinch interaction (fullscreen transform mode)
  const handlePanStartDismiss = useCallback(() => {
    setSelectedNode(null);
    tooltip.hideTooltip();
    setHoveredNode(null);
    setHoveredEdgeKey(null);
  }, [setSelectedNode, tooltip, setHoveredNode]);
  const handleWheelDismiss = useCallback(() => {
    tooltip.hideTooltip();
  }, [tooltip]);
  const { svgRef, wrapperRef, isPanning, handlePanStart } = usePanZoom({
    viewTransform,
    onViewTransformChange,
    scrollRef,
    onPanStart: handlePanStartDismiss,
    onWheel: handleWheelDismiss,
  });

  // Convert graph coordinates to screen coordinates (accounts for scroll or view transform)
  const toScreen = useCallback((gx: number, gy: number) => {
    if (viewTransform) {
      return { x: gx * viewTransform.scale + viewTransform.x, y: gy * viewTransform.scale + viewTransform.y };
    }
    const sx = scrollRef.current?.scrollLeft ?? 0;
    const sy = scrollRef.current?.scrollTop ?? 0;
    return { x: gx - sx, y: gy - sy };
  }, [viewTransform, scrollRef]);

  const isFs = !!isFullscreen; // fullscreen layout mode (reserve backward space)

  // ─── Layout + derived graph data ──────────────────────────────
  const {
    layoutNodes, edges, width, height, nodePositions,
    ricochetHopLabels, portPositions,
    maxEdgeValue, edgeScriptInfo,
    detChainEdges, entropyEdges,
    toxicMergeNodes, hoveredEdges, focusSpotlight,
  } = useGraphLayout({
    nodes, rootTxid, filter, rootTxids,
    expandedNodeTxid, isFullscreen: isFs,
    nodePositionOverrides, boltzmannCache,
    entropyGradientMode, hoveredNode,
  });

  // Report visible count to parent (eliminates redundant layout call)
  useEffect(() => {
    onLayoutComplete?.({ visibleCount: layoutNodes.length, nodePositions, containerWidth, containerHeight: containerHeight ?? 0 });
  }, [layoutNodes.length, nodePositions, onLayoutComplete, containerWidth, containerHeight]);

  // Auto-center on first render when viewTransform is available.
  // GraphCanvas knows the real containerWidth/containerHeight from ParentSize,
  // so it can compute the correct centering without guessing.
  const hasAutoCenteredRef = useRef(false);
  useEffect(() => {
    if (!onViewTransformChange || hasAutoCenteredRef.current) return;
    if (layoutNodes.length === 0 || containerWidth <= 0) return;
    const ch = containerHeight ?? 0;
    if (ch <= 0) return;

    hasAutoCenteredRef.current = true;
    const roots = layoutNodes.filter((n) => n.isRoot);
    const targets = roots.length > 0 ? roots : layoutNodes;
    const avgX = targets.reduce((s, n) => s + n.x + n.width / 2, 0) / targets.length;
    const avgY = targets.reduce((s, n) => s + n.y + n.height / 2, 0) / targets.length;
    onViewTransformChange({ x: containerWidth / 2 - avgX, y: ch / 2 - avgY, scale: 1 });
  }, [layoutNodes, containerWidth, containerHeight, onViewTransformChange]);

  const svgWidth = Math.max(containerWidth, width);
  const svgHeight = Math.max(isFullscreen ? (containerHeight ?? height) : height, 150);

  // Keyboard navigation
  const handleKeyDown = useKeyboardNavigation({
    focusedNode,
    setFocusedNode,
    layoutNodes,
    nodes,
    rootTxid,
    atCapacity,
    expandedNodeTxid,
    onExpandInput,
    onExpandOutput,
    onCollapse,
    onToggleExpand,
  });

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
    // In annotate mode, clicking a node opens its label editor
    if (annotateMode && onSetNodeLabel) {
      startEditNodeLabel(node.txid);
      return;
    }
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
  }, [setSelectedNode, toScreen, onToggleExpand, annotateMode, onSetNodeLabel, startEditNodeLabel]);

  // Minimap scroll handler
  const [scrollPos, setScrollPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => setScrollPos({ left: el.scrollLeft, top: el.scrollTop });
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [scrollRef]);

  // Track SVG element dimensions for minimap viewport rect (avoids ref read during render)
  const [svgDims, setSvgDims] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !isFullscreen) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSvgDims({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [svgRef, isFullscreen]);

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

  // Pre-compute minimap visibility to avoid IIFE in JSX
  const showMinimap = useMemo(() => {
    if (!isFullscreen) return false;
    const actualW = svgDims?.width ?? containerWidth;
    const actualH = svgDims?.height ?? (containerHeight ?? 600);
    const nodesMinX = layoutNodes.length > 0 ? Math.min(...layoutNodes.map((n) => n.x)) : 0;
    const nodesMaxX = layoutNodes.length > 0 ? Math.max(...layoutNodes.map((n) => n.x + n.width)) : 0;
    const nodesMaxY = layoutNodes.length > 0 ? Math.max(...layoutNodes.map((n) => n.y + n.height)) : 0;
    const nodesW = nodesMaxX - nodesMinX;
    const nodesH = nodesMaxY;
    const vScale = viewTransform?.scale ?? 1;
    return !(nodesW * vScale < actualW && nodesH * vScale < actualH);
  }, [isFullscreen, svgDims, containerWidth, containerHeight, layoutNodes, viewTransform]);

  const minimapViewportWidth = viewTransform
    ? (svgDims?.width ?? containerWidth) / viewTransform.scale
    : (svgDims?.width ?? containerWidth);
  const minimapViewportHeight = viewTransform
    ? (svgDims?.height ?? (containerHeight ?? 600)) / viewTransform.scale
    : (svgDims?.height ?? (containerHeight ?? 600));
  const minimapScrollLeft = viewTransform ? -viewTransform.x / viewTransform.scale : scrollPos.left;
  const minimapScrollTop = viewTransform ? -viewTransform.y / viewTransform.scale : scrollPos.top;

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
        style={{
          userSelect: "none",
          WebkitUserSelect: "none",
          cursor: isPanning ? "grabbing" : "grab",
          ...(viewTransform ? { touchAction: "none" } : {}),
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedNode(null);
        }}
      >
        <ChartDefs />
        <GraphSvgDefs />

        <rect
          width={viewTransform ? containerWidth : svgWidth}
          height={viewTransform ? (containerHeight ?? svgHeight) : svgHeight}
          fill="black"
          fillOpacity={0}
          pointerEvents={annotateMode ? "none" : "all"}
          onMouseDown={handlePanStart}
        />

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

        {/* Edges (main edges, hover overlay, det-chain overlay, flow particles) */}
        <GraphEdges
          edges={edges}
          nodes={nodes}
          rootTxid={rootTxid}
          expandedNodeTxid={expandedNodeTxid}
          portPositions={portPositions}
          hoveredNode={hoveredNode}
          hoveredEdges={hoveredEdges}
          hoveredEdgeKey={hoveredEdgeKey}
          setHoveredEdgeKey={setHoveredEdgeKey}
          focusSpotlight={focusSpotlight}
          linkabilityEdgeMode={linkabilityEdgeMode}
          rootBoltzmannResult={rootBoltzmannResult}
          boltzmannCache={boltzmannCache}
          changeOutputs={changeOutputs}
          detChainEdges={detChainEdges}
          entropyEdges={entropyEdges}
          maxEdgeValue={maxEdgeValue}
          edgeScriptInfo={edgeScriptInfo}
          tooltip={tooltip}
          toScreen={toScreen}
        />

        {/* Annotations layer (between edges and nodes) */}
        {annotations && annotations.length > 0 && (
          <GraphAnnotations
            annotations={annotations}
            annotateMode={!!annotateMode}
            viewTransform={viewTransform}
            onAdd={(a) => onAnnotationsChange?.([...(annotations ?? []), a])}
            onUpdate={(id, patch) => onAnnotationsChange?.(annotations.map((a) => a.id === id ? { ...a, ...patch } : a))}
            onDelete={(id) => onAnnotationsChange?.(annotations.filter((a) => a.id !== id))}
          />
        )}
        {/* Annotate mode overlay for creating new annotations on empty canvas */}
        {annotateMode && (!annotations || annotations.length === 0) && (
          <GraphAnnotations
            annotations={[]}
            annotateMode
            viewTransform={viewTransform}
            onAdd={(a) => onAnnotationsChange?.([a])}
            onUpdate={() => {}}
            onDelete={() => {}}
          />
        )}

        {/* Nodes */}
        {layoutNodes.map((node) => (
          <GraphNodeRenderer
            key={node.txid}
            node={node}
            graphNodes={nodes}
            edges={edges}
            hoveredNode={hoveredNode}
            hoveredEdges={hoveredEdges}
            focusedNode={focusedNode}
            focusSpotlight={focusSpotlight}
            expandedNodeTxid={expandedNodeTxid ?? null}
            heatMapActive={heatMapActive}
            heatMap={heatMap}
            fingerprintMode={fingerprintMode}
            toxicMergeNodes={toxicMergeNodes}
            ricochetHopLabels={ricochetHopLabels}
            walletUtxos={walletUtxos}
            loading={loading}
            atCapacity={atCapacity}
            outspendCache={outspendCache}
            onExpandInput={onExpandInput}
            onExpandOutput={onExpandOutput}
            onCollapse={onCollapse}
            onExpandPortInput={onExpandPortInput}
            onExpandPortOutput={onExpandPortOutput}
            handleNodeClick={handleNodeClick}
            handleNodeDoubleClick={handleNodeDoubleClick}
            handleNodeMouseDown={handleNodeMouseDown}
            handleNodeTouchStart={handleNodeTouchStart}
            justDraggedRef={justDraggedRef}
            draggingTxid={draggingTxid}
            setHoveredNode={setHoveredNode}
            tooltip={tooltip}
            toScreen={toScreen}
            isTouchRef={isTouchRef}
            selectedNode={selectedNode}
            onNodePositionChange={onNodePositionChange}
            viewTransform={viewTransform}
            hoveredPort={hoveredPort}
            setHoveredPort={setHoveredPort}
            annotateMode={annotateMode}
            nodeLabels={nodeLabels}
            onSetNodeLabel={onSetNodeLabel}
            editingLabel={editingLabel}
            editLabelText={editLabelText}
            setEditLabelText={setEditLabelText}
            startEditNodeLabel={startEditNodeLabel}
            commitLabel={commitLabel}
          />
        ))}

        {/* Edge labels (rendered on top of nodes for clickability) */}
        <GraphEdgeLabels
          edges={edges}
          edgeLabels={edgeLabels}
          annotateMode={annotateMode}
          editingLabel={editingLabel}
          editLabelText={editLabelText}
          setEditLabelText={setEditLabelText}
          startEditEdgeLabel={startEditEdgeLabel}
          commitLabel={commitLabel}
          onSetEdgeLabel={onSetEdgeLabel}
        />

        </g>
      </svg>

      {/* Minimap - only in fullscreen, hidden when all nodes fit in viewport */}
      {showMinimap && (
        <GraphMinimap
          layoutNodes={layoutNodes}
          edges={edges}
          graphWidth={width}
          graphHeight={height}
          viewportWidth={minimapViewportWidth}
          viewportHeight={minimapViewportHeight}
          scrollLeft={minimapScrollLeft}
          scrollTop={minimapScrollTop}
          onMinimapClick={handleMinimapClick}
          heatMap={heatMap}
          heatMapActive={heatMapActive}
        />
      )}
    </div>
  );
}
