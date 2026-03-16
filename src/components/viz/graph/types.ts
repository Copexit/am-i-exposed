import type { GraphNode } from "@/hooks/useGraphExpansion";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { Finding, ScoringResult } from "@/lib/types";
import type { EntityCategory } from "@/lib/analysis/entities";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { useChartTooltip } from "../shared/ChartTooltip";

// Re-export for convenience
export type { GraphNode } from "@/hooks/useGraphExpansion";

export interface GraphExplorerProps {
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  /** Multi-root highlight set (wallet UTXO graph). */
  rootTxids?: Set<string>;
  /** Txid -> vout indices for UTXO badges on root nodes. */
  walletUtxos?: Map<string, Set<number>>;
  findings?: Finding[];
  loading: Set<string>;
  errors: Map<string, string>;
  nodeCount: number;
  maxNodes: number;
  canUndo: boolean;
  onExpandInput: (txid: string, inputIndex: number) => void;
  onExpandOutput: (txid: string, outputIndex: number) => void;
  onCollapse: (txid: string) => void;
  onUndo: () => void;
  onReset: () => void;
  onTxClick?: (txid: string) => void;
  /** Boltzmann result for the root transaction (linkability edge coloring). */
  rootBoltzmannResult?: BoltzmannWorkerResult | null;
  /** Txid of the single expanded node (shows UTXO ports). */
  expandedNodeTxid?: string | null;
  /** Toggle expansion of a node (collapses previous). */
  onToggleExpand?: (txid: string) => void;
  /** Expand backward from a specific input port. */
  onExpandPortInput?: (txid: string, inputIndex: number) => void;
  /** Expand forward from a specific output port. */
  onExpandPortOutput?: (txid: string, outputIndex: number) => void;
  /** Cached outspends per txid. */
  outspendCache?: Map<string, MempoolOutspend[]>;
  /** Trigger auto-trace forward from a specific output. */
  onAutoTrace?: (txid: string, outputIndex: number) => void;
  /** Cancel in-progress auto-trace. */
  onCancelAutoTrace?: () => void;
  /** Whether auto-trace is currently running. */
  autoTracing?: boolean;
  /** Auto-trace progress info. */
  autoTraceProgress?: { hop: number; txid: string; reason: string } | null;
  /** Trigger compounding linkability trace from a specific output. */
  onAutoTraceLinkability?: (txid: string, outputIndex: number) => void;
  /** Number of snapshots in the undo stack (for time travel slider). */
  undoStackLength?: number;
  /** Jump to a specific snapshot in the undo stack. */
  onGotoSnapshot?: (index: number) => void;
  /** Smart view mode: only auto-show relevant nodes. */
  smartView?: boolean;
  /** Toggle smart view on/off (re-initializes graph). */
  onToggleSmartView?: () => void;
}

export interface LayoutNode {
  txid: string;
  tx: MempoolTransaction;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  isRoot: boolean;
  isCoinJoin: boolean;
  coinJoinType?: string;
  entityLabel?: string;
  entityCategory?: EntityCategory;
  entityOfac?: boolean;
  entityConfidence?: "high" | "medium";
  inputCount: number;
  outputCount: number;
  fee: number;
  feeRate: string;
  confirmed: boolean;
}

export interface LayoutEdge {
  fromTxid: string;
  toTxid: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** True when this edge was created by a backward expansion (new node at lower depth). */
  isBackward: boolean;
  /** Number of outputs from `fromTxid` consumed by `toTxid`. >= 2 means consolidation. */
  consolidationCount: number;
  /** Which output indices of `fromTxid` are consumed by `toTxid`. */
  outputIndices?: number[];
}

export interface TooltipData {
  txid: string;
  inputCount: number;
  outputCount: number;
  totalValue: number;
  isCoinJoin: boolean;
  coinJoinType?: string;
  entityLabel?: string;
  entityCategory?: EntityCategory;
  entityOfac?: boolean;
  entityConfidence?: "high" | "medium";
  depth: number;
  fee: number;
  feeRate: string;
  confirmed: boolean;
  /** Linkability probability for edge hover tooltip. */
  linkProb?: number;
  /** Normalized effective entropy for edge hover tooltip (0-1). */
  entropyNormalized?: number;
  /** Effective entropy in bits for edge hover tooltip. */
  entropyBits?: number;
}

export type NodeFilter = {
  showCoinJoin: boolean;
  showEntity: boolean;
  showStandard: boolean;
};

export interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

// ─── Port / Expanded Node types ──────────────────────────────────

/** Layout info for a single input or output port within an expanded node. */
export interface PortLayout {
  index: number;
  address: string;
  value: number;
  scriptType: string;
  /** Absolute y center of this port in SVG coordinates. */
  y: number;
  /** For outputs: spend status from outspends. */
  spent?: boolean | null;
  /** For outputs: which tx spent it. */
  spentByTxid?: string;
  /** For inputs: parent txid. */
  parentTxid?: string;
  /** Whether this port can be clicked to expand the graph. */
  isExpandable: boolean;
  /** Whether the connected tx is already in the graph. */
  isExpanded: boolean;
}

/** Position map for port-to-port edge routing. Keyed by "${txid}:${side}:${index}". */
export type PortPositionMap = Map<string, { x: number; y: number }>;

export interface GraphCanvasProps extends GraphExplorerProps {
  containerWidth: number;
  containerHeight?: number;
  tooltip: ReturnType<typeof useChartTooltip<TooltipData>>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  filter: NodeFilter;
  hoveredNode: string | null;
  setHoveredNode: (txid: string | null) => void;
  selectedNode: { txid: string; x: number; y: number } | null;
  setSelectedNode: (node: { txid: string; x: number; y: number } | null) => void;
  focusedNode: string | null;
  setFocusedNode: (txid: string | null) => void;
  heatMap: Map<string, ScoringResult>;
  heatMapActive: boolean;
  isFullscreen?: boolean;
  viewTransform?: ViewTransform;
  onViewTransformChange?: (vt: ViewTransform) => void;
  linkabilityEdgeMode?: boolean;
  /** Fingerprint mode: encode locktime (node shape) and version (node fill). */
  fingerprintMode?: boolean;
  /** Entropy gradient mode: color edges by effective (bottleneck) entropy across hops. */
  entropyGradientMode?: boolean;
  /** Change-marked output keys: "${txid}:${outputIndex}". Edges from these render orange. */
  changeOutputs?: Set<string>;
  /** Called after layout with visible node count (avoids redundant layout computation). */
  onLayoutComplete?: (info: { visibleCount: number }) => void;
  /** Boltzmann results for any node (not just root). Keyed by txid. */
  boltzmannCache?: Map<string, BoltzmannWorkerResult>;
}

export interface MinimapProps {
  layoutNodes: LayoutNode[];
  edges: LayoutEdge[];
  graphWidth: number;
  graphHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollLeft: number;
  scrollTop: number;
  onMinimapClick: (x: number, y: number) => void;
  heatMap: Map<string, ScoringResult>;
  heatMapActive: boolean;
}
