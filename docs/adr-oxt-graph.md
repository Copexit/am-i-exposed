# ADR: OXT-Style Transaction Graph

**Status:** Implemented
**Date:** 2026-03-15 (original), updated 2026-03-15 (post-implementation)

## Context

OXT Research's Graphalizer was the reference tool for Bitcoin on-chain privacy analysis. It provided a DAG-based transaction graph with rich visual encoding (script types, locktime, version), selective UTXO expansion, peel chain tracing, change marking, and integrated Boltzmann link probability data. OXT has shut down, and no freely available tool replicates its graph-based analytical workflow.

The am-i.exposed project already implements chain analysis modules (backward/forward tracing, clustering, entity proximity, taint analysis) and a Boltzmann WASM worker pool. This ADR documents the architectural decisions for the OXT-style graph explorer.

See `docs/research-oxt-graph.md` for the full research reference on OXT's visual system.

## Architecture Overview

```
GraphExplorerPanel / WalletGraphExplorerPanel
  -> useGraphExpansion (state: nodes, edges, expansion, outspend cache)
  -> GraphExplorer (orchestrator: toolbar, legend, sidebar, canvas)
       -> GraphCanvas (SVG rendering: nodes, edges, minimap, gestures)
            -> ExpandedNode (UTXO port rendering when node is selected)
       -> GraphSidebar (320px right panel: I/O, Analysis, Technical tabs)
       -> GraphToolbar (shared between inline and fullscreen modes)
```

**Key files:**
- `src/components/viz/graph/` - 14 files (types, constants, layout, edge-utils, portLayout, scriptStyles, icons, GraphCanvas, GraphMinimap, ExpandedNode, GraphSidebar, index)
- `src/hooks/useGraphExpansion.ts` - graph state management (reducer + expansion state)
- `src/components/viz/GraphExplorer.tsx` - orchestrator (~870 LOC)

## Decisions

### D1. Column-based layout (not force-directed)

Deterministic column layout: each column = one hop depth. Transactions at depth 0 in center, parents to the left, children to the right.

**Why:** DAG structure maps to left-to-right chronological flow. Force-directed is non-deterministic and makes spatial memory impossible. Column layout is stable across expansion.

### D2. Single expanded node at a time

Only one node can show UTXO ports. Clicking a new node collapses the previous one.

**Why:** Multiple expanded nodes cause cascading layout shifts. Single-expansion guides the peel-chain workflow: examine one tx, select one UTXO, move to next.

### D3. Right sidebar (320px)

When a node is expanded, a 320px sidebar slides in from the right, pushing the graph viewport left.

**Tabs:**
- **I/O** - all inputs/outputs with script type color strips, addresses (copy-on-click), amounts, entity matches, spend status, change marking, Boltzmann linkability indicators, bulk expand buttons
- **Analysis** - score, grade, findings by severity, entity matches
- **Technical** - version, locktime, size, weight, vsize, fee/rate, SegWit/Taproot/RBF indicators

**Why:** Floating panels clip at edges. Overlays hide the graph. Sidebar keeps both visible.

### D4. Edge encoding (always active)

| Property | Encodes | Details |
|----------|---------|---------|
| Color | Script type | Green (P2PKH), Blue (P2WPKH), Purple (P2TR), Orange (P2SH), Teal (P2WSH), Yellow (OP_RETURN), Pink (non-standard) |
| Dash pattern | Script wrapping | Solid (raw), dashed (P2SH), dot-dash (P2WSH) |
| Thickness | BTC amount | Log scale: `1.5 + (log2(1+sats) / log2(1+maxSats)) * 6.5`, range 1.5-8px |
| Orange override | Change marking | Manually or auto-marked change outputs render edges in #f97316 |

### D5. Fingerprint mode (toggle)

Mutually exclusive with heat map mode. Overrides node rendering:

| Property | Encodes | Values |
|----------|---------|--------|
| Node shape | Locktime | Rounded rect (none), sharp rect (block height), hexagon (timestamp) |
| Node fill | Version | Dark grey (v1 #2a2a2e), medium grey (v2 #4a4a52), light grey (v3+ #6a6a72) |

### D6. Change marking (auto + manual)

Change outputs are automatically marked using existing heuristics when nodes enter the graph:
- Address type mismatch (input/output script match)
- Round amount detection
- Value disparity
- Unnecessary input analysis
- Optimal change detection

State: `Set<string>` keyed by `"${txid}:${outputIndex}"`. Auto-populated from heuristics, user can toggle on/off via sidebar checkboxes. Manual overrides tracked separately so heuristic suggestions don't override user intent.

Suggestion dots (pulsing orange) show in sidebar for heuristic-identified outputs not yet user-confirmed.

**Orange trail:** Change-marked edges create a visual peel chain trail through the graph.

### D7. Eager Boltzmann computation

Boltzmann linkability is computed eagerly for all feasible nodes in the graph:

| Total I/O | Behavior |
|-----------|----------|
| 1 input (any outputs) | Instant synthetic result (100% deterministic, 0 entropy) |
| 2-17 I/O | Auto-compute via WASM worker |
| 18-23 I/O + JoinMarket | Auto-compute via turbo approximation |
| 18-23 I/O non-JoinMarket | Manual "Compute Linkability" button in sidebar |
| 24-80 I/O | Manual button only |
| >80 I/O | Not computable |

**Cache:** `Map<string, BoltzmannWorkerResult>` ref in GraphExplorer. Seeded with root tx result from the main analysis pipeline. Version counter triggers re-renders when cache updates.

**Sequential computation:** Only one WASM computation runs at a time. Each graph change aborts the previous computation cycle (via AbortController) and starts a new queue. This prevents `terminatePool()` from killing in-flight workers.

**Edge coloring:** When linkability mode is active, edges from ANY node with cached Boltzmann data show probability-based coloring (not just root). Deterministic links get "100%" badges.

### D8. Port rendering (cap at 20)

Expanded nodes show up to 20 input ports and 20 output ports. Overflow shows "... +N more" indicator. Full I/O list available in sidebar (scrollable, no cap).

### D9. Double-click expand all

Double-clicking a node expands up to 5 inputs and 5 outputs simultaneously. Single click toggles the expanded port view.

## Consequences

### Enabled capabilities

- **Peel chain tracing** - selective expansion + auto change marking + orange trail
- **Wallet fingerprint analysis** - script type colors, locktime shapes, version fills
- **Per-UTXO linkability** - Boltzmann data on every feasible node via eager computation
- **Per-input-output probability drill-down** - click a linkability dot to see breakdown
- **Entity detection** - per-UTXO entity matching in sidebar I/O tab

### Trade-offs

- **Single-expanded-node** prevents side-by-side comparison. Sidebar provides details for the selected node.
- **Column layout** doesn't handle cross-generation edges as cleanly as force-directed.
- **Port cap at 20** means large CoinJoins need sidebar for full I/O exploration.
- **Sequential Boltzmann** means large graphs take time to fully populate linkability data.

### Not in scope

- **Automatic clustering visualization** - requires cluster database
- **Saved graph layouts** - no user accounts
- **Comment system** - client-side only tool
- **Node drag-to-reposition** - deliberately chose stable column layout
- **Right-click context menus** - sidebar provides all actions
