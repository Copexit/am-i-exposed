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
| `--background` | `bg-background` | #0b0b0d | #eceef2 | page (light: a cool mid-grey paper, low glare) |
| `--surface-1` | `bg-surface-1` | #111114 | #fbfbfc | cards, sections, panels (raised) |
| `--surface-2` | `bg-surface-2` | #17171b | #e0e4ea | hover and active tints, tracks, wells inside cards |
| `--surface-float` | `bg-surface-float` | #17171b | #fbfbfc | popovers, tooltips, the home scan field |
| `--surface-inset` | `bg-surface-inset` | #111114 | #eef0f4 | classic wells (light: card color at page level, recessed inside a card) |
| `--hairline` | `border-hairline` | 7% white | rgba(15,17,21,.14) | dividers, card outlines |
| `--hairline-strong` | `border-hairline-strong` | 13% white | rgba(15,17,21,.22) | hover/focus outlines, active chips |
| `--foreground` | `text-foreground` | #f2f2f4 | #15171c | primary text (17.3:1 card, 15.4:1 page) |
| `--muted` | `text-muted` | #a6a6b0 | #4a4f5a | secondary text (7.9:1 card, 7.1:1 page) |
| `--faint` | `text-faint` | #70707b | #62676f | eyebrows, captions (5.5:1 card, 4.9:1 page, AA everywhere) |
| `--bitcoin` | `bg-bitcoin` | #f7931a | #f7931a | accent fills, primary action (near-black label), focus rings, grade arc |
| `--bitcoin-text` | `text-bitcoin` | #f7931a | #b04307 | orange text; light remaps `text-bitcoin` (5.6:1 card, 5.0:1 page) |
| `--bitcoin-display` | `text-(--bitcoin-display)` | #f7931a | #c85f06 | large display type only, e.g. the hero "exposed?" (3.6:1 page) |
| severity | `text-severity-*` | critical #ef4444, high #f97316, medium #eab308, low #60a5fa, good #28d065 | critical #c81e1e, high #b53d0b, medium #8f5606, low #1d56d8, good #12703a | meaning only, AA text on card and page |
| `--fill-*` | (light only) | = severity | critical #ef4444, high #ea580c, medium #b07b00, low #3b82f6, good #15803d | marks: dots, bars, dial, grade letters (>= 3:1) |
| `--shadow-sm` / `--shadow-card` / `--shadow-pop` | `shadow-(--shadow-card)` | transparent (pop = shadow-2xl) | soft layered, rgba(16,18,24,.05-.18) | elevation |

**Elevation in light.** Light is designed as light, not an inverted dark:
elevation is a near-white card on a mid-grey page (never pure white: it glares), a hairline and a soft layered
shadow (`--shadow-card`; `--shadow-pop` for popovers). Never a surface darker
than the page for a raised element; wells (inputs inside cards, code, table
heads) are a hair darker than the page. Dark stays flat: its shadow tokens are
transparent, so adding `shadow-(--shadow-card)` never changes dark. Panels that
are bare in dark (verdict band, rail) take `.v2-panel`, which only draws in light.

**Severity in light.** Solid `bg-severity-*` marks resolve to the brighter
`--fill-*` hues, and the translucent tints dark uses (`bg-severity-*/10`,
`border-severity-*/30`) become clean soft tints (red-50 style) instead of
greyed washes (see the remaps in `globals.css`). Graph text drawn in a mark
color goes through `svgTextColor()`.

Grades use `GRADE_COLORS` (classes, AA text) or `GRADE_VAR` (CSS vars for
display-size letters, dials and bars; light uses `--fill-*`) or `GRADE_TEXT_VAR` (small text, AA) from `src/lib/constants.ts`, so they follow the theme.

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
