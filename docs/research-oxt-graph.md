# OXT Transaction Graph Visualization - Research Reference

This document compiles research on OXT Research's transaction graph visualization tool ("Graphalizer"), drawing from Medium articles (Parts 1-4 + Update), the BitcoinTalk introduction post, 21ideas.org mirrors, KYCP.org documentation, and the Boltzmann introduction post by LaurentMT. The goal is to capture the visual encoding system, interaction model, and analytical workflows that made OXT the reference tool for on-chain privacy analysis - and to inform the am-i.exposed graph implementation.

---

## 1. Architecture

OXT's graph visualization - internally called the "Graphalizer" - models the Bitcoin UTXO graph as a directed acyclic graph (DAG).

- **Nodes** represent transactions. Each node is a single tx, identified by its txid.
- **Edges** represent UTXOs flowing between transactions. An arrow pointing toward a node is an input being consumed; an arrow pointing away is an output being created.
- **Unspent outputs** are shown as unfilled diamond shapes at edge endpoints. These diamonds are proportional in size to the BTC amount and labeled with "(U)" to indicate unspent status.
- The graph is manually laid out, typically left-to-right in chronological order. Users drag nodes to arrange them. There is no automatic force-directed physics simulation - the layout is entirely user-controlled and deterministic.
- The Graphalizer operates as an expansion-based explorer: start from one transaction, then selectively expand connected transactions by following inputs or outputs.

---

## 2. Fingerprint Mode Visual Encoding

OXT's "Fingerprint Mode" encodes transaction metadata into the visual properties of nodes and edges, enabling pattern recognition without reading raw data.

### Node Shape (Locktime)

| Shape    | Meaning                                          |
|----------|--------------------------------------------------|
| Circle   | `nLockTime = 0` (no locktime set)                |
| Square   | `nLockTime` < 500,000,000 (interpreted as block height) |
| Hexagon  | `nLockTime` >= 500,000,000 (interpreted as Unix timestamp) |

### Node Color (Transaction Version)

| Color      | Meaning       |
|------------|---------------|
| Dark grey  | Version 1 tx  |
| Light grey | Version 2 tx  |

### Edge Color (Script Type)

| Color      | Script Type(s)              |
|------------|-----------------------------|
| Green      | P2PK / P2PKH (legacy)       |
| Light blue | P2WPKH / P2SH (segwit)      |
| Orange     | Multisig                     |
| Yellow     | OP_RETURN (data carrier)     |
| Pink       | Non-standard scripts         |

### Edge Dashing (Script Hash Wrapping)

| Dash Pattern   | Meaning                     |
|----------------|-----------------------------|
| Solid          | Non-script-hash (bare)       |
| 1-gap dashing  | P2SH (script hash wrapped)   |
| 2-gap dashing  | P2WSH (witness script hash)  |
| 3-gap dashing  | P2TR (Taproot)               |

### Edge Weight (Amount)

Edge thickness is automatically proportional to the BTC amount of the UTXO. Larger amounts produce thicker lines, smaller amounts produce thinner lines. This makes it visually obvious which output carries the bulk of the value.

### Key Insight

Script type transitions along a chain of transactions signal that coins may have changed hands. If a wallet consistently produces P2WPKH outputs and one transaction suddenly shows a P2PKH output, that output likely belongs to a different entity. This visual pattern - a color change along a chain of edges - is one of the most powerful fingerprinting tools in OXT's arsenal.

---

## 3. Interaction Model

### Selection and Expansion

- **Single click** on a node selects it (transitions from blue to green highlight) and shows the toolbar with available actions.
- **Double click** on a node expands ALL UTXOs connected to that transaction. OXT itself warns that this is noisy and can clutter the graph with many new nodes at once.
- **Selective expansion** is the preferred workflow: hover to the right of an address label in the transaction details to reveal a per-UTXO "Expand Tx Graph" button. This allows expanding a single specific UTXO rather than all connections.

### Navigation

- **Click and drag** repositions individual nodes. Layout is entirely manual, typically arranged left-to-right in chronological order.
- **Mouse scroll wheel** zooms in and out.
- **Right-click** opens context menus on transactions, TXOs, and comments, providing quick access to relevant actions.

### Boltzmann Link Probability

The **chain icon** in the INPUTS & OUTPUTS tab of the transaction details window shows the Boltzmann link probability for a specific input-output pair. This is a subset view of the full link probability matrix, indicating how strongly a particular input is linked to a particular output.

---

## 4. Transaction Details Window

When a transaction node is selected, OXT displays a details panel with the following structure:

1. **TXID header** - the full transaction ID with a copy-to-clipboard button.
2. **Technical tab** - raw transaction metadata including version number and locktime value.
3. **INPUTS & OUTPUTS tab** - a scrollable list of all inputs and outputs, each showing:
   - Address (with truncation and copy button)
   - Amount in BTC
   - Chain icon for Boltzmann link probability
   - Per-UTXO "Expand Tx Graph" button (appears on hover)
4. **Expand/Collapse buttons** - bulk-expand or bulk-collapse all inputs or all outputs simultaneously.

---

## 5. Change Detection

Identifying which output is the change (returned to the sender) and which is the payment is central to transaction graph analysis.

### Manual Marking

OXT provides an orange highlight tool in the left toolbar. Users can manually mark an output as suspected change, coloring its edge orange for visual tracking through the graph.

### Automatic Visual Cues

Edge weight (thickness) makes change outputs readily apparent in many cases. When one output carries significantly more value than the other, the thicker edge typically represents the change output (the sender returning funds to themselves).

### Heuristic Signals

Four primary heuristics inform change detection in OXT's analytical workflow:

1. **Address reuse** - if one output address has appeared before in the same wallet cluster, it is likely change.
2. **Round number payment** - if one output is a round number (e.g., 0.1 BTC, 0.01 BTC), the other output is likely change.
3. **Script type variance** - if the inputs are all P2WPKH and one output is P2WPKH while the other is P2PKH, the matching script type output is likely change.
4. **Largest output** - in simple spends, the larger output is often change (the sender getting back the remainder).

### Wallet Fingerprinting

Consistent patterns across a chain of transactions reveal wallet software identity: same script type for all outputs, consistent output ordering (change always at index 0 or always at the end), same version number, same locktime behavior. These patterns are visible in the graph as uniform node shapes, node colors, and edge colors.

---

## 6. Peel Chain Tracing

A peel chain is a series of simple spend transactions where each transaction has one input and two outputs: a small "peel" (the payment) and a large remainder (the change). This is the most common spending pattern for individual wallets.

### Workflow

1. Start with a transaction of interest.
2. Identify the change output (using the heuristics above).
3. Expand that change output to reveal the next transaction.
4. Repeat - the graph grows left-to-right, one transaction at a time.
5. Continue until reaching a terminal condition.

### Two Directions

- **Source tracing (backward)** - follow inputs to discover where funds originated. Each hop goes backward in time.
- **Destination tracing (forward)** - follow outputs to discover where funds were sent. Each hop goes forward in time.

### Entity Barrier

Tracing should stop at custodial service boundaries (exchanges, payment processors). These entities pool funds from many users, so tracing through them conflates unrelated users. When a transaction lands at a known entity address, that is a natural stopping point for the trace.

---

## 7. Boltzmann / Link Probability Matrix Integration

### Background

The Boltzmann analysis framework was developed by LaurentMT as a core OXT component. It provides a mathematical model for quantifying the privacy of individual transactions.

### Core Concepts

- **Transaction entropy** (`E = log2(N)`) measures the number of valid input-to-output mapping interpretations. Higher entropy means more ambiguity for an observer.
- **Link probability matrix (LPM)** - for each (input, output) pair, the probability that the input funded that output. Computed by enumerating all valid interpretations and averaging.
- **Deterministic link** - an input-output pair with 100% probability, meaning there is no valid interpretation in which they are not connected. This represents an unavoidable information leak.

### OXT Integration

In OXT, Boltzmann data is accessed via the chain icon on the INPUTS & OUTPUTS tab. Clicking the icon for a specific input-output pair shows its link probability as a percentage.

### KYCP.org Companion

KYCP.org ("Know Your Coin Privacy") provides the full visual LPM heatmap for any transaction. Its color coding:

| Color  | Meaning                                    |
|--------|--------------------------------------------|
| Orange | Same wallet cluster (CIOH-linked inputs)   |
| Red    | Address reuse detected                     |
| Green  | No deterministic link (privacy preserved)  |

KYCP.org serves as a visual companion to OXT's graph - the graph shows structural patterns, while KYCP shows per-transaction linkability detail.

---

## 8. Wallet Clustering

### Common Input Ownership Heuristic (CIOH)

The foundational clustering heuristic: all inputs to a transaction are assumed to be controlled by the same entity. This heuristic fails for CoinJoin transactions (where multiple users contribute inputs) but holds for the vast majority of ordinary transactions.

### Cluster Naming

- Known entities are labeled by name (exchanges, services, etc.).
- Unknown clusters receive the designation `ANON` followed by an index number (e.g., `ANON 12345`).

### Logged-In Features

Authenticated OXT users had access to additional cluster analysis tools:

- Daily balance and volume charts for clusters
- Full address lists per cluster
- Attribution notes (user-contributed labels)
- Saved graph layouts (persistent across sessions)
- Comments on transactions and clusters

---

## 9. Transaction Type Patterns

The graph visualization reveals transaction structure at a glance. Common patterns:

### Simple Send

- **Structure:** 1+ inputs, 2 outputs (payment + change)
- **Graph shape:** Narrow node with two outgoing edges of different thickness
- **Analysis:** Change detection heuristics apply directly

### Sweep

- **Structure:** 1 input, 1 output
- **Graph shape:** Single incoming edge, single outgoing edge
- **Analysis:** No change detection needed - the entire value moves to one destination

### Consolidation (Fan-In)

- **Structure:** Many inputs, 1 output
- **Graph shape:** Many incoming edges converging to one outgoing edge
- **Analysis:** All inputs are clustered via CIOH. Common for wallets reducing UTXO count.

### Batch Spend (Fan-Out)

- **Structure:** 1+ inputs, many outputs
- **Graph shape:** Few incoming edges, many outgoing edges of varying thickness
- **Analysis:** Typical of exchange withdrawals. Multiple recipients in one transaction.

### CoinJoin

- **Structure:** Many inputs, many outputs with equal (or near-equal) amounts
- **Graph shape:** Dense node with many edges of similar thickness on both sides
- **Analysis:** CIOH does not apply. Entropy is high. Equal output amounts create ambiguity that defeats linkability analysis.

---

## 10. Sources

1. **LaurentMT**, "Introducing OXT - An Open Source Block Explorer with Privacy-Focused Analytics", BitcoinTalk, 2015.
2. **OXT Research**, "Understanding Bitcoin Privacy with OXT - Part 1: Transaction Graph", Medium.
3. **OXT Research**, "Understanding Bitcoin Privacy with OXT - Part 2: Fingerprinting", Medium.
4. **OXT Research**, "Understanding Bitcoin Privacy with OXT - Part 3: Change Detection & Peel Chains", Medium.
5. **OXT Research**, "Understanding Bitcoin Privacy with OXT - Part 4: Wallet Clustering", Medium.
6. **OXT Research**, "Understanding Bitcoin Privacy with OXT - Update", Medium.
7. **LaurentMT**, "Introducing Boltzmann", Medium, 2018.
8. **KYCP.org**, "Know Your Coin Privacy - Documentation", kycp.org.
9. **21ideas.org**, Russian mirrors of OXT Research articles.
10. **LaurentMT**, "Bitcoin Transactions & Privacy (Parts 1-3)", gist.github.com/LaurentMT.
