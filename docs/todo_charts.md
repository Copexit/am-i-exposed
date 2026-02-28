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

## Implementation Approach

- React components with inline SVG - no external chart library needed
- CSS for simple bars/charts
- `<svg>` directly for custom diagrams like peel chains and tx flow
- Lightweight and zero-dependency
- Could progressive-enhance: basic text info always shown, diagram enhances understanding
