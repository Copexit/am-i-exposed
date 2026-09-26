# Testing Guide

How the am-i-exposed test suites are organized, how to run them, and how to update the regression baselines. Every test runs offline against recorded fixtures: no test may reach the network.

## Quick reference

```bash
pnpm test                    # Unit, integration, hook and component tests (one Vitest run)
pnpm test:coverage           # Same run with v8 coverage and thresholds (what CI runs)
pnpm test:watch              # Watch mode
pnpm vitest run <path>       # One file or directory
pnpm vitest run -u <path>    # Update snapshots (golden corpus), see below
pnpm build && pnpm test:e2e  # Playwright against the static export in out/
cd cli && pnpm test          # CLI + MCP server tests (separate Vitest project)
cd boltzmann-rs && cargo test  # Rust Boltzmann engine tests
```

Before pushing: `pnpm test && pnpm lint && pnpm type-check && pnpm build`. Lint runs with `--max-warnings 0` and type-aware promise rules, so test files must lint cleanly too.

## Rules for new tests

- **Exercise production code.** Import the real module; never test a copied or re-implemented version of the logic.
- **Deterministic.** Use fake timers (`vi.useFakeTimers()`), fixed data and fixtures. No `Date.now()`-dependent assertions, no real network.
- **Meaningful assertions.** Assert behavior (a grade, a finding id and impact, rendered text, a call argument). A test that only checks `toBeDefined()` is not a test.
- **A failing test that exposes a real bug** is fixed in the source, not by loosening the assertion.

## 1. Vitest (unit, integration, hooks, components)

Config: `vitest.config.ts`. A single run covers:

- `src/**/*.test.ts`, `src/**/*.test.tsx`
- `workers/**/*.test.js` (Cloudflare workers: chainalysis-proxy, coinjoin-stats, tor-check)
- `umbrel/**/*.test.js` (Umbrel tor-proxy sidecar)

The default environment is `node`. Tests that need a DOM (React hooks, components, pages, clipboard, localStorage) opt in per file with a pragma on the first line:

```ts
// @vitest-environment jsdom
```

There is no separate hook config; hook tests (`src/hooks/__tests__/`) run in the main suite. IndexedDB-backed code is tested with `fake-indexeddb`. React code uses `@testing-library/react` (`renderHook`, `render`, `act`).

The heuristic loader delay (`tick()` in `src/lib/analysis/heuristic-registry.ts`) is 0 under `NODE_ENV=test`, so pipeline tests do not need to advance 50ms per heuristic. Golden tests still use fake timers so any remaining timers are controlled.

### Layout

| Location | What it covers |
|----------|----------------|
| `src/lib/analysis/heuristics/__tests__/` | One file per heuristic (tx and address level) |
| `src/lib/analysis/__tests__/` | Orchestrator, tx pipeline, cross-heuristic rules, address orchestrator, run-txid / run-address pipelines, chain trace, Boltzmann pool, finding metadata, golden cases, golden corpus |
| `src/lib/analysis/chain/__tests__/` | Chain analysis modules and recursive trace |
| `src/lib/analysis/{cex-risk,cluster,cross-heuristic,entity-filter}/__tests__/` | OFAC / Chainalysis checks, cluster building, cross-heuristic rules, entity index |
| `src/lib/{api,bitcoin,graph,observatory,recommendations,scoring,wallet}/__tests__/` | API client and caches, PSBT / descriptor parsing, graph reducer and URL codec, observatory clients, recommendation cascade, scoring, wallet scan |
| `src/lib/__tests__/` | Formatting, palette/CSS drift, locale parity, finding locale text |
| `src/hooks/__tests__/` | React hooks (jsdom) |
| `src/components/**/__tests__/`, `src/app/**/__tests__/` | Component and page smoke tests (jsdom) |

### Fixtures

All fixtures live in `src/lib/analysis/heuristics/__tests__/fixtures/`:

- `tx-factory.ts` - `makeTx`, `makeVin`, `makeVout`, `makeAddress`, `resetAddrCounter` for synthetic transactions. Prefer these for heuristic unit tests.
- `api-responses/*.json` - real mempool.space responses for the reference transactions (see `docs/testing-reference.md`) and Satoshi's genesis address.
- `api-responses/corpus/*.json` - `{ tx, hex }` pairs for the golden corpus.
- `hodlhodl-tp.json`, `hodlhodl-fp.json` - true/false positive sets for escrow detection.

The same fixtures are reused by the CLI tests and the Playwright mocks.

### Capturing fixtures

`scripts/capture-fixtures.mjs` is the only script that touches the network. It re-downloads the reference transactions, the address fixtures and the corpus (tx JSON plus raw hex) from mempool.space:

```bash
node scripts/capture-fixtures.mjs
```

Run it only when adding a new case (add the txid to `TX_CASES`, `ADDR_CASES` or `CORPUS_TXIDS` first). Recapturing can change fixture content (for example spend status or confirmations), so review the resulting fixture and baseline diffs like any other change.

## 2. Golden regression baselines

Two suites pin the end-to-end output of the analysis pipeline. Any heuristic, scoring or cross-heuristic change that moves a score shows up here.

### Golden cases (`src/lib/analysis/__tests__/golden-cases.test.ts`)

Runs `analyzeTransaction` / `analyzeAddress` on the reference fixtures and asserts the exact grade and score. These are heuristic-only results (no chain trace, no fiat prices, no entity data), which is why web scans of the same txid can differ (see the e2e tests). The expected values are mirrored in the score matrix of `docs/testing-reference.md`.

When a change moves a golden value intentionally:

1. Explain which findings changed and why the new score is more correct.
2. Update the expected value in the test.
3. Update the matching row in `docs/testing-reference.md`.

### Golden corpus (`src/lib/analysis/__tests__/golden-corpus.test.ts`)

Runs every `{ tx, hex }` pair in `fixtures/api-responses/corpus/` through the full tx pipeline (with raw hex, so hex-based heuristics run) and snapshots grade, score and the sorted list of `finding-id impact` strings. The corpus is a set of everyday transactions from block 850000, one per input/output shape and script type.

To accept an intentional change:

```bash
pnpm vitest run -u src/lib/analysis/__tests__/golden-corpus.test.ts
```

Then review `__snapshots__/golden-corpus.test.ts.snap` and justify every delta in the commit message: for each changed txid, name the finding that appeared, disappeared or changed impact and why. An unexplained delta is a regression until proven otherwise. Never run `-u` on the whole suite to make a red run green.

## 3. Locale tests

- `src/lib/__tests__/locale-parity.test.ts` - all locales (en, es, pt, de, fr, pl) exist and share the English key set; no em dashes in any value; every literal `t()` key used in `src/` exists in English; no mustache sections; every emitted finding id has title and description keys; every `{{placeholder}}` is passed by its `t()` call.
- `src/lib/__tests__/finding-locale-text.test.ts` - renders real findings through i18next with the English catalog and asserts that the localized text keeps the heuristic's information (counts, linked pairs, formatted sats, variants).
- `src/lib/__tests__/palette.test.ts` - parses `src/app/globals.css` and fails if `src/lib/palette.ts` drifts from the CSS tokens.

When adding a finding or a UI string, add the English key first; the parity test then lists the keys missing from other locales (`/translate` fills them).

## 4. E2E (Playwright)

Config: `playwright.config.ts`. Tests in `e2e/*.spec.ts` run in Chromium against the static export served on port 3333 (`npx serve out -l 3333`, without `-s` so routes like `/graph/` are served as their own pages), so run `pnpm build` first.

`e2e/helpers/mock-api.ts` (`mockMempoolApi(page)`) makes the tests fully offline:

- A catch-all route is registered first (lowest priority) and aborts every request to a non-localhost host, so nothing can reach the real network.
- Specific routes serve the fixture JSON for known txids and addresses (tx, outspends, address, utxo, txs); unknown ones return 404, `/hex` returns an empty body.

Extra helpers, registered after `mockMempoolApi` so they take priority:

- `mockExtraTxs(page, txs)` - serves test-built transactions (and all-unspent outspends); `loadTxFixture(name)` loads a fixture to build them from.
- `mockWalletAddresses(page, funded)` - wallet scans: every derived address is empty except the funded ones.
- `mockObservatoryApi(page)` - the observatory worker routes and LiquiSabi JSON-RPC, served from `src/lib/observatory/__tests__/fixtures/`.

Assertions read `data-testid` / `data-grade` / `data-score` attributes (for example `[data-testid='score-display']`). Web scores include chain and entity findings, so they may differ from the golden-case values; each spec documents the expected delta.

## 5. CLI tests

The CLI (`cli/`) has its own Vitest config (`cli/vitest.config.ts`) and runs from the `cli/` directory:

```bash
cd cli && pnpm test
```

- `@/` resolves to the web app's `src/`, so the CLI tests exercise the shared analysis code and reuse the same fixtures.
- `fetch` is stubbed with `vi.fn()` and fed fixture responses; timers are faked.
- `AM_I_EXPOSED_CACHE_DIR` is set to a per-process temp directory, so tests never touch the real `~/.am-i-exposed` SQLite cache. Use the same variable when running the CLI by hand against a throwaway cache.
- `commands-boltzmann.test.ts` uses the real Node WASM bindings: build them first with `bash scripts/build-boltzmann-wasm-node.sh` (CI does this in the `cli-wasm` job).
- `mcp-server.test.ts` covers the MCP tool surface.

## 6. Coverage

`pnpm test:coverage` uses v8 coverage over `src/lib/**` and `src/hooks/**` (tests, JSON and type-only `types.ts` modules excluded). The thresholds in `vitest.config.ts` (statements, lines, functions, branches) are set to the measured floor minus one point, so any coverage regression fails CI; raise them when coverage goes up. The HTML report is written to `coverage/`.

## 7. CI

`.github/workflows/ci.yml` runs on pull requests (the deploy workflow also runs `pnpm test` before publishing):

| Job | Runs |
|-----|------|
| `lint` | `pnpm lint`, `pnpm type-check` |
| `unit` | `pnpm test:coverage` (uploads the coverage report) |
| `build` | `pnpm build` (uploads `out/`) |
| `e2e` | Playwright against the built `out/` |
| `cli-build` | CLI type-check, bundle, `--version` / `--help` smoke test |
| `cli-wasm` | Builds the Node WASM target, then `cd cli && pnpm test` |
