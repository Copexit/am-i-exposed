"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSavedGraphs, MAX_SAVED_GRAPHS } from "@/hooks/useSavedGraphs";
import { serializeGraph } from "@/lib/graph/saved-graph-types";
import { encodeGraphToUrl } from "@/lib/graph/graph-url-codec";
import { truncateId } from "@/lib/constants";
import { copyToClipboard } from "@/lib/clipboard";
import type { GraphNode } from "@/components/viz/graph/types";
import type { GraphState } from "@/lib/graph/graph-reducer";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import type { SavedGraph, GraphAnnotation } from "@/lib/graph/saved-graph-types";

type Panel = "save" | "load" | null;

interface UseSaveLoadShareArgs {
  nodes?: Map<string, GraphNode>;
  rootTxid?: string;
  rootTxids?: Set<string>;
  network?: BitcoinNetwork;
  currentGraphId?: string | null;
  onLoadSavedGraph?: (graph: SavedGraph) => void;
  nodePositionOverrides?: Map<string, { x: number; y: number }>;
  annotations?: GraphAnnotation[];
  nodeLabels?: Map<string, string>;
  edgeLabels?: Map<string, string>;
}

export function useSaveLoadShare(args: UseSaveLoadShareArgs) {
  const {
    nodes, rootTxid, rootTxids, network, currentGraphId,
    nodePositionOverrides: posOverrides,
    annotations: savedAnnotations,
    nodeLabels, edgeLabels,
  } = args;

  const { t } = useTranslation();
  const { graphs, saveGraph, updateGraph, deleteGraph } = useSavedGraphs();

  const [activePanel, setActivePanel] = useState<Panel>(null);
  const [saveName, setSaveName] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close panel on outside click
  useEffect(() => {
    if (!activePanel) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setActivePanel(null);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [activePanel]);

  // Auto-clear toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const buildGraphState = useCallback((): GraphState => ({
    nodes: nodes ?? new Map(),
    rootTxid: rootTxid ?? "",
    rootTxids: rootTxids ?? new Set(),
    maxNodes: 100,
    undoStack: [],
    loading: new Set(),
    errors: new Map(),
  }), [nodes, rootTxid, rootTxids]);

  const handleSave = useCallback(() => {
    if (!network) return;
    const name = saveName.trim() || `Graph - ${truncateId(rootTxid ?? "")}`;
    const saved = serializeGraph(buildGraphState(), name, network, undefined, undefined, posOverrides, savedAnnotations, nodeLabels, edgeLabels);
    const id = saveGraph(saved);
    if (id) {
      setToast(t("graphSaveLoad.saved", { defaultValue: "Graph saved" }));
      setActivePanel(null);
    } else if (graphs.length >= MAX_SAVED_GRAPHS) {
      setToast(t("graphSaveLoad.limitReached", { defaultValue: "Max 50 saved graphs reached" }));
    } else {
      setToast(t("workspace.storageFull", { defaultValue: "Browser storage is full. Delete some bookmarks or saved graphs and try again." }));
    }
  }, [saveName, rootTxid, buildGraphState, network, saveGraph, graphs.length, t, posOverrides, savedAnnotations, nodeLabels, edgeLabels]);

  const handleUpdate = useCallback(() => {
    if (!currentGraphId) return;
    const state = buildGraphState();
    const nodesArr = [...state.nodes.values()].map((n) => ({
      txid: n.txid, depth: n.depth,
      parentEdge: n.parentEdge ? { ...n.parentEdge } : undefined,
      childEdge: n.childEdge ? { ...n.childEdge } : undefined,
    }));
    const ok = updateGraph(currentGraphId, {
      nodes: nodesArr,
      rootTxid: state.rootTxid,
      rootTxids: [...state.rootTxids],
    });
    if (!ok) {
      setToast(t("workspace.storageFull", { defaultValue: "Browser storage is full. Delete some bookmarks or saved graphs and try again." }));
      return;
    }
    setToast(t("graphSaveLoad.updated", { defaultValue: "Graph updated" }));
    setActivePanel(null);
  }, [currentGraphId, buildGraphState, updateGraph, t]);

  const handleShare = useCallback(() => {
    if (!network) return;
    const saved = serializeGraph(buildGraphState(), "", network, undefined, undefined, posOverrides, savedAnnotations, nodeLabels, edgeLabels);
    const encoded = encodeGraphToUrl(saved);
    if (!encoded) {
      setToast(t("graphSaveLoad.tooLarge", { defaultValue: "Graph too large for URL - use JSON export" }));
      return;
    }
    const url = `${window.location.origin}/graph/?network=${network}#graph=${encoded}`;
    // Fire-and-forget: copyToClipboard never rejects.
    void copyToClipboard(url).then((ok) => setToast(ok
      ? t("graphSaveLoad.linkCopied", { defaultValue: "Link copied to clipboard" })
      : t("graphSaveLoad.copyFailed", { defaultValue: "Failed to copy" })));
  }, [buildGraphState, network, t, posOverrides, savedAnnotations, nodeLabels, edgeLabels]);

  const [now] = useState(() => Date.now());
  const timeAgo = useCallback((ms: number): string => {
    const secs = Math.floor((now - ms) / 1000);
    if (secs < 60) return t("graph.timeAgoJustNow", { defaultValue: "just now" });
    if (secs < 3600) return t("graph.timeAgoMinutesAgo", { count: Math.floor(secs / 60), defaultValue: "{{count}}m ago" });
    if (secs < 86400) return t("graph.timeAgoHoursAgo", { count: Math.floor(secs / 3600), defaultValue: "{{count}}h ago" });
    return t("graph.timeAgoDaysAgo", { count: Math.floor(secs / 86400), defaultValue: "{{count}}d ago" });
  }, [now, t]);

  return {
    graphs,
    activePanel,
    setActivePanel,
    saveName,
    setSaveName,
    toast,
    confirmDeleteId,
    setConfirmDeleteId,
    panelRef,
    handleSave,
    handleUpdate,
    handleShare,
    deleteGraph,
    timeAgo,
  };
}
