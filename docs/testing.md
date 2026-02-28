# Testing Plan

Comprehensive testing strategy for am-i-exposed. The codebase currently has zero automated tests - only `pnpm lint`, `pnpm type-check`, and `pnpm build` in CI. This document guides implementation of unit, integration, and E2E testing from scratch.

## Table of Contents

1. [Framework Selection](#1-framework-selection)
2. [Unit Tests - Heuristic Engine](#2-unit-tests---heuristic-engine)
3. [Scoring Engine Tests](#3-scoring-engine-tests)
4. [Input Validation Tests](#4-input-validation-tests)
5. [Cross-Heuristic Intelligence Tests](#5-cross-heuristic-intelligence-tests)
6. [Golden Test Cases](#6-golden-test-cases)
7. [Integration Tests](#7-integration-tests)
8. [E2E Tests (Playwright)](#8-e2e-tests-playwright)
9. [CI Pipeline](#9-ci-pipeline)
10. [Agent-Friendly Conventions](#10-agent-friendly-conventions)
11. [Implementation Phases](#11-implementation-phases)

---

## 1. Framework Selection

### Vitest (Unit + Integration)

**Why Vitest over Jest:**
- Native ESM support - the codebase uses `module: "esnext"` and TypeScript path aliases (`@/*`)
- Built-in TypeScript support via esbuild - no babel configuration
- `vite-tsconfig-paths` resolves `@/*` aliases without extra config
- `vi.fn()` / `vi.mock()` API mirrors Jest
- Built-in coverage via `@vitest/coverage-v8`

**Install:**
```bash
pnpm add -D vitest @vitest/coverage-v8 vite-tsconfig-paths
```

**Config: `vitest.config.ts`**
```typescript
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/lib/analysis/**",
        "src/lib/scoring/**",
        "src/lib/bitcoin/**",
        "src/lib/api/**",
      ],
      thresholds: {
        lines: 60,
        functions: 70,
        branches: 50,
      },
    },
  },
});
```

**Separate config for React hook tests: `vitest.config.hooks.ts`**
```typescript
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/hooks/__tests__/**/*.test.ts"],
  },
});
```

Additional deps for hook tests:
```bash
pnpm add -D jsdom @testing-library/react @testing-library/jest-dom
```

### Playwright (E2E)

**Why Playwright:**
- Already used for screenshots in the project
- Static export compatibility via `webServer` config serving `out/`
- API mocking via `page.route()` for deterministic tests
- Multi-browser + mobile viewport emulation

**Install:**
```bash
pnpm add -D @playwright/test
npx playwright install --with-deps chromium
```

**Config: `playwright.config.ts`**
```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  webServer: {
    command: "pnpm build && npx serve out -l 3333",
    port: 3333,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:3333",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "mobile", use: { browserName: "chromium", viewport: { width: 375, height: 812 } } },
  ],
});
```

### Package.json Scripts

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:hooks": "vitest run --config vitest.config.hooks.ts",
  "test:e2e": "playwright test",
  "test:all": "vitest run && playwright test"
}
```

---

## 2. Unit Tests - Heuristic Engine

Every heuristic is a **pure function** - takes a `MempoolTransaction` (or `MempoolAddress` + UTXOs + txs) and returns `HeuristicResult` with `findings[]`. No DOM, no API calls, no side effects. Ideal for node-env unit testing.

### 2.1 File Layout

```
src/lib/analysis/heuristics/__tests__/
  fixtures/
    tx-factory.ts                     # Programmatic minimal fixture builders
    api-responses/                    # Real API responses for golden tests
      whirlpool-coinjoin.json
      wabisabi-coinjoin.json
      ...
  coinbase-detection.test.ts
  round-amount.test.ts
  change-detection.test.ts
  cioh.test.ts
  coinjoin.test.ts
  entropy.test.ts
  fee-analysis.test.ts
  op-return.test.ts
  wallet-fingerprint.test.ts
  anonymity-set.test.ts
  timing.test.ts
  script-type-mix.test.ts
  dust-output.test.ts
  address-reuse.test.ts
  utxo-analysis.test.ts
  address-type.test.ts
  spending-analysis.test.ts
```

### 2.2 Fixture Factory

Build a factory for creating minimal valid objects. Real API responses are hundreds of lines - tests should use minimal fixtures that only populate the fields each heuristic reads.

**File: `src/lib/analysis/heuristics/__tests__/fixtures/tx-factory.ts`**

```typescript
import type { MempoolTransaction, MempoolVin, MempoolVout, MempoolAddress, MempoolUtxo } from "@/lib/api/types";

export function makeTx(overrides: Partial<MempoolTransaction> = {}): MempoolTransaction {
  return {
    txid: "a".repeat(64),
    version: 2,
    locktime: 0,
    size: 250,
    weight: 700,
    fee: 1500,
    vin: [makeVin()],
    vout: [makeVout(), makeVout({ value: 50000 })],
    status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
    ...overrides,
  };
}

export function makeVin(overrides: Partial<MempoolVin> = {}): MempoolVin {
  return {
    txid: "b".repeat(64),
    vout: 0,
    prevout: {
      scriptpubkey: "0014" + "c".repeat(40),
      scriptpubkey_asm: "OP_0 OP_PUSHBYTES_20 " + "c".repeat(40),
      scriptpubkey_type: "v0_p2wpkh",
      scriptpubkey_address: "bc1q" + "a".repeat(38),
      value: 100000,
    },
    scriptsig: "",
    scriptsig_asm: "",
    is_coinbase: false,
    sequence: 0xfffffffd,
    ...overrides,
  };
}

export function makeVout(overrides: Partial<MempoolVout> = {}): MempoolVout {
  return {
    scriptpubkey: "0014" + "d".repeat(40),
    scriptpubkey_asm: "OP_0 OP_PUSHBYTES_20 " + "d".repeat(40),
    scriptpubkey_type: "v0_p2wpkh",
    scriptpubkey_address: "bc1q" + "b".repeat(38),
    value: 48000,
    ...overrides,
  };
}

export function makeAddress(overrides: Partial<MempoolAddress> = {}): MempoolAddress {
  return {
    address: "bc1q" + "a".repeat(38),
    chain_stats: {
      funded_txo_count: 1,
      funded_txo_sum: 100000,
      spent_txo_count: 0,
      spent_txo_sum: 0,
      tx_count: 1,
    },
    mempool_stats: {
      funded_txo_count: 0,
      funded_txo_sum: 0,
      spent_txo_count: 0,
      spent_txo_sum: 0,
      tx_count: 0,
    },
    ...overrides,
  };
}

export function makeUtxo(overrides: Partial<MempoolUtxo> = {}): MempoolUtxo {
  return {
    txid: "a".repeat(64),
    vout: 0,
    value: 50000,
    status: { confirmed: true, block_height: 800000 },
    ...overrides,
  };
}
```

### 2.3 Test Patterns by Heuristic

Each test file should cover: **found=true** (2+ scenarios), **found=false** (1+ scenario), **edge cases** (coinbase skip, OP_RETURN, empty inputs), **exact scoreImpact at tier boundaries**, **severity values**, **finding IDs**.

#### Coinbase Detection (simplest - binary)

```typescript
// src/lib/analysis/heuristics/__tests__/coinbase-detection.test.ts
import { describe, it, expect } from "vitest";
import { analyzeCoinbase } from "../coinbase-detection";
import { makeTx, makeVin, makeVout } from "./fixtures/tx-factory";

describe("analyzeCoinbase", () => {
  it("detects a coinbase transaction", () => {
    const tx = makeTx({
      vin: [makeVin({ is_coinbase: true, prevout: null })],
      vout: [makeVout({ value: 625000000 })],
    });
    const result = analyzeCoinbase(tx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].id).toBe("coinbase-transaction");
    expect(result.findings[0].severity).toBe("low");
    expect(result.findings[0].scoreImpact).toBe(0);
  });

  it("returns empty findings for a normal transaction", () => {
    const tx = makeTx();
    const result = analyzeCoinbase(tx);
    expect(result.findings).toHaveLength(0);
  });

  it("returns empty when multiple inputs exist", () => {
    const tx = makeTx({
      vin: [makeVin({ is_coinbase: true }), makeVin()],
    });
    const result = analyzeCoinbase(tx);
    expect(result.findings).toHaveLength(0);
  });
});
```

#### Round Amount Detection (H1 - value-based, tiered impact)

```typescript
// src/lib/analysis/heuristics/__tests__/round-amount.test.ts
describe("analyzeRoundAmounts", () => {
  it("flags a round output among non-round outputs", () => {
    const tx = makeTx({
      vout: [makeVout({ value: 1_000_000 }), makeVout({ value: 48_723 })],
    });
    const result = analyzeRoundAmounts(tx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].id).toBe("h1-round-amount");
  });

  it("applies tiered impact for multiple round outputs", () => { /* ... */ });
  it("does NOT flag when ALL outputs are round", () => { /* ... */ });
  it("skips coinbase transactions", () => { /* ... */ });
  it("skips single-output transactions", () => { /* ... */ });
});
```

#### CoinJoin Detection (H4 - most complex, 5 detection paths)

```typescript
// src/lib/analysis/heuristics/__tests__/coinjoin.test.ts
describe("analyzeCoinJoin", () => {
  describe("Whirlpool detection", () => {
    it("detects 5x equal outputs at 0.05 BTC denom", () => { /* ... */ });
    it("detects 5x equal outputs at 0.001 BTC denom", () => { /* ... */ });
    it("rejects 4 equal outputs at Whirlpool denom", () => { /* ... */ });
    it("allows up to 6 total outputs (5 equal + 1 OP_RETURN)", () => { /* ... */ });
    it("returns +30 scoreImpact", () => { /* ... */ });
  });

  describe("WabiSabi detection", () => {
    it("detects large CoinJoin (20+ inputs, 20+ outputs)", () => { /* ... */ });
    it("returns isWabiSabi=1 in params", () => { /* ... */ });
    it("does not falsely detect batched withdrawal", () => { /* ... */ });
  });

  describe("JoinMarket detection", () => {
    it("detects 2 equal outputs with 2+ distinct input addresses", () => { /* ... */ });
    it("rejects dust denomination (< 10,000 sats)", () => { /* ... */ });
  });

  describe("Stonewall detection", () => {
    it("detects 2-3 inputs, 4 outputs, 2 equal + 2 distinct", () => { /* ... */ });
    it("rejects Whirlpool denominations", () => { /* ... */ });
  });

  describe("isCoinJoinFinding", () => {
    it("returns true for h4-whirlpool with positive impact", () => { /* ... */ });
    it("returns false for h4-exchange-flagging", () => { /* ... */ });
    it("returns false for non-h4 findings", () => { /* ... */ });
  });
});
```

#### CIOH (H3 - tiered scaling)

```typescript
// src/lib/analysis/heuristics/__tests__/cioh.test.ts
describe("analyzeCioh", () => {
  it("returns 'good' for single input address", () => { /* ... */ });
  it("applies tiered impact: -6 for 2 addresses", () => { /* ... */ });
  it("applies tiered impact: -15 for 5 addresses", () => { /* ... */ });
  it("applies tiered impact: -45 for 50+ addresses", () => { /* ... */ });
  it("deduplicates same address across multiple inputs", () => { /* ... */ });
  it("skips coinbase inputs", () => { /* ... */ });
  it("severity is 'critical' at 25+ impact", () => { /* ... */ });
});
```

#### Address Reuse (H8 - address-level heuristic)

```typescript
// src/lib/analysis/heuristics/__tests__/address-reuse.test.ts
describe("analyzeAddressReuse", () => {
  it("returns 'good' with +3 for single-use address", () => { /* ... */ });
  it("returns -24 for 2-tx address reuse", () => { /* ... */ });
  it("returns -70 for 1000+ tx address reuse", () => { /* ... */ });
  it("falls back to tx_count when funded_txo_count is 0 (Umbrel/romanz)", () => { /* ... */ });
  it("provides remediation with urgency 'immediate' for 10+ txs", () => { /* ... */ });
});
```

### 2.4 Test Checklist Per Heuristic

| Category | What to verify |
|----------|---------------|
| **found=true** | At least 2 scenarios where the heuristic triggers |
| **found=false** | At least 1 scenario where it correctly does NOT trigger |
| **edge cases** | Coinbase skipping, OP_RETURN filtering, empty inputs/outputs |
| **impact values** | Exact `scoreImpact` values at tier boundaries |
| **severity** | Correct severity string at each tier |
| **finding IDs** | The `id` field matches the expected string exactly |
| **params** | Critical params populated (e.g., `count`, `walletGuess`) |

**Estimated total: ~10-15 tests per heuristic = ~170-255 unit tests.**

### 2.5 Complete Heuristic Test Matrix

| # | Heuristic File | Export | Type | Key Test Cases |
|---|---------------|--------|------|---------------|
| - | `coinbase-detection.ts` | `analyzeCoinbase` | TxHeuristic | Coinbase vs normal, multi-input coinbase |
| H1 | `round-amount.ts` | `analyzeRoundAmounts` | TxHeuristic | Round amounts, all-round (no flag), tiered impact, denom thresholds |
| H2 | `change-detection.ts` | `analyzeChangeDetection` | TxHeuristic | Change output ID, self-send, single-output (no change), multi-output |
| H3 | `cioh.ts` | `analyzeCioh` | TxHeuristic | Single addr, 2/5/10/20/50+ addrs, dedup, coinbase skip |
| H4 | `coinjoin.ts` | `analyzeCoinJoin` | TxHeuristic | Whirlpool (5 denoms), WabiSabi (20+), JoinMarket (2 equal), Stonewall, false positives |
| H5 | `entropy.ts` | `analyzeEntropy` | TxHeuristic | High/low entropy, single-output, equal outputs, Boltzmann bounds |
| H6 | `fee-analysis.ts` | `analyzeFees` | TxHeuristic | Round fee rate, RBF signaling, fee rate ranges |
| H7 | `op-return.ts` | `analyzeOpReturn` | TxHeuristic | OP_RETURN present vs absent, ASCII data, protocol tags |
| H11 | `wallet-fingerprint.ts` | `analyzeWalletFingerprint` | TxHeuristic | Known wallet patterns, unidentified, with/without rawHex |
| H13 | `anonymity-set.ts` | `analyzeAnonymitySet` | TxHeuristic | Single output, multiple equal, mixed |
| H14 | `timing.ts` | `analyzeTiming` | TxHeuristic | Confirmed vs unconfirmed, locktime patterns |
| H15 | `script-type-mix.ts` | `analyzeScriptTypeMix` | TxHeuristic | All same type, mixed types, type combinations |
| H16 | `dust-output.ts` | `analyzeDustOutputs` | TxHeuristic | Dust present, no dust, dust attack threshold (546/330 sats) |
| H8 | `address-reuse.ts` | `analyzeAddressReuse` | AddressHeuristic | Single-use (+3), 2-tx (-24), 1000+ tx (-70), romanz fallback |
| H9 | `utxo-analysis.ts` | `analyzeUtxos` | AddressHeuristic | UTXO consolidation, dust UTXOs, mixed values |
| H10 | `address-type.ts` | `analyzeAddressType` | AddressHeuristic | P2TR (good), P2WPKH, P2PKH (penalty), P2SH |
| H16-addr | `spending-analysis.ts` | `analyzeSpendingPattern` | AddressHeuristic | Spending patterns, consolidation, batch sends |

---

## 3. Scoring Engine Tests

**File: `src/lib/scoring/__tests__/score.test.ts`**

Tests for `calculateScore` and `scoreToGrade` in `src/lib/scoring/score.ts`.

```typescript
import { describe, it, expect } from "vitest";
import { calculateScore, getSummarySentiment } from "../score";
import type { Finding } from "@/lib/types";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "test",
    severity: "low",
    title: "Test",
    description: "Test",
    recommendation: "Test",
    scoreImpact: 0,
    ...overrides,
  };
}

describe("calculateScore", () => {
  it("returns base score 70 with no findings", () => {
    const result = calculateScore([]);
    expect(result.score).toBe(70);
    expect(result.grade).toBe("B");
  });

  it("clamps score to 0 minimum", () => {
    const result = calculateScore([makeFinding({ scoreImpact: -200 })]);
    expect(result.score).toBe(0);
    expect(result.grade).toBe("F");
  });

  it("clamps score to 100 maximum", () => {
    const result = calculateScore([makeFinding({ scoreImpact: 100 })]);
    expect(result.score).toBe(100);
    expect(result.grade).toBe("A+");
  });

  it("sums multiple findings", () => {
    const result = calculateScore([
      makeFinding({ scoreImpact: -10 }),
      makeFinding({ scoreImpact: -15 }),
      makeFinding({ scoreImpact: 5 }),
    ]);
    expect(result.score).toBe(50); // 70 - 10 - 15 + 5
    expect(result.grade).toBe("C");
  });

  it("sorts findings by severity (critical first)", () => {
    const result = calculateScore([
      makeFinding({ severity: "low", id: "last" }),
      makeFinding({ severity: "critical", id: "first" }),
      makeFinding({ severity: "medium", id: "middle" }),
    ]);
    expect(result.findings[0].id).toBe("first");
    expect(result.findings[2].id).toBe("last");
  });

  // Grade boundary tests
  it.each([
    [90, "A+"], [100, "A+"],
    [75, "B"],  [89, "B"],
    [50, "C"],  [74, "C"],
    [25, "D"],  [49, "D"],
    [0, "F"],   [24, "F"],
  ])("score %i maps to grade %s", (score, expectedGrade) => {
    const impact = score - 70;
    const result = calculateScore([makeFinding({ scoreImpact: impact })]);
    expect(result.grade).toBe(expectedGrade);
  });
});

describe("getSummarySentiment", () => {
  it("returns 'danger' for grade F", () => { /* ... */ });
  it("returns 'positive' when no finding has negative impact", () => { /* ... */ });
  it("returns 'positive' for A+ and B grades", () => { /* ... */ });
  it("returns 'cautious' for grade C with negative findings", () => { /* ... */ });
  it("returns 'warning' for grade D with negative findings", () => { /* ... */ });
});
```

---

## 4. Input Validation Tests

**File: `src/lib/analysis/__tests__/detect-input.test.ts`**

Tests for `detectInputType` and `cleanInput` in `src/lib/analysis/detect-input.ts`.

```typescript
describe("detectInputType", () => {
  describe("txid detection", () => {
    it("accepts 64 lowercase hex chars", () => { /* ... */ });
    it("accepts 64 mixed-case hex chars", () => { /* ... */ });
    it("rejects 63 hex chars", () => { /* ... */ });
    it("rejects 65 hex chars", () => { /* ... */ });
    it("rejects non-hex chars", () => { /* ... */ });
  });

  describe("mainnet addresses", () => {
    it("accepts bc1q (P2WPKH)", () => { /* ... */ });
    it("accepts bc1p (P2TR)", () => { /* ... */ });
    it("accepts 1... (P2PKH)", () => { /* ... */ });
    it("accepts 3... (P2SH)", () => { /* ... */ });
    it("rejects invalid bech32 chars", () => { /* ... */ });
  });

  describe("testnet addresses", () => {
    it("accepts tb1q", () => { /* ... */ });
    it("accepts tb1p", () => { /* ... */ });
    it("accepts m... and n...", () => { /* ... */ });
    it("accepts 2...", () => { /* ... */ });
  });

  describe("URL extraction", () => {
    it("extracts txid from mempool.space URL", () => { /* ... */ });
    it("extracts address from mempool.space URL", () => { /* ... */ });
    it("extracts from blockstream.info URL", () => { /* ... */ });
    it("handles testnet4 URLs", () => { /* ... */ });
  });

  it("rejects empty string", () => { /* ... */ });
  it("rejects random text", () => { /* ... */ });
});

describe("cleanInput", () => {
  it("strips zero-width characters", () => { /* ... */ });
  it("strips control characters", () => { /* ... */ });
  it("extracts txid from mempool URL", () => { /* ... */ });
  it("truncates to MAX_INPUT_LENGTH", () => { /* ... */ });
});
```

**File: `src/lib/bitcoin/__tests__/address-type.test.ts`**

Tests for `getAddressType` in `src/lib/bitcoin/address-type.ts`.

```typescript
describe("getAddressType", () => {
  it.each([
    ["bc1p...", "p2tr"],
    ["bc1q" + "a".repeat(38), "p2wpkh"],
    ["bc1q" + "a".repeat(58), "p2wsh"],
    ["3...", "p2sh"],
    ["1...", "p2pkh"],
    ["tb1p...", "p2tr"],
    ["tb1q...", "p2wpkh"],
  ])("returns correct type for %s", (addr, expected) => { /* ... */ });
});
```

---

## 5. Cross-Heuristic Intelligence Tests

**File: `src/lib/analysis/__tests__/cross-heuristic.test.ts`**

Tests for `applyCrossHeuristicRules()` in `src/lib/analysis/orchestrator.ts`. Since this function is not exported, test it indirectly through `analyzeTransaction()` with fixtures that trigger both CoinJoin detection and other heuristics.

```typescript
describe("cross-heuristic intelligence", () => {
  it("suppresses CIOH (h3-cioh) when CoinJoin detected", () => {
    // Build a Whirlpool-like tx that also triggers CIOH
    const tx = makeWhirlpoolTx(); // 5 inputs from different addresses, 5 equal outputs
    const result = await analyzeTransaction(tx);
    const cioh = result.findings.find(f => f.id === "h3-cioh");
    if (cioh) expect(cioh.scoreImpact).toBe(0);
  });

  it("suppresses round amounts (h1-round-amount) in CoinJoin context", () => { /* ... */ });
  it("suppresses change detection (h2-change-detected) in CoinJoin context", () => { /* ... */ });
  it("does NOT suppress self-send (h2-self-send) in CoinJoin context", () => { /* ... */ });
  it("suppresses script-mixed in CoinJoin context", () => { /* ... */ });
  it("suppresses dust findings in CoinJoin context", () => { /* ... */ });
  it("suppresses timing-unconfirmed in CoinJoin context", () => { /* ... */ });
  it("suppresses anon-set-none in CoinJoin context", () => { /* ... */ });
  it("suppresses fee fingerprinting (h6-*) in CoinJoin context", () => { /* ... */ });
  it("infers Wasabi Wallet from WabiSabi CoinJoin", () => { /* ... */ });
  it("infers Samourai/Sparrow from Whirlpool CoinJoin", () => { /* ... */ });
  it("does NOT suppress any penalties when no CoinJoin found", () => { /* ... */ });
});
```

**Finding IDs suppressed by CoinJoin:**
- `h3-cioh`
- `h1-round-amount`
- `h2-change-detected` (but NOT `h2-self-send`)
- `script-mixed`
- `h11-wallet-fingerprint` (zeroed, wallet inferred from CoinJoin type)
- `dust-attack`, `dust-outputs`
- `timing-unconfirmed`
- `h6-round-fee-rate`, `h6-rbf-signaled`
- `anon-set-none`, `anon-set-moderate`

---

## 6. Golden Test Cases

**File: `src/lib/analysis/__tests__/golden-cases.test.ts`**

Uses the 11 reference transactions from `docs/testing-reference.md` with real captured API responses. These run the full orchestrator pipeline and assert the final score and grade.

### 6.1 Fixture Capture Script

**File: `scripts/capture-fixtures.mjs`**

```javascript
// Fetches real mempool.space API responses for reference transactions
// and saves them as JSON fixtures for deterministic offline testing.
// Usage: node scripts/capture-fixtures.mjs

import { writeFileSync, mkdirSync } from "fs";

const API = "https://mempool.space/api";
const DIR = "src/lib/analysis/heuristics/__tests__/fixtures/api-responses";

const TX_CASES = [
  { name: "whirlpool-coinjoin", txid: "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2" },
  { name: "wabisabi-coinjoin", txid: "fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e" },
  { name: "joinmarket-coinjoin", txid: "4f112abd2eefe3484a7bbf7c1731f784cba19de677468835145e9c448fb18b7d" },
  { name: "taproot-op-return", txid: "0bf67b1f05326afbd613e11631a2b86466ac7e255499f6286e31b9d7d889cee7" },
  { name: "bare-multisig", txid: "60a20bd93aa49ab4b28d514ec10b06e1829ce6818ec06cd3aabd013ebcdc4bb1" },
  { name: "op-return-charley", txid: "8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684" },
  { name: "simple-legacy-p2pkh", txid: "0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4" },
  { name: "batch-withdrawal-143", txid: "3d81a6b95903dd457d45a2fc998acc42fe96f59ef01157bdcbc331fe451c8d9e" },
  { name: "dust-attack-555", txid: "655c533bf059721cec9d3d70b3171a07997991a02fedfa1c9b593abc645e1cc5" },
  { name: "taproot-script-path", txid: "37777defed8717c581b4c0509329550e344bdc14ac38f71fc050096887e535c8" },
];

const ADDR_CASES = [
  { name: "satoshi-genesis", address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" },
];

mkdirSync(DIR, { recursive: true });

for (const { name, txid } of TX_CASES) {
  const res = await fetch(`${API}/tx/${txid}`);
  const json = await res.json();
  writeFileSync(`${DIR}/${name}.json`, JSON.stringify(json, null, 2));
  console.log(`Saved ${name}`);
  await new Promise(r => setTimeout(r, 500)); // rate limit courtesy
}

for (const { name, address } of ADDR_CASES) {
  const [addr, utxos, txs] = await Promise.all([
    fetch(`${API}/address/${address}`).then(r => r.json()),
    fetch(`${API}/address/${address}/utxo`).then(r => r.json()),
    fetch(`${API}/address/${address}/txs`).then(r => r.json()),
  ]);
  writeFileSync(`${DIR}/${name}-address.json`, JSON.stringify(addr, null, 2));
  writeFileSync(`${DIR}/${name}-utxos.json`, JSON.stringify(utxos, null, 2));
  writeFileSync(`${DIR}/${name}-txs.json`, JSON.stringify(txs, null, 2));
  console.log(`Saved ${name} (address + utxos + txs)`);
}
```

### 6.2 Golden Test Structure

```typescript
import { describe, it, expect } from "vitest";
import { analyzeTransaction, analyzeAddress } from "../orchestrator";
import whirlpoolTx from "./fixtures/api-responses/whirlpool-coinjoin.json";
import wabisabiTx from "./fixtures/api-responses/wabisabi-coinjoin.json";
// ... import all fixtures

describe("golden test cases - transactions", () => {
  it.each([
    ["Whirlpool CoinJoin", whirlpoolTx, "A+", 100],
    ["WabiSabi CoinJoin", wabisabiTx, "A+", 100],
    ["Simple Legacy P2PKH", legacyTx, "C", 61],
    ["JoinMarket 2x equal", joinmarketTx, "C", 58],
    ["Taproot + OP_RETURN", taprootOpReturnTx, "D", 48],
    ["Batch withdrawal 143", batchTx, "D", 44],
    ["Dust attack 555 sats", dustTx, "C", 52],
    ["Taproot script-path", taprootScriptTx, "C", 53],
  ])("%s scores %s (%i)", async (name, tx, expectedGrade, expectedScore) => {
    const result = await analyzeTransaction(tx as MempoolTransaction);
    expect(result.grade).toBe(expectedGrade);
    expect(result.score).toBe(expectedScore);
  });
});

describe("golden test cases - addresses", () => {
  it("Satoshi Genesis address scores F (0)", async () => {
    const result = await analyzeAddress(
      satoshiAddress as MempoolAddress,
      satoshiUtxos as MempoolUtxo[],
      satoshiTxs as MempoolTransaction[],
    );
    expect(result.grade).toBe("F");
    expect(result.score).toBe(0);
  });
});
```

### 6.3 Score Validation Matrix

From `docs/testing-reference.md`:

| Scenario | Expected Grade | Score | Key Heuristics |
|----------|---------------|-------|----------------|
| Whirlpool 5x5 | A+ | 100 | H4 (+30), H5 (+15), anon (+5), cross-heuristic suppression |
| WabiSabi 300+ | A+ | 100 | H4 (+25), H5 (+15), anon (+10), cross-heuristic suppression |
| Satoshi's address | F | 0 | H8 (-70), H10 (-5), spending (-2) |
| Simple legacy P2PKH | C | 61 | H11 (-5), H2 (-5), script (+2) |
| JoinMarket 2x equal | C | 58 | H3 (-6), H5 (-5), H11 (-6), anon (+5) |
| Taproot + OP_RETURN | D | 48 | H7 (-10), H5 (-5), H11 (-5), H1 (-5), script (-3) |
| Batch withdrawal 143 | D | 44 | H1 (-15), H5 (-5), H11 (-5), script (-3) |
| Dust attack 555 sats | C | 52 | dust (-8), H5 (-5), H11 (-5), anon (-2) |
| Taproot script-path | C | 53 | H3 (-6), H5 (-5), H11 (-5), H6 (-2) |

**When a golden test fails:**
- If the change is intentional (recalibrated heuristic), update both the test expected value AND `docs/testing-reference.md`.
- If unintentional, investigate which heuristic regressed.

---

## 7. Integration Tests

### 7.1 Orchestrator

**File: `src/lib/analysis/__tests__/orchestrator.test.ts`**

```typescript
describe("analyzeTransaction", () => {
  it("runs all TX_HEURISTICS and returns scored result", async () => {
    const tx = makeTx();
    const result = await analyzeTransaction(tx);
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("grade");
    expect(result).toHaveProperty("findings");
    expect(typeof result.score).toBe("number");
  });

  it("calls onStep callback for each heuristic (13 * 2 = 26 calls)", async () => {
    const onStep = vi.fn();
    await analyzeTransaction(makeTx(), undefined, onStep);
    expect(onStep).toHaveBeenCalledTimes(26);
  });

  it("applies cross-heuristic rules after all heuristics run", async () => {
    const result = await analyzeTransaction(makeWhirlpoolTx());
    const cioh = result.findings.find(f => f.id === "h3-cioh");
    if (cioh) expect(cioh.scoreImpact).toBe(0);
  });
});

describe("analyzeAddress", () => {
  it("runs all ADDRESS_HEURISTICS and returns scored result", async () => { /* ... */ });
  it("adds partial-history warning when txs < totalOnChain", async () => { /* ... */ });
  it("adds unavailable warning when txs is empty but totalOnChain > 0", async () => { /* ... */ });
});

describe("analyzeDestination (pre-send)", () => {
  it("returns LOW risk for unused address", async () => { /* ... */ });
  it("returns MEDIUM risk for address received once", async () => { /* ... */ });
  it("returns HIGH risk for 10+ reused address", async () => { /* ... */ });
  it("returns CRITICAL for 100+ reused address", async () => { /* ... */ });
  it("returns CRITICAL for OFAC-sanctioned address", async () => { /* ... */ });
  it("escalates LOW to MEDIUM when high-severity findings exist", async () => { /* ... */ });
  it("returns HIGH when funded_txo_count=0 but tx_count > 0 (romanz fallback)", async () => { /* ... */ });
});
```

### 7.2 API Layer

**File: `src/lib/api/__tests__/fetch-with-retry.test.ts`**

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithRetry, ApiError } from "../fetch-with-retry";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("fetchWithRetry", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns response on first success", async () => {
    mockFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const res = await fetchWithRetry("https://example.com");
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws NOT_FOUND for 404 (no retry)", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(fetchWithRetry("https://example.com")).rejects.toHaveProperty("code", "NOT_FOUND");
  });

  it("retries on 429 up to MAX_RETRIES then throws RATE_LIMITED", async () => {
    mockFetch.mockResolvedValue(new Response("", { status: 429 }));
    await expect(fetchWithRetry("https://example.com")).rejects.toHaveProperty("code", "RATE_LIMITED");
    expect(mockFetch).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });

  it("retries on 500 then succeeds", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const res = await fetchWithRetry("https://example.com");
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("respects AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchWithRetry("https://example.com", { signal: controller.signal })
    ).rejects.toThrow();
  });
});
```

**File: `src/lib/api/__tests__/enrich-prevouts.test.ts`**

```typescript
describe("needsEnrichment", () => {
  it("returns false when prevout is populated", () => { /* ... */ });
  it("returns true when prevout is null", () => { /* ... */ });
  it("skips coinbase inputs", () => { /* ... */ });
});

describe("enrichPrevouts", () => {
  it("reconstructs missing prevout data from parent tx", async () => { /* ... */ });
  it("handles failed parent fetches gracefully", async () => { /* ... */ });
  it("respects abort signal", async () => { /* ... */ });
});
```

### 7.3 Hook Tests (jsdom environment)

Requires `vitest.config.hooks.ts` with `environment: "jsdom"`.

**File: `src/hooks/__tests__/useBookmarks.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBookmarks } from "../useBookmarks";

describe("useBookmarks", () => {
  beforeEach(() => { localStorage.clear(); });

  it("starts with empty bookmarks", () => {
    const { result } = renderHook(() => useBookmarks());
    expect(result.current.bookmarks).toEqual([]);
  });

  it("adds a bookmark", () => {
    const { result } = renderHook(() => useBookmarks());
    act(() => {
      result.current.addBookmark({ input: "abc", type: "txid", grade: "A+", score: 95 });
    });
    expect(result.current.bookmarks).toHaveLength(1);
    expect(result.current.bookmarks[0].input).toBe("abc");
  });

  it("removes duplicate when adding same input", () => { /* ... */ });
  it("removes a bookmark", () => { /* ... */ });
  it("updates a label", () => { /* ... */ });
  it("clears all bookmarks", () => { /* ... */ });
  it("isBookmarked returns true for existing input", () => { /* ... */ });
});
```

**File: `src/hooks/__tests__/useRecentScans.test.ts`** - same pattern using `sessionStorage`.

---

## 8. E2E Tests (Playwright)

### 8.1 API Mocking

All E2E tests must mock the mempool.space API for determinism. Use Playwright's `page.route()`.

**File: `e2e/helpers/mock-api.ts`**

```typescript
import type { Page } from "@playwright/test";
import whirlpoolFixture from "../fixtures/whirlpool-coinjoin.json";

const fixtureMap: Record<string, unknown> = {
  "323df21f...": whirlpoolFixture,
  // ... map txids to fixtures
};

export async function mockMempoolApi(page: Page) {
  await page.route("**/api/tx/*", async (route) => {
    const txid = route.request().url().split("/tx/")[1];
    const fixture = fixtureMap[txid];
    if (fixture) {
      await route.fulfill({ json: fixture });
    } else {
      await route.fulfill({ status: 404 });
    }
  });
  // Similar routes for /address/*, /address/*/txs, /address/*/utxo
}
```

### 8.2 data-testid Attributes

These need to be added to the relevant components:

| Component | data-testid | Purpose |
|-----------|------------|---------|
| AddressInput | `address-input` | Main input field |
| AddressInput | `scan-button` | Submit button |
| ScoreDisplay | `grade-display` | Grade letter (A+, B, C, D, F) |
| ScoreDisplay | `score-value` | Numeric score |
| DiagnosticLoader | `diagnostic-loader` | Loading indicator |
| FindingCard | `finding-card` | Individual finding cards |
| ResultsPanel | `results-panel` | Results container |
| Error display | `error-message` | Error banner |

### 8.3 Test Files

**`e2e/scan-flow.spec.ts`**

```typescript
import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

test.describe("Transaction scan flow", () => {
  test.beforeEach(async ({ page }) => {
    await mockMempoolApi(page);
    await page.goto("/");
  });

  test("scans a Whirlpool CoinJoin and shows A+ grade", async ({ page }) => {
    await page.fill('[data-testid="address-input"]', WHIRLPOOL_TXID);
    await page.click('[data-testid="scan-button"]');
    await expect(page.locator('[data-testid="grade-display"]')).toHaveText("A+");
  });

  test("shows error for invalid input", async ({ page }) => {
    await page.fill('[data-testid="address-input"]', "invalid-text");
    await page.click('[data-testid="scan-button"]');
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
  });

  test("displays diagnostic loader during analysis", async ({ page }) => {
    await page.fill('[data-testid="address-input"]', WHIRLPOOL_TXID);
    await page.click('[data-testid="scan-button"]');
    await expect(page.locator('[data-testid="diagnostic-loader"]')).toBeVisible();
    await expect(page.locator('[data-testid="grade-display"]')).toBeVisible({ timeout: 10000 });
  });
});
```

**`e2e/bookmarks.spec.ts`**

```typescript
test.describe("Bookmark flow", () => {
  test("saves and persists a bookmark across reloads", async ({ page }) => { /* ... */ });
  test("labels a bookmark", async ({ page }) => { /* ... */ });
  test("removes a bookmark", async ({ page }) => { /* ... */ });
});
```

**`e2e/hash-routing.spec.ts`**

```typescript
test.describe("Hash routing", () => {
  test("navigating to /#tx=<txid> auto-triggers scan", async ({ page }) => { /* ... */ });
  test("navigating to /#addr=<addr> auto-triggers scan", async ({ page }) => { /* ... */ });
  test("back/forward navigation works", async ({ page }) => { /* ... */ });
});
```

**`e2e/responsive.spec.ts`**

```typescript
test.describe("Mobile responsive", () => {
  test("input and results render on 375px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator('[data-testid="address-input"]')).toBeVisible();
  });
});
```

**`e2e/methodology.spec.ts`**

```typescript
test.describe("Methodology page", () => {
  test("renders all heuristic sections", async ({ page }) => {
    await page.goto("/methodology/");
    await expect(page.locator("h1")).toContainText("Methodology");
    await expect(page.locator("text=Round Amount")).toBeVisible();
    await expect(page.locator("text=CoinJoin")).toBeVisible();
  });
});
```

---

## 9. CI Pipeline

### 9.1 Updated GitHub Actions Workflow

Replace the existing single `check` job with staged jobs:

**File: `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm type-check

  unit:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-report
          path: coverage/

  e2e:
    runs-on: ubuntu-latest
    needs: unit
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: npx playwright install --with-deps chromium
      - run: pnpm build
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: test-results/

  build:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
```

### 9.2 Pipeline Diagram

```
PR opened
  |
  v
[lint + type-check] --------> [build]
  |
  v
[unit + coverage]
  |
  v
[e2e (Playwright)]
```

### 9.3 Coverage Thresholds (Progressive)

| Phase | Lines | Functions | Branches |
|-------|-------|-----------|----------|
| Phase 1 | 40% | 50% | 30% |
| Phase 2 | 60% | 70% | 50% |
| Phase 3 | 75% | 80% | 60% |
| Target | 85% | 90% | 75% |

---

## 10. Agent-Friendly Conventions

### 10.1 Test Naming

Every test description must be a complete sentence stating the expected behavior:

```
Good:  "returns -24 for 2-tx address reuse"
Bad:   "address reuse test"
Good:  "detects 5x 0.05 BTC Whirlpool pool"
Bad:   "whirlpool"
```

### 10.2 Quick Commands

```bash
# Quick check - did anything break?
pnpm test

# With coverage
pnpm test:coverage

# Just the golden cases (fastest regression signal)
pnpm vitest run src/lib/analysis/__tests__/golden-cases.test.ts

# Just one heuristic after modifying it
pnpm vitest run src/lib/analysis/heuristics/__tests__/round-amount.test.ts

# Watch mode during development
pnpm test:watch
```

### 10.3 Snapshot Testing for Complex Heuristics

For complex heuristics like CoinJoin and entropy, use inline snapshots to catch structural changes:

```typescript
it("produces expected findings for Whirlpool tx", () => {
  const result = analyzeCoinJoin(whirlpoolFixture);
  expect(result.findings.map(f => ({
    id: f.id,
    severity: f.severity,
    scoreImpact: f.scoreImpact,
  }))).toMatchInlineSnapshot(`
    [
      { "id": "h4-whirlpool", "severity": "good", "scoreImpact": 30 },
      { "id": "h4-exchange-flagging", "severity": "low", "scoreImpact": 0 },
    ]
  `);
});
```

Using `toMatchInlineSnapshot` over `toMatchSnapshot` keeps expected output visible in the test file.

### 10.4 Full Directory Layout

```
src/
  lib/
    analysis/
      heuristics/
        __tests__/
          fixtures/
            tx-factory.ts
            api-responses/
              whirlpool-coinjoin.json
              wabisabi-coinjoin.json
              joinmarket-coinjoin.json
              taproot-op-return.json
              simple-legacy-p2pkh.json
              dust-attack-555.json
              batch-withdrawal-143.json
              taproot-script-path.json
              bare-multisig.json
              op-return-charley.json
              satoshi-genesis-address.json
              satoshi-genesis-utxos.json
              satoshi-genesis-txs.json
          coinbase-detection.test.ts
          round-amount.test.ts
          change-detection.test.ts
          cioh.test.ts
          coinjoin.test.ts
          entropy.test.ts
          fee-analysis.test.ts
          op-return.test.ts
          wallet-fingerprint.test.ts
          anonymity-set.test.ts
          timing.test.ts
          script-type-mix.test.ts
          dust-output.test.ts
          address-reuse.test.ts
          utxo-analysis.test.ts
          address-type.test.ts
          spending-analysis.test.ts
      __tests__/
        orchestrator.test.ts
        cross-heuristic.test.ts
        golden-cases.test.ts
        detect-input.test.ts
    scoring/
      __tests__/
        score.test.ts
    bitcoin/
      __tests__/
        address-type.test.ts
    api/
      __tests__/
        fetch-with-retry.test.ts
        enrich-prevouts.test.ts
  hooks/
    __tests__/
      useBookmarks.test.ts
      useRecentScans.test.ts
e2e/
  helpers/
    mock-api.ts
  fixtures/
    (symlink or copy of api-responses/)
  scan-flow.spec.ts
  bookmarks.spec.ts
  hash-routing.spec.ts
  responsive.spec.ts
  methodology.spec.ts
```

---

## 11. Implementation Phases

### Phase 1: Framework Setup + Heuristic Unit Tests

**Highest ROI. ~170+ tests covering the core analysis engine.**

1. Install Vitest + deps
2. Create `vitest.config.ts`
3. Add `test`, `test:watch`, `test:coverage` scripts
4. Create `tx-factory.ts` fixture factory
5. Write unit tests for all 13 TX-level heuristics (simplest first):
   - `coinbase-detection.test.ts`
   - `round-amount.test.ts`
   - `cioh.test.ts`
   - `op-return.test.ts`
   - `dust-output.test.ts`
   - `timing.test.ts`
   - `anonymity-set.test.ts`
   - `script-type-mix.test.ts`
   - `fee-analysis.test.ts`
   - `change-detection.test.ts`
   - `wallet-fingerprint.test.ts`
   - `entropy.test.ts`
   - `coinjoin.test.ts` (most complex - 5 detection paths)
6. Write unit tests for all 4 address-level heuristics:
   - `address-reuse.test.ts`
   - `utxo-analysis.test.ts`
   - `address-type.test.ts`
   - `spending-analysis.test.ts`

**Exit criteria:** `pnpm test` runs 170+ tests, 0 failures, coverage for `src/lib/analysis/heuristics/` > 80%.

### Phase 2: Scoring + Validation + Cross-Heuristic

1. Write `score.test.ts` - `calculateScore`, `scoreToGrade`, `getSummarySentiment`
2. Write `detect-input.test.ts` - `detectInputType`, `cleanInput`
3. Write `address-type.test.ts` (bitcoin/) - `getAddressType`
4. Write `cross-heuristic.test.ts` - all CoinJoin suppression rules

**Exit criteria:** All scoring boundaries, input validation patterns, and cross-heuristic interactions covered.

### Phase 3: Golden Cases + Integration

1. Run `scripts/capture-fixtures.mjs` to download real API responses
2. Write `golden-cases.test.ts` - assert scores/grades for all 11 reference cases
3. Write `orchestrator.test.ts` - full pipeline tests
4. Write `fetch-with-retry.test.ts` - retry logic with mocked fetch
5. Write `enrich-prevouts.test.ts` - prevout reconstruction
6. Install jsdom + testing-library, create `vitest.config.hooks.ts`
7. Write `useBookmarks.test.ts` and `useRecentScans.test.ts`

**Exit criteria:** Golden tests match `docs/testing-reference.md`. API retry/fallback tested. Hooks handle storage correctly.

### Phase 4: E2E Tests

1. Install Playwright, configure with static export
2. Add `data-testid` attributes to key components
3. Create `e2e/helpers/mock-api.ts`
4. Write `scan-flow.spec.ts`, `bookmarks.spec.ts`, `hash-routing.spec.ts`, `responsive.spec.ts`, `methodology.spec.ts`

**Exit criteria:** All E2E tests pass against static export with mocked API.

### Phase 5: CI Pipeline + Coverage Gates

1. Update `.github/workflows/ci.yml` with staged jobs
2. Configure coverage thresholds
3. Add artifact upload for coverage + Playwright traces
4. Verify pipeline on a test PR

**Exit criteria:** CI blocks PRs that break tests or drop coverage below thresholds.

---

## Potential Challenges

| Challenge | Mitigation |
|-----------|-----------|
| Path alias `@/*` not resolving | `vite-tsconfig-paths` plugin handles this |
| Large WabiSabi fixture (327 inputs, 279 outputs) | Store as JSON, Vitest handles JSON imports natively |
| `setTimeout` in orchestrator `tick()` slows tests | Use `vi.useFakeTimers()` or accept ~650ms overhead |
| Hook tests need React 19 + jsdom | Separate vitest config with `environment: "jsdom"` |
| `useSyncExternalStore` module-level cache | Clear storage + `vi.resetModules()` in `beforeEach` |
| Entropy floating point precision | Use `toBeCloseTo()` instead of exact equality |
| Wallet fingerprint needs optional `rawHex` | Test both with and without `rawHex` parameter |
| Heuristic changes shift golden test scores | Update both the test AND `docs/testing-reference.md` |
| E2E tests need `pnpm build` first | Playwright `webServer` config builds automatically |
