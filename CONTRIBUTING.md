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
pnpm lint       # Must pass with 0 errors
pnpm build      # Static export to out/
```

**Requirements:** Node.js 20+, pnpm 9+

## Project structure

```
src/
  app/                    # Next.js pages (static export)
  components/             # React components
  context/                # React context providers
  lib/
    analysis/
      heuristics/         # 16 privacy heuristics (H1-H12 tx, H13-H16 addr)
      orchestrator.ts     # Runs heuristics, manages scoring
    api/                  # mempool.space / blockstream.info clients
    bitcoin/              # Address type detection, validation
    i18n/                 # Internationalization (en, es, de, fr, pt)
    scoring/              # Score calculation, grade assignment
docs/                     # Architecture, methodology, research
```

Key docs to read before contributing:
- **[`docs/privacy-engine.md`](docs/privacy-engine.md)** - Heuristic reference (H1-H12), scoring model
- **[`docs/development-guide.md`](docs/development-guide.md)** - Architecture, state machine, API details
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
3. Run `pnpm lint` and `pnpm build` - both must pass
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

1. Create the heuristic file in `src/lib/analysis/heuristics/`
2. Follow the existing pattern: export a function that takes transaction/address data and returns findings
3. Register it in the orchestrator (`src/lib/analysis/orchestrator.ts`)
4. Document it in `docs/privacy-engine.md`
5. Add test transactions to `docs/testing-reference.md`

## Translations

We support 5 locales: `en`, `es`, `de`, `fr`, `pt`. Translation strings use `react-i18next` with inline `defaultValue` fallbacks. To add translations for a new locale or fix an existing one, look for `t("key", { defaultValue: "..." })` calls throughout the components.

## Privacy rules

This is a privacy-focused project. Please:
- **Never** log or persist user addresses/transaction IDs
- **Never** include personal names, handles, or identifying info in commit messages
- **Never** add analytics, tracking pixels, or third-party scripts

## Questions?

Open an issue or start a discussion on GitHub. We're happy to help you find something to work on.
