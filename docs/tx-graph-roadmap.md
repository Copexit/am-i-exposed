# Transaction Graph Roadmap

Beyond-OXT features for the am-i.exposed transaction graph explorer. Organized by sprint priority. Each feature includes impact/feasibility ratings and implementation pointers.

See `docs/adr-oxt-graph.md` for the current architecture and `docs/research-oxt-graph.md` for the OXT reference.

---

## Sprint 1: Core UX + Auto-Trace

### 1.1 Auto-Trace Peel Chain ("One-Click Trace")

**Impact: 9/10, Feasibility: 9/10**

Button on any output (in sidebar or expanded node) that auto-follows the most-likely change output N hops forward. Builds the orange change trail automatically. Stops at:
- CoinJoin detected (mixing boundary)
- Known entity (custodial boundary)
- Unspent UTXO (chain end)
- Ambiguous change (show branching choice to user)
- Depth limit (configurable, default 20 hops)

Implementation: sequential loop in `useGraphExpansion.ts` - expand output, run `analyzeChangeDetection` on new tx, pick highest-confidence change output, expand again. Show trace in real-time with step counter. "Auto-trace" button in `GraphSidebar.tsx` next to each output.

### 1.2 Compounding Linkability Trace ("Follow the Money")

**Impact: 9/10, Feasibility: 8/10**

From the current node, auto-expand forward, compute Boltzmann at each hop, and compound the linkability probability down the chain. Stop when compound linkability drops below X% (default 5%, configurable in settings panel).

Example: if output #2 of tx A has 85% linkability to input #0, and that input's tx B has output #1 with 70% linkability, the compound is 85% x 70% = 59.5%. Continue until compound < 5%.

Highlight the traced path with a gradient from bright (high compound linkability) to dim (fading confidence). This is the "how far can an analyst trace with confidence" visualization.

Implementation: new `autoTraceLinkability()` in `useGraphExpansion.ts`. Uses Boltzmann cache per hop. Sequential: expand -> compute Boltzmann -> read max probability for the change output -> multiply with running product -> continue or stop. Display compound percentage on each edge of the trace path.

### 1.3 Cross-Graph Address Search

**Impact: 7/10, Feasibility: 10/10**

Search input above the graph. Type any address, all nodes containing that address (as input or output) highlight with a bright glow ring. Reveals address reuse patterns spatially across the entire expanded graph.

Implementation: build inverted index `address -> Set<txid>` from all graph nodes' vin/vout addresses. On keystroke (debounced), compute matches and pass highlight set to `GraphCanvas.tsx`. Render matching nodes with `filter="url(#glow-medium)"` and thicker stroke.

### 1.4 Node Pattern Labels

**Impact: 6/10, Feasibility: 9/10**

Auto-classify each node and show a small label below the node box: "simple send", "consolidation", "batch", "CoinJoin (Whirlpool)", "peel chain link", "sweep", "self-transfer", etc.

Implementation: `analyzeTransactionSync()` already returns `txType`. Render as `<Text>` below each compact node in `GraphCanvas.tsx`. Use abbreviated forms for space: "CJ:WP" for Whirlpool, "CONSOL" for consolidation, etc.

### 1.5 Keyboard Navigation Overhaul

**Impact: 7/10, Feasibility: 8/10**

Current keyboard nav is basic (arrow keys between columns, Enter to expand). Rethink for power users:

| Key | Action |
|-----|--------|
| Arrow keys | Navigate between nodes (current behavior, keep) |
| Enter | Expand/collapse UTXO ports on focused node (toggle, like click) |
| Space | Quick-analyze: open sidebar for focused node without expanding ports |
| `e` | Expand first available input (backward) |
| `r` | Expand first available output (forward) |
| `t` | Auto-trace from focused node (trigger peel chain trace) |
| `d` | Double-click equivalent (expand up to 5 in each direction) |
| `x` or Delete | Collapse focused node (remove from graph) |
| `z` | Undo last expansion |
| `f` | Toggle fullscreen |
| `/` | Focus address search bar |
| `h` | Toggle heat map |
| `g` | Toggle fingerprint mode |
| `l` | Toggle linkability edge mode |
| `?` | Show keyboard shortcut overlay |
| `1-9` | Jump to node at depth N (relative to root) |
| `Escape` | Close sidebar / deselect / exit fullscreen |

Implementation: refactor `handleKeyDown` in `GraphCanvas.tsx`. Add a keyboard shortcut overlay component (shown on `?`). Use a keybinding map for easy customization.

### 1.6 Dust Output Visualization

**Impact: 5/10, Feasibility: 9/10**

Nodes with outputs below the dust threshold (`DUST_THRESHOLD` from `src/lib/constants.ts`, currently 1000 sats) get a distinct visual treatment:

- Edges for dust outputs: thin dashed red-orange, very low opacity (0.2)
- Dust output ports in expanded node: greyed out with "dust" label
- Dust badge on compact nodes (small "D" icon if tx has dust outputs)
- Configurable threshold: add `dustThreshold` to analysis settings panel (`useAnalysisSettings`), default 1000 sats. Single source of truth - `DUST_THRESHOLD` constant replaced by the setting value, with fallback to 1000.

Current state: `DUST_THRESHOLD = 1000` in `src/lib/constants.ts`, used in chain analysis and some viz components but not in the graph.

---

## Sprint 2: Analytics Overlays

### 2.1 Cross-Transaction Deterministic Link Chains

**Impact: 9/10, Feasibility: 9/10**

When Boltzmann data shows 100% deterministic links across multiple hops, chain them and draw bold red paths through the graph. These are certainty-level traces.

Traverse: for each deterministic link `(outIdx, inIdx)` in tx A, check if outIdx's spending tx B also has a deterministic link from that input. Recurse. Render as thick pulsing red overlay.

### 2.2 Toxic Change Detection + Alert

**Impact: 8/10, Feasibility: 9/10**

Auto-detect when CoinJoin change (non-equal output) is later spent with a mixed output. Badge the toxic merge tx with a biohazard-style warning. Show in sidebar: "This transaction merges mixed and unmixed UTXOs, destroying CoinJoin privacy."

### 2.3 Privacy Score Sparklines

**Impact: 7/10, Feasibility: 9/10**

Tiny bar chart inside each compact node (4-6 bars, 2px wide) colored by finding severity. At-a-glance view of why a node has its score.

### 2.4 Entropy Propagation ("Privacy Gradient")

**Impact: 10/10, Feasibility: 8/10, Novelty: 10/10**

Compute "effective entropy" per UTXO accounting for entropy at every hop. A Whirlpool output flowing through a deterministic sweep loses all privacy. Visualize as gradient-colored edges fading from green (high effective entropy) to red (collapsed entropy). Nothing on earth does this.

---

## Sprint 3: Advanced Visualization

### 3.1 Temporal Replay Animation

**Impact: 8/10, Feasibility: 8/10**

Timeline scrubber at bottom. Nodes/edges appear in block-time order. Play/pause/speed controls. Shows temporal patterns.

### 3.2 Node Drag-to-Reposition

**Impact: 5/10, Feasibility: 6/10**

Allow click-and-drag on individual nodes to reposition them on the canvas. Positions stored as overrides in component state (per-txid x/y offsets). Column layout remains the default, but manual adjustments are preserved during the session.

Implementation: add `dragOffsets: Map<string, {x: number, y: number}>` state. On drag start, capture initial position. On drag move, update offset. Layout applies offset after column positioning. Double-click a node's position resets it to auto.

Trade-off: the ADR chose column layout for stability. Drag allows manual override without changing the base algorithm.

### 3.3 Taint Overlay on Graph

**Impact: 7/10, Feasibility: 7/10**

Overlay taint data directly on graph edges. Edge opacity/color encodes taint fraction.

### 3.4 Sankey Flow Diagram Mode

**Impact: 8/10, Feasibility: 7/10**

Alternative to DAG layout. Width of each flow = BTC value. Toggle between DAG and Sankey modes.

### 3.5 Privacy Diffusion Heatmap

**Impact: 8/10, Feasibility: 7/10, Novelty: 10/10**

Background heat layer. CoinJoins radiate green, entities radiate red. Instant gestalt understanding.

---

## Sprint 4: Pro Features

### 4.1 Simulated Analyst View ("What Chainalysis Sees")

Collapse CIOH-clustered nodes into super-nodes. CoinJoins become opaque boxes. Entity labels on clusters.

### 4.2 PSBT Pre-Spend Simulator

Paste PSBT, see ghost node with dashed edges. Warnings for privacy leaks before broadcast.

### 4.3 Anon-Set Tracker

Per-UTXO practical anonymity set accounting for CoinJoin co-participant behavior.

### 4.4 WebGL Migration

GPU-accelerated rendering for 10-50x node capacity.

---

## Configuration Additions

Features requiring new settings in `useAnalysisSettings`:

| Setting | Default | Range | Used by |
|---------|---------|-------|---------|
| `dustThreshold` | 1000 | 100-10000 sats | Dust visualization, chain analysis |
| `autoTraceDepth` | 20 | 1-100 hops | Peel chain auto-trace |
| `linkabilityTraceThreshold` | 0.05 | 0.01-0.50 | Compounding linkability trace stop condition |
| `autoTraceOnExpand` | false | boolean | Whether to auto-trace when expanding a node |

---

## Design Principles

1. **Automate the obvious.** If a heuristic can identify change, mark it. If linkability can be computed, compute it. Don't make the user do mechanical work.
2. **Progressive disclosure.** Compact nodes show sparklines. Click to expand ports. Click port to see sidebar. Click linkability dot to see per-output breakdown. Each layer adds detail.
3. **Visual encoding is king.** Color, thickness, shape, dashing, opacity, position - encode data in every visual channel. The user should understand the graph before reading any text.
4. **Client-side only.** Every computation runs in the browser. No proprietary databases. mempool.space API only. This is a constraint that forces innovation.
5. **Keyboard-first for power users.** Every action should be one keypress away. Mouse for exploration, keyboard for speed.
