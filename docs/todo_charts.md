# Charts & Diagrams - Brain Dump

Ideas from Arkad's feedback: "graficos son muchas veces explicativos por si solos" (graphics are often self-explanatory) and "Claude hace imagenes?" (does Claude make images?).

## Potential Visualizations

### 1. Peel Chain Diagram
SVG showing a chain of transactions with decreasing amounts. Based on Hudson Intelligence peel chain example Arkad shared: 2.0 BTC -> 1.8 -> 1.6 -> ... -> 0.6 BTC, peeling 0.2 each time. Shows how "throw a large coin and pay with the change" creates a traceable pattern.

### 2. Transaction Flow Diagram
Inputs -> Outputs with annotations: change output, payment output, fee, address types. Could annotate which heuristics flag which parts.

### 3. Score Breakdown Waterfall
Visual bar/waterfall chart showing each heuristic's +/- impact on the base score of 70. Currently text-only in ScoreBreakdown component. A waterfall would make the impact immediately visible.

### 4. UTXO Set Visualization
For address analysis: bubble chart of UTXOs by value. Shows dust attacks (tiny bubbles), consolidation (one big bubble), healthy distribution, etc.

### 5. CoinJoin Structure Diagram
Visual showing equal-value outputs. Whirlpool (exactly 5 equal outputs at known denominations) vs WabiSabi (20+ inputs and outputs with equal-value subsets).

### 6. Address Type Distribution
Pie chart or treemap showing relative anonymity set sizes: P2WPKH dominant, P2TR growing, legacy shrinking. Helps explain why Native SegWit is recommended.

### 7. Finding Severity Breakdown
Horizontal stacked bar showing count of findings by severity level (critical/high/medium/low/good). Quick visual summary.

### 8. Privacy Timeline
For addresses with multiple transactions: chart showing how the privacy situation evolved over time. Score or risk level per transaction.

### 9. Cluster Growth via CIOH + Change Following
From Arkad's course: tx1 (D1,D2,D3 -> Pago,D4) -> tx2 (D4,D5,D6 -> Pago,D7) -> tx3 (D7,D8,D9 -> Pago,D10) -> tx4 (D10,D11,D12 -> Pago,D13). Each transaction adds the change address plus new inputs to the cluster. Shows how CIOH + change detection link an ever-growing set of addresses to a single entity.

### 10. Coin Control UTXO Selection
From Arkad's course: "El control de monedas soluciona:" - 4 scenarios of paying 0.01 BTC from a wallet with UTXOs of 0.001, 0.004, 0.005, 0.01, 0.02, 1.00. Scenarios: (1) amount leak (X), (2) change address leak (X), (3) multi-input CIOH leak (X), (4) exact UTXO match - no change, no extra inputs (checkmark). Shows coin control as the ultimate privacy tool.

### 11. Multiple Sweeps Strategy
From Arkad's course: "Etapas de la estrategia de barridos multiples" - addresses with UTXOs -> individual sweeps (B1-B5) to new addresses -> network change -> consolidation to 1M sats -> spend via mobile. A complex but effective privacy workflow for moving funds between wallets.

### 12. Stowaway/PayJoin Pre-Cycles
From Arkad's course: Two STOWAWAY (PayJoin) transactions with multiple participants contributing inputs, creating ambiguity about fund ownership, leading to a final BARRIDO (sweep). Shows how interactive PayJoin breaks the common input ownership heuristic across multiple rounds.

### 13. Stonewall Fund Distribution
From Arkad's course: Using STONEWALL to distribute funds across outputs. Bob ends up with 3 coins in intermediate wallet. "Las monedas de baja denominacion PUEDE mantenerlas bloqueadas y DEBE utilizarlas individualmente." Low-denomination coins should be kept locked and spent individually to avoid unnecessary CIOH exposure.

## Implementation Approach

- React components with inline SVG - no external chart library needed
- CSS for simple bars/charts
- `<svg>` directly for custom diagrams like peel chains and tx flow
- Lightweight and zero-dependency
- Could progressive-enhance: basic text info always shown, diagram enhances understanding
