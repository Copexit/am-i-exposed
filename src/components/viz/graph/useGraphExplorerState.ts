/**
 * Reducer-based state management for GraphExplorer.
 *
 * Replaces 18+ individual useState calls with a single useReducer,
 * grouping all boolean flags, mode state, and data collections.
 */

import { useReducer, useCallback, useRef } from "react";
import type { ScoringResult } from "@/lib/types";
import type { GraphAnnotation, SavedGraph } from "@/lib/graph/saved-graph-types";
import type { NodeFilter, ViewTransform } from "./types";

// ─── State ──────────────────────────────────────────────────────────

type EdgeMode = "default" | "linkability" | "entropy";

export interface GraphExplorerState {
  // Interaction
  hoveredNode: string | null;
  selectedNode: { txid: string; x: number; y: number } | null;
  focusedNode: string | null;
  filter: NodeFilter;
  sidebarCollapsed: boolean;

  // Node position overrides from dragging
  nodePositionOverrides: Map<string, { x: number; y: number }>;

  // Annotations
  annotations: GraphAnnotation[];
  annotateMode: boolean;

  // Labels
  nodeLabels: Map<string, string>;
  edgeLabels: Map<string, string>;

  // View
  viewTransform: ViewTransform | undefined;

  // Edge coloring
  edgeMode: EdgeMode;

  // Heat map
  heatMapActive: boolean;
  heatMap: Map<string, ScoringResult>;
  heatProgress: number;

  // Fingerprint mode
  fingerprintMode: boolean;

  // Change marking
  changeOutputs: Set<string>;

  // Layout info
  visibleCount: number;
}

// ─── Actions ────────────────────────────────────────────────────────

type GraphExplorerAction =
  | { type: "SET_HOVERED_NODE"; txid: string | null }
  | { type: "SET_SELECTED_NODE"; node: { txid: string; x: number; y: number } | null }
  | { type: "SET_FOCUSED_NODE"; txid: string | null }
  | { type: "SET_FILTER"; filter: NodeFilter }
  | { type: "TOGGLE_FILTER"; key: keyof NodeFilter }
  | { type: "SET_SIDEBAR_COLLAPSED"; collapsed: boolean }
  | { type: "SET_NODE_POSITION"; txid: string; x: number; y: number }
  | { type: "SET_NODE_POSITION_OVERRIDES"; overrides: Map<string, { x: number; y: number }> }
  | { type: "SET_ANNOTATIONS"; annotations: GraphAnnotation[] }
  | { type: "TOGGLE_ANNOTATE_MODE" }
  | { type: "SET_NODE_LABEL"; txid: string; label: string }
  | { type: "SET_EDGE_LABEL"; key: string; label: string }
  | { type: "SET_NODE_LABELS"; labels: Map<string, string> }
  | { type: "SET_EDGE_LABELS"; labels: Map<string, string> }
  | { type: "SET_VIEW_TRANSFORM"; vt: ViewTransform | undefined }
  | { type: "SET_EDGE_MODE"; mode: EdgeMode }
  | { type: "CYCLE_EDGE_MODE"; hasLinkability: boolean }
  | { type: "SET_HEAT_MAP_ACTIVE"; active: boolean }
  | { type: "SET_HEAT_MAP"; heatMap: Map<string, ScoringResult> }
  | { type: "SET_HEAT_PROGRESS"; progress: number }
  | { type: "SET_FINGERPRINT_MODE"; active: boolean }
  | { type: "TOGGLE_HEAT_MAP" }
  | { type: "TOGGLE_FINGERPRINT" }
  | { type: "SET_CHANGE_OUTPUTS"; outputs: Set<string> }
  | { type: "TOGGLE_CHANGE_OUTPUT"; txid: string; outputIndex: number }
  | { type: "MERGE_CHANGE_OUTPUTS"; keys: Set<string>; userToggled: Set<string> }
  | { type: "SET_VISIBLE_COUNT"; count: number }
  | { type: "RESTORE_SAVED_GRAPH"; graph: SavedGraph }
  | { type: "CLEAR_FULLSCREEN" };

// ─── Reducer ────────────────────────────────────────────────────────

function graphExplorerReducer(state: GraphExplorerState, action: GraphExplorerAction): GraphExplorerState {
  switch (action.type) {
    case "SET_HOVERED_NODE":
      return { ...state, hoveredNode: action.txid };
    case "SET_SELECTED_NODE":
      return { ...state, selectedNode: action.node };
    case "SET_FOCUSED_NODE":
      return { ...state, focusedNode: action.txid };
    case "SET_FILTER":
      return { ...state, filter: action.filter };
    case "TOGGLE_FILTER":
      return { ...state, filter: { ...state.filter, [action.key]: !state.filter[action.key] } };
    case "SET_SIDEBAR_COLLAPSED":
      return { ...state, sidebarCollapsed: action.collapsed };
    case "SET_NODE_POSITION": {
      const next = new Map(state.nodePositionOverrides);
      next.set(action.txid, { x: action.x, y: action.y });
      return { ...state, nodePositionOverrides: next };
    }
    case "SET_NODE_POSITION_OVERRIDES":
      return { ...state, nodePositionOverrides: action.overrides };
    case "SET_ANNOTATIONS":
      return { ...state, annotations: action.annotations };
    case "TOGGLE_ANNOTATE_MODE":
      return { ...state, annotateMode: !state.annotateMode };
    case "SET_NODE_LABEL": {
      const next = new Map(state.nodeLabels);
      if (action.label) next.set(action.txid, action.label);
      else next.delete(action.txid);
      return { ...state, nodeLabels: next };
    }
    case "SET_EDGE_LABEL": {
      const next = new Map(state.edgeLabels);
      if (action.label) next.set(action.key, action.label);
      else next.delete(action.key);
      return { ...state, edgeLabels: next };
    }
    case "SET_NODE_LABELS":
      return { ...state, nodeLabels: action.labels };
    case "SET_EDGE_LABELS":
      return { ...state, edgeLabels: action.labels };
    case "SET_VIEW_TRANSFORM":
      return { ...state, viewTransform: action.vt };
    case "SET_EDGE_MODE":
      return { ...state, edgeMode: action.mode };
    case "CYCLE_EDGE_MODE": {
      const prev = state.edgeMode;
      let next: EdgeMode;
      if (prev === "default") next = action.hasLinkability ? "linkability" : "entropy";
      else if (prev === "linkability") next = "entropy";
      else next = "default";
      return { ...state, edgeMode: next };
    }
    case "SET_HEAT_MAP_ACTIVE":
      return { ...state, heatMapActive: action.active };
    case "SET_HEAT_MAP":
      return { ...state, heatMap: action.heatMap };
    case "SET_HEAT_PROGRESS":
      return { ...state, heatProgress: action.progress };
    case "SET_FINGERPRINT_MODE":
      return { ...state, fingerprintMode: action.active };
    case "TOGGLE_HEAT_MAP":
      return {
        ...state,
        heatMapActive: !state.heatMapActive,
        fingerprintMode: !state.heatMapActive ? false : state.fingerprintMode,
      };
    case "TOGGLE_FINGERPRINT":
      return {
        ...state,
        fingerprintMode: !state.fingerprintMode,
        heatMapActive: !state.fingerprintMode ? false : state.heatMapActive,
      };
    case "SET_CHANGE_OUTPUTS":
      return { ...state, changeOutputs: action.outputs };
    case "TOGGLE_CHANGE_OUTPUT": {
      const key = `${action.txid}:${action.outputIndex}`;
      const next = new Set(state.changeOutputs);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...state, changeOutputs: next };
    }
    case "MERGE_CHANGE_OUTPUTS": {
      const next = new Set(state.changeOutputs);
      for (const key of action.keys) {
        if (!action.userToggled.has(key)) next.add(key);
      }
      return { ...state, changeOutputs: next };
    }
    case "SET_VISIBLE_COUNT":
      return { ...state, visibleCount: action.count };
    case "RESTORE_SAVED_GRAPH":
      return {
        ...state,
        nodePositionOverrides: action.graph.nodePositions
          ? new Map(Object.entries(action.graph.nodePositions))
          : new Map(),
        annotations: action.graph.annotations ?? [],
        nodeLabels: action.graph.nodeLabels
          ? new Map(Object.entries(action.graph.nodeLabels))
          : new Map(),
        edgeLabels: action.graph.edgeLabels
          ? new Map(Object.entries(action.graph.edgeLabels))
          : new Map(),
      };
    case "CLEAR_FULLSCREEN":
      return { ...state, selectedNode: null, viewTransform: undefined };
    default:
      return state;
  }
}

// ─── Initial state factory ──────────────────────────────────────────

function createInitialState(alwaysFullscreen?: boolean): GraphExplorerState {
  return {
    hoveredNode: null,
    selectedNode: null,
    focusedNode: null,
    filter: { showCoinJoin: true, showEntity: true, showStandard: true },
    sidebarCollapsed: typeof window !== "undefined" && window.innerWidth < 640,
    nodePositionOverrides: new Map(),
    annotations: [],
    annotateMode: false,
    nodeLabels: new Map(),
    edgeLabels: new Map(),
    viewTransform: alwaysFullscreen ? { x: 0, y: 0, scale: 1 } : undefined,
    edgeMode: "default",
    heatMapActive: false,
    heatMap: new Map(),
    heatProgress: 0,
    fingerprintMode: false,
    changeOutputs: new Set(),
    visibleCount: 0,
  };
}

// ─── Hook ───────────────────────────────────────────────────────────

export function useGraphExplorerState(alwaysFullscreen?: boolean) {
  const [state, dispatch] = useReducer(
    graphExplorerReducer,
    alwaysFullscreen,
    createInitialState,
  );

  // Track manual change output overrides (not part of reducer - ref-only)
  const userToggledRef = useRef<Set<string>>(new Set());

  const toggleChange = useCallback((txid: string, outputIndex: number) => {
    const key = `${txid}:${outputIndex}`;
    userToggledRef.current.add(key);
    dispatch({ type: "TOGGLE_CHANGE_OUTPUT", txid, outputIndex });
  }, []);

  const handleNodePositionChange = useCallback((txid: string, x: number, y: number) => {
    dispatch({ type: "SET_NODE_POSITION", txid, x, y });
  }, []);

  const handleSetNodeLabel = useCallback((txid: string, label: string) => {
    dispatch({ type: "SET_NODE_LABEL", txid, label });
  }, []);

  const handleSetEdgeLabel = useCallback((key: string, label: string) => {
    dispatch({ type: "SET_EDGE_LABEL", key, label });
  }, []);

  const handleToggleHeatMap = useCallback(() => {
    dispatch({ type: "TOGGLE_HEAT_MAP" });
  }, []);

  const handleToggleFingerprint = useCallback(() => {
    dispatch({ type: "TOGGLE_FINGERPRINT" });
  }, []);

  const nodePositionsRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
  const containerDimsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  const handleLayoutComplete = useCallback((info: {
    visibleCount: number;
    nodePositions: Map<string, { x: number; y: number; w: number; h: number }>;
    containerWidth: number;
    containerHeight: number;
  }) => {
    dispatch({ type: "SET_VISIBLE_COUNT", count: info.visibleCount });
    nodePositionsRef.current = info.nodePositions;
    containerDimsRef.current = { width: info.containerWidth, height: info.containerHeight };
  }, []);

  const handleFullscreenExit = useCallback(() => {
    dispatch({ type: "CLEAR_FULLSCREEN" });
  }, []);

  const restoreSavedGraph = useCallback((graph: SavedGraph) => {
    dispatch({ type: "RESTORE_SAVED_GRAPH", graph });
  }, []);

  // Restore state when a saved graph is loaded (from URL or workspace)
  const lastLoadedRef = useRef<SavedGraph | null>(null);
  const restoreFromLastLoaded = useCallback((graph: SavedGraph | null | undefined) => {
    if (!graph || graph === lastLoadedRef.current) return;
    lastLoadedRef.current = graph;
    dispatch({ type: "RESTORE_SAVED_GRAPH", graph });
  }, []);

  return {
    state,
    dispatch,
    userToggledRef,
    toggleChange,
    handleNodePositionChange,
    handleSetNodeLabel,
    handleSetEdgeLabel,
    handleToggleHeatMap,
    handleToggleFingerprint,
    handleLayoutComplete,
    handleFullscreenExit,
    restoreSavedGraph,
    restoreFromLastLoaded,
    nodePositionsRef,
    containerDimsRef,
  };
}
