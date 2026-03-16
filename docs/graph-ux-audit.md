# Transaction Graph - UX Audit & Vision Report

*Date: 2026-03-15*

---

## 1. Bug Fixes Applied

### Edge Tooltip Scroll Drift (FIXED)
Edge hover tooltips used `e.clientX - svgRect.left` for positioning, which broke after scrolling. Node tooltips correctly used `toScreen()`. Now both use the same approach.

### Tooltip-Sidebar Redundancy (FIXED)
When clicking a node to open the sidebar, the tooltip remained visible showing the same txid, in/out counts, and entity info. Now: tooltip is suppressed for the expanded node, and reduced to a minimal chip for other nodes.

---

## 2. Data Redundancy Map

### Before (data shown in 3+ places simultaneously)

| Data | Canvas Label | Hover Tooltip | Sidebar | Redundancy |
|------|-------------|---------------|---------|------------|
| Txid (truncated) | 8-char | 8-char | 10-char header | TRIPLE |
| In/Out count | Summary line | Count text | Full I/O list | TRIPLE |
| Total value | Summary line | Sats text | Score bar | TRIPLE |
| Entity name | 9px label | Full entity block | I/O + Analysis tabs | QUADRUPLE |
| OFAC status | Triangle badge | Text | I/O + Analysis | QUADRUPLE |

### After (minimal tooltip)
Tooltip now shows only: 6-char txid + entity/CJ badge + fee rate + unconfirmed flag. All data already on the canvas label is omitted. Tooltip is fully suppressed for the sidebar's expanded node.

---

## 3. Color Conflict Analysis

### Orange (#f97316) - was used for 5 unrelated concepts
| Concept | Before | After |
|---------|--------|-------|
| P2SH/multisig edges | #f97316 | #f97316 (kept - standard convention) |
| Entity "p2p" nodes | #f97316 | #e879f9 (fuchsia) |
| Entity "unknown" nodes | #f97316 | #9ca3af (gray) |
| SVG_COLORS.high severity | #f97316 | #f97316 (kept - severity system) |
| Change marking edges | #f97316 (was) | #d97706 (amber, fixed in previous session) |

### Red (#ef4444) - used for 6 things (acceptable)
All red uses signal "danger/critical" which is semantically correct: OFAC, consolidation, toxic merge, deterministic chains, darknet/scam entities. No change needed.

### Yellow (#eab308) - OP_RETURN conflict
OP_RETURN edges were bright yellow, same as gambling entities and medium severity. Changed to warm gray (#78716c) since OP_RETURN is data-only, not a payment.

---

## 4. Visibility Issues

### Dust Edges (FIXED)
Before: 0.15 opacity, 1px width - effectively invisible.
After: 0.3 opacity, 1.5px width, "2 2" dash pattern for visual distinction.

### Default Edge Opacity (FIXED)
Raised from 0.35 to 0.45. Edges are the primary connective tissue of the graph.

### Arrow Marker Opacity (FIXED)
Raised from 0.5 to 0.7. Direction arrows carry critical information.

### Arrow Marker Size (FIXED - previous session)
Changed from `markerUnits="strokeWidth"` to `markerUnits="userSpaceOnUse"` with 12x8 fixed size. Prevents arrowheads from ballooning on thick edges.

---

## 5. Remaining Weaknesses

### Node Badges Pile Up
CoinJoin diamond + OFAC triangle + toxic merge badge all compete for the top-right corner of a 180x56px node. Three overlapping shapes in 36px.

**Recommendation:** Horizontal pill row below txid label.

### Four Font Sizes on One Node
- Txid: 11px weight 600
- Summary: 10px normal
- Type label: 9px 0.6 opacity
- Entity: 9px weight 500

**Recommendation:** Two-line design with consistent sizing.

### Expanded Node Readability
Port rows blend into each other against the same dark background. No alternating shading.

### Sidebar Fixed Width
320px on all screen sizes. No resize, no alternative layout.

### Legend Verbosity
Still 6-8 items inline even after collapsing. Wraps on mobile.

**Recommendation:** Legend as a popover behind a "?" button.

---

## 6. Brainstorm - Making the Graph Special

### Focus Mode (Spotlight)
Click a node: it and its neighbors stay full opacity, everything else fades to 15%. Creates natural attention direction. Sidebar appears in the spotlight. Exit via Escape or canvas click.

### Edge Flow Particles
Animated 2px dots traveling along edges in the direction of value transfer. CSS `offset-path` animation, only on focused node's connections. Speed proportional to value.

### Privacy Ripple
Animated entropy visualization: high-entropy edges pulse green slowly (calm), low-entropy pulse red fast (alarming). "Heartbeat" metaphor for privacy health.

### Node Expand Morphing
Smooth SVG transition from collapsed rect to expanded port view. Ports stagger in 30ms each. Motion spring physics.

### Contextual Glow Auras
CoinJoin: pulsing green glow. OFAC: red warning pulse. Root: bitcoin-orange breathing. SVG filter-based, GPU-accelerated.

### Edge Probability Badge
Instead of mouse-following tooltip for linkability, render a small SVG pill at edge midpoint on hover. Stays fixed in graph space.

### Time Travel Slider
Scrub through expansion history using the existing undo stack. Playback button auto-advances. Useful for presentations.

### Ambient Grid Background
Subtle radial gradient from dark blue at root to black at edges. Faint dot grid (0.03 opacity). Radar/Minority Report aesthetic.

### Sound Design (opt-in)
Click sounds on expand, whoosh on auto-trace hop, chime on completion. Web Audio API, very low volume, toggle in settings.

---

## 7. Implementation Priority

| Priority | Item | Effort | Impact | Status |
|----------|------|--------|--------|--------|
| P0 | Edge tooltip scroll fix | S | Critical | DONE |
| P0 | Tooltip-sidebar redundancy | S | High | DONE |
| P0 | Color conflicts | S | High | DONE |
| P0 | Edge/dust visibility | S | Medium | DONE |
| P1 | Focus mode spotlight | M | Very High | DONE |
| P1 | Node badge reorganization | S | Medium | DONE |
| P1 | Ambient grid background | S | High (feel) | DONE |
| P2 | Edge flow particles | M | High (wow) | DONE |
| P2 | Node expand morphing | M | Medium | DONE |
| P2 | Legend as popover | S | Medium | DONE |
| P3 | Glow auras | M | Medium | DONE |
| P3 | Time travel slider | L | Medium | DONE |
| P3 | Privacy ripple animation | M | Medium | DONE |
| P4 | Sound design | M | Low-Medium | DONE |
