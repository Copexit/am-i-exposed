# am-i.exposed v2 - design spec

v2 is served at `/v2/` next to the classic UI during the beta (noindex, not in
the sitemap). It shares the analysis engine, hooks and data with classic. Only
the presentation layer is new.

## Principles (every review checks these)

1. **Every pixel has a source.** Each number, tag and label shown in a result
   comes from the engine through the view model (`src/lib/view/`). Components
   never re-run heuristics or re-derive facts (change, dust, entities, counts).
   Nothing is invented for decoration.
2. **Summary before detail, never hidden.** Verdict first, all evidence one
   interaction away. No finding is unreachable.
3. **One orchestrated moment per flow** (the Reveal). Elsewhere motion is
   150-250ms, eases out, and explains a change of state. Always honor
   `prefers-reduced-motion` (MotionConfig `reducedMotion="user"` is global).
4. **Calm through subtraction.** Hierarchy from type, spacing and hairlines.
   Borders and fills only where an element must read as a separate object.
   Orange (`--bitcoin`) is the single accent. Severity colors carry meaning only.
5. **Analyst-grade.** Exact values in tabular mono (`.v2-num`). IDs copyable.
   Keyboard reachable. Honest states: partial, timed out, cancelled, unknown.

## Tokens (`src/app/globals.css`)

Dark is `[data-ui="v2"]`; light is `html[data-theme="light"] [data-ui="v2"]`
(same selector on `<html>`), which wins over dark. JS-drawn surfaces (canvas,
SVG, inline styles) read the same values from `V2_COLORS` / `V2_LIGHT_COLORS`
in `src/lib/palette.ts` via `useV2Palette()`; `palette.test.ts` fails on drift.

| Token | Tailwind | Dark | Light | Use |
|---|---|---|---|---|
| `--background` | `bg-background` | #0b0b0d | #fafaf9 | page |
| `--surface-1` | `bg-surface-1` | #111114 | #f4f4f2 | sections, rails |
| `--surface-2` | `bg-surface-2` | #17171b | #ffffff | raised items, popovers, inputs |
| `--hairline` | `border-hairline` | 7% white | 8% black | dividers, quiet outlines |
| `--hairline-strong` | `border-hairline-strong` | 13% white | 14% black | hover/focus outlines, active chips |
| `--foreground` | `text-foreground` | #f2f2f4 | #131316 | primary text |
| `--muted` | `text-muted` | #a6a6b0 | #55555f | secondary text (AA on all surfaces) |
| `--faint` | `text-faint` | #70707b | #8a8a94 | eyebrows, captions only, never essential info |
| `--bitcoin` | `bg-bitcoin` | #f7931a | #f7931a | accent fills, primary action, focus |
| `--bitcoin-text` | `text-bitcoin` | #f7931a | #b45309 | orange text (light remaps `text-bitcoin` for AA) |
| severity | `text-severity-*` | critical #ef4444, high #f97316, medium #eab308, low #60a5fa, good #28d065 | critical #dc2626, high #c2410c, medium #a16207, low #2563eb, good #15803d | meaning only |

Grades use `GRADE_COLORS` (classes) or `GRADE_VAR` (CSS vars, for inline
styles and SVG) from `src/lib/constants.ts`, so they follow the theme.

Theme: stored in `localStorage["ami-theme"]` ("light" / "dark"; absent =
follow the OS live). Picked in settings (System / Light / Dark). The pre-paint
script in `src/app/layout.tsx` mirrors `useTheme` so there is no flash.

## Type

Geist (UI) and Geist Mono (numbers, ids, eyebrows). Scale (px): 11 eyebrow,
13 caption, 14 body-sm, 15 body, 17 lead, 20 h3, 28 h2, 40 h1, 64-96 display
(grade letter, home headline). Headings `text-wrap: balance`, tight tracking on
display sizes (`tracking-tight`). Body line-height 1.55, max ~70ch.

## Layout

- Page max width 1360px, side gutter 16px (mobile) / 24px / 32px.
- Results (>= 1280px): verdict band full width; main 8 cols + sticky rail 4
  cols; analyst workspace full width. Tablet: one column, rail content after
  findings. Phone (390px): compact sticky verdict bar, section chips, heavy
  tools open fullscreen. Never horizontal page scroll.
- Radius: 8px controls, 12px panels. Spacing scale 4/8/12/16/24/32/48/64.

## Copy

No em dashes anywhere. Never "we/us/our". Never "proprietary". Passive or
refer to "am-i.exposed". All strings through `t("v2.<area>.<key>", { defaultValue })`;
keys land in all 6 locales before merge (locale-parity test).

## Component rules

- Reuse engine-facing helpers and heavy components (GraphExplorerPanel,
  LinkabilityHeatmap, TaintPathDiagram, ClusterPanel, CexRiskPanel, ...).
- Every direct child of an `AnimatePresence` gets a `key` at the call site.
- Links into the scanner use `scannerHref()` (`src/lib/v2/paths.ts`) so v2
  users stay in v2.
- `data-testid` on key states (verdict, findings, reveal, stage) for e2e.
