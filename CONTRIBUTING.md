# Contributing to am-i.exposed

Thanks for your interest in improving Bitcoin privacy for everyone. This project is open source and welcomes contributions of all kinds - bug fixes, new heuristics, UI improvements, translations, and documentation.

## Quick start

```bash
# Clone and install
git clone https://github.com/Copexit/am-i-exposed.git
cd am-i-exposed
pnpm install

# Dev server
pnpm dev        # http://localhost:3000

# Verify your changes
pnpm lint         # 0 errors, 0 warnings
pnpm type-check   # tsc --noEmit
pnpm test         # Vitest
pnpm build        # Static export to out/
```

**Requirements:** Node.js 22 (what CI uses), pnpm 10

## Project structure

```
src/
  app/                    # Next.js pages (static export)
  components/             # React components
  context/                # React context providers
  hooks/                  # React hooks wrapping src/lib
  lib/                    # Framework-free logic (also compiled by the CLI)
    analysis/
      heuristics/         # One module per heuristic
      heuristic-registry.ts # 28 tx + 6 address heuristics
      tx-pipeline.ts      # Runs tx heuristics, finalizes the score
      chain/              # Multi-hop chain analysis
    api/                  # mempool.space API client and caches
    bitcoin/              # Networks, PSBT, descriptors, address types
    scoring/              # Score calculation, grade assignment
public/locales/           # Translations (en, es, pt, de, fr, pl)
cli/                      # CLI and MCP server
docs/                     # Architecture, methodology, research
```

Key docs to read before contributing:
- **[`docs/privacy-engine.md`](docs/privacy-engine.md)** - Heuristic reference, scoring model
- **[`docs/development-guide.md`](docs/development-guide.md)** - Architecture, data flow, API details
- **[`docs/testing.md`](docs/testing.md)** - Test suites and how to update the golden baselines
- **[`docs/testing-reference.md`](docs/testing-reference.md)** - Example transactions with expected grades

## Code style

- **TypeScript strict mode** - no `any` types
- **Tailwind CSS 4** - use semantic tokens (`bg-surface-inset`) over hardcoded colors
- **motion/react** for animations (not `framer-motion`)
- **`"use client"`** on all interactive components (static export, no RSC)
- **No em dashes** - use ` - ` (hyphen with spaces) instead of `---` everywhere
- All Bitcoin amounts in **satoshis** (never BTC floats in logic)

## Submitting a PR

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm test`, `pnpm lint`, `pnpm type-check` and `pnpm build` - all must pass
4. Write a clear PR description explaining **what** and **why**
5. If adding a new heuristic, include test transactions with expected outcomes

## Good first issues

Look for issues labeled [`good first issue`](https://github.com/Copexit/am-i-exposed/labels/good%20first%20issue). These are scoped tasks that don't require deep knowledge of the scoring engine.

Examples of good first contributions:
- Adding a missing translation key for a locale
- Improving an existing finding's recommendation text
- Fixing a UI bug on mobile
- Adding a test case to `docs/testing-reference.md`

## Adding a new heuristic

1. Create the heuristic file in `src/lib/analysis/heuristics/` and export it from `heuristics/index.ts`
2. Follow the existing pattern: a function that takes transaction/address data and returns findings
3. Register it in `src/lib/analysis/heuristic-registry.ts` (`TX_HEURISTICS` or `ADDRESS_HEURISTICS`)
4. Add each new finding id to `FINDING_METADATA` in `src/lib/analysis/finding-metadata.ts` (finding ids are a typed union) and its title/description keys to `public/locales/en/common.json`
5. Add unit tests next to the other heuristic tests, and review any golden corpus snapshot change (see `docs/testing.md`)
6. Document it in `docs/privacy-engine.md`

## Translations

Six locales are supported: `en`, `es`, `pt`, `de`, `fr`, `pl`, in `public/locales/<lang>/common.json`. Strings use `react-i18next` with inline `defaultValue` fallbacks. English is the source of truth: `src/lib/__tests__/locale-parity.test.ts` fails when a locale is missing a key, a `t()` key is missing from English, or a value contains an em dash.

## Privacy rules

This is a privacy-focused project. Please:
- **Never** log or persist user addresses/transaction IDs
- **Never** include personal names, handles, or identifying info in commit messages
- **Never** add analytics, tracking pixels, or third-party scripts

## Questions?

Open an issue or start a discussion on GitHub.
