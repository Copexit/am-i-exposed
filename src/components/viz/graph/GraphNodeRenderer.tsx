"use client";

import { motion } from "motion/react";
import { Text } from "@visx/text";
import { useTranslation } from "react-i18next";
import { SVG_COLORS } from "../shared/svgConstants";
import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { ENTITY_CATEGORY_COLORS } from "./constants";
import { getNodeColor } from "./layout";
import { getLockTimeRx, getVersionFill } from "./scriptStyles";
import { ExpandedNode } from "./ExpandedNode";
import { NodeBadges } from "./NodeBadges";
import { PrivacySparkline } from "./PrivacySparkline";
import { NodeExpandButtons } from "./NodeExpandButtons";
import { NodeLabelAnnotation } from "./NodeLabelAnnotation";
import type { LayoutNode, LayoutEdge, GraphNode, TooltipData } from "./types";
import type { MempoolOutspend } from "@/lib/api/types";
import type { ScoringResult } from "@/lib/types";
import type { EditingLabel } from "./useLabelEditor";
import type { useChartTooltip } from "../shared/ChartTooltip";

// ─── Props ──────────────────────────────────────────────────────

interface GraphNodeRendererProps {
  node: LayoutNode;
  graphNodes: Map<string, GraphNode>;
  edges: LayoutEdge[];
  hoveredNode: string | null;
  hoveredEdges: Set<string> | null;
  focusedNode: string | null;
  focusSpotlight: { nodes: Set<string>; edges: Set<string> } | null;
  expandedNodeTxid: string | null | undefined;
  heatMapActive: boolean;
  heatMap: Map<string, ScoringResult>;
  fingerprintMode?: boolean;
  toxicMergeNodes: Set<string>;
  ricochetHopLabels: Map<string, string>;
  walletUtxos?: Map<string, Set<number>>;
  loading: Set<string>;
  atCapacity: boolean;
  outspendCache?: ReadonlyMap<string, MempoolOutspend[]>;
  onExpandInput: (txid: string, inputIndex: number) => void;
  onExpandOutput: (txid: string, outputIndex: number) => void;
  onCollapse: (txid: string) => void;
  onToggleExpand?: (txid: string) => void;
  onExpandPortInput?: (txid: string, inputIndex: number) => void;
  onExpandPortOutput?: (txid: string, outputIndex: number) => void;
  handleNodeClick: (node: LayoutNode, currentSelectedTxid: string | null) => void;
  handleNodeDoubleClick: (node: LayoutNode) => void;
  handleNodeMouseDown: (e: React.MouseEvent, node: LayoutNode) => void;
  handleNodeTouchStart?: (e: React.TouchEvent, node: LayoutNode) => void;
  justDraggedRef: React.RefObject<boolean>;
  draggingTxid: string | null;
  setHoveredNode: (txid: string | null) => void;
  tooltip: ReturnType<typeof useChartTooltip<TooltipData>>;
  toScreen: (gx: number, gy: number) => { x: number; y: number };
  isTouchRef: React.RefObject<boolean>;
  selectedNode: { txid: string; x: number; y: number } | null;
  onNodePositionChange?: (txid: string, x: number, y: number) => void;
  viewTransform?: { x: number; y: number; scale: number };
  hoveredPort: string | null;
  setHoveredPort: (port: string | null) => void;
  annotateMode?: boolean;
  nodeLabels?: Map<string, string>;
  onSetNodeLabel?: (txid: string, label: string) => void;
  editingLabel: EditingLabel | null;
  editLabelText: string;
  setEditLabelText: (text: string) => void;
  startEditNodeLabel: (txid: string) => void;
  commitLabel: () => void;
}

export function GraphNodeRenderer({
  node,
  graphNodes,
  edges,
  hoveredNode,
  hoveredEdges,
  focusedNode,
  focusSpotlight,
  expandedNodeTxid,
  heatMapActive,
  heatMap,
  fingerprintMode,
  toxicMergeNodes,
  ricochetHopLabels,
  walletUtxos,
  loading,
  atCapacity,
  outspendCache,
  onExpandInput,
  onExpandOutput,
  onCollapse,
  onExpandPortInput,
  onExpandPortOutput,
  handleNodeClick,
  handleNodeDoubleClick,
  handleNodeMouseDown,
  handleNodeTouchStart,
  justDraggedRef,
  draggingTxid,
  setHoveredNode,
  tooltip,
  toScreen,
  isTouchRef,
  selectedNode,
  onNodePositionChange,
  viewTransform,
  hoveredPort,
  setHoveredPort,
  annotateMode,
  nodeLabels,
  onSetNodeLabel,
  editingLabel,
  editLabelText,
  setEditLabelText,
  startEditNodeLabel,
  commitLabel,
}: GraphNodeRendererProps) {
  const { t } = useTranslation();

  const heatScore = heatMapActive ? heatMap.get(node.txid)?.score : undefined;
  const color = getNodeColor(node, heatScore);
  const totalValue = node.tx.vout.reduce((s, o) => s + o.value, 0);
  const isHovered = hoveredNode === node.txid;
  const isFocused = focusedNode === node.txid;
  const isDimmedByHover = hoveredNode && !isHovered
    && !hoveredEdges?.has(`e-${hoveredNode}-${node.txid}`)
    && !hoveredEdges?.has(`e-${node.txid}-${hoveredNode}`);
  const isConnectedToHovered = hoveredNode && (
    edges.some((e) =>
      (e.fromTxid === hoveredNode && e.toTxid === node.txid)
      || (e.toTxid === hoveredNode && e.fromTxid === node.txid),
    )
  );
  const isLoading = loading.has(node.txid);
  const isExpandedNode = node.txid === expandedNodeTxid;

  let nodeOpacity = 1;
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
          graphNodes={graphNodes}
          outspends={outspendCache?.get(node.txid)}
          heatScore={heatScore}
          isLoading={isLoading}
          hoveredPort={hoveredPort}
          onHoverPort={setHoveredPort}
          onExpandInput={onExpandPortInput ?? onExpandInput}
          onExpandOutput={onExpandPortOutput ?? onExpandOutput}
          onNodeClick={() => { if (!justDraggedRef.current) handleNodeClick(node, selectedNode?.txid ?? null); }}
          onMouseDown={(e: React.MouseEvent) => handleNodeMouseDown(e, node)}
          onTouchStart={handleNodeTouchStart ? (e: React.TouchEvent) => handleNodeTouchStart(e, node) : undefined}
          atCapacity={atCapacity}
        />
      </motion.g>
    );
  }

  return (
    <motion.g
      key={node.txid}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: nodeOpacity, scale: 1 }}
      transition={{ duration: 0.3 }}
      style={{ cursor: "pointer" }}
      onMouseEnter={() => {
        if (isTouchRef.current) return;
        setHoveredNode(node.txid);
        if (expandedNodeTxid === node.txid) return;
        const pos = toScreen(node.x + node.width / 2, node.y - 8);
        tooltip.showTooltip({
          tooltipData: {
            txid: node.txid, inputCount: node.inputCount, outputCount: node.outputCount,
            totalValue, isCoinJoin: node.isCoinJoin, coinJoinType: node.coinJoinType,
            entityLabel: node.entityLabel, entityCategory: node.entityCategory,
            entityOfac: node.entityOfac, entityConfidence: node.entityConfidence,
            depth: node.depth, fee: node.fee, feeRate: node.feeRate, confirmed: node.confirmed,
          },
          tooltipLeft: pos.x, tooltipTop: pos.y,
        });
      }}
      onMouseLeave={() => { setHoveredNode(null); tooltip.hideTooltip(); }}
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
      <rect
        x={node.x} y={node.y} width={node.width} height={node.height}
        rx={fingerprintMode ? getLockTimeRx(node.tx.version) : 8}
        fill={fingerprintMode ? getVersionFill(node.tx.locktime) : heatMapActive && heatScore !== undefined ? `${color}20` : SVG_COLORS.surfaceElevated}
        stroke={color}
        strokeWidth={isHovered ? 2.5 : (node.isRoot ? 2.5 : 1.5)}
        strokeOpacity={isHovered || node.isRoot ? 1 : 0.6}
        filter={node.isRoot ? "url(#glow-medium)" : (isHovered ? "url(#glow-subtle)" : undefined)}
        onClick={() => handleNodeClick(node, selectedNode?.txid ?? null)}
      />

      {/* Focused node indicator */}
      {isFocused && (
        <rect x={node.x - 3} y={node.y - 3} width={node.width + 6} height={node.height + 6} rx={10} fill="none" stroke={SVG_COLORS.bitcoin} strokeWidth={1.5} strokeDasharray="4 4" strokeOpacity={0.7}>
          <animate attributeName="stroke-dashoffset" values="0;8" dur="0.8s" repeatCount="indefinite" />
        </rect>
      )}

      {/* Loading pulse overlay */}
      {isLoading && (
        <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={8} fill={color} fillOpacity={0.15}>
          <animate attributeName="fill-opacity" values="0.05;0.2;0.05" dur="1.2s" repeatCount="indefinite" />
        </rect>
      )}

      {/* Badge pills */}
      <NodeBadges nodeX={node.x} nodeY={node.y} nodeWidth={node.width} isCoinJoin={node.isCoinJoin} coinJoinType={node.coinJoinType} isOfac={node.entityOfac} isToxicMerge={toxicMergeNodes.has(node.txid)} />

      {/* Privacy score sparkline */}
      {heatMapActive && heatMap.has(node.txid) && (
        <PrivacySparkline scoringResult={heatMap.get(node.txid)!} nodeX={node.x} nodeY={node.y} nodeWidth={node.width} nodeHeight={node.height} />
      )}

      {/* Heat map score */}
      {heatMapActive && heatScore !== undefined && (
        <Text x={node.x + node.width - 20} y={node.y + node.height / 2 + 6} fontSize={18} fontWeight={800} fill={color} textAnchor="middle" opacity={0.9}>{heatScore}</Text>
      )}

      {/* Txid label */}
      <Text x={node.x + 10} y={node.y + 20} fontSize={11} fill={color} fontWeight={600} fontFamily="monospace">{truncateId(node.txid, 8)}</Text>

      {/* Summary line */}
      <Text x={node.x + 10} y={node.y + 38} fontSize={10} fill={SVG_COLORS.muted}>
        {`${node.inputCount}in / ${node.outputCount}out - ${formatSats(totalValue)}`}
      </Text>

      {/* Quick tx type label */}
      {!node.entityLabel && !node.isCoinJoin && node.inputCount > 0 && node.txid !== expandedNodeTxid && (
        <Text x={node.x + 10} y={node.y + 50} fontSize={9} fill={SVG_COLORS.muted} fillOpacity={0.6}>
          {ricochetHopLabels.get(node.txid) ??
           (node.tx.vout.some(o => o.scriptpubkey_type === "op_return" && o.scriptpubkey.replace(/^6a(?:4c..)?/, "").length === 160) &&
           node.tx.vout.some(o => o.value > 0 && o.value <= 1000) ? t("graph.bip47Notification", { defaultValue: "BIP47 notification" }) :
           node.inputCount === 1 && node.outputCount === 1 ? t("graph.txTypeSweep", { defaultValue: "sweep" }) :
           node.inputCount === 1 && node.outputCount === 2 ? t("graph.txTypeSimpleSend", { defaultValue: "simple send" }) :
           node.inputCount > 1 && node.outputCount === 1 ? t("graph.txTypeConsolidation", { defaultValue: "consolidation" }) :
           node.inputCount === 1 && node.outputCount > 3 ? t("graph.txTypeBatch", { defaultValue: "batch" }) :
           node.tx.vin[0]?.is_coinbase ? t("graph.coinbase", { defaultValue: "coinbase" }) :
           "")}
        </Text>
      )}

      {/* Entity label + category */}
      {node.entityLabel && (
        <Text x={node.x + 10} y={node.y + 50} fontSize={9} fill={ENTITY_CATEGORY_COLORS[node.entityCategory ?? "unknown"]} fontWeight={500}>
          {node.entityLabel}
        </Text>
      )}

      {/* Wallet UTXO badge */}
      {walletUtxos?.has(node.txid) && (() => {
        const vouts = walletUtxos.get(node.txid)!;
        const utxoSats = [...vouts].reduce((sum, vi) => sum + (node.tx.vout[vi]?.value ?? 0), 0);
        return (
          <g>
            <rect x={node.x} y={node.y + node.height + 2} width={node.width} height={18} rx={4} fill={SVG_COLORS.bitcoin} fillOpacity={0.15} stroke={SVG_COLORS.bitcoin} strokeWidth={0.5} strokeOpacity={0.4} />
            <Text x={node.x + node.width / 2} y={node.y + node.height + 14} fontSize={9} fill={SVG_COLORS.bitcoin} textAnchor="middle" fontWeight={600}>
              {vouts.size === 1 ? t("graph.walletOutput", { sats: formatSats(utxoSats), defaultValue: "Wallet: {{sats}}" }) : t("graph.walletOutputs", { count: vouts.size, sats: formatSats(utxoSats), defaultValue: "{{count}} outputs: {{sats}}" })}
            </Text>
          </g>
        );
      })()}

      {/* Transparent click overlay */}
      <rect
        x={node.x} y={node.y} width={node.width} height={node.height} rx={8} fill="transparent"
        style={{ cursor: draggingTxid === node.txid ? "grabbing" : onNodePositionChange && viewTransform ? "grab" : "pointer" }}
        onMouseDown={(e) => handleNodeMouseDown(e, node)}
        onTouchStart={handleNodeTouchStart ? (e) => handleNodeTouchStart(e, node) : undefined}
        onClick={() => { if (!justDraggedRef.current) handleNodeClick(node, selectedNode?.txid ?? null); }}
        onDoubleClick={(e) => { e.stopPropagation(); handleNodeDoubleClick(node); }}
      />

      <NodeExpandButtons
        node={node}
        graphNodes={graphNodes}
        color={color}
        atCapacity={atCapacity}
        outspendCache={outspendCache}
        onExpandInput={onExpandInput}
        onExpandOutput={onExpandOutput}
        onCollapse={onCollapse}
      />

      <NodeLabelAnnotation
        node={node}
        annotateMode={annotateMode}
        nodeLabels={nodeLabels}
        onSetNodeLabel={onSetNodeLabel}
        editingLabel={editingLabel}
        editLabelText={editLabelText}
        setEditLabelText={setEditLabelText}
        startEditNodeLabel={startEditNodeLabel}
        commitLabel={commitLabel}
      />
    </motion.g>
  );
}
