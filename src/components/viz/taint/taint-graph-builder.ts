/**
 * Pure graph builder functions for the taint path visualization.
 *
 * These take findings / trace layers and produce { nodes, edges }
 * with zero React dependencies, making them independently testable.
 */

import { analyzeCoinJoin, isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import { truncateId } from "@/lib/constants";
import type { Finding } from "@/lib/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";

export interface TaintNode {
  id: string;
  label: string;
  depth: number;
  y: number;
  type: "root" | "entity" | "coinjoin" | "regular";
  taintPct: number;
  entityName?: string;
  category?: string;
  /** Address or txid to navigate to when clicked */
  clickTarget?: string;
}

interface TaintEdge {
  source: string;
  target: string;
  taintPct: number;
  value: number;
}

const MAX_INDIVIDUAL = 3;

// ── Layer-based graph building (real trace data) ───────────────────────

/** Classify and add nodes from a single trace layer. */
function addLayerNodes(
  layer: TraceLayer,
  direction: "backward" | "forward",
  nodes: TaintNode[],
  entityByTxid: Map<string, { name: string; category: string; address?: string }>,
) {
  if (layer.txs.size === 0) return;

  const depth = direction === "backward" ? -layer.depth : layer.depth;
  const prefix = direction === "backward" ? "bw" : "fw";

  const entityTxs: { txid: string; entity: { name: string; category: string; address?: string } }[] = [];
  const cjTxids: string[] = [];
  const regularTxids: string[] = [];

  for (const [txid, tx] of layer.txs) {
    const entity = entityByTxid.get(txid);
    if (entity) {
      entityTxs.push({ txid, entity });
    } else {
      const cjResult = analyzeCoinJoin(tx);
      if (cjResult.findings.some(isCoinJoinFinding)) {
        cjTxids.push(txid);
      } else {
        regularTxids.push(txid);
      }
    }
  }

  // Entity nodes (always shown individually)
  for (const { txid, entity } of entityTxs) {
    nodes.push({
      id: `${prefix}-entity-${txid.slice(0, 8)}`,
      label: entity.name,
      depth,
      y: 0,
      type: "entity",
      taintPct: 100,
      entityName: entity.name,
      category: entity.category,
      clickTarget: entity.address ?? txid,
    });
  }

  // CoinJoin nodes (grouped per depth)
  if (cjTxids.length > 0) {
    nodes.push({
      id: `${prefix}-cj-${layer.depth}`,
      label: cjTxids.length === 1 ? "CoinJoin" : `${cjTxids.length} CoinJoins`,
      depth,
      y: 0,
      type: "coinjoin",
      taintPct: 0,
      clickTarget: cjTxids[0],
    });
  }

  // Regular nodes (individual if few, grouped otherwise)
  if (regularTxids.length > 0) {
    if (regularTxids.length <= MAX_INDIVIDUAL) {
      for (const txid of regularTxids) {
        nodes.push({
          id: `${prefix}-${txid.slice(0, 8)}`,
          label: truncateId(txid, 4),
          depth,
          y: 0,
          type: "regular",
          taintPct: 0,
          clickTarget: txid,
        });
      }
    } else {
      nodes.push({
        id: `${prefix}-group-${layer.depth}`,
        label: `${regularTxids.length} txs`,
        depth,
        y: 0,
        type: "regular",
        taintPct: 0,
        clickTarget: regularTxids[0],
      });
    }
  }
}

/** Create tree edges: each node connects to a primary parent at the adjacent depth toward root. */
function createTreeEdges(nodes: TaintNode[], edges: TaintEdge[]) {
  const depthGroups = new Map<number, TaintNode[]>();
  for (const node of nodes) {
    const g = depthGroups.get(node.depth) ?? [];
    g.push(node);
    depthGroups.set(node.depth, g);
  }

  for (const [depth, group] of depthGroups) {
    if (depth === 0) continue;

    const parentDepth = depth > 0 ? depth - 1 : depth + 1;
    const parents = depthGroups.get(parentDepth);
    if (!parents || parents.length === 0) continue;

    // Pick primary parent: entity > coinjoin > root > first
    const primary = parents.find(n => n.type === "entity")
      ?? parents.find(n => n.type === "coinjoin")
      ?? parents.find(n => n.type === "root")
      ?? parents[0];

    for (const node of group) {
      const hasTaint = node.type === "entity" || primary.type === "entity" || node.taintPct > 50;
      if (depth < 0) {
        // Backward: arrow from deeper node toward root
        edges.push({ source: node.id, target: primary.id, taintPct: hasTaint ? 70 : 0, value: 0 });
      } else {
        // Forward: arrow from root outward
        edges.push({ source: primary.id, target: node.id, taintPct: hasTaint ? 70 : 0, value: 0 });
      }
    }
  }
}

// ── Findings-based graph building (legacy fallback) ────────────────────

function buildFromFindings(findings: Finding[], nodes: TaintNode[], edges: TaintEdge[], taintPct: number) {
  // Entity proximity - backward
  const backwardEntity = findings.find((f) => f.id === "chain-entity-proximity-backward");
  if (backwardEntity) {
    const hops = (backwardEntity.params?.hops as number) ?? 1;
    const entityName = (backwardEntity.params?.entityName as string) ?? "Unknown";
    const category = (backwardEntity.params?.category as string) ?? "unknown";
    const entityTxid = (backwardEntity.params?.entityTxid as string) ?? undefined;
    const entityAddress = (backwardEntity.params?.entityAddress as string) ?? undefined;

    for (let d = 1; d < hops; d++) {
      const nodeId = `bw-${d}`;
      nodes.push({
        id: nodeId, label: `Hop -${d}`, depth: -d, y: 0, type: "regular",
        taintPct: Math.max(0, taintPct * (1 - d / hops)), clickTarget: entityTxid,
      });
      const prevId = d === 1 ? "root" : `bw-${d - 1}`;
      edges.push({ source: nodeId, target: prevId, taintPct: 80, value: 0 });
    }

    const entityNodeId = `bw-entity-${entityName}`;
    nodes.push({
      id: entityNodeId, label: entityName, depth: -hops, y: 0, type: "entity",
      taintPct: 100, entityName, category, clickTarget: entityAddress ?? entityTxid,
    });
    const prevId = hops === 1 ? "root" : `bw-${hops - 1}`;
    edges.push({ source: entityNodeId, target: prevId, taintPct: 100, value: 0 });
  }

  // CoinJoin in ancestry
  const cjAncestry = findings.find((f) => f.id === "chain-coinjoin-ancestry");
  if (cjAncestry) {
    const depth = backwardEntity ? -(((backwardEntity.params?.hops as number) ?? 1) + 1) : -1;
    nodes.push({
      id: "bw-coinjoin", label: "CoinJoin", depth,
      y: nodes.filter((n) => n.depth === depth).length,
      type: "coinjoin", taintPct: 0,
    });
    const prevDepth = depth + 1;
    const prevNode = nodes.find((n) => n.depth === prevDepth);
    edges.push({ source: "bw-coinjoin", target: prevNode?.id ?? "root", taintPct: 0, value: 0 });
  }

  // Clean backward hops from trace summary
  const traceSummary = findings.find((f) => f.id === "chain-trace-summary");
  if (!backwardEntity && !cjAncestry && traceSummary) {
    const bwDepth = (traceSummary.params?.backwardDepth as number) ?? 0;
    for (let d = 1; d <= bwDepth; d++) {
      const nodeId = `bw-${d}`;
      if (nodes.some((n) => n.id === nodeId)) continue;
      nodes.push({ id: nodeId, label: `Hop -${d}`, depth: -d, y: 0, type: "regular", taintPct: 0 });
      const prevId = d === 1 ? "root" : `bw-${d - 1}`;
      edges.push({ source: nodeId, target: prevId, taintPct: 0, value: 0 });
    }
  }

  // Entity proximity - forward
  const forwardEntity = findings.find((f) => f.id === "chain-entity-proximity-forward");
  if (forwardEntity) {
    const hops = (forwardEntity.params?.hops as number) ?? 1;
    const entityName = (forwardEntity.params?.entityName as string) ?? "Unknown";
    const category = (forwardEntity.params?.category as string) ?? "unknown";
    const entityTxid = (forwardEntity.params?.entityTxid as string) ?? undefined;
    const entityAddress = (forwardEntity.params?.entityAddress as string) ?? undefined;

    for (let d = 1; d < hops; d++) {
      const nodeId = `fw-${d}`;
      nodes.push({
        id: nodeId, label: `Hop +${d}`, depth: d, y: 0, type: "regular",
        taintPct: Math.max(0, taintPct * (1 - d / hops)), clickTarget: entityTxid,
      });
      const prevId = d === 1 ? "root" : `fw-${d - 1}`;
      edges.push({ source: prevId, target: nodeId, taintPct: 60, value: 0 });
    }

    const entityNodeId = `fw-entity-${entityName}`;
    nodes.push({
      id: entityNodeId, label: entityName, depth: hops, y: 0, type: "entity",
      taintPct: 0, entityName, category, clickTarget: entityAddress ?? entityTxid,
    });
    const prevId = hops === 1 ? "root" : `fw-${hops - 1}`;
    edges.push({ source: prevId, target: entityNodeId, taintPct: 50, value: 0 });
  }

  // CoinJoin in descendancy
  const cjDescendancy = findings.find((f) => f.id === "chain-coinjoin-descendancy");
  if (cjDescendancy) {
    const depth = forwardEntity ? ((forwardEntity.params?.hops as number) ?? 1) + 1 : 1;
    nodes.push({
      id: "fw-coinjoin", label: "CoinJoin", depth,
      y: nodes.filter((n) => n.depth === depth).length,
      type: "coinjoin", taintPct: 0,
    });
    const prevDepth = depth - 1;
    const prevNode = nodes.find((n) => n.depth === prevDepth);
    edges.push({ source: prevNode?.id ?? "root", target: "fw-coinjoin", taintPct: 0, value: 0 });
  }

  // Clean forward hops from trace summary
  if (!forwardEntity && !cjDescendancy && traceSummary) {
    const fwDepth = (traceSummary.params?.forwardDepth as number) ?? 0;
    for (let d = 1; d <= fwDepth; d++) {
      const nodeId = `fw-${d}`;
      if (nodes.some((n) => n.id === nodeId)) continue;
      nodes.push({ id: nodeId, label: `Hop +${d}`, depth: d, y: 0, type: "regular", taintPct: 0 });
      const prevId = d === 1 ? "root" : `fw-${d - 1}`;
      edges.push({ source: prevId, target: nodeId, taintPct: 0, value: 0 });
    }
  }
}

// ── Main graph builder ──────────────────────────────────────────────────

export function buildTaintGraph(
  findings: Finding[],
  backwardLayers?: TraceLayer[] | null,
  forwardLayers?: TraceLayer[] | null,
): { nodes: TaintNode[]; edges: TaintEdge[] } {
  const nodes: TaintNode[] = [];
  const edges: TaintEdge[] = [];

  const isTargetCJ = findings.some(isCoinJoinFinding);
  const taintPct = (findings.find(f => f.id === "chain-taint-backward")?.params?.taintPct as number) ?? 0;

  // Root node (the analyzed transaction)
  nodes.push({
    id: "root",
    label: "Analyzed TX",
    depth: 0,
    y: 0,
    type: isTargetCJ ? "coinjoin" : "root",
    taintPct,
  });

  const hasLayers = (backwardLayers && backwardLayers.length > 0) || (forwardLayers && forwardLayers.length > 0);

  if (hasLayers) {
    // Build entity lookup from findings (entity-proximity stores txid of the matched tx)
    const entityByTxid = new Map<string, { name: string; category: string; address?: string }>();
    for (const f of findings) {
      if (f.id === "chain-entity-proximity-backward" || f.id === "chain-entity-proximity-forward") {
        const txid = f.params?.entityTxid as string | undefined;
        if (txid) entityByTxid.set(txid, {
          name: (f.params?.entityName as string) ?? "Unknown",
          category: (f.params?.category as string) ?? "unknown",
          address: f.params?.entityAddress as string | undefined,
        });
      }
    }

    // Build nodes from real trace layer data
    for (const layer of backwardLayers ?? []) addLayerNodes(layer, "backward", nodes, entityByTxid);
    for (const layer of forwardLayers ?? []) addLayerNodes(layer, "forward", nodes, entityByTxid);
    createTreeEdges(nodes, edges);
  } else {
    // Fallback: approximate from findings when trace layers unavailable
    buildFromFindings(findings, nodes, edges, taintPct);
  }

  // Assign y positions per depth column
  const depthGroups = new Map<number, TaintNode[]>();
  for (const node of nodes) {
    const g = depthGroups.get(node.depth) ?? [];
    g.push(node);
    depthGroups.set(node.depth, g);
  }
  for (const g of depthGroups.values()) {
    g.forEach((n, i) => { n.y = i; });
  }

  return { nodes, edges };
}
