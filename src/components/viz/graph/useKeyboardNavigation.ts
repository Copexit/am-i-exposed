import { useCallback } from "react";
import type { GraphNode } from "@/hooks/useGraphExpansion";
import type { LayoutNode } from "./types";
import { isOpReturnOutput } from "@/lib/analysis/heuristics/tx-utils";

interface UseKeyboardNavigationParams {
  focusedNode: string | null;
  setFocusedNode: (txid: string | null) => void;
  layoutNodes: LayoutNode[];
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  atCapacity: boolean;
  expandedNodeTxid?: string | null;
  onExpandInput: (txid: string, inputIndex: number) => void;
  onExpandOutput: (txid: string, outputIndex: number) => void;
  onCollapse: (txid: string) => void;
  onToggleExpand?: (txid: string) => void;
}

export function useKeyboardNavigation({
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
}: UseKeyboardNavigationParams): (e: React.KeyboardEvent) => void {
  return useCallback((e: React.KeyboardEvent) => {
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
          !consumedOutputs.has(i) && !isOpReturnOutput(v) && v.value > 0,
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
          if (!isOpReturnOutput(gn.tx.vout[i]) && gn.tx.vout[i].value > 0) {
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
}
