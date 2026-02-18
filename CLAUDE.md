# CLAUDE.md - Project Instructions for AI Assistants

## Build & Test

- **Package manager:** pnpm (do not use npm or yarn)
- **Dev server:** `pnpm dev`
- **Build (static export):** `pnpm build`
- **Lint:** `pnpm lint`

## Code Style Rules

### No em dashes

Never use em dashes in any form:
- No literal `---` (U+2014) characters
- No `\u2014` unicode escapes
- No `&mdash;` HTML entities

Use a regular hyphen with spaces instead: ` - `

This applies to all strings, comments, UI text, metadata, test descriptions, and documentation within `src/`.

### General

- TypeScript strict mode, no `any` types
- Tailwind CSS 4 for styling (use semantic tokens like `bg-surface-inset` over hardcoded hex values)
- Use `motion/react` (not `framer-motion`) for animations
- Next.js 16 with static export (`output: "export"`)
- All Bitcoin amounts in satoshis (never BTC floats in logic)
- Dark theme only - no light mode toggle
- `"use client"` on all interactive pages/components (static export does not support RSC)

### Bitcoin-specific

- Support all mempool.space networks: mainnet, testnet4, signet
- Address validation must be network-aware (bc1 for mainnet, tb1 for testnet/signet)
- Primary API: mempool.space, fallback: blockstream.info (mainnet only)
- Never log or persist user addresses/txids

### Severity levels

Use these consistently for findings:
- `critical` - red (#ef4444)
- `high` - orange (#f97316)
- `medium` - amber (#eab308)
- `low` - blue (#3b82f6)
- `good` - green (#28d065)
