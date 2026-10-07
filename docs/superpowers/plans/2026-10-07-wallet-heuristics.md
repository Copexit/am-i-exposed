# Wallet Heuristics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add wallet-level heuristics to the xpub/descriptor audit. They score what the wallet did across its history:
- CoinJoin outputs merged with unmixed coins;
- change merged with other coins;
- payments that reveal their change;
- peel chains;
- coins kept apart (a credit).

The plan also adds a coin-origins breakdown and transaction links on wallet findings, with parity in the CLI.

**Architecture:**
- **A pure behaviour model** (`wallet-behavior.ts`) turns `WalletAddressInfo[]` into one deduplicated tx graph. It classifies every wallet coin by origin, and lists the transactions the wallet built alone and its simple payments.
- **Pure checks** (`wallet-heuristics.ts`) turn that into `Finding`s.
- **Wiring:** `auditWallet` calls both, so the web app, the CLI and MCP get the same result.
- **UI:** the existing finding list, plus a `TxRefList` on finding cards and a `CoinOrigins` bar in the verdict band.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript strict, Tailwind 4 tokens, react-i18next (6 flat-key locales, `_one/_other` plurals; pl `_one/_few/_many/_other`), Vitest (+ jsdom per file), Playwright with offline mocks.

**Spec:** `docs/spec-wallet-heuristics.md`. Read it first, especially "The behaviour model", "Heuristics kept", "Scoring" and "Copy and remediation". The plan argues from it, and the copy there is the English source of truth.

## Global Constraints

- **Workflow:**
  - pnpm only.
  - Work only in `/home/user/aie-wallet-h` (branch `feat/wallet-heuristics`). Never touch `/home/user/am-i-exposed` or other worktrees.
  - Never `git stash`. Never push or deploy.
- **Commits:**
  - conventional;
  - NO `Co-Authored-By` or any AI attribution;
  - never `-c user.email/name` (the identity is preconfigured);
  - `git add <files>` explicitly.
- **Gates for every task:**
  - `pnpm type-check`;
  - `pnpm lint` (0 warnings);
  - the task's tests;
  - `pnpm vitest run src/lib/__tests__/locale-parity.test.ts` when locales or finding IDs change.

  It checks that every `FINDING_METADATA` id has `title` and `description` keys in `en`, that every literal `t("key")` exists in `en`, and parity across the 6 locales.
- **Code:** TypeScript strict, no `any`.
- **Copy:**
  - No em dashes (U+2014, its `\u` escape, the HTML entity) anywhere.
  - No "we/us/our" in copy; passive or tool-named voice.
  - Spanish is Castilian tuteo (usa, envía, haz).
  - Every new `t()` key has a `defaultValue` and exists in all 6 locales (`public/locales/{en,es,pt,de,fr,pl}/common.json`).
  - The English locale values equal the English `title`/`description`/`recommendation` strings in code (the locale-text test checks titles).
- **Data:**
  - `auditWallet` stays a pure function of `WalletAddressInfo[]` (and `failedAddresses`): no requests, no traces.
  - Never log or persist addresses or txids. Txids go only into in-memory finding `params._txids`.
- **NEVER add PayJoin detection.** A tx with any input from outside the wallet is skipped by every new check and never labelled.
- **Scoring:**
  - The wallet base score stays 70, and the impacts are exactly the spec's.
  - Golden wallet: C 52. Clean wallet: B 81.
- **UI:**
  - Tokens only, no hex.
  - Touch targets >= 40 px, with a visible focus ring.
  - No horizontal scroll at 390 px.
- **e2e:**
  - Run `pnpm build` first, and `ss -ltnp | grep :3333` must be empty.
  - Then `CI=1 pnpm exec playwright test <files> --workers=1`.
  - Afterwards run `git checkout -- public/sitemap.xml` if it changed.
- **CLI:** `cd cli && pnpm install --frozen-lockfile && pnpm test && pnpm type-check`.

## Review Focus

1. **A coin whose funding tx is not in the scanned history** (address history truncated at 100 txs) must never cause a finding. Its class is `unknown`, and `unknown` never makes a W1 merge "unmixed" or a W2 change merge. Tests: Task 1 (`coinClass` returns `unknown`), Task 2 ("an unknown-origin input does not make the merge 'unmixed'").
2. **A tx with an input from outside the wallet** (collaborative or PayJoin-shaped) must be skipped by every check, never labelled. Tests: Task 1 (`soloSpends` skips it).
3. **The wallet's own CoinJoin** (remix, Stonewall) must never count as a merge or consolidation, and a merge counted by W1 or W2 must not also count as `wallet-consolidation-history`. Tests: Task 1 (CoinJoins are not solo spends), Task 4 (dedup).
4. **The same tx in several addresses' lists** (payment in the input address's and the change address's list) must count once. Test: Task 1.
5. **An empty wallet, a wallet with no spends, or a wallet with only receipts** must produce no new findings, zero origins and no crash. Tests: Task 1 (`utxoOrigins` empty), Task 4 (`auditWallet([])`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/analysis/wallet-behavior.ts` | Wallet graph, coin classes, solo spends, simple payments, UTXO origins |
| `src/lib/analysis/wallet-heuristics.ts` | W1-W5 checks returning `Finding`s, `txRefs` |
| `src/lib/analysis/wallet-audit.ts` | Calls the checks, consolidation dedup, `utxoOrigins` on the result |
| `src/lib/analysis/finding-metadata.ts` | 5 new IDs |
| `src/lib/analysis/__tests__/fixtures/wallet-history.ts` | Offline history builder, `goldenWallet()`, `cleanWallet()` |
| `src/lib/analysis/__tests__/wallet-behavior.test.ts`, `wallet-heuristics.test.ts`, `wallet-golden.test.ts` | Unit and golden tests |
| `src/components/FindingCardTables.tsx`, `src/components/FindingCard.tsx` | `TxRefList` and its use in `FindingCardBody` |
| `src/components/wallet/CoinOrigins.tsx`, `src/components/flows/WalletResults.tsx` | Coin-origins bar in the verdict band |
| `public/locales/*/common.json` | Finding and UI copy, 6 locales |
| `cli/src/output/formatter.ts`, `cli/src/output/json.ts`, `cli/src/mcp/server.ts` | Coin origins in CLI text, JSON and MCP |
| `e2e/wallet-scan.spec.ts`, `e2e/helpers/mock-api.ts` | Offline e2e for a change merge |
| `docs/privacy-engine.md`, `docs/xpub-analysis.md`, `docs/adr-finding-tiers.md`, `docs/testing-reference.md`, `docs/README.md` | Documentation |

---

### Task 1: Behaviour model and history fixtures

**Files:**
- Create:
  - `src/lib/analysis/wallet-behavior.ts`
  - `src/lib/analysis/__tests__/fixtures/wallet-history.ts`
  - `src/lib/analysis/__tests__/wallet-behavior.test.ts`

**Interfaces:**
- Consumes:
  - `WalletAddressInfo` from `./wallet-audit` (type only);
  - `isCoinJoinTx(tx)` from `./heuristics/coinjoin`;
  - `detectTx0(tx): Tx0Match | null` from `./heuristics/coinjoin-premix` (`toxicChange?: MempoolVout`, an element of `tx.vout`);
  - `makeTx`, `makeVin`, `makeVout` from `../../heuristics/__tests__/fixtures/tx-factory`.
- Produces:

```ts
export type CoinClass = "mixed" | "coinjoin-change" | "change" | "self" | "received" | "unknown";
export const COIN_CLASSES: readonly CoinClass[];
export type OriginCounts = Record<CoinClass, { count: number; sats: number }>;
export interface WalletGraph { own: ReadonlySet<string>; txs: ReadonlyMap<string, MempoolTransaction>; isCoinJoin: (tx: MempoolTransaction) => boolean }
export function buildWalletGraph(infos: readonly WalletAddressInfo[]): WalletGraph;
export const isOwn: (g: WalletGraph, address: string | undefined) => boolean;
export function coinClass(g: WalletGraph, txid: string, vout: number): CoinClass;
export function soloSpends(g: WalletGraph): MempoolTransaction[]; // oldest first
export interface SimplePayment { tx: MempoolTransaction; change: MempoolVout; payment: MempoolVout }
export function simplePayments(g: WalletGraph, spends: readonly MempoolTransaction[]): SimplePayment[];
export function utxoOrigins(g: WalletGraph, infos: readonly WalletAddressInfo[]): OriginCounts;
// fixtures/wallet-history.ts
export interface Coin { txid: string; vout: number; address: string; value: number }
export const recv: (i: number) => string; export const chg: (i: number) => string;
export const ext: (i: number) => string; export const extTaproot: (i: number) => string;
export class History { readonly txs: MempoolTransaction[]; tx(inputs, outputs, height): Coin[]; receive(address, value, height): Coin; infos(addresses): WalletAddressInfo[] }
export function coinJoin(h: History, input: Coin, denom: number, mixedTo: string, changeTo: string, height: number): Coin[]; // index 0 = mixedTo, index 5 = wallet change
export function goldenWallet(): WalletAddressInfo[];
export function cleanWallet(): WalletAddressInfo[];
export const walletAddrs: (n: number) => { address: string; isChange: boolean; index: number }[];
```

- [ ] **Step 1: Write the fixture builder** (test support, no logic under test). Create `src/lib/analysis/__tests__/fixtures/wallet-history.ts`:

```ts
/**
 * Synthetic wallet histories for wallet-level heuristic tests: a tiny builder
 * over tx-factory. Addresses are fake but typed by prefix (getAddressType).
 */
import type { MempoolTransaction } from "@/lib/api/types";
import type { WalletAddressInfo } from "../../wallet-audit";
import { makeTx, makeVin, makeVout } from "../../heuristics/__tests__/fixtures/tx-factory";

export interface Coin { txid: string; vout: number; address: string; value: number }

const addr = (prefix: string, tag: string, n: number) => `${prefix}${tag}${n.toString(16).padStart(38 - tag.length, "0")}`;
/** Wallet receive / change addresses (P2WPKH-shaped) and outside addresses. */
export const recv = (i: number) => addr("bc1q", "aa", i);
export const chg = (i: number) => addr("bc1q", "cc", i);
export const ext = (i: number) => addr("bc1q", "ee", i);
export const extTaproot = (i: number) => addr("bc1p", "ee", i);

export class History {
  private n = 0;
  readonly txs: MempoolTransaction[] = [];

  /** A tx spending `inputs`, paying `outputs`, at `height`. Returns its output coins. */
  tx(inputs: (Coin | { address: string; value: number })[], outputs: { address: string; value: number }[], height: number): Coin[] {
    const txid = (++this.n).toString(16).padStart(64, "0");
    const tx = makeTx({
      txid,
      vin: inputs.map((c, i) => makeVin({
        txid: "txid" in c ? c.txid : (1000 + this.n * 10 + i).toString(16).padStart(64, "f"),
        vout: "vout" in c ? c.vout : 0,
        prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: c.address.startsWith("bc1p") ? "v1_p2tr" : "v0_p2wpkh", scriptpubkey_address: c.address, value: c.value },
      })),
      vout: outputs.map((o) => makeVout({ scriptpubkey_address: o.address, value: o.value, scriptpubkey_type: o.address.startsWith("bc1p") ? "v1_p2tr" : "v0_p2wpkh" })),
      status: { confirmed: true, block_height: height, block_time: 1_700_000_000 + height * 600 },
    });
    this.txs.push(tx);
    return outputs.map((o, vout) => ({ txid, vout, address: o.address, value: o.value }));
  }

  /** Received from outside: one external input. */
  receive(address: string, value: number, height: number): Coin {
    return this.tx([{ address: ext(900 + this.n), value: value + 1_000 }], [{ address, value }], height)[0]!;
  }

  /** WalletAddressInfo[] for `addresses` (wallet order), with txs, stats and unspent coins derived from the history. */
  infos(addresses: { address: string; isChange: boolean; index: number }[]): WalletAddressInfo[] {
    const spent = new Set(this.txs.flatMap((t) => t.vin.map((v) => `${v.txid}:${v.vout}`)));
    return addresses.map(({ address, isChange, index }) => {
      const txs = this.txs.filter((t) => t.vout.some((o) => o.scriptpubkey_address === address) || t.vin.some((v) => v.prevout?.scriptpubkey_address === address));
      const funded = this.txs.flatMap((t) => t.vout.map((o, vout) => ({ t, o, vout }))).filter(({ o }) => o.scriptpubkey_address === address);
      const utxos = funded.filter(({ t, vout }) => !spent.has(`${t.txid}:${vout}`))
        .map(({ t, o, vout }) => ({ txid: t.txid, vout, value: o.value, status: t.status }));
      const stats = { funded_txo_count: funded.length, funded_txo_sum: funded.reduce((s, f) => s + f.o.value, 0), spent_txo_count: 0, spent_txo_sum: 0, tx_count: txs.length };
      return {
        derived: { address, isChange, index, path: `${isChange ? 1 : 0}/${index}` },
        addressData: { address, chain_stats: stats, mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 } },
        txs,
        utxos,
      };
    });
  }
}

/** Equal-output CoinJoin: the wallet's `input` plus 4 outside inputs, 5 x `denom` outputs (one to `mixedTo`), wallet change to `changeTo`. */
export function coinJoin(h: History, input: Coin, denom: number, mixedTo: string, changeTo: string, height: number): Coin[] {
  const others = [1, 2, 3, 4].map((i) => ({ address: ext(500 + i + height), value: denom + 50_000 }));
  const outs = [mixedTo, ext(600 + height), ext(601 + height), ext(602 + height), ext(603 + height)].map((address) => ({ address, value: denom }));
  return h.tx([input, ...others], [...outs, { address: changeTo, value: input.value - denom - 5_000 }], height);
}

/**
 * The golden wallet: a payment that reveals its change, change merged with a
 * receipt, a CoinJoin whose output is merged with unmixed change, and a peel
 * chain of 3 payments. See docs/spec-wallet-heuristics.md "Golden wallet".
 */
export function goldenWallet(): WalletAddressInfo[] {
  const h = new History();
  const r0 = h.receive(recv(0), 1_000_000, 100);
  const r1 = h.receive(recv(1), 500_000, 101);
  const [, c0] = h.tx([r0], [{ address: extTaproot(1), value: 300_000 }, { address: chg(0), value: 699_000 }], 102); // P1
  const [, c1] = h.tx([c0!, r1], [{ address: ext(2), value: 1_150_000 }, { address: chg(1), value: 48_000 }], 103); // M1
  const r2 = h.receive(recv(2), 2_000_000, 104);
  const cj = coinJoin(h, r2, 1_000_000, recv(3), chg(2), 105);
  h.tx([cj[0]!, c1!], [{ address: ext(3), value: 1_040_000 }], 106); // PM
  const r4 = h.receive(recv(4), 3_000_000, 110);
  const [, c3] = h.tx([r4], [{ address: ext(4), value: 100_001 }, { address: chg(3), value: 2_899_000 }], 111); // P2
  const [, c4] = h.tx([c3!], [{ address: ext(5), value: 200_003 }, { address: chg(4), value: 2_698_000 }], 112); // P3
  h.tx([c4!], [{ address: ext(6), value: 150_007 }, { address: chg(5), value: 2_547_000 }], 113); // P4
  return h.infos([
    ...[0, 1, 2, 3, 4].map((i) => ({ address: recv(i), isChange: false, index: i })),
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ address: chg(i), isChange: true, index: i })),
  ]);
}

/** A careful wallet: 6 receipts, 3 single-coin changeless spends. */
export function cleanWallet(): WalletAddressInfo[] {
  const h = new History();
  const coins = [0, 1, 2, 3, 4, 5].map((i) => h.receive(recv(i), 400_000 + i * 1_111, 100 + i));
  coins.slice(0, 3).forEach((c, i) => h.tx([c], [{ address: ext(10 + i), value: c.value - 1_500 }], 200 + i));
  return h.infos([0, 1, 2, 3, 4, 5].map((i) => ({ address: recv(i), isChange: false, index: i })));
}

/** Receive and change addresses 0..n-1, in scan order. */
export const walletAddrs = (n: number) => [
  ...Array.from({ length: n }, (_, i) => ({ address: recv(i), isChange: false, index: i })),
  ...Array.from({ length: n }, (_, i) => ({ address: chg(i), isChange: true, index: i })),
];
```

- [ ] **Step 2: Write the failing tests.** Create `src/lib/analysis/__tests__/wallet-behavior.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { History, coinJoin, recv, chg, ext, walletAddrs } from "./fixtures/wallet-history";
import { buildWalletGraph, coinClass, soloSpends, simplePayments, utxoOrigins } from "../wallet-behavior";
import { isCoinJoinTx } from "../heuristics/coinjoin";
import { detectTx0 } from "../heuristics/coinjoin-premix";

describe("coinClass", () => {
  it("classifies received, change, self, mixed, CoinJoin change and unknown", () => {
    const h = new History();
    const r = h.receive(recv(0), 1_000_000, 100);
    const [pay, change] = h.tx([r], [{ address: ext(1), value: 300_000 }, { address: chg(0), value: 699_000 }], 101);
    const [self] = h.tx([change!], [{ address: recv(1), value: 698_000 }], 102);
    const r2 = h.receive(recv(2), 2_000_000, 103);
    const cj = coinJoin(h, r2, 1_000_000, recv(3), chg(1), 104);
    const g = buildWalletGraph(h.infos(walletAddrs(4)));

    expect(isCoinJoinTx(g.txs.get(cj[0]!.txid)!)).toBe(true); // fixture guard
    expect(coinClass(g, r.txid, r.vout)).toBe("received");
    expect(coinClass(g, change!.txid, change!.vout)).toBe("change");
    expect(coinClass(g, pay!.txid, pay!.vout)).toBe("change"); // an output's class comes from its tx; only wallet outputs are ever asked
    expect(coinClass(g, self!.txid, self!.vout)).toBe("self");
    expect(coinClass(g, cj[0]!.txid, 0)).toBe("mixed");
    expect(coinClass(g, cj[5]!.txid, 5)).toBe("coinjoin-change");
    expect(coinClass(g, "f".repeat(64), 0)).toBe("unknown");
    expect(coinClass(g, r.txid, 9)).toBe("unknown");
  });

  it("classifies a Whirlpool tx0's toxic change as CoinJoin change", () => {
    const h = new History();
    const r = h.receive(recv(0), 300_000, 100);
    const out = h.tx([r], [
      { address: recv(1), value: 100_000 },
      { address: recv(2), value: 100_000 },
      { address: ext(1), value: 5_000 },
      { address: chg(0), value: 90_000 },
    ], 101);
    const g = buildWalletGraph(h.infos(walletAddrs(3)));
    expect(detectTx0(g.txs.get(out[0]!.txid)!)).not.toBeNull(); // fixture guard
    expect(coinClass(g, out[3]!.txid, 3)).toBe("coinjoin-change");
    expect(coinClass(g, out[0]!.txid, 0)).toBe("change");
  });
});

describe("soloSpends and simplePayments", () => {
  it("skips txs with an outside input and CoinJoins; payments need one change and one recipient", () => {
    const h = new History();
    const a = h.receive(recv(0), 500_000, 100);
    const b = h.receive(recv(1), 500_000, 101);
    const c = h.receive(recv(2), 2_000_000, 102);
    const d = h.receive(recv(3), 400_000, 103);
    const e = h.receive(recv(4), 400_000, 104);
    // payment: one recipient + change
    h.tx([a], [{ address: ext(1), value: 100_000 }, { address: chg(0), value: 399_000 }], 110);
    // batch: two recipients + change (solo spend, not a simple payment)
    h.tx([b], [{ address: ext(2), value: 100_000 }, { address: ext(3), value: 100_000 }, { address: chg(1), value: 299_000 }], 111);
    // collaborative: one outside input (skipped entirely, never labelled)
    h.tx([d, { address: ext(50), value: 300_000 }], [{ address: ext(4), value: 350_000 }, { address: chg(2), value: 349_000 }], 112);
    // CoinJoin the wallet joined
    coinJoin(h, c, 1_000_000, recv(5), chg(3), 113);
    // changeless and self-transfer (solo spends, not payments)
    h.tx([e], [{ address: ext(5), value: 399_000 }], 114);
    const g = buildWalletGraph(h.infos(walletAddrs(6)));

    const spends = soloSpends(g);
    expect(spends.map((t) => t.status.block_height)).toEqual([110, 111, 114]);
    expect(simplePayments(g, spends).map((p) => p.tx.status.block_height)).toEqual([110]);
    const [p] = simplePayments(g, spends);
    expect(p!.change.scriptpubkey_address).toBe(chg(0));
    expect(p!.payment.scriptpubkey_address).toBe(ext(1));
  });

  it("counts a tx listed under several wallet addresses once", () => {
    const h = new History();
    const a = h.receive(recv(0), 500_000, 100);
    h.tx([a], [{ address: ext(1), value: 100_000 }, { address: chg(0), value: 399_000 }], 101);
    const g = buildWalletGraph(h.infos(walletAddrs(1))); // the payment is in recv(0)'s and chg(0)'s lists
    expect(g.txs.size).toBe(2);
    expect(soloSpends(g)).toHaveLength(1);
  });
});

describe("utxoOrigins", () => {
  it("sums unspent coins by class", () => {
    const h = new History();
    h.receive(recv(0), 10_000, 100);
    const r = h.receive(recv(1), 1_000_000, 101);
    h.tx([r], [{ address: ext(1), value: 300_000 }, { address: chg(0), value: 699_000 }], 102);
    const infos = h.infos(walletAddrs(2));
    const o = utxoOrigins(buildWalletGraph(infos), infos);
    expect(o.received).toEqual({ count: 1, sats: 10_000 });
    expect(o.change).toEqual({ count: 1, sats: 699_000 });
    expect(o.mixed).toEqual({ count: 0, sats: 0 });
  });

  it("is all zeros for an empty wallet", () => {
    const o = utxoOrigins(buildWalletGraph([]), []);
    expect(Object.values(o).every((v) => v.count === 0 && v.sats === 0)).toBe(true);
  });
});
```

- [ ] **Step 3: Run, expect FAIL.**
  - Run: `pnpm vitest run src/lib/analysis/__tests__/wallet-behavior.test.ts`
  - Expected: FAIL, `Failed to resolve import "../wallet-behavior"`.

- [ ] **Step 4: Implement.** Create `src/lib/analysis/wallet-behavior.ts`:

```ts
/**
 * Wallet behaviour model: the scanned history as one graph, each coin paid to
 * the wallet classified by where it came from, and the transactions the
 * wallet built alone. Pure: computed from the scan data only, no requests.
 * See docs/spec-wallet-heuristics.md.
 */
import type { MempoolTransaction, MempoolVout } from "@/lib/api/types";
import type { WalletAddressInfo } from "./wallet-audit";
import { isCoinJoinTx } from "./heuristics/coinjoin";
import { detectTx0 } from "./heuristics/coinjoin-premix";

export type CoinClass = "mixed" | "coinjoin-change" | "change" | "self" | "received" | "unknown";
export const COIN_CLASSES: readonly CoinClass[] = ["mixed", "coinjoin-change", "change", "self", "received", "unknown"];
export type OriginCounts = Record<CoinClass, { count: number; sats: number }>;

export interface WalletGraph {
  own: ReadonlySet<string>;
  /** Every scanned tx once, by txid */
  txs: ReadonlyMap<string, MempoolTransaction>;
  /** isCoinJoinTx, memoized per txid */
  isCoinJoin: (tx: MempoolTransaction) => boolean;
}

export function buildWalletGraph(infos: readonly WalletAddressInfo[]): WalletGraph {
  const own = new Set(infos.map((i) => i.derived.address));
  const txs = new Map<string, MempoolTransaction>();
  for (const info of infos) for (const tx of info.txs) if (!txs.has(tx.txid)) txs.set(tx.txid, tx);
  const memo = new Map<string, boolean>();
  const isCoinJoin = (tx: MempoolTransaction) => {
    let v = memo.get(tx.txid);
    if (v === undefined) memo.set(tx.txid, (v = isCoinJoinTx(tx)));
    return v;
  };
  return { own, txs, isCoinJoin };
}

export const isOwn = (g: WalletGraph, address: string | undefined): boolean =>
  address !== undefined && g.own.has(address);

/**
 * Where output `vout` of `txid` came from. "unknown" when that tx is not in
 * the scanned history (truncated history): unknown never triggers a finding.
 */
export function coinClass(g: WalletGraph, txid: string, vout: number): CoinClass {
  const tx = g.txs.get(txid);
  const out = tx?.vout[vout];
  if (!tx || !out) return "unknown";
  if (g.isCoinJoin(tx)) {
    return tx.vout.filter((o) => o.value === out.value).length >= 2 ? "mixed" : "coinjoin-change";
  }
  if (!tx.vin.some((v) => isOwn(g, v.prevout?.scriptpubkey_address))) return "received";
  const toxic = detectTx0(tx)?.toxicChange;
  if (toxic && tx.vout.indexOf(toxic) === vout) return "coinjoin-change";
  const paysOthers = tx.vout.some((o) => o.scriptpubkey_address !== undefined && !g.own.has(o.scriptpubkey_address));
  return paysOthers ? "change" : "self";
}

/** Oldest first (unconfirmed last), ties by txid, so finding tx lists are stable. */
function chronological(a: MempoolTransaction, b: MempoolTransaction): number {
  const h = (t: MempoolTransaction) => t.status.block_height ?? Number.MAX_SAFE_INTEGER;
  return h(a) - h(b) || (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : 0);
}

/**
 * Transactions the wallet built alone: every input is the wallet's and it is
 * not a CoinJoin. A tx with any outside input is skipped, never labelled.
 */
export function soloSpends(g: WalletGraph): MempoolTransaction[] {
  return [...g.txs.values()]
    .filter((tx) => tx.vin.length > 0 && tx.vin.every((v) => isOwn(g, v.prevout?.scriptpubkey_address)) && !g.isCoinJoin(tx))
    .sort(chronological);
}

export interface SimplePayment {
  tx: MempoolTransaction;
  change: MempoolVout;
  payment: MempoolVout;
}

/** Solo spends with exactly one output to the wallet (change) and one to someone else; tx0s excluded. */
export function simplePayments(g: WalletGraph, spends: readonly MempoolTransaction[]): SimplePayment[] {
  const out: SimplePayment[] = [];
  for (const tx of spends) {
    const addressed = tx.vout.filter((o) => o.scriptpubkey_address !== undefined);
    const mine = addressed.filter((o) => isOwn(g, o.scriptpubkey_address));
    const theirs = addressed.filter((o) => !isOwn(g, o.scriptpubkey_address));
    if (mine.length !== 1 || theirs.length !== 1 || detectTx0(tx)) continue;
    out.push({ tx, change: mine[0]!, payment: theirs[0]! });
  }
  return out;
}

/** Unspent coins by class: count and sats. */
export function utxoOrigins(g: WalletGraph, infos: readonly WalletAddressInfo[]): OriginCounts {
  const r = Object.fromEntries(COIN_CLASSES.map((c) => [c, { count: 0, sats: 0 }])) as OriginCounts;
  for (const info of infos) {
    for (const u of info.utxos) {
      const slot = r[coinClass(g, u.txid, u.vout)];
      slot.count++;
      slot.sats += u.value;
    }
  }
  return r;
}
```

- [ ] **Step 5: Run, expect PASS.** Run the same test (6 tests pass), then `pnpm type-check && pnpm lint`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/analysis/wallet-behavior.ts src/lib/analysis/__tests__/fixtures/wallet-history.ts src/lib/analysis/__tests__/wallet-behavior.test.ts
git commit -m "feat(wallet): behaviour model - coin origins, solo spends, simple payments"
```

---

### Task 2: W1 post-mix merge and W2 change merge

**Files:**
- Create:
  - `src/lib/analysis/wallet-heuristics.ts`
  - `src/lib/analysis/__tests__/wallet-heuristics.test.ts`
- Modify:
  - `src/lib/analysis/finding-metadata.ts` (Wallet Audit block)
  - `public/locales/{en,es,pt,de,fr,pl}/common.json`
  - `src/lib/__tests__/finding-locale-text.test.ts`
  - `src/lib/__tests__/locale-plural-pl.test.ts`

**Interfaces:**
- Consumes: Task 1 (`WalletGraph`, `coinClass`, and the fixtures).
- Produces:

```ts
export const MAX_TX_REFS = 10;
export function txRefs(txids: readonly string[]): { _txids: string; more: number };
export function checkMerges(g: WalletGraph, spends: readonly MempoolTransaction[]): { findings: Finding[]; merged: Set<string> };
// finding IDs: "wallet-postmix-merge" (params: count, unmixedCount, mixedOnlyCount, _variant "unmixed"|"mixed", _txids, more)
//              "wallet-change-merge"  (params: count, _txids, more)
```

- [ ] **Step 1: Write the failing tests.** Create `src/lib/analysis/__tests__/wallet-heuristics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { History, coinJoin, recv, chg, ext, walletAddrs, type Coin } from "./fixtures/wallet-history";
import { buildWalletGraph, simplePayments, soloSpends } from "../wallet-behavior";
import { checkMerges, txRefs, MAX_TX_REFS } from "../wallet-heuristics";

const run = (h: History, n = 8) => {
  const g = buildWalletGraph(h.infos(walletAddrs(n)));
  const spends = soloSpends(g);
  return { g, spends, payments: simplePayments(g, spends) };
};

/** A payment from `coin` paying `value` out, change to `changeTo`. */
const pay = (h: History, coin: Coin, value: number, changeTo: string, height: number, to = ext(height)) =>
  h.tx([coin], [{ address: to, value }, { address: changeTo, value: coin.value - value - 1_000 }], height);

describe("txRefs", () => {
  it("caps the list and counts the rest", () => {
    const ids = Array.from({ length: 13 }, (_, i) => String(i));
    expect(JSON.parse(txRefs(ids)._txids)).toHaveLength(MAX_TX_REFS);
    expect(txRefs(ids).more).toBe(3);
    expect(txRefs(["a"]).more).toBe(0);
  });
});

describe("checkMerges", () => {
  it("W1 unmixed: a mixed output spent with change is critical -15, and not also a change merge", () => {
    const h = new History();
    const r = h.receive(recv(0), 2_000_000, 100);
    const cj = coinJoin(h, r, 1_000_000, recv(1), chg(0), 101);
    const [, change] = pay(h, h.receive(recv(2), 500_000, 102), 100_001, chg(1), 103);
    const m = h.tx([cj[0]!, change!], [{ address: ext(1), value: 1_300_000 }], 104);
    const { findings, merged } = checkMerges(run(h).g, run(h).spends);
    expect(findings.map((f) => [f.id, f.severity, f.scoreImpact])).toEqual([["wallet-postmix-merge", "critical", -15]]);
    expect(findings[0]!.params).toMatchObject({ _variant: "unmixed", unmixedCount: 1, mixedOnlyCount: 0, count: 1 });
    expect(JSON.parse(String(findings[0]!.params!._txids))).toEqual([m[0]!.txid]);
    expect([...merged]).toEqual([m[0]!.txid]);
  });

  it("W1 mixed-only: two outputs of the same CoinJoin merged is high -8; two such spends -12", () => {
    const h = new History();
    const r = h.receive(recv(0), 3_000_000, 100);
    const others = [1, 2, 3].map((i) => ({ address: ext(70 + i), value: 1_050_000 }));
    const cj = h.tx([r, ...others], [recv(1), recv(2), ext(80), ext(81), ext(82)].map((address) => ({ address, value: 1_000_000 })), 101);
    h.tx([cj[0]!, cj[1]!], [{ address: ext(1), value: 1_990_000 }], 102);
    let f = checkMerges(run(h).g, run(h).spends).findings;
    expect(f.map((x) => [x.id, x.severity, x.scoreImpact, x.params?._variant])).toEqual([["wallet-postmix-merge", "high", -8, "mixed"]]);

    const r2 = h.receive(recv(3), 3_000_000, 103);
    const cj2 = h.tx([r2, ...others], [recv(4), recv(5), ext(83), ext(84), ext(85)].map((address) => ({ address, value: 1_000_000 })), 104);
    h.tx([cj2[0]!, cj2[1]!], [{ address: ext(2), value: 1_990_000 }], 105);
    f = checkMerges(run(h).g, run(h).spends).findings;
    expect(f[0]!.scoreImpact).toBe(-12);
  });

  it("W1: an unknown-origin input does not make the merge 'unmixed'", () => {
    const h = new History();
    const r = h.receive(recv(0), 2_000_000, 100);
    const cj = coinJoin(h, r, 1_000_000, recv(1), chg(0), 101);
    // recv(2) holds a coin whose funding tx is outside the scanned history
    h.tx([cj[0]!, { txid: "e".repeat(64), vout: 0, address: recv(2), value: 50_000 }], [{ address: ext(1), value: 1_040_000 }], 102);
    const f = checkMerges(run(h).g, run(h).spends).findings;
    expect(f[0]!.params?._variant).toBe("mixed");
  });

  it("W2: change merged with a receipt is medium -4; 2 spends high -7; 5 spends high -10", () => {
    const h = new History();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const [, change] = pay(h, h.receive(recv(i * 2), 1_000_000, 100 + i * 10), 200_007, chg(i), 101 + i * 10);
      const other = h.receive(recv(i * 2 + 1), 300_000, 102 + i * 10);
      ids.push(h.tx([change!, other], [{ address: ext(200 + i), value: 1_090_000 }], 103 + i * 10)[0]!.txid);
      const f = checkMerges(run(h, 12).g, run(h, 12).spends).findings;
      expect(f).toHaveLength(1);
      expect(f[0]!.id).toBe("wallet-change-merge");
      expect([f[0]!.severity, f[0]!.scoreImpact]).toEqual(i === 0 ? ["medium", -4] : i < 4 ? ["high", -7] : ["high", -10]);
    }
    expect(JSON.parse(String(checkMerges(run(h, 12).g, run(h, 12).spends).findings[0]!.params!._txids))).toEqual(ids);
  });

  it("W2 ignores merges of outputs of one tx and receipts-only merges", () => {
    const h = new History();
    const r = h.receive(recv(0), 1_000_000, 100);
    const out = h.tx([r], [{ address: ext(1), value: 100_007 }, { address: chg(0), value: 400_000 }, { address: chg(1), value: 498_000 }], 101);
    h.tx([out[1]!, out[2]!], [{ address: ext(2), value: 897_000 }], 102);
    h.tx([h.receive(recv(1), 100_000, 103), h.receive(recv(2), 100_000, 104)], [{ address: ext(3), value: 199_000 }], 105);
    const { findings, merged } = checkMerges(run(h).g, run(h).spends);
    expect(findings).toEqual([]);
    expect(merged.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
  - Run: `pnpm vitest run src/lib/analysis/__tests__/wallet-heuristics.test.ts`
  - Expected: FAIL, cannot resolve `../wallet-heuristics`.

- [ ] **Step 3: Register the IDs.** In `src/lib/analysis/finding-metadata.ts`, after `"wallet-consolidation-history"`, add:

```ts
  "wallet-postmix-merge":         { adversaryTiers: [P, K, S], temporality: "historical" },
  "wallet-change-merge":          { adversaryTiers: [P, K],    temporality: "historical" },
```

- [ ] **Step 4: Implement.** Create `src/lib/analysis/wallet-heuristics.ts`:

```ts
/**
 * Wallet-level heuristics: behaviours that only exist across the wallet's
 * history (merges, change exposure, peel chains). docs/spec-wallet-heuristics.md
 */
import type { Finding } from "@/lib/types";
import { coinClass, type WalletGraph } from "./wallet-behavior";
import type { MempoolTransaction } from "@/lib/api/types";

/** Txids listed on a finding card; the rest are counted in `more`. */
export const MAX_TX_REFS = 10;

export function txRefs(txids: readonly string[]): { _txids: string; more: number } {
  return { _txids: JSON.stringify(txids.slice(0, MAX_TX_REFS)), more: Math.max(0, txids.length - MAX_TX_REFS) };
}

/**
 * W1 post-mix merge and W2 change merge. Each spend counts once, under the
 * worse of the two; `merged` lets the consolidation check skip them.
 */
export function checkMerges(g: WalletGraph, spends: readonly MempoolTransaction[]): { findings: Finding[]; merged: Set<string> } {
  const unmixed: string[] = [];
  const mixedOnly: string[] = [];
  const change: string[] = [];
  for (const tx of spends) {
    if (tx.vin.length < 2) continue;
    const classes = tx.vin.map((v) => coinClass(g, v.txid, v.vout));
    if (classes.includes("mixed")) {
      (classes.some((c) => c !== "mixed" && c !== "unknown") ? unmixed : mixedOnly).push(tx.txid);
    } else if (new Set(tx.vin.map((v) => v.txid)).size >= 2 && classes.some((c) => c === "change" || c === "coinjoin-change")) {
      change.push(tx.txid);
    }
  }

  const findings: Finding[] = [];
  const postmix = [...unmixed, ...mixedOnly];
  if (postmix.length > 0) {
    const worst = unmixed.length > 0;
    const count = postmix.length;
    findings.push({
      id: "wallet-postmix-merge",
      severity: worst ? "critical" : "high",
      confidence: "high",
      title: worst
        ? `${count} spend${count > 1 ? "s" : ""} merged CoinJoin outputs with unmixed coins`
        : `${count} spend${count > 1 ? "s" : ""} merged several CoinJoin outputs`,
      description: worst
        ? "CoinJoin outputs were spent together with coins that were never mixed (CoinJoin change, change or received coins). " +
          "The common-input heuristic links each mixed output to the unmixed coin's history, which largely undoes the CoinJoin for it."
        : "Several CoinJoin outputs were spent together. Each was hidden among its round's peers; spent together, " +
          "their possible histories intersect and the anonymity of each output shrinks.",
      recommendation: worst
        ? "Spend each CoinJoin output on its own, never in the same transaction as unmixed coins or CoinJoin change. " +
          "Freeze CoinJoin change and unmixed coins with coin control and spend or remix them separately."
        : "Spend one CoinJoin output per transaction. When a payment needs more, use a collaborative transaction " +
          "(Stonewall, PayJoin with a recipient that supports it) instead of merging mixed outputs.",
      scoreImpact: worst ? (unmixed.length > 1 ? -20 : -15) : (mixedOnly.length > 1 ? -12 : -8),
      params: { count, unmixedCount: unmixed.length, mixedOnlyCount: mixedOnly.length, _variant: worst ? "unmixed" : "mixed", ...txRefs(postmix) },
    });
  }
  if (change.length > 0) {
    const count = change.length;
    findings.push({
      id: "wallet-change-merge",
      severity: count > 1 ? "high" : "medium",
      confidence: "high",
      title: `${count} spend${count > 1 ? "s" : ""} merged change with other coins`,
      description:
        "Change from an earlier payment was spent together with a coin from a different transaction. " +
        "Whoever identified that change, including the earlier payment's recipient, now also sees the other coin and its history, " +
        "and every address involved joins one cluster.",
      recommendation:
        "Use coin control: spend change on its own or with coins from the same transaction. " +
        "When a payment needs more, spend the change completely in a payment that leaves no new change, or run it through a CoinJoin first.",
      scoreImpact: count >= 5 ? -10 : count > 1 ? -7 : -4,
      params: { count, ...txRefs(change) },
    });
  }
  return { findings, merged: new Set([...postmix, ...change]) };
}
```

- [ ] **Step 5: Run, expect PASS** (6 tests).

- [ ] **Step 6: Copy, 6 locales.** Add to `public/locales/en/common.json` next to the other `finding.wallet-*` keys. The values are verbatim from the spec, "Copy and remediation":

```json
  "finding.wallet-postmix-merge.title.unmixed_one": "{{count}} spend merged CoinJoin outputs with unmixed coins",
  "finding.wallet-postmix-merge.title.unmixed_other": "{{count}} spends merged CoinJoin outputs with unmixed coins",
  "finding.wallet-postmix-merge.description.unmixed": "CoinJoin outputs were spent together with coins that were never mixed (CoinJoin change, change or received coins). The common-input heuristic links each mixed output to the unmixed coin's history, which largely undoes the CoinJoin for it.",
  "finding.wallet-postmix-merge.recommendation.unmixed": "Spend each CoinJoin output on its own, never in the same transaction as unmixed coins or CoinJoin change. Freeze CoinJoin change and unmixed coins with coin control and spend or remix them separately.",
  "finding.wallet-postmix-merge.title.mixed_one": "{{count}} spend merged several CoinJoin outputs",
  "finding.wallet-postmix-merge.title.mixed_other": "{{count}} spends merged several CoinJoin outputs",
  "finding.wallet-postmix-merge.description.mixed": "Several CoinJoin outputs were spent together. Each was hidden among its round's peers; spent together, their possible histories intersect and the anonymity of each output shrinks.",
  "finding.wallet-postmix-merge.recommendation.mixed": "Spend one CoinJoin output per transaction. When a payment needs more, use a collaborative transaction (Stonewall, PayJoin with a recipient that supports it) instead of merging mixed outputs.",
  "finding.wallet-change-merge.title_one": "{{count}} spend merged change with other coins",
  "finding.wallet-change-merge.title_other": "{{count}} spends merged change with other coins",
  "finding.wallet-change-merge.description": "Change from an earlier payment was spent together with a coin from a different transaction. Whoever identified that change, including the earlier payment's recipient, now also sees the other coin and its history, and every address involved joins one cluster.",
  "finding.wallet-change-merge.recommendation": "Use coin control: spend change on its own or with coins from the same transaction. When a payment needs more, spend the change completely in a payment that leaves no new change, or run it through a CoinJoin first.",
```

  Translate the same keys into `es`, `pt`, `de` and `fr`. For `pl`, replace every `_other` title key with `_one`, `_few`, `_many` and `_other`. Rules:
  - Spanish: Castilian tuteo.
  - Keep "CoinJoin", "PayJoin" and "Stonewall" untranslated.
  - Keep every `{{placeholder}}`.
  - No em dashes.
  - Use the same term the locale already uses for "change" (`wallet.coinSel.change`) and "coin control" (grep the locale).

  The Polish change-merge titles are pinned by the plural test:
  - `_one`: `"{{count}} wydatek połączył resztę z innymi monetami"`
  - `_few`: `"{{count}} wydatki połączyły resztę z innymi monetami"`
  - `_many`: `"{{count}} wydatków połączyło resztę z innymi monetami"`
  - `_other`: `"{{count}} wydatku połączyło resztę z innymi monetami"`

- [ ] **Step 7: Locale tests.** Append to `src/lib/__tests__/finding-locale-text.test.ts`, after its last `describe` block. Add the import at the top with the other imports: `import { History, coinJoin, recv, chg, ext, walletAddrs } from "../analysis/__tests__/fixtures/wallet-history";` and `import { buildWalletGraph, soloSpends } from "../analysis/wallet-behavior";` and `import { checkMerges } from "../analysis/wallet-heuristics";`.

```ts
describe("wallet merge findings render in every locale", () => {
  const merges = () => {
    const h = new History();
    const r = h.receive(recv(0), 2_000_000, 100);
    const cj = coinJoin(h, r, 1_000_000, recv(1), chg(0), 101);
    const [, change] = h.tx([h.receive(recv(2), 1_000_000, 102)], [{ address: ext(1), value: 200_007 }, { address: chg(1), value: 798_000 }], 103);
    h.tx([cj[0]!, change!], [{ address: ext(2), value: 1_790_000 }], 104); // W1 unmixed
    const [, c2] = h.tx([h.receive(recv(3), 1_000_000, 105)], [{ address: ext(3), value: 200_007 }, { address: chg(2), value: 798_000 }], 106);
    h.tx([c2!, h.receive(recv(4), 100_000, 107)], [{ address: ext(4), value: 890_000 }], 108); // W2
    const g = buildWalletGraph(h.infos(walletAddrs(5)));
    return checkMerges(g, soloSpends(g)).findings;
  };

  it("English locale text equals the code's English text", () => {
    for (const f of merges()) {
      expect(render(f).title).toBe(f.title);
      expect(render(f).description).toBe(f.description);
      expect(render(f).recommendation).toBe(f.recommendation);
    }
  });

  it("every locale resolves title, description and recommendation", () => {
    for (const f of merges()) {
      for (const lng of LANGS) {
        const text = render(f, lng);
        for (const v of Object.values(text)) {
          expect(v).not.toMatch(/\{\{|^finding\./);
        }
        if (lng !== "en") expect(text.description).not.toBe(f.description);
      }
    }
  });
});
```

  Append inside the existing `it(...)` of `src/lib/__tests__/locale-plural-pl.test.ts`:

```ts
    const merge = (count: number) => i18n.t("finding.wallet-change-merge.title", { count });
    expect(merge(1)).toBe("1 wydatek połączył resztę z innymi monetami");
    expect(merge(3)).toBe("3 wydatki połączyły resztę z innymi monetami");
    expect(merge(5)).toBe("5 wydatków połączyło resztę z innymi monetami");
```

- [ ] **Step 8: Run.**
  - Run: `pnpm vitest run src/lib/analysis/__tests__/wallet-heuristics.test.ts src/lib/__tests__/finding-locale-text.test.ts src/lib/__tests__/locale-plural-pl.test.ts src/lib/__tests__/locale-parity.test.ts src/lib/analysis/__tests__/finding-metadata.test.ts`
  - Expected: PASS. Then `pnpm type-check && pnpm lint`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/analysis/wallet-heuristics.ts src/lib/analysis/__tests__/wallet-heuristics.test.ts src/lib/analysis/finding-metadata.ts public/locales/*/common.json src/lib/__tests__/finding-locale-text.test.ts src/lib/__tests__/locale-plural-pl.test.ts
git commit -m "feat(wallet): post-mix merge and change merge heuristics"
```

---

### Task 3: W3 change exposure, W4 peel chain, W5 coins kept apart

**Files:**
- Modify:
  - `src/lib/analysis/wallet-heuristics.ts`
  - `src/lib/analysis/__tests__/wallet-heuristics.test.ts`
  - `src/lib/analysis/finding-metadata.ts`
  - `public/locales/{en,es,pt,de,fr,pl}/common.json`
  - `src/lib/__tests__/finding-locale-text.test.ts`

**Interfaces:**
- Consumes:
  - Task 1 (`SimplePayment`, `simplePayments`) and Task 2 (`txRefs`);
  - `getAddressType` from `@/lib/bitcoin/address-type`;
  - `isRoundAmount` from `./heuristics/round-amount`.
- Produces:

```ts
export function checkChangeExposure(payments: readonly SimplePayment[]): Finding[]; // "wallet-change-exposed": exposed, payments, ratio, byType, byRound, byOptimal, _txids, more
export function checkPeelChains(payments: readonly SimplePayment[]): Finding[];     // "wallet-peel-chain": count, chains, _txids, more
export function checkNoMerge(spendCount: number, anyMerge: boolean): Finding[];     // "wallet-no-merge": count
```

- [ ] **Step 1: Write the failing tests.** In `wallet-heuristics.test.ts`:
  - change the imports to `import { checkMerges, checkChangeExposure, checkPeelChains, checkNoMerge, txRefs, MAX_TX_REFS } from "../wallet-heuristics";`;
  - add `extTaproot` to the fixture import;
  - append:

```ts
describe("checkChangeExposure", () => {
  it("counts only rules that point at the real change, by ratio", () => {
    const h = new History();
    // type: payment to Taproot, change P2WPKH like the input
    pay(h, h.receive(recv(0), 1_000_000, 100), 123_457, chg(0), 101, extTaproot(1));
    // round payment, non-round change
    pay(h, h.receive(recv(1), 1_000_000, 102), 200_000, chg(1), 103);
    // optimal: change 48,000 below both inputs, payment above
    h.tx([h.receive(recv(2), 500_000, 104), h.receive(recv(3), 600_000, 105)], [{ address: ext(2), value: 1_051_003 }, { address: chg(2), value: 48_000 }], 106);
    // not exposed: same types, non-round, single input
    pay(h, h.receive(recv(4), 1_000_000, 107), 123_457, chg(3), 108);
    // a rule that would point at the payment does not count: round change, non-round payment
    pay(h, h.receive(recv(5), 1_001_000, 109), 123_457, chg(4), 110);
    const { payments } = run(h);
    expect(payments).toHaveLength(5);
    const [f] = checkChangeExposure(payments);
    expect(f!.params).toMatchObject({ exposed: 3, payments: 5, ratio: 60, byType: 1, byRound: 1, byOptimal: 1 });
    expect([f!.severity, f!.scoreImpact]).toEqual(["high", -6]);
  });

  it("medium above 20%, low otherwise, nothing when none exposed", () => {
    const h = new History();
    pay(h, h.receive(recv(0), 1_000_000, 100), 200_000, chg(0), 101); // exposed (round)
    for (let i = 1; i < 5; i++) pay(h, h.receive(recv(i), 1_000_000, 100 + i * 2), 123_457, chg(i), 101 + i * 2);
    expect(checkChangeExposure(run(h).payments)[0]!.scoreImpact).toBe(-2); // 1 of 5 = 20%, not above
    pay(h, h.receive(recv(6), 1_000_000, 120), 300_000, chg(6), 121);
    expect(checkChangeExposure(run(h).payments)[0]!.scoreImpact).toBe(-4); // 2 of 6
    expect(checkChangeExposure([])).toEqual([]);
  });
});

describe("checkPeelChains", () => {
  const chain = (h: History, start: Coin, n: number, changeBase: number, height: number) => {
    let coin = start;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const out = pay(h, coin, 10_007 + i, chg(changeBase + i), height + i);
      ids.push(out[0]!.txid);
      coin = out[1]!;
    }
    return ids;
  };

  it("no finding below 3 payments; medium -3 at 3; high -6 at 6; reports the longest chain in order", () => {
    const h = new History();
    chain(h, h.receive(recv(0), 5_000_000, 100), 2, 0, 101);
    expect(checkPeelChains(run(h, 20).payments)).toEqual([]);

    const ids3 = chain(h, h.receive(recv(1), 5_000_000, 110), 3, 2, 111);
    let [f] = checkPeelChains(run(h, 20).payments);
    expect([f!.severity, f!.scoreImpact, f!.params?.count, f!.params?.chains]).toEqual(["medium", -3, 3, 1]);
    expect(JSON.parse(String(f!.params!._txids))).toEqual(ids3);

    const ids6 = chain(h, h.receive(recv(2), 5_000_000, 120), 6, 5, 121);
    [f] = checkPeelChains(run(h, 20).payments);
    expect([f!.severity, f!.scoreImpact, f!.params?.count, f!.params?.chains]).toEqual(["high", -6, 6, 2]);
    expect(JSON.parse(String(f!.params!._txids))).toEqual(ids6);
  });

  it("a multi-input payment breaks the chain", () => {
    const h = new History();
    const [, c0] = pay(h, h.receive(recv(0), 5_000_000, 100), 10_007, chg(0), 101);
    const [, c1] = pay(h, c0!, 10_009, chg(1), 102);
    const [, c2] = h.tx([c1!, h.receive(recv(1), 50_000, 103)], [{ address: ext(1), value: 60_011 }, { address: chg(2), value: c1!.value - 11_000 }], 104);
    pay(h, c2!, 10_013, chg(3), 105);
    expect(checkPeelChains(run(h).payments)).toEqual([]);
  });
});

describe("checkNoMerge", () => {
  it("rewards 3+ spends without merges", () => {
    expect(checkNoMerge(3, false).map((f) => [f.id, f.severity, f.scoreImpact])).toEqual([["wallet-no-merge", "good", 3]]);
    expect(checkNoMerge(2, false)).toEqual([]);
    expect(checkNoMerge(5, true)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`checkChangeExposure` is not exported).

- [ ] **Step 3: Register the IDs** in `finding-metadata.ts`, after the Task 2 lines:

```ts
  "wallet-change-exposed":        { adversaryTiers: [P],       temporality: "ongoing_pattern" },
  "wallet-peel-chain":            { adversaryTiers: [P, K],    temporality: "ongoing_pattern" },
  "wallet-no-merge":              { adversaryTiers: [P],       temporality: "ongoing_pattern" },
```

- [ ] **Step 4: Implement.** In `wallet-heuristics.ts`, change the imports to:

```ts
import type { Finding, Severity } from "@/lib/types";
import { getAddressType } from "@/lib/bitcoin/address-type";
import { isRoundAmount } from "./heuristics/round-amount";
import { coinClass, type SimplePayment, type WalletGraph } from "./wallet-behavior";
import type { MempoolTransaction } from "@/lib/api/types";
```

  Then append:

```ts
/** W3: in how many simple payments a standard change rule points at the real change. */
export function checkChangeExposure(payments: readonly SimplePayment[]): Finding[] {
  let byType = 0, byRound = 0, byOptimal = 0;
  const exposedTxids: string[] = [];
  for (const { tx, change, payment } of payments) {
    const ct = getAddressType(change.scriptpubkey_address!);
    const type = ct !== getAddressType(payment.scriptpubkey_address!)
      && tx.vin.every((v) => getAddressType(v.prevout!.scriptpubkey_address!) === ct);
    const round = isRoundAmount(payment.value) && !isRoundAmount(change.value);
    const minIn = Math.min(...tx.vin.map((v) => v.prevout!.value));
    const optimal = tx.vin.length >= 2 && change.value < minIn && payment.value >= minIn;
    if (type) byType++;
    if (round) byRound++;
    if (optimal) byOptimal++;
    if (type || round || optimal) exposedTxids.push(tx.txid);
  }
  const exposed = exposedTxids.length;
  if (exposed === 0) return [];
  const ratio = exposed / payments.length;
  const [severity, scoreImpact]: [Severity, number] = ratio > 0.5 ? ["high", -6] : ratio > 0.2 ? ["medium", -4] : ["low", -2];
  return [{
    id: "wallet-change-exposed",
    severity,
    confidence: "high",
    title: `${exposed} of ${payments.length} payments revealed their change`,
    description:
      `In ${exposed} of ${payments.length} simple payments a standard change-detection rule pointed at the real change output: ` +
      `address type (${byType}), round payment amount (${byRound}), or change smaller than every input (${byOptimal}). ` +
      "Anyone applying these rules can follow the wallet's change from payment to payment.",
    recommendation:
      "Use a wallet that gives change the payment's address type (Bitcoin Core does), avoid round payment amounts, " +
      "and prefer changeless payments (exact-amount coin selection) or spend one coin that covers the payment.",
    scoreImpact,
    params: { exposed, payments: payments.length, ratio: Math.round(ratio * 100), byType, byRound, byOptimal, ...txRefs(exposedTxids) },
  }];
}

/** W4: payments that each spend only the previous payment's change. */
export function checkPeelChains(payments: readonly SimplePayment[]): Finding[] {
  const steps = new Map(payments.filter((p) => p.tx.vin.length === 1).map((p) => [p.tx.txid, p.tx]));
  const prevOf = new Map<string, string>();
  for (const tx of steps.values()) {
    const parent = tx.vin[0]!.txid;
    // A payment's only wallet output is its change, so a step spending a step spends its change
    if (steps.has(parent)) prevOf.set(tx.txid, parent);
  }
  const len = new Map<string, number>();
  const depth = (id: string): number => {
    const path: string[] = [];
    let cur: string | undefined = id;
    while (cur !== undefined && !len.has(cur)) { path.push(cur); cur = prevOf.get(cur); }
    let d = cur !== undefined ? len.get(cur)! : 0;
    for (let i = path.length - 1; i >= 0; i--) len.set(path[i]!, ++d);
    return len.get(id)!;
  };
  const parents = new Set(prevOf.values());
  const tails = [...steps.keys()].filter((id) => !parents.has(id));
  const long = tails.filter((id) => depth(id) >= 3);
  if (long.length === 0) return [];
  const end = long.reduce((a, b) => (depth(b) > depth(a) ? b : a));
  const chain: string[] = [];
  for (let cur: string | undefined = end; cur !== undefined; cur = prevOf.get(cur)) chain.unshift(cur);
  const count = chain.length;
  return [{
    id: "wallet-peel-chain",
    severity: count >= 6 ? "high" : "medium",
    confidence: "high",
    title: `Peel chain of ${count} payments`,
    description:
      `${count} payments in a row each spent only the change of the previous one. ` +
      `Anyone who identifies one payment in the chain can follow the rest. Chains of 3 or more payments: ${long.length}.`,
    recommendation:
      "Break the chain: pay from a different coin, spend exact amounts so no change is left, " +
      "run the change through a CoinJoin before the next payment, or use PayJoin or Stonewall when available.",
    scoreImpact: count >= 6 ? -6 : -3,
    params: { count, chains: long.length, ...txRefs(chain) },
  }];
}

/** Good practice: 3+ solo spends and none merged change, CoinJoin outputs or many coins. */
export function checkNoMerge(spendCount: number, anyMerge: boolean): Finding[] {
  if (spendCount < 3 || anyMerge) return [];
  return [{
    id: "wallet-no-merge",
    severity: "good",
    confidence: "high",
    title: `Coins kept apart in ${spendCount} spends`,
    description:
      `None of the wallet's ${spendCount} spends merged change, CoinJoin outputs or many coins into one transaction. ` +
      "Keeping coins apart limits what each payment reveals.",
    recommendation: "Keep using coin control.",
    scoreImpact: 3,
    params: { count: spendCount },
  }];
}
```

- [ ] **Step 5: Run, expect PASS** (all of `wallet-heuristics.test.ts`, 11 tests).

- [ ] **Step 6: Copy, 6 locales.** `en` (verbatim from the spec):

```json
  "finding.wallet-change-exposed.title": "{{exposed}} of {{payments}} payments revealed their change",
  "finding.wallet-change-exposed.description": "In {{exposed}} of {{payments}} simple payments a standard change-detection rule pointed at the real change output: address type ({{byType}}), round payment amount ({{byRound}}), or change smaller than every input ({{byOptimal}}). Anyone applying these rules can follow the wallet's change from payment to payment.",
  "finding.wallet-change-exposed.recommendation": "Use a wallet that gives change the payment's address type (Bitcoin Core does), avoid round payment amounts, and prefer changeless payments (exact-amount coin selection) or spend one coin that covers the payment.",
  "finding.wallet-peel-chain.title_one": "Peel chain of {{count}} payment",
  "finding.wallet-peel-chain.title_other": "Peel chain of {{count}} payments",
  "finding.wallet-peel-chain.description": "{{count}} payments in a row each spent only the change of the previous one. Anyone who identifies one payment in the chain can follow the rest. Chains of 3 or more payments: {{chains}}.",
  "finding.wallet-peel-chain.recommendation": "Break the chain: pay from a different coin, spend exact amounts so no change is left, run the change through a CoinJoin before the next payment, or use PayJoin or Stonewall when available.",
  "finding.wallet-no-merge.title_one": "Coins kept apart in {{count}} spend",
  "finding.wallet-no-merge.title_other": "Coins kept apart in {{count}} spends",
  "finding.wallet-no-merge.description": "None of the wallet's {{count}} spends merged change, CoinJoin outputs or many coins into one transaction. Keeping coins apart limits what each payment reveals.",
  "finding.wallet-no-merge.recommendation": "Keep using coin control.",
```

  Translate into es, pt, de, fr and pl (pl `_one/_few/_many/_other` for the two title keys) with the Task 2 rules.

- [ ] **Step 7: Locale tests.** In `finding-locale-text.test.ts`:
  - extend the wallet-history import with `goldenWallet`;
  - merge `simplePayments` into the wallet-behavior import;
  - add `checkChangeExposure, checkPeelChains, checkNoMerge` to the wallet-heuristics import. `auditWallet` is not wired until Task 4, so the findings are built directly.
  - append:

```ts
describe("wallet pattern findings render in every locale", () => {
  const patterns = () => {
    const infos = goldenWallet();
    const g = buildWalletGraph(infos);
    const payments = simplePayments(g, soloSpends(g));
    return [...checkChangeExposure(payments), ...checkPeelChains(payments), ...checkNoMerge(3, false)];
  };

  it("English locale text equals the code's English text", () => {
    const fs = patterns();
    expect(fs.map((f) => f.id)).toEqual(["wallet-change-exposed", "wallet-peel-chain", "wallet-no-merge"]);
    for (const f of fs) {
      expect(render(f).title).toBe(f.title);
      expect(render(f).description).toBe(f.description);
      expect(render(f).recommendation).toBe(f.recommendation);
    }
  });

  it("every locale resolves title, description and recommendation", () => {
    for (const f of patterns()) {
      for (const lng of LANGS) {
        for (const v of Object.values(render(f, lng))) expect(v).not.toMatch(/\{\{|^finding\./);
      }
    }
  });
});
```

- [ ] **Step 8: Run** the Task 2 Step 8 command. Expect PASS, then type-check and lint.

- [ ] **Step 9: Commit**

```bash
git add src/lib/analysis/wallet-heuristics.ts src/lib/analysis/__tests__/wallet-heuristics.test.ts src/lib/analysis/finding-metadata.ts public/locales/*/common.json src/lib/__tests__/finding-locale-text.test.ts
git commit -m "feat(wallet): change exposure, peel chain and coins-kept-apart heuristics"
```

---

### Task 4: Wire into auditWallet, golden wallets

**Files:**
- Modify:
  - `src/lib/analysis/wallet-audit.ts`
  - `src/lib/analysis/__tests__/wallet-audit.test.ts`
  - `cli/__tests__/output-formatter.test.ts`
  - `cli/__tests__/output-json.test.ts` (result literals gain `utxoOrigins`)
- Create: `src/lib/analysis/__tests__/wallet-golden.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: `WalletAuditResult.utxoOrigins: OriginCounts` (new required field), and the full set of wallet findings from `auditWallet`.

- [ ] **Step 1: Write the failing tests.** Create `src/lib/analysis/__tests__/wallet-golden.test.ts`:

```ts
/**
 * Golden wallets: synthetic offline histories through the full wallet audit.
 * Pins grade, score and every finding with its impact (docs/spec-wallet-heuristics.md, Scoring).
 * A change here is a scoring change: justify it in the commit and in docs/testing-reference.md.
 */
import { describe, it, expect } from "vitest";
import { auditWallet } from "../wallet-audit";
import { goldenWallet, cleanWallet } from "./fixtures/wallet-history";

const pin = (r: ReturnType<typeof auditWallet>) => ({
  grade: r.grade,
  score: r.score,
  findings: r.findings.map((f) => `${f.id} ${f.scoreImpact}`).sort(),
});

describe("golden wallets", () => {
  it("golden wallet: C 52", () => {
    expect(pin(auditWallet(goldenWallet()))).toEqual({
      grade: "C",
      score: 52,
      findings: [
        "wallet-change-exposed -4",
        "wallet-change-merge -4",
        "wallet-no-reuse 5",
        "wallet-peel-chain -3",
        "wallet-postmix-merge -15",
        "wallet-uniform-script 3",
      ],
    });
  });

  it("clean wallet: B 81", () => {
    expect(pin(auditWallet(cleanWallet()))).toEqual({
      grade: "B",
      score: 81,
      findings: ["wallet-no-merge 3", "wallet-no-reuse 5", "wallet-uniform-script 3"],
    });
  });

  it("golden wallet coin origins", () => {
    const o = auditWallet(goldenWallet()).utxoOrigins;
    expect(o["coinjoin-change"]).toEqual({ count: 1, sats: 995_000 });
    expect(o.change).toEqual({ count: 1, sats: 2_547_000 });
  });
});
```

  Add the import `import { History, recv, chg, ext, walletAddrs } from "./fixtures/wallet-history";` to `wallet-audit.test.ts`, then append:

```ts
describe("auditWallet: wallet heuristics", () => {
  it("a merge counted as change merge is not also a consolidation", () => {
    const h = new History();
    const [, change] = h.tx([h.receive(recv(0), 1_000_000, 100)], [{ address: ext(1), value: 200_007 }, { address: chg(0), value: 798_000 }], 101);
    h.tx([change!, h.receive(recv(1), 100_000, 102), h.receive(recv(2), 100_000, 103)], [{ address: ext(2), value: 990_000 }], 104);
    const ids = auditWallet(h.infos(walletAddrs(3))).findings.map((f) => f.id);
    expect(ids).toContain("wallet-change-merge");
    expect(ids).not.toContain("wallet-consolidation-history");
  });

  it("an empty wallet gets no wallet-heuristic findings and zero origins", () => {
    const r = auditWallet([]);
    expect(r.findings).toEqual([]);
    expect(r.score).toBe(70);
    expect(r.utxoOrigins.received).toEqual({ count: 0, sats: 0 });
  });

  it("new findings carry metadata", () => {
    const h = new History();
    const [, change] = h.tx([h.receive(recv(0), 1_000_000, 100)], [{ address: ext(1), value: 200_007 }, { address: chg(0), value: 798_000 }], 101);
    h.tx([change!, h.receive(recv(1), 100_000, 102)], [{ address: ext(2), value: 890_000 }], 103);
    const f = auditWallet(h.infos(walletAddrs(2))).findings.find((x) => x.id === "wallet-change-merge");
    expect(f?.adversaryTiers).toEqual(["passive_observer", "kyc_exchange"]);
    expect(f?.temporality).toBe("historical");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
  - Run: `pnpm vitest run src/lib/analysis/__tests__/wallet-golden.test.ts src/lib/analysis/__tests__/wallet-audit.test.ts`
  - Expected: the golden tests fail (no wallet-heuristic findings, `utxoOrigins` undefined).

- [ ] **Step 3: Implement** in `src/lib/analysis/wallet-audit.ts`:

```ts
// imports (after the DerivedAddress import)
import { buildWalletGraph, simplePayments, soloSpends, utxoOrigins, type OriginCounts } from "./wallet-behavior";
import { checkChangeExposure, checkMerges, checkNoMerge, checkPeelChains } from "./wallet-heuristics";

// WalletAuditResult: add after dustUtxos
  /** Unspent coins by origin class (count, sats) */
  utxoOrigins: OriginCounts;

// checkSpendingPatterns: new signature and skip
function checkSpendingPatterns(addresses: WalletAddressInfo[], exclude: ReadonlySet<string>): Finding[] {
  ...
      if (allTxIds.has(tx.txid) || exclude.has(tx.txid)) continue;

// auditWallet: replace the two lines
//   findings.push(...checkSpendingPatterns(addresses));
//   findings.push(...checkGoodPractices(addresses));
// with
  const graph = buildWalletGraph(addresses);
  const spends = soloSpends(graph);
  const payments = simplePayments(graph, spends);
  const merges = checkMerges(graph, spends);
  findings.push(...merges.findings);
  findings.push(...checkChangeExposure(payments));
  findings.push(...checkPeelChains(payments));
  const consolidations = checkSpendingPatterns(addresses, merges.merged);
  findings.push(...consolidations);
  findings.push(...checkGoodPractices(addresses));
  findings.push(...checkNoMerge(spends.length, merges.merged.size > 0 || consolidations.length > 0));

// return object: add after dustUtxos
    utxoOrigins: utxoOrigins(graph, addresses),
```

  Also update the file's header comment "Checks:" list with: merges (post-mix, change), change exposure, peel chains (docs/spec-wallet-heuristics.md).

  In `cli/__tests__/output-formatter.test.ts` and `cli/__tests__/output-json.test.ts`:
  - add `import { buildWalletGraph, utxoOrigins } from "@/lib/analysis/wallet-behavior";`;
  - add `utxoOrigins: utxoOrigins(buildWalletGraph([]), []),` to every `WalletAuditResult` literal (3 literals).

- [ ] **Step 4: Run, expect PASS.**
  - Run: `pnpm vitest run src/lib/analysis src/lib/__tests__`
  - Expected: PASS. The golden values are C 52 and B 81, exactly. A different value means an implementation deviates from Tasks 1-3: fix the code, not the expectation.
  - Then `pnpm type-check && pnpm lint && (cd cli && pnpm install --frozen-lockfile && pnpm type-check && pnpm test)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analysis/wallet-audit.ts src/lib/analysis/__tests__/wallet-audit.test.ts src/lib/analysis/__tests__/wallet-golden.test.ts cli/__tests__/output-formatter.test.ts cli/__tests__/output-json.test.ts
git commit -m "feat(wallet): score wallet heuristics in the audit, golden wallets"
```

---

### Task 5: UI, transaction links on findings and coin origins

**Files:**
- Modify:
  - `src/components/FindingCardTables.tsx`
  - `src/components/FindingCard.tsx`
  - `src/components/flows/WalletResults.tsx`
  - `public/locales/*/common.json`
- Create:
  - `src/components/wallet/CoinOrigins.tsx`
  - `src/components/wallet/__tests__/CoinOrigins.test.tsx`
  - `src/components/__tests__/TxRefList.test.tsx`

**Interfaces:**
- Consumes:
  - `COIN_CLASSES`, `CoinClass`, `OriginCounts` (Task 1);
  - `WalletAuditResult.utxoOrigins` (Task 4);
  - `truncateId` from `@/lib/constants`;
  - `fmtN` from `@/lib/format`.
- Produces:
  - `TxRefList({ txidsJson: string; more: number; onTxClick?: (txid: string) => void })`;
  - `CoinOrigins({ origins: OriginCounts })`.

- [ ] **Step 1: Write the failing tests.** Create `src/components/__tests__/TxRefList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, o: Record<string, unknown> = {}) => String(o.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (raw, n: string) => (n in o ? String(o[n]) : raw)),
    i18n: { language: "en" },
  }),
}));

import { TxRefList } from "../FindingCardTables";

afterEach(cleanup);

const A = "a".repeat(64);
const B = "b".repeat(64);

describe("TxRefList", () => {
  it("opens a tx and counts the rest", () => {
    const onTxClick = vi.fn();
    render(<TxRefList txidsJson={JSON.stringify([A, B])} more={4} onTxClick={onTxClick} />);
    fireEvent.click(screen.getAllByRole("button")[1]!);
    expect(onTxClick).toHaveBeenCalledWith(B);
    expect(screen.getByText("and 4 more")).toBeTruthy();
  });

  it("renders nothing for bad JSON or an empty list", () => {
    expect(render(<TxRefList txidsJson="not json" more={0} />).container.innerHTML).toBe("");
    expect(render(<TxRefList txidsJson="[]" more={0} />).container.innerHTML).toBe("");
  });
});
```

  Create `src/components/wallet/__tests__/CoinOrigins.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { COIN_CLASSES, type OriginCounts } from "@/lib/analysis/wallet-behavior";

vi.mock("react-i18next", async () => {
  const en = (await import("../../../../public/locales/en/common.json")).default as Record<string, string>;
  const t = (k: string, o: Record<string, unknown> = {}) =>
    (en[k] ?? (typeof o.defaultValue === "string" ? o.defaultValue : k)).replace(/\{\{(\w+)\}\}/g, (raw, name: string) => (name in o ? String(o[name]) : raw));
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

import { CoinOrigins } from "../CoinOrigins";

afterEach(cleanup);

const origins = (set: Partial<OriginCounts>): OriginCounts =>
  ({ ...Object.fromEntries(COIN_CLASSES.map((c) => [c, { count: 0, sats: 0 }])), ...set }) as OriginCounts;

describe("CoinOrigins", () => {
  it("lists classes with coins and hides empty ones", () => {
    render(<CoinOrigins origins={origins({ mixed: { count: 3, sats: 3_000_000 }, "coinjoin-change": { count: 1, sats: 995_000 } })} />);
    expect(screen.getByText("Mixed (CoinJoin)")).toBeTruthy();
    expect(screen.getByText("CoinJoin change")).toBeTruthy();
    expect(screen.queryByText("Received")).toBeNull();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("4 unspent coins by origin");
  });

  it("renders nothing without coins", () => {
    const { container } = render(<CoinOrigins origins={origins({})} />);
    expect(container.innerHTML).toBe("");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
  - Run: `pnpm vitest run src/components/__tests__/TxRefList.test.tsx src/components/wallet/__tests__/CoinOrigins.test.tsx`
  - Expected: FAIL (no export, no module).

- [ ] **Step 3: Copy, 6 locales.** `en`:

```json
  "finding.txRefs": "Transactions",
  "finding.txRefsMore_one": "and {{count}} more",
  "finding.txRefsMore_other": "and {{count}} more",
  "wallet.coinOrigins": "Coin origins",
  "wallet.coinOriginsAria_one": "{{count}} unspent coin by origin",
  "wallet.coinOriginsAria_other": "{{count}} unspent coins by origin",
  "wallet.origin.mixed": "Mixed (CoinJoin)",
  "wallet.origin.coinjoin-change": "CoinJoin change",
  "wallet.origin.change": "Change",
  "wallet.origin.self": "Self-transfer",
  "wallet.origin.received": "Received",
  "wallet.origin.unknown": "Unknown origin",
```

  Translate into the other 5 locales (pl plural forms for the two plural keys), with the Task 2 rules.

  Note: `wallet.origin.*` keys are built from a template (`` t(`wallet.origin.${c}`) ``). The parity test's literal scan does not see them, so all 6 must be present by hand.

- [ ] **Step 4: Implement `TxRefList`.** Append to `src/components/FindingCardTables.tsx` (it already imports `useTranslation` and `truncateId`):

```tsx
// ─── Transactions behind a wallet finding ───────────────────────────────

/** The txids a wallet finding is about (`params._txids`, a JSON array), each opening its analysis. */
export function TxRefList({ txidsJson, more, onTxClick }: {
  txidsJson: string;
  more: number;
  onTxClick?: (txid: string) => void;
}) {
  const { t } = useTranslation();
  let txids: string[];
  try {
    const parsed: unknown = JSON.parse(txidsJson);
    txids = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return null;
  }
  if (txids.length === 0) return null;
  return (
    <div data-testid="finding-tx-refs" className="rounded-md border border-card-border px-3 py-2">
      <p className="eyebrow mb-1">{t("finding.txRefs", { defaultValue: "Transactions" })}</p>
      <ul className="flex flex-wrap gap-x-4">
        {txids.map((txid) => (
          <li key={txid}>
            {onTxClick ? (
              <button
                type="button"
                onClick={() => onTxClick(txid)}
                className="inline-flex items-center min-h-[40px] font-mono text-xs text-bitcoin hover:text-bitcoin-hover transition-colors cursor-pointer"
              >
                {truncateId(txid, 8)}
              </button>
            ) : (
              <span className="inline-flex items-center min-h-[40px] font-mono text-xs text-foreground/70">{truncateId(txid, 8)}</span>
            )}
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="text-xs text-muted">{t("finding.txRefsMore", { count: more, defaultValue: "and {{count}} more" })}</p>
      )}
    </div>
  );
}
```

  In `src/components/FindingCard.tsx`:
  - change the import to `import { RicochetHopTable, ConsolidationTable, TxRefList } from "./FindingCardTables";`;
  - in `FindingCardBody`, insert right before `<div className="flex items-center justify-between">` (the learn-more row):

```tsx
      {typeof finding.params?._txids === "string" && (
        <TxRefList txidsJson={finding.params._txids} more={Number(finding.params.more ?? 0)} onTxClick={onTxClick} />
      )}
```

- [ ] **Step 5: Implement `CoinOrigins`.** Create `src/components/wallet/CoinOrigins.tsx`:

```tsx
"use client";

import { useTranslation } from "react-i18next";
import { COIN_CLASSES, type CoinClass, type OriginCounts } from "@/lib/analysis/wallet-behavior";
import { fmtN } from "@/lib/format";

/** Segment colour per class: tokens only. */
const TONE: Record<CoinClass, string> = {
  mixed: "bg-severity-good",
  "coinjoin-change": "bg-severity-high",
  change: "bg-foreground/55",
  self: "bg-foreground/40",
  received: "bg-foreground/25",
  unknown: "bg-foreground/10",
};

const LABEL: Record<CoinClass, string> = {
  mixed: "Mixed (CoinJoin)",
  "coinjoin-change": "CoinJoin change",
  change: "Change",
  self: "Self-transfer",
  received: "Received",
  unknown: "Unknown origin",
};

/** Unspent coins by origin: a bar weighted by sats and a legend with counts. */
export function CoinOrigins({ origins }: { origins: OriginCounts }) {
  const { t } = useTranslation();
  const present = COIN_CLASSES.filter((c) => origins[c].count > 0);
  const totalCount = present.reduce((s, c) => s + origins[c].count, 0);
  const totalSats = present.reduce((s, c) => s + origins[c].sats, 0);
  if (totalCount === 0) return null;
  const label = (c: CoinClass) => t(`wallet.origin.${c}`, { defaultValue: LABEL[c] });
  return (
    <div data-testid="coin-origins" className="space-y-2">
      <span className="text-[13px] text-muted">{t("wallet.coinOrigins", { defaultValue: "Coin origins" })}</span>
      <div
        role="img"
        aria-label={t("wallet.coinOriginsAria", { count: totalCount, defaultValue: "{{count}} unspent coins by origin" })}
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-inset"
      >
        {present.map((c) => (
          <span key={c} className={TONE[c]} style={{ width: `${totalSats > 0 ? (origins[c].sats / totalSats) * 100 : 100 / present.length}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {present.map((c) => (
          <li key={c} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TONE[c]}`} />
            <span className="text-foreground">{label(c)}</span>
            <span className="num">{fmtN(origins[c].count)} · {fmtN(origins[c].sats)} sats</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

  In `src/components/flows/WalletResults.tsx`:
  - add `import { CoinOrigins } from "@/components/wallet/CoinOrigins";`;
  - right after the closing `</dl>` of the stats grid inside the verdict band, add `<CoinOrigins origins={result.utxoOrigins} />`. It renders nothing when there are no UTXOs.

- [ ] **Step 6: Run, expect PASS.**
  - Run: the Step 2 command, plus `src/lib/__tests__/locale-parity.test.ts`.
  - Then `pnpm type-check && pnpm lint`.
  - Visual check: `pnpm dev`, then scan any zpub with history.
    - The coin-origins bar sits under the stats in both themes.
    - No horizontal scroll at 390 px.
    - Expanding a merge finding shows the "Transactions" list, and a txid opens the tx analysis.

- [ ] **Step 7: Commit**

```bash
git add src/components/FindingCardTables.tsx src/components/FindingCard.tsx src/components/flows/WalletResults.tsx src/components/wallet/CoinOrigins.tsx src/components/wallet/__tests__/CoinOrigins.test.tsx src/components/__tests__/TxRefList.test.tsx public/locales/*/common.json
git commit -m "feat(wallet): transaction links on wallet findings, coin origins bar"
```

---

### Task 6: CLI parity

**Files:**
- Modify:
  - `cli/src/output/formatter.ts`
  - `cli/src/output/json.ts`
  - `cli/src/mcp/server.ts`
  - `cli/__tests__/output-formatter.test.ts`
  - `cli/__tests__/output-json.test.ts`

**Interfaces:**
- Consumes: `WalletAuditResult.utxoOrigins`, and `COIN_CLASSES`, `CoinClass` from `@/lib/analysis/wallet-behavior`.
- Produces:
  - a text line `Coin origins: <n> <label>, ...`;
  - JSON `walletInfo.utxoOrigins`;
  - MCP `scan_wallet` result `utxoOrigins`.

- [ ] **Step 1: Write the failing tests.** In `cli/__tests__/output-formatter.test.ts`, inside `describe("formatWalletResult")`:

```ts
  it("lists coin origins when there are UTXOs", () => {
    const origins = utxoOrigins(buildWalletGraph([]), []);
    origins.mixed = { count: 3, sats: 3_000_000 };
    origins["coinjoin-change"] = { count: 1, sats: 995_000 };
    const result: WalletAuditResult = {
      score: 52, grade: "C", findings: [], activeAddresses: 5, totalTxs: 9, totalUtxos: 4,
      totalBalance: 3_995_000, reusedAddresses: 0, dustUtxos: 0, utxoOrigins: origins,
    };
    expect(formatWalletResult("zpub6abc...", result, "mainnet")).toContain("3 mixed, 1 CoinJoin change");
  });

  it("omits coin origins without UTXOs", () => {
    const result: WalletAuditResult = {
      score: 70, grade: "C", findings: [], activeAddresses: 0, totalTxs: 0, totalUtxos: 0,
      totalBalance: 0, reusedAddresses: 0, dustUtxos: 0, utxoOrigins: utxoOrigins(buildWalletGraph([]), []),
    };
    expect(formatWalletResult("zpub6abc...", result, "mainnet")).not.toContain("Coin origins");
  });
```

  In `cli/__tests__/output-json.test.ts`, in the first `walletJson` test, after the existing expects:

```ts
    expect(parsed.walletInfo.utxoOrigins.received).toEqual({ count: 0, sats: 0 });
```

- [ ] **Step 2: Run, expect FAIL.** `cd cli && pnpm test -- output-formatter output-json`.

- [ ] **Step 3: Implement.**

  In `cli/src/output/formatter.ts`, add `import { COIN_CLASSES, type CoinClass } from "@/lib/analysis/wallet-behavior";`, and at module level:

```ts
const ORIGIN_LABEL: Record<CoinClass, string> = {
  mixed: "mixed",
  "coinjoin-change": "CoinJoin change",
  change: "change",
  self: "self-transfer",
  received: "received",
  unknown: "unknown origin",
};
```

  In `formatWalletResult`, after the `Dust UTXOs:` line:

```ts
  const origins = COIN_CLASSES.filter((c) => result.utxoOrigins[c].count > 0)
    .map((c) => `${result.utxoOrigins[c].count} ${ORIGIN_LABEL[c]}`);
  if (origins.length > 0) lines.push(line("Coin origins:", origins.join(", ")));
```

  In `cli/src/output/json.ts` `walletJson`, add `utxoOrigins: result.utxoOrigins,` after `dustUtxos` in `walletInfo`.

  In `cli/src/mcp/server.ts` (`scan_wallet` result), add `utxoOrigins: result.utxoOrigins,` after `dustUtxos`.

- [ ] **Step 4: Run, expect PASS.** `cd cli && pnpm test && pnpm type-check`, then `pnpm lint` at the root.

- [ ] **Step 5: Commit**

```bash
git add cli/src/output/formatter.ts cli/src/output/json.ts cli/src/mcp/server.ts cli/__tests__/output-formatter.test.ts cli/__tests__/output-json.test.ts
git commit -m "feat(cli): coin origins in wallet scan text, JSON and MCP output"
```

---

### Task 7: e2e, change merge on the wallet page

**Files:**
- Modify:
  - `e2e/helpers/mock-api.ts`
  - `e2e/wallet-scan.spec.ts`

**Interfaces:**
- Consumes:
  - `mockWalletAddresses` and `MockAddressData`, which gain an optional `fundedCount?: number`. It defaults to `txs.length`, which would mark an address that both received and spent as reused.
  - The spec's existing `fundingTx`, `payTo`, `FIRST_ADDRESS`, `SECOND_ADDRESS`, `CHANGE_ADDRESS`, `ZPUB`.

- [ ] **Step 1: Mock support.** In `e2e/helpers/mock-api.ts`:
  - add `fundedCount?: number;` to `MockAddressData`;
  - in `mockWalletAddresses`, replace `const n = data ? data.txs.length : 0;` with:

```ts
    const txCount = data ? data.txs.length : 0;
    const n = data?.fundedCount ?? txCount;
```

  - use `funded_txo_count: n` and `tx_count: txCount` in the stats.

- [ ] **Step 2: Write the test.** Append to `e2e/wallet-scan.spec.ts`:

```ts
const OUTSIDE_1 = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const OUTSIDE_2 = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

/** A wallet-built tx spending `inputs` (outputs of earlier mock txs) to `outputs`. */
function spend(txidByte: string, inputs: { tx: typeof fundingTx; vout: number }[], outputs: { address: string; value: number }[]) {
  const tx = structuredClone(fundingTx);
  tx.txid = txidByte.repeat(32);
  tx.vin = inputs.map(({ tx: parent, vout }) => ({ ...structuredClone(fundingTx.vin[0]!), txid: parent.txid, vout, prevout: { ...parent.vout[vout]! } }));
  tx.vout = outputs.map((o) => ({ ...structuredClone(fundingTx.vout[0]!), scriptpubkey_address: o.address, scriptpubkey_type: "v0_p2wpkh", value: o.value }));
  return tx;
}

test("wallet heuristics: change merged with a receipt is flagged and links to the tx", async ({ page }) => {
  const r1 = payTo("c1", FIRST_ADDRESS, 300_000);
  const r2 = payTo("d1", SECOND_ADDRESS, 600_000);
  const p1 = spend("e1", [{ tx: r1, vout: 0 }], [{ address: OUTSIDE_1, value: 200_000 }, { address: CHANGE_ADDRESS, value: 99_000 }]);
  const m1 = spend("f1", [{ tx: p1, vout: 1 }, { tx: r2, vout: 0 }], [{ address: OUTSIDE_2, value: 690_000 }]);
  await mockExtraTxs(page, [r1, r2, p1, m1]);
  await mockWalletAddresses(page, {
    [FIRST_ADDRESS]: { txs: [p1, r1], utxos: [], fundedSats: 300_000, fundedCount: 1 },
    [SECOND_ADDRESS]: { txs: [m1, r2], utxos: [], fundedSats: 600_000, fundedCount: 1 },
    [CHANGE_ADDRESS]: { txs: [m1, p1], utxos: [], fundedSats: 99_000, fundedCount: 1 },
  });

  await page.goto(`/#xpub=${ZPUB}`);
  await expect(page.getByText("Wallet Privacy Audit")).toBeVisible({ timeout: 20_000 });
  const finding = page.getByRole("button", { name: /1 spend merged change with other coins/ });
  await expect(finding).toBeVisible();
  await finding.click();
  const refs = page.getByTestId("finding-tx-refs");
  await expect(refs).toBeVisible();
  await refs.getByRole("button").first().click();
  await expect(page).toHaveURL(new RegExp(`#tx=${"f1".repeat(32)}`));
});
```

- [ ] **Step 3: Run.**
  - Run: `pnpm build && CI=1 pnpm exec playwright test e2e/wallet-scan.spec.ts --workers=1`
  - Expected: all wallet-scan tests PASS (the new one plus the existing 4; `fundedCount` is optional, so they are unchanged).
  - Afterwards `git checkout -- public/sitemap.xml` if it changed.
  - If the finding row is not a button with that accessible name, use the finding title text (`page.getByText(...)`) and click it. The behaviour under test is unchanged.

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/mock-api.ts e2e/wallet-scan.spec.ts
git commit -m "test(e2e): wallet change-merge finding and its transaction link"
```

---

### Task 8: Documentation

**Files:**
- Modify:
  - `docs/privacy-engine.md`
  - `docs/xpub-analysis.md`
  - `docs/adr-finding-tiers.md`
  - `docs/testing-reference.md`
  - `docs/README.md`

- [ ] **Step 1: `docs/privacy-engine.md`.**

  Overview sentence: change "28 transaction-level heuristics, 6 address-level heuristics, and 12 chain analysis modules" to "28 transaction-level heuristics, 6 address-level heuristics, 5 wallet-level heuristics, and 12 chain analysis modules".

  Before `## Scoring Model`, add a `## Wallet-Level Heuristics` section. It gets one `###` per W1-W5, each with:
  - **Mechanism:** the "What" from the spec;
  - **Privacy impact:** the "Why", with references;
  - **Detection:** the function in `wallet-heuristics.ts` and the coin classes it uses;
  - **Impact:** the spec's scores.

  Start the section with a paragraph on the behaviour model (coin classes table, solo spends, simple payments, `unknown` never scores) and on the PayJoin ruling (outside inputs are skipped, never labelled).

  Under `### Base Score`, add: "For wallet audits (xpub/descriptor), the base score is **70**, the same as transactions; wallet checks and wallet-level heuristics add their impacts to it."

  In `### Heuristic Impact Summary`, add rows (Level `Wallet`; the Min and Max columns follow the table's convention, Min = mildest, Max = worst):

```markdown
| W1 | Post-Mix Merge | Wallet | -8 | -20 |
| W2 | Change Merged With Other Coins | Wallet | -4 | -10 |
| W3 | Change Exposure | Wallet | -2 | -6 |
| W4 | Peel Chain (Wallet) | Wallet | -3 | -6 |
| W5 | Coins Kept Apart | Wallet | +3 | +3 |
```

- [ ] **Step 2: `docs/xpub-analysis.md`.**
  - Add to "Wallet Audit Checks" table:
    - `| Post-mix merge | CoinJoin output spent with other coins | -8 to -20 |`
    - `| Change merge | Change spent with a coin from another tx | -4 to -10 |`
    - `| Change exposure | Payments whose change a standard rule identifies | -2 to -6 |`
    - `| Peel chain | 3+ payments each spending only the previous change | -3 to -6 |`
    - `| Coins kept apart (positive) | 3+ spends, no merges | +3 |`
  - Add a note: consolidations already counted as a merge are not counted again.
  - Add `wallet-behavior.ts` and `wallet-heuristics.ts` to the Key Files table.

- [ ] **Step 3: `docs/adr-finding-tiers.md`.** Add a `### Wallet-Level Heuristics` subsection to the Classification Catalog, before `### Cross-Heuristic & Infrastructure`. It holds the 5 IDs with the tiers and temporality from the spec's Metadata table, plus a one-line rationale each.

- [ ] **Step 4: `docs/testing-reference.md`.** Under the reference table, add a "Golden wallets" paragraph:
  - `goldenWallet()` C 52: `wallet-postmix-merge` -15, `wallet-change-merge` -4, `wallet-change-exposed` -4, `wallet-peel-chain` -3, `wallet-no-reuse` +5, `wallet-uniform-script` +3;
  - `cleanWallet()` B 81: `wallet-no-merge` +3, `wallet-no-reuse` +5, `wallet-uniform-script` +3;
  - the test file `src/lib/analysis/__tests__/wallet-golden.test.ts`;
  - a delta there is a scoring change and must be justified in the commit.

- [ ] **Step 5: `docs/README.md`.** Under "Specs and Planning", add:
  - `- **[spec-wallet-heuristics.md](./spec-wallet-heuristics.md)** - Wallet-level heuristics: post-mix and change merges, change exposure, peel chains, coin origins (0.41.0)`
  - `- **[superpowers/plans/2026-10-07-wallet-heuristics.md](./superpowers/plans/2026-10-07-wallet-heuristics.md)** - Task-by-task implementation plan for the spec above`

- [ ] **Step 6: Final gate.**
  - Run: `grep -rnP "\x{2014}|\\\\u2014|&mdash;" docs/spec-wallet-heuristics.md docs/privacy-engine.md docs/xpub-analysis.md src/lib/analysis/wallet-*.ts src/components/wallet/CoinOrigins.tsx`. Expected: no output.
  - Then `pnpm test && pnpm lint && pnpm type-check && pnpm build` and `cd cli && pnpm test`. All pass.

- [ ] **Step 7: Commit**

```bash
git add docs/privacy-engine.md docs/xpub-analysis.md docs/adr-finding-tiers.md docs/testing-reference.md docs/README.md
git commit -m "docs: wallet-level heuristics in the privacy engine reference"
```

---

## Self-review against the spec

| Spec item | Task |
|---|---|
| Behaviour model: coin classes (incl. Stonewall, tx0 toxic change, `unknown`), solo spends, simple payments, ordering | 1 |
| W1 post-mix merge, both variants, impacts -8/-12/-15/-20 | 2 |
| W2 change merge, impacts -4/-7/-10, same-tx and receipts-only merges excluded, W1 precedence | 2 |
| W3 change exposure, 3 rules pointing at the real change, ratio steps | 3 |
| W4 peel chain, 3/6 thresholds, longest chain in order | 3 |
| W5 coins kept apart, +3 | 3, wired in 4 |
| Consolidation dedup | 4 |
| Metadata for 5 IDs | 2, 3 |
| Base 70, golden C 52 and clean B 81 | 4 |
| `_txids` cap 10 with `more`, TxRefList on finding cards | 2, 5 |
| Coin origins: result field, UI bar, CLI text/JSON/MCP | 4, 5, 6 |
| Copy verbatim, 6 locales, plurals, Castilian Spanish | 2, 3, 5 |
| No requests, no PayJoin labelling, no persistence | 1 (pure model, outside-input skip), Global Constraints |
| Tests: unit, audit, golden, locale text, components, CLI, e2e | 1-7 |
| Docs: privacy-engine, xpub-analysis, testing-reference (+ ADR, index) | 8 |
| Rollout 0.41.0 | Out of plan scope: the release follows CLAUDE.md "Release Process" after merge, with the spec's release note |

Type consistency, checked:
- `checkMerges` returns `{ findings, merged }`, consumed in Task 4.
- `SimplePayment` has `{ tx, change, payment }` throughout.
- `OriginCounts` is keyed by `COIN_CLASSES`.
- `utxoOrigins(g, infos)` has the same signature in Tasks 1, 4 and 6.
- `txRefs` returns `{ _txids: string; more: number }`, and `TxRefList` reads `params._txids` and `params.more`.
