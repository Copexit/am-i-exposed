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

### Voice and tone in UI text

- **Never use "we", "us", or "our"** in UI copy, metadata, FAQ answers, or any user-facing text. This tool is not a person, company, or group.
- Use **passive voice** or refer to the tool by name ("am-i.exposed").
- Data is never "transmitted to us" - say "transmitted to anyone" or specify the actual recipient (e.g., "mempool.space for blockchain data").
- Correct: "Your addresses and transactions are never logged, stored, or transmitted to anyone except the mempool.space API (or your own instance)."
- Wrong: "We don't store your data." / "Your data is never transmitted to us."

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

## Deployment Rules

- **NEVER deploy without explicit user permission.** Always ask first.
- **NEVER edit code directly on the VPS.** All changes happen locally, then commit, push, pull on server.
- **NEVER commit feedback files** or any file containing real names of testers/collaborators. Use `.gitignore`.
- **NEVER expose tester identities** in commit messages, code comments, or any pushed file.

## Release Process

- **Always run `pnpm test && pnpm lint && pnpm build` before pushing.** CI runs type-check and will fail on type errors that `pnpm test` alone does not catch. Do not push without verifying the build passes locally.
- After removing or adding dependencies, always run `pnpm install` to sync `pnpm-lock.yaml`. CI uses `--frozen-lockfile` and will fail on mismatches.
- When releasing to Umbrel (see `docs/deploy-umbrel.md`), **wait for CI to finish building Docker images** before pushing the app store update. The main image takes 5-10 min for arm64 cross-compilation. Pushing the app store first causes Umbrel instances to pull a tag that doesn't exist yet, breaking updates.
- Use `/deploy` command for the full pipeline: type-check, build, bump version, commit, push, GH Pages, Umbrel release.

## Slash Commands

- `/deploy [patch|minor|major]` - Full deploy pipeline
- `/devserver [port]` - Kill and restart dev server (default: 3000)
- `/feedback <folder>` - Parse feedback screenshots/audio into actionable markdown
- `/audit-loop <end-time>` - Run expert audit + fix loop until specified time
- `/translate [lang]` - Sync all i18n locale files

## Documentation

Project documentation lives in `docs/`. Before tackling new tasks, explore this folder for context. Key references:

- **`docs/privacy-engine.md`** - Canonical heuristic reference (H1-H12), scoring model, threat model
- **`docs/development-guide.md`** - Architecture, components, state machine, API endpoints
- **`docs/testing-reference.md`** - Example transactions/addresses with expected grades
- **`docs/research-boltzmann-entropy.md`** - Entropy math and implementation notes

See `docs/README.md` for the full index including research, deployment guides, and feature specs.
