# ADR: OXT-Style Transaction Graph

**Status:** Accepted
**Date:** 2026-03-15

## Context

OXT Research's Graphalizer was the reference tool for Bitcoin on-chain privacy analysis. It provided a DAG-based transaction graph with rich visual encoding (script types, locktime, version), selective UTXO expansion, peel chain tracing, change marking, and integrated Boltzmann link probability data. OXT has shut down, and no freely available tool replicates its graph-based analytical workflow.

The am-i.exposed project already implements chain analysis modules (backward/forward tracing, clustering, entity proximity, taint analysis) and a basic `GraphExplorer` component using visx. However, the current graph lacks the visual encoding, interaction precision, and analytical depth that made OXT effective. This ADR defines the architectural decisions for refactoring the graph toward OXT-level capability while fitting within the project's static-export, client-side-only constraints.

See `docs/research-oxt-graph.md` for the full research reference on OXT's visual system.

## Decisions

### D1. Column-based layout (not force-directed)

The graph uses a deterministic column-based layout where each column represents a "generation" (hop depth from the root transaction). Transactions at depth 0 are in the center column, depth -1 (parents) to the left, depth +1 (children) to the right, and so on.

**Rationale:**

- The transaction graph is a DAG, and left-to-right chronological layout matches the natural mental model of time flowing forward.
- Force-directed layouts are non-deterministic - the same graph renders differently each time, making it impossible to build spatial memory of a trace.
- OXT itself used manual left-to-right arrangement. A column layout automates this without requiring manual drag-to-position.
- Layout stability is critical for analytical work: expanding a new node should not cause existing nodes to jump around.

Within each column, nodes are vertically ordered by their connection to the expanded node's ports, minimizing edge crossings.

### D2. Single expanded node at a time

Only one transaction node can be in the "expanded" state (showing individual UTXO ports for inputs and outputs) at any given time. Clicking a new node to expand it automatically collapses the previously expanded node.

**Rationale:**

- Expanding a node adds port elements for every input and output, which changes the node's height and affects the vertical layout of its column.
- Allowing multiple expanded nodes simultaneously creates cascading layout shifts that destabilize the graph.
- OXT's workflow centers on focusing on one transaction at a time, examining its inputs and outputs, then selectively expanding a single UTXO to move to the next transaction.
- This constraint naturally guides users through the peel-chain-tracing workflow: expand, examine, select one UTXO, expand next.

The collapsed state still shows the transaction summary (txid truncated, total value, input/output count) so the graph remains informative even with most nodes collapsed.

### D3. Right sidebar for transaction details (320px)

When a transaction node is selected (single click), a 320px sidebar slides in from the right edge of the viewport. The sidebar contains the full transaction details: txid, version, locktime, and a scrollable list of all inputs and outputs with addresses, amounts, and per-UTXO expand buttons.

**Rationale:**

- A floating tooltip or popover would clip at viewport edges and overlap other nodes, especially in dense graphs.
- An overlay modal would obscure the graph entirely, breaking the workflow of examining a transaction while seeing its context.
- A right sidebar pushes the graph viewport leftward, keeping both the graph and the details visible simultaneously. This matches the pattern used by code editors (file tree on left, details on right) and mapping tools.
- 320px provides enough width for full addresses (truncated with copy button), amounts, and action buttons without overwhelming the graph area.

The sidebar includes expand/collapse buttons for bulk-expanding all inputs or all outputs, matching OXT's transaction details window.

### D4. Edge thickness uses logarithmic scale

Edge thickness encodes the BTC amount of the UTXO using a logarithmic scale:

```
thickness = 1.5 + (log2(1 + sats) / log2(1 + maxSats)) * 6.5
```

This produces a range of 1.5px (minimum, for dust-level outputs) to 8px (maximum, for the largest UTXO in the visible graph).

**Rationale:**

- Linear scaling causes small UTXOs to be invisible. A transaction with one 1 BTC output and one 10,000 sat output would render the small output as a sub-pixel line.
- Logarithmic scaling compresses the range so that small outputs remain visible while large outputs are still noticeably thicker.
- The `maxSats` denominator is computed from the currently visible graph, so the scale adapts as the graph grows.
- The 1.5px minimum ensures every edge is clickable and visible, even for dust outputs.

### D5. Script type color palette

Edge colors encode the script type of the UTXO, aligned with OXT conventions but updated for modern script types:

| Script Type    | Color   | Hex       |
|----------------|---------|-----------|
| P2PKH (legacy) | Green   | `#4ade80` |
| P2WPKH (native segwit) | Blue | `#60a5fa` |
| P2SH (wrapped) | Orange  | `#fb923c` |
| P2TR (Taproot) | Purple  | `#c084fc` |
| OP_RETURN      | Yellow  | `#facc15` |
| Non-standard   | Pink    | `#f472b6` |

**Rationale:**

- Green for legacy and blue for native segwit match OXT's original palette (OXT used light-blue for segwit).
- Purple for Taproot is a new addition since OXT predates widespread Taproot adoption. Purple is visually distinct from all existing colors and has become a de facto convention in the ecosystem.
- The palette uses Tailwind's 400-weight colors for consistency with the existing am-i.exposed design system.
- Script type transitions along a chain of edges are one of the strongest fingerprinting signals, making color encoding essential for visual analysis.

### D6. Port rendering cap at 20 per side

When a node is expanded, it displays individual UTXO ports (inputs on the left, outputs on the right). The maximum number of visible ports is capped at 20 per side. If a transaction has more than 20 inputs or 20 outputs, the first 19 are shown with a summary port labeled "... +N more" at the bottom.

**Rationale:**

- CoinJoin transactions routinely have 50-150+ inputs and outputs. Rendering all of them as individual ports would make the expanded node extremely tall (potentially thousands of pixels), pushing other nodes off-screen and breaking the layout.
- 20 ports at ~28px each plus spacing produces a node height of approximately 600px, which fits comfortably in most viewports.
- The "... +N more" overflow port is not expandable in the graph but links to the full list in the right sidebar, where all inputs/outputs are available in a scrollable list.
- For CoinJoin analysis, the sidebar's full list is more useful than graph ports anyway, since equal-amount outputs are visually indistinguishable in the graph.

### D7. Change marking stored in component state

Suspected change outputs are tracked in a `Set<string>` keyed by `"${txid}:${outputIndex}"`. This set is stored in React component state (not persisted to localStorage or any external store).

**Rationale:**

- Change marking is an ephemeral analytical activity - users mark outputs during a specific investigation and do not need markings to survive page reloads.
- Persisting change markings would require a schema for serialization and migration, adding complexity with minimal benefit.
- The existing change detection heuristics (address reuse, round number, script type, largest output) can auto-suggest change outputs. These suggestions are rendered as dashed-orange edges; user-confirmed markings become solid-orange edges.
- Orange edge color for change markings matches OXT's convention.

### D8. Phase-by-phase implementation

The refactoring is split into five phases, each delivered as a separate pull request:

1. **Decomposition + docs** - Extract the current monolithic `GraphExplorer` into smaller components (`GraphNode`, `GraphEdge`, `GraphViewport`, `GraphControls`). Write the research doc and this ADR.
2. **UTXO ports** - Implement expandable nodes with individual input/output ports. Add single-expanded-node constraint and port rendering cap.
3. **Edge encoding + fingerprint mode** - Add script-type color encoding, logarithmic thickness, and edge dashing for script-hash types. Add a toggle for fingerprint mode (node shape/color encoding).
4. **Sidebar** - Implement the 320px right sidebar with full transaction details, per-UTXO expand buttons, and change marking controls.
5. **Boltzmann polish** - Integrate the existing `useBoltzmann` hook to show link probability icons on sidebar ports. Add LPM heatmap link for the selected transaction.

**Rationale:**

- Each phase is independently reviewable and testable.
- Phase 1 is pure refactoring with no behavior changes, establishing a clean component architecture before adding features.
- Phase 2 (ports) is the highest-risk layout change and benefits from isolation.
- Phase 5 depends on the sidebar from Phase 4 and the port system from Phase 2, so it must come last.

## Consequences

### Enabled capabilities

- **Peel chain tracing** - the selective-expansion workflow (expand one UTXO at a time) directly supports following peel chains through the graph, the primary analytical technique for tracing individual wallet activity.
- **Wallet fingerprint analysis** - script type colors, node shapes, and version colors make wallet fingerprints visible at a glance, enabling identification of wallet software and detection of entity transitions.
- **Per-UTXO linkability visualization** - Boltzmann link probability data displayed per port in the sidebar connects the graph exploration workflow with the existing LPM analysis.
- **Change tracking** - orange-highlighted change edges make it possible to visually trace value flow through a series of transactions, marking the analyst's interpretation directly on the graph.

### Trade-offs

- **Single-expanded-node constraint** prevents side-by-side comparison of two transactions' port layouts. This is an acceptable trade-off for layout stability - the sidebar can show details for the selected node while collapsed nodes still display summary information.
- **Column layout** does not handle DAG structures with many cross-generation edges as cleanly as force-directed layouts. For transactions with inputs from multiple generations, some edges will span multiple columns. This is mitigated by keeping the graph focused (typical peel chain traces are linear).
- **Port cap at 20** means large CoinJoin transactions cannot be fully explored in the graph view. The sidebar provides the complete list, and the existing `LinkabilityHeatmap` component handles CoinJoin analysis more effectively than a graph view.

### Not in scope

- **Automatic clustering visualization** - OXT displayed cluster boundaries and labels. This requires a cluster database, which is outside the scope of this refactoring. Entity proximity data from the existing chain analysis modules can be surfaced in the sidebar as a future enhancement.
- **Saved graph layouts** - OXT allowed logged-in users to save and reload graph arrangements. The am-i.exposed project has no user accounts, so graph state is ephemeral.
- **Comment system** - OXT supported user comments on transactions and clusters. Not applicable to a client-side-only tool.
