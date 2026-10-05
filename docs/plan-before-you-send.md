# Before You Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users paste, drop or scan a PSBT or raw transaction (and every other accepted input), get the full privacy analysis before broadcasting, and optionally broadcast it after an explicit, explained confirm step.

**Architecture:** Every input source (paste, file, QR) is normalized to one canonical string and goes through `detectInputType`; PSBT and raw tx strings become an in-memory `LocalTx` that is analyzed by `runLocalAnalysis` (same engine as txid scans, plus optional consented parent lookups through an uncached client). Nothing about a `LocalTx` is persisted. Broadcast is a separate module (`broadcast.ts`, plain `fetch`, never retried) behind a confirm dialog. The QR scanner assembles static, BC-UR and BBQr codes into the same canonical string.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript strict, Tailwind 4, `motion/react`, `@scure/btc-signer` 2.4.1, `@scure/base`, `@noble/hashes`, `zxing-wasm` (new, lazy, self-hosted in a plain-JS module worker), Vitest, Playwright.

**Spec:** `docs/spec-before-you-send.md` (read it first; this plan argues from it, including its "Plan-time amendments" section).

## Global Constraints

- Worktree: `/home/user/aie-before-you-send`, branch `feat/before-you-send`. Never work in `/home/user/am-i-exposed` (shared by other sessions). Never use `git stash`.
- Package manager pnpm only. TypeScript strict, no `any`. Animations via `motion/react`. Tailwind semantic tokens (`bg-surface-inset`, `bg-surface-elevated`, `text-muted`, `text-foreground`, `text-bitcoin`, `text-severity-*`), never hex.
- No em dashes anywhere (no U+2014 character, no backslash-u-2014 escape, no `&mdash;` entity). Use ` - `.
- UI copy never says "we", "us", "our". Spanish is Castilian tuteo (usa, envía, pega), never voseo.
- Every new i18n key goes into all 6 locales (`public/locales/{en,es,de,fr,pt,pl}/common.json`, flat keys); the locale-parity test must pass. Code passes `defaultValue` with the English text.
- All amounts in satoshis (numbers), never BTC floats.
- Workers that load WASM are plain `.js` in `public/workers/` (Next static export does not bundle TS workers). The page CSP has no `wasm-unsafe-eval`, so WASM only runs inside workers.
- Never log or persist a PSBT, raw tx, txid of a local tx, or address of a local tx (no `console.*`, no localStorage, no IndexedDB, no URL hash).
- Commits: git identity is the repo's local config (Copexit). Never pass `-c user.email/-c user.name`. Never add `Co-Authored-By`, "Generated with", session URLs or any AI attribution to commits or PR bodies.
- Never `git push` or open a PR without asking the owner first. Commit freely.
- Gates before any push: `pnpm type-check && pnpm lint && pnpm test && pnpm build` (chain with `&&`, never `;`).
- Broadcast: `POST {base}/tx` with `Content-Type: text/plain`, body = hex. Never retried, never automatic, never bound to Enter or a keyboard shortcut. CLI/MCP never get network access.
- Lookup client for local txs: `createMempoolClient(...)` directly (never `createApiClient`, which caches in IndexedDB).
- Input caps: short inputs 512 chars (unchanged); PSBT / raw hex / UR / BBQr payloads up to 4 MB (`MAX_PAYLOAD_LENGTH = 4 * 1024 * 1024`). Files up to 4 MB.
- Checklist thresholds: absurd fee = fee rate > 1,000 sat/vB OR fee > 10% of the output total; dust = non-OP_RETURN output < 546 sats.

## Review Focus

1. **Line-wrapped base64 PSBT** (copied from a terminal or Bitcoin Core with newlines every 64/76 chars, or with spaces) must parse, not be rejected or cut. Pinned in Task 2.
2. **Random even-length hex that is not a transaction** (a block header, a hash list, a pubkey dump) must be `invalid` with the normal error, never a crash and never a half-parsed "transaction". Pinned in Task 2.
3. **Double-click or Enter on the confirm button, and Escape while sending** must produce exactly one POST, and the dialog cannot be dismissed while a broadcast is in flight. Pinned in Task 12.
4. **Camera permission denied or no camera** must show a clear message and offer the photo fallback; pasting still works. Pinned in Task 19.
5. **Two different animated UR or BBQr sequences scanned back to back** (user switches screens mid-scan) must reset cleanly instead of mixing parts or throwing. Pinned in Tasks 15 and 17.

---

## File Structure

New files (one responsibility each):

| File | Responsibility |
|---|---|
| `src/lib/bitcoin/tx-convert.ts` | btc-signer `Transaction` -> engine `MempoolTransaction` pieces (moved out of `psbt.ts`, shared with raw tx) |
| `src/lib/input/local-tx.ts` | `LocalTx` type, `parseLocalTx(text, network)`, `parseRawTx`, `psbtToLocalTx`, `localTxLabel` |
| `src/lib/input/file.ts` | `readInputFile(file)` and `bytesToPayload(bytes)`: file/bytes -> canonical string |
| `src/lib/analysis/run-local-analysis.ts` | Analysis pipeline for a `LocalTx` (optional parent/address lookups, heuristics, Boltzmann) |
| `src/lib/api/backend-class.ts` | `backendClass()` self-hosted vs public, `endpointHost()` |
| `src/lib/analysis/pre-broadcast-checklist.ts` | Pure checklist builder (reveals + safety checks) |
| `src/lib/api/broadcast.ts` | `broadcastTx`, `testMempoolAccept`, `getTxStatus`, `parseRpcError` |
| `src/components/flows/BeforeYouSend.tsx` | Local-tx panel: status, metrics, lookup button, checklist, broadcast button (replaces `PsbtBanner.tsx`) |
| `src/components/flows/BroadcastDialog.tsx` | Confirm dialog + send state machine |
| `src/components/InputExtras.tsx` | Open-file button, drag-and-drop wiring, Scan-QR button for both search fields |
| `src/lib/input/ur/bytewords.ts`, `crc32.ts`, `xoshiro.ts`, `sampler.ts`, `fountain.ts`, `cbor.ts`, `registry.ts`, `index.ts` | BC-UR decoding |
| `src/lib/input/bbqr.ts` | BBQr decoding and part assembly |
| `src/lib/input/qr-assembler.ts` | Frame-by-frame assembler for static / UR / BBQr |
| `src/lib/input/qr-decode.ts` | Frame decoding: native `BarcodeDetector` or the zxing worker |
| `public/workers/qr.worker.js` | Plain-JS module worker running zxing-wasm |
| `scripts/copy-zxing.mjs` | Copies the zxing-wasm reader build into `public/vendor/zxing/` (gitignored) |
| `src/components/QrScanner.tsx` | Camera modal + photo fallback |
| `e2e/helpers/local-tx-fixtures.ts`, `e2e/helpers/y4m.ts` | Deterministic signed tx/PSBT fixtures and fake-camera video |
| `e2e/before-you-send.spec.ts`, `e2e/qr-scanner.spec.ts` | E2E coverage |

Modified: `src/lib/bitcoin/psbt.ts`, `src/lib/analysis/detect-input.ts`, `src/lib/types.ts`, `src/lib/analysis/analysis-state.ts`, `src/hooks/useAnalysis.ts`, `src/hooks/useScanner.ts`, `src/hooks/useRecentScans.ts`, `src/hooks/useBookmarks.ts`, `src/app/page.tsx`, `src/components/results/Results.tsx`, `src/components/results/ResultsFooter.tsx`, `src/components/AddressInput.tsx`, `src/components/results/InlineSearchBar.tsx`, `src/components/scan/ScanScreen.tsx`, `src/lib/api/mempool.ts`, `src/lib/analysis/run-txid-analysis.ts`, `src/lib/analysis/finding-metadata.ts`, `cli/src/commands/scan-psbt.ts`, `cli/src/mcp/server.ts`, locales, docs.

Deleted: `src/components/flows/PsbtBanner.tsx` (superseded by `BeforeYouSend.tsx`).

---

# PR 1: Input layer, truncation fix, persistence

### Task 1: Shared tx conversion and `LocalTx` parsing

**Files:**
- Create: `src/lib/bitcoin/tx-convert.ts`
- Create: `src/lib/input/local-tx.ts`
- Modify: `src/lib/bitcoin/psbt.ts` (import helpers from `tx-convert.ts`; delete the moved copies)
- Test: `src/lib/input/__tests__/local-tx.test.ts`, shared fixtures `src/lib/input/__tests__/fixtures.ts`

**Interfaces:**
- Produces:
  - `fixtures.ts` (tests only): `priv`, `pub`, `pay`, `buildPsbt(opts: { sign: boolean; nonWitness?: boolean }): Transaction` (1 input of 100,000 sats, outputs 60,000 + 39,000, fee 1,000).
  - `tx-convert.ts`: `type BtcNetwork = typeof NETWORK`; `describeScript(script: Uint8Array, net: BtcNetwork): { scriptpubkey: string; scriptpubkey_type: string; scriptpubkey_address: string }`; `scriptSigAsm(script: Uint8Array | undefined): string`; `INPUT_VSIZE: Record<string, number>`; `MEMPOOL_SCRIPT_TYPE`; `netFor(network: BitcoinNetwork): BtcNetwork`.
  - `local-tx.ts`:
    ```ts
    export type LocalTxStatus = "unsigned" | "partial" | "signed";
    export interface LocalTx {
      source: "psbt" | "raw";
      status: LocalTxStatus;
      tx: MempoolTransaction;
      missingPrevouts: number[];
      signedHex: string | null;
      psbt: PSBTParseResult | null;
    }
    export const PREVIEW_TXID = "psbt-preview";
    export function parseRawTx(hexOrBytes: string | Uint8Array, network: BitcoinNetwork): LocalTx; // throws Error
    export function psbtToLocalTx(input: string, network: BitcoinNetwork): LocalTx;           // throws Error
    export function parseLocalTx(text: string, network: BitcoinNetwork): LocalTx;             // dispatches by prefix
    export function isRawTxHex(text: string): boolean;                                         // strict, never throws
    export function localTxLabel(local: LocalTx): { key: "local.queryPsbt" | "local.queryRaw"; inputs: number; outputs: number };
    ```

- [ ] **Step 1: Write the failing tests**

Fixtures are built with btc-signer and a fixed key, so signatures are deterministic (RFC 6979).

```ts
// src/lib/input/__tests__/fixtures.ts
import { Transaction, p2wpkh, NETWORK } from "@scure/btc-signer";
import { secp256k1 } from "@noble/curves/secp256k1.js";

export const priv = new Uint8Array(32).fill(7);
export const pub = secp256k1.getPublicKey(priv, true);
export const pay = p2wpkh(pub, NETWORK);

/** Parent tx paying 100_000 sats to `pay` (unsigned is fine: only its outputs matter). */
function parentTx(): Transaction {
  const p = new Transaction({ allowUnknownInputs: true });
  p.addInput({ txid: new Uint8Array(32).fill(1), index: 0 });
  p.addOutput({ script: pay.script, amount: 100_000n });
  p.addOutput({ script: pay.script, amount: 50_000n });
  return p;
}

export function buildPsbt(opts: { sign: boolean; nonWitness?: boolean }) {
  const parent = parentTx();
  const tx = new Transaction();
  tx.addInput({
    txid: parent.id, index: 0,
    witnessUtxo: { script: pay.script, amount: 100_000n },
    ...(opts.nonWitness ? { nonWitnessUtxo: parent.toBytes(true, false) } : {}),
  });
  tx.addOutputAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", 60_000n, NETWORK);
  tx.addOutput({ script: pay.script, amount: 39_000n });
  if (opts.sign) tx.sign(priv);
  return tx;
}
```

```ts
// src/lib/input/__tests__/local-tx.test.ts
import { describe, it, expect } from "vitest";
import { base64 } from "@scure/base";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt } from "./fixtures";
import { parseRawTx, psbtToLocalTx, parseLocalTx, isRawTxHex, PREVIEW_TXID } from "../local-tx";

describe("parseRawTx", () => {
  it("parses a signed segwit tx: status signed, txid real, prevouts missing", () => {
    const t = buildPsbt({ sign: true });
    t.finalize();
    const hex = bytesToHex(t.extract());
    const local = parseRawTx(hex, "mainnet");
    expect(local.source).toBe("raw");
    expect(local.status).toBe("signed");
    expect(local.signedHex).toBe(hex);
    expect(local.tx.txid).toBe(t.id);
    expect(local.missingPrevouts).toEqual([0]);
    expect(local.tx.vin[0].prevout).toBeNull();
    expect(local.tx.vout.map((o) => o.value)).toEqual([60_000, 39_000]);
    expect(local.tx.vin[0].witness.length).toBe(2);
    expect(local.tx.weight).toBeGreaterThan(0);
  });

  it("parses an unsigned raw tx (no witnesses): status unsigned, no signedHex", () => {
    const t = buildPsbt({ sign: false });
    const hex = bytesToHex(t.unsignedTx);
    const local = parseRawTx(hex, "mainnet");
    expect(local.status).toBe("unsigned");
    expect(local.signedHex).toBeNull();
    expect(local.tx.txid).toBe(PREVIEW_TXID);
  });

  it("rejects trailing bytes", () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    expect(() => parseRawTx(bytesToHex(t.extract()) + "00", "mainnet")).toThrow();
  });
});

describe("psbtToLocalTx", () => {
  it("unsigned PSBT: status unsigned, prevouts known from witnessUtxo", () => {
    const local = psbtToLocalTx(base64.encode(buildPsbt({ sign: false }).toPSBT()), "mainnet");
    expect(local.status).toBe("unsigned");
    expect(local.missingPrevouts).toEqual([]);
    expect(local.psbt?.fee).toBe(1_000);
  });

  it("signed (not finalized) PSBT: status signed, signedHex extractable", () => {
    const t = buildPsbt({ sign: true });
    const local = psbtToLocalTx(base64.encode(t.toPSBT()), "mainnet");
    expect(local.status).toBe("signed");
    const c = t.clone(); c.finalize();
    expect(local.signedHex).toBe(bytesToHex(c.extract()));
    expect(local.tx.txid).toBe(c.id);
  });

  it("finalized PSBT: status signed", () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    expect(psbtToLocalTx(base64.encode(t.toPSBT()), "mainnet").status).toBe("signed");
  });

  it("parses a realistic PSBT longer than 512 chars (non_witness_utxo)", () => {
    const b64 = base64.encode(buildPsbt({ sign: false, nonWitness: true }).toPSBT());
    expect(b64.length).toBeGreaterThan(512);
    expect(psbtToLocalTx(b64, "mainnet").tx.vout).toHaveLength(2);
  });
});

describe("parseLocalTx / isRawTxHex", () => {
  it("dispatches PSBT base64, PSBT hex and raw hex", () => {
    const t = buildPsbt({ sign: true });
    expect(parseLocalTx(base64.encode(t.toPSBT()), "mainnet").source).toBe("psbt");
    expect(parseLocalTx(bytesToHex(t.toPSBT()), "mainnet").source).toBe("psbt");
    t.finalize();
    expect(parseLocalTx(bytesToHex(t.extract()), "mainnet").source).toBe("raw");
  });

  it("isRawTxHex: true only for a strictly parseable tx", () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    expect(isRawTxHex(bytesToHex(t.extract()))).toBe(true);
    expect(isRawTxHex("ab".repeat(80))).toBe(false);   // random hex
    expect(isRawTxHex("a".repeat(64))).toBe(false);    // txid
    expect(isRawTxHex("zz")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/input/__tests__/local-tx.test.ts`
Expected: FAIL, `Cannot find module '../local-tx'`.

- [ ] **Step 3: Create `tx-convert.ts` by moving helpers out of `psbt.ts`**

```ts
// src/lib/bitcoin/tx-convert.ts
/** btc-signer -> mempool.space-shaped pieces, shared by the PSBT and raw tx parsers. */
import { Address, OutScript, Script, NETWORK, TEST_NETWORK } from "@scure/btc-signer";
import { bytesToHex } from "./hex";
import type { BitcoinNetwork } from "./networks";

export type BtcNetwork = typeof NETWORK;

/** btc-signer OutScript type -> mempool.space scriptpubkey_type */
export const MEMPOOL_SCRIPT_TYPE: Record<string, string> = {
  pk: "p2pk", pkh: "p2pkh", sh: "p2sh", wpkh: "v0_p2wpkh", wsh: "v0_p2wsh", tr: "v1_p2tr", ms: "multisig", p2a: "anchor",
};

/** Rough per-input vsize by prevout type, for transactions that are not signed yet. */
export const INPUT_VSIZE: Record<string, number> = {
  p2pkh: 148,
  p2sh: 91, // assumes P2SH-P2WPKH
  v0_p2wpkh: 68,
  v1_p2tr: 58,
};

export const netFor = (network: BitcoinNetwork): BtcNetwork => (network === "mainnet" ? NETWORK : TEST_NETWORK);

/** Describe an output script the way the mempool.space API does. */
export function describeScript(script: Uint8Array, net: BtcNetwork) {
  const scriptpubkey = bytesToHex(script);
  if (script[0] === 0x6a) {
    return { scriptpubkey, scriptpubkey_type: "op_return", scriptpubkey_address: "" };
  }
  let scriptpubkey_type = "unknown";
  let scriptpubkey_address = "";
  try {
    const decoded = OutScript.decode(script);
    scriptpubkey_type = MEMPOOL_SCRIPT_TYPE[decoded.type] ?? "unknown";
    scriptpubkey_address = Address(net).encode(decoded);
  } catch {
    // Non-standard script or a type without an address (p2pk, bare multisig)
  }
  return { scriptpubkey, scriptpubkey_type, scriptpubkey_address };
}

/**
 * scriptSig pushes as space-separated hex, enough for detectLowRSignatures
 * (it only reads hex items starting with 30). Opcodes are kept as their names.
 */
export function scriptSigAsm(script: Uint8Array | undefined): string {
  if (!script || script.length === 0) return "";
  try {
    return Script.decode(script).map((op) => (op instanceof Uint8Array ? bytesToHex(op) : String(op))).join(" ");
  } catch {
    return "";
  }
}
```

In `src/lib/bitcoin/psbt.ts`: delete `MEMPOOL_SCRIPT_TYPE`, `INPUT_VSIZE`, `BtcNetwork`, `describeScript`; add `import { describeScript, INPUT_VSIZE, scriptSigAsm, type BtcNetwork } from "./tx-convert";`; export `inferTestnet` (it is used by nothing new yet, keep it private if lint complains about unused exports); change the vin builder line `scriptsig_asm: "",` to `scriptsig_asm: scriptSigAsm(inp.finalScriptSig),`. Remove now-unused imports (`Address`, `OutScript`) from `psbt.ts`.

- [ ] **Step 4: Create `local-tx.ts`**

```ts
// src/lib/input/local-tx.ts
/**
 * A transaction that is not (necessarily) on chain yet: a PSBT or a raw tx
 * pasted, dropped or scanned by the user. Lives in memory only.
 */
import { Transaction, RawTx } from "@scure/btc-signer";
import { base64 } from "@scure/base";
import { bytesToHex, hexToBytes } from "@/lib/bitcoin/hex";
import { parsePSBT, type PSBTParseResult } from "@/lib/bitcoin/psbt";
import { describeScript, INPUT_VSIZE, netFor, scriptSigAsm } from "@/lib/bitcoin/tx-convert";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import type { MempoolTransaction, MempoolVin, MempoolVout } from "@/lib/api/types";

export type LocalTxStatus = "unsigned" | "partial" | "signed";

export interface LocalTx {
  source: "psbt" | "raw";
  status: LocalTxStatus;
  /** Engine shape. txid is real only when the tx is signed (legacy scriptSigs change it). */
  tx: MempoolTransaction;
  /** Input indexes whose prevout (value + script) is unknown. */
  missingPrevouts: number[];
  /** Broadcastable hex, only when status === "signed". */
  signedHex: string | null;
  /** PSBT metadata (fee, vsize...) for PSBT sources. */
  psbt: PSBTParseResult | null;
}

export const PREVIEW_TXID = "psbt-preview";

const RAW_OPTS = { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true } as const;
const MIN_RAW_TX_HEX = 120; // 60 bytes: smallest plausible 1-in-1-out tx
const HEX_RE = /^[0-9a-fA-F]+$/;

/** Strict raw tx check: hex, even, not a txid, and parses with no trailing bytes. Never throws. */
export function isRawTxHex(text: string): boolean {
  if (text.length < MIN_RAW_TX_HEX || text.length % 2 !== 0 || !HEX_RE.test(text)) return false;
  if (text.toLowerCase().startsWith("70736274ff")) return false; // PSBT hex
  try {
    decodeRaw(hexToBytes(text));
    return true;
  } catch {
    return false;
  }
}

function decodeRaw(bytes: Uint8Array) {
  const raw = RawTx.decode(bytes); // throws on trailing bytes / truncation
  if (raw.inputs.length === 0 || raw.outputs.length === 0) throw new Error("Transaction has no inputs or outputs");
  return Transaction.fromRaw(bytes, RAW_OPTS);
}

/** Parse a raw transaction (hex or bytes). Prevouts are unknown until looked up. */
export function parseRawTx(hexOrBytes: string | Uint8Array, network: BitcoinNetwork): LocalTx {
  const bytes = typeof hexOrBytes === "string" ? hexToBytes(hexOrBytes.trim()) : hexOrBytes;
  const tx = decodeRaw(bytes);
  const net = netFor(network);

  const vin: MempoolVin[] = [];
  let signed = true;
  let estimatedVsize = 10.5;
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    const witness = inp.finalScriptWitness?.map(bytesToHex) ?? [];
    const scriptsig = inp.finalScriptSig ? bytesToHex(inp.finalScriptSig) : "";
    if (witness.length === 0 && scriptsig === "") signed = false;
    estimatedVsize += 68;
    vin.push({
      txid: inp.txid ? bytesToHex(inp.txid) : `unknown_${i}`,
      vout: inp.index ?? 0,
      prevout: null,
      scriptsig,
      scriptsig_asm: scriptSigAsm(inp.finalScriptSig),
      witness,
      is_coinbase: false,
      sequence: inp.sequence ?? 0xffffffff,
    });
  }
  const vout: MempoolVout[] = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const out = tx.getOutput(i);
    estimatedVsize += 31;
    vout.push({
      ...(out.script ? describeScript(out.script, net) : { scriptpubkey: "", scriptpubkey_type: "unknown", scriptpubkey_address: "" }),
      scriptpubkey_asm: "",
      value: Number(out.amount ?? 0n),
    });
  }

  const weight = signed ? tx.weight : Math.ceil(estimatedVsize) * 4;
  return {
    source: "raw",
    status: signed ? "signed" : "unsigned",
    tx: {
      txid: signed ? tx.id : PREVIEW_TXID,
      version: tx.version,
      locktime: tx.lockTime,
      vin,
      vout,
      size: signed ? bytes.length : Math.ceil(estimatedVsize),
      weight,
      fee: 0,
      status: { confirmed: false },
    },
    missingPrevouts: vin.map((_, i) => i),
    signedHex: signed ? bytesToHex(bytes) : null,
    psbt: null,
  };
}

function psbtBytes(input: string): Uint8Array {
  const t = input.trim();
  if (t.startsWith("cHNidP")) return base64.decode(t);
  return hexToBytes(t);
}

/** Parse a PSBT and work out whether it can be finalized (= broadcastable). */
export function psbtToLocalTx(input: string, network: BitcoinNetwork): LocalTx {
  const parsed = parsePSBT(input, network);
  const tx = Transaction.fromPSBT(psbtBytes(input));

  let status: LocalTxStatus = "unsigned";
  let signedHex: string | null = null;
  let txid = PREVIEW_TXID;
  try {
    const c = tx.clone();
    if (!c.isFinal) c.finalize();
    const extracted = c.extract();
    signedHex = bytesToHex(extracted);
    txid = Transaction.fromRaw(extracted, RAW_OPTS).id;
    status = "signed";
  } catch {
    for (let i = 0; i < tx.inputsLength; i++) {
      const inp = tx.getInput(i);
      if ((inp.partialSig?.length ?? 0) > 0 || inp.tapKeySig || (inp.tapScriptSig?.length ?? 0) > 0) status = "partial";
    }
  }

  const missingPrevouts = parsed.tx.vin.flatMap((v, i) => (v.prevout ? [] : [i]));
  return {
    source: "psbt",
    status,
    tx: { ...parsed.tx, txid },
    missingPrevouts,
    signedHex,
    psbt: parsed,
  };
}

/** PSBT (base64/hex) or raw tx hex. Throws with the parser's reason. */
export function parseLocalTx(text: string, network: BitcoinNetwork): LocalTx {
  const t = text.trim();
  if (t.startsWith("cHNidP") || t.toLowerCase().startsWith("70736274ff")) return psbtToLocalTx(t, network);
  return parseRawTx(t, network);
}

/** i18n label for the scan header / ScanScreen ("PSBT · 2 in · 3 out"). */
export function localTxLabel(local: LocalTx) {
  return {
    key: local.source === "psbt" ? ("local.queryPsbt" as const) : ("local.queryRaw" as const),
    inputs: local.tx.vin.length,
    outputs: local.tx.vout.length,
  };
}

// Silence unused-import lint if INPUT_VSIZE ends up unused after refactors.
void INPUT_VSIZE;
```

Remove the `void INPUT_VSIZE;` line and the `INPUT_VSIZE` import if lint reports it unused (it is used only in `psbt.ts`).

If `c.isFinal` is not a getter in btc-signer 2.4.1 (check `node_modules/@scure/btc-signer/transaction.d.ts`), use `try { c.finalize(); } catch { /* already final */ }` before `extract()`; the "finalized PSBT" test decides.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/input/__tests__/local-tx.test.ts src/lib/bitcoin/__tests__/psbt.test.ts`
Expected: PASS (psbt tests unchanged and green after the move).

- [ ] **Step 6: Commit**

```bash
git add src/lib/bitcoin/tx-convert.ts src/lib/bitcoin/psbt.ts src/lib/input/local-tx.ts src/lib/input/__tests__/local-tx.test.ts src/lib/input/__tests__/fixtures.ts
git commit -m "feat(input): LocalTx parsing for PSBT and raw transactions"
```

---

### Task 2: Input detection and cleaning (truncation fix)

**Files:**
- Modify: `src/lib/types.ts:3` (`InputType` adds `"rawtx"`)
- Modify: `src/lib/analysis/detect-input.ts`
- Test: `src/lib/analysis/__tests__/detect-input.test.ts` (update the 512 test at line ~112, add cases)

**Interfaces:**
- Consumes: `isRawTxHex` (Task 1).
- Produces: `InputType = "txid" | "address" | "xpub" | "psbt" | "rawtx" | "invalid"`; `cleanInput(input: string): string` (payload-aware); `MAX_PAYLOAD_LENGTH`; `isLocalPayloadPrefix(s: string): boolean` (true for strings starting `cHNidP` or `70736274ff`).

- [ ] **Step 1: Write the failing tests** (append to `detect-input.test.ts`; replace the existing "truncates to 512" test with the first two cases)

```ts
import { base64 } from "@scure/base";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt } from "@/lib/input/__tests__/fixtures";
import { cleanInput, detectInputType, MAX_PAYLOAD_LENGTH } from "../detect-input";

describe("cleanInput payloads", () => {
  it("still caps short, non-payload input at 512 chars", () => {
    expect(cleanInput("x".repeat(600))).toHaveLength(512);
  });

  it("keeps a full PSBT longer than 512 chars", () => {
    const b64 = base64.encode(buildPsbt({ sign: false, nonWitness: true }).toPSBT());
    expect(cleanInput(b64)).toBe(b64);
  });

  it("joins a line-wrapped base64 PSBT (Review Focus 1)", () => {
    const b64 = base64.encode(buildPsbt({ sign: false, nonWitness: true }).toPSBT());
    const wrapped = b64.match(/.{1,64}/g)!.join("\n") + "\n";
    expect(cleanInput(wrapped)).toBe(b64);
    expect(cleanInput(b64.match(/.{1,76}/g)!.join(" "))).toBe(b64);
  });

  it("caps payloads at MAX_PAYLOAD_LENGTH", () => {
    expect(cleanInput("cHNidP" + "A".repeat(MAX_PAYLOAD_LENGTH))).toHaveLength(MAX_PAYLOAD_LENGTH);
  });

  it("takes the address from a BIP21 URI and lowercases uppercase bech32", () => {
    expect(cleanInput("bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?amount=0.1")).toBe("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
    expect(cleanInput("BITCOIN:BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4")).toBe("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
    expect(cleanInput("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4")).toBe("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
  });
});

describe("detectInputType rawtx", () => {
  it("detects a signed raw tx", () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    expect(detectInputType(bytesToHex(t.extract()))).toBe("rawtx");
  });
  it("random even hex is invalid, not rawtx (Review Focus 2)", () => {
    expect(detectInputType("00".repeat(80))).toBe("invalid");
    expect(detectInputType("0100000000".repeat(30))).toBe("invalid");
    expect(detectInputType("ff".repeat(1000))).toBe("invalid");
  });
  it("64-hex stays a txid and PSBT hex stays psbt", () => {
    expect(detectInputType("a".repeat(64))).toBe("txid");
    expect(detectInputType(bytesToHex(buildPsbt({ sign: false }).toPSBT()))).toBe("psbt");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/analysis/__tests__/detect-input.test.ts`
Expected: FAIL (truncated PSBT, no `rawtx`, no `MAX_PAYLOAD_LENGTH`).

- [ ] **Step 3: Implement**

In `src/lib/types.ts` line 3:
```ts
export type InputType = "txid" | "address" | "xpub" | "psbt" | "rawtx" | "invalid";
```

In `src/lib/analysis/detect-input.ts`, replace `cleanInput` and the start of `detectInputType`:

```ts
import { isRawTxHex } from "@/lib/input/local-tx";

/** Max length for short inputs (address, txid, xpub, URL). */
const MAX_INPUT_LENGTH = 512;
/** Max length for transaction payloads (PSBT, raw tx, UR, BBQr). */
export const MAX_PAYLOAD_LENGTH = 4 * 1024 * 1024;

/** True for strings that start like a PSBT (base64 or hex). */
export function isLocalPayloadPrefix(s: string): boolean {
  return s.startsWith("cHNidP") || s.toLowerCase().startsWith("70736274ff");
}

/** Long hex or PSBT-looking text: whitespace inside is line wrapping, not content. */
function looksLikePayload(s: string): boolean {
  const compact = s.replace(/\s+/g, "");
  return isLocalPayloadPrefix(compact) || (compact.length > 64 && /^[0-9a-fA-F]+$/.test(compact));
}

const BIP21_RE = /^bitcoin:([a-z0-9]+)(?:\?.*)?$/i;
const UPPER_BECH32_RE = /^(BC1|TB1)[02-9AC-HJ-NP-Z]+$/;

/** Clean user input, extracting from URLs / BIP21 if needed. Payloads keep their full length. */
export function cleanInput(input: string): string {
  // Strip zero-width joiners and Unicode directional overrides; keep \n, \r, \t for payload unwrapping
  const stripped = input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f​-‏ - ⁠-⁯]/g, "");
  if (looksLikePayload(stripped)) {
    return stripped.replace(/\s+/g, "").slice(0, MAX_PAYLOAD_LENGTH);
  }
  const trimmed = stripped.replace(/[\t\n\r]/g, "").trim().slice(0, MAX_INPUT_LENGTH);
  const bip21 = trimmed.match(BIP21_RE)?.[1];
  const candidate = bip21 ?? extractFromUrl(trimmed) ?? trimmed;
  return UPPER_BECH32_RE.test(candidate) ? candidate.toLowerCase() : candidate;
}
```

In `detectInputType`, after the PSBT check add:
```ts
  // Raw transaction hex (signed or unsigned); strict parse, so other hex stays invalid
  if (isRawTxHex(trimmed)) return "rawtx";
```

Keep the PSBT check using `isPSBT` (it accepts the `70736274ff` hex prefix).

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/lib/analysis/__tests__/detect-input.test.ts src/lib/input`
Expected: PASS. Then `pnpm type-check`: fix every `switch`/record over `InputType` it reports (for example `scan-model.ts`, `AddressInput.tsx` hint) by treating `"rawtx"` like `"psbt"`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/analysis/detect-input.ts src/lib/analysis/__tests__/detect-input.test.ts src/lib/input/__tests__ src/components/scan/scan-model.ts src/components/AddressInput.tsx
git commit -m "fix(input): keep full PSBTs, detect raw tx hex, unwrap pasted payloads"
```

---

### Task 3: Local analysis in the hook, no persistence anywhere

**Files:**
- Create: `src/lib/analysis/run-local-analysis.ts`
- Modify: `src/lib/analysis/analysis-state.ts` (replace `psbtData` with `localTx: LocalTx | null`)
- Modify: `src/hooks/useAnalysis.ts` (local branch replaces the PSBT branch; add `retryLocal`)
- Modify: `src/hooks/useScanner.ts` (submit path, never add local scans to history)
- Modify: `src/hooks/useRecentScans.ts`, `src/hooks/useBookmarks.ts` (drop truncated PSBT entries on read)
- Modify: `src/app/page.tsx`, `src/components/results/Results.tsx`, `src/components/results/ResultsFooter.tsx`, `src/components/scan/ScanScreen.tsx`
- Modify: `src/lib/analysis/finding-metadata.ts` (new finding id `local-needs-amounts`)
- Test: `src/lib/analysis/__tests__/run-local-analysis.test.ts`, `src/hooks/__tests__/useAnalysis.test.ts`, `src/hooks/__tests__/useRecentScans.test.ts`, new `src/hooks/__tests__/local-privacy.test.tsx`

**Interfaces:**
- Consumes: `LocalTx`, `parseLocalTx`, `localTxLabel` (Task 1); `InputType` with `"rawtx"` (Task 2).
- Produces:
  ```ts
  // run-local-analysis.ts
  export interface LocalAnalysisDeps {
    /** Uncached client for parent/address lookups; null = no network access. */
    lookup: LookupClient | null;
    signal: AbortSignal;
    onStep?: (stepId: string, impact?: number) => void;
    boltzmannTimeoutMs: number;
    isCustomApi: boolean;
  }
  export type LookupClient = Pick<MempoolClient, "getTransaction" | "getAddress">;
  export interface LocalAnalysisResult {
    result: ScoringResult;
    tx: MempoolTransaction;              // prevouts patched when looked up
    lookedUp: boolean;
    outputTxCounts: Map<string, number> | null;
    boltzmannResult: BoltzmannWorkerResult | null;
    boltzmannStatus: "idle" | "complete" | "error";
  }
  export async function runLocalAnalysis(local: LocalTx, deps: LocalAnalysisDeps): Promise<LocalAnalysisResult>;
  export function countLookups(local: LocalTx): { inputs: number; addresses: number };
  ```
  - `AnalysisState.localTx: LocalTx | null`, `AnalysisState.localLookup: { status: "available" | "running" | "done" | "failed"; inputs: number; addresses: number } | null` (Task 8 fills `localLookup`; Task 3 adds the field with `null`).
  - `useAnalysis()` returns `retryLocal: () => void`.

- [ ] **Step 1: Write the failing pipeline test**

```ts
// src/lib/analysis/__tests__/run-local-analysis.test.ts
import { describe, it, expect, vi } from "vitest";
import { base64 } from "@scure/base";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt } from "@/lib/input/__tests__/fixtures";
import { parseLocalTx } from "@/lib/input/local-tx";
import { runLocalAnalysis } from "../run-local-analysis";

vi.mock("@/lib/analysis/boltzmann-compute", () => ({
  isAutoComputable: () => true,
  computeBoltzmann: vi.fn().mockResolvedValue(null),
}));

const deps = { lookup: null, signal: new AbortController().signal, boltzmannTimeoutMs: 1000, isCustomApi: false };

describe("runLocalAnalysis", () => {
  it("never reports timing-unconfirmed for a local tx", async () => {
    const local = parseLocalTx(base64.encode(buildPsbt({ sign: false }).toPSBT()), "mainnet");
    const r = await runLocalAnalysis(local, deps);
    expect(r.result.findings.some((f) => f.id === "timing-unconfirmed")).toBe(false);
  });

  it("lists missing amounts instead of silently skipping (raw tx, no lookup)", async () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    const r = await runLocalAnalysis(parseLocalTx(bytesToHex(t.extract()), "mainnet"), deps);
    const f = r.result.findings.find((x) => x.id === "local-needs-amounts");
    expect(f?.params).toEqual({ count: 1 });
    expect(r.lookedUp).toBe(false);
  });

  it("patches prevouts from looked-up parents and computes the fee", async () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    const local = parseLocalTx(bytesToHex(t.extract()), "mainnet");
    const parentId = local.tx.vin[0].txid;
    const parent = {
      txid: parentId, vin: [], status: { confirmed: true, block_height: 800_000 },
      vout: [{ value: 100_000, scriptpubkey: "0014" + "00".repeat(20), scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", scriptpubkey_asm: "" }],
    };
    const lookup = {
      getTransaction: vi.fn().mockResolvedValue(parent),
      getAddress: vi.fn().mockResolvedValue({ chain_stats: { tx_count: 3 }, mempool_stats: { tx_count: 0 } }),
    };
    const r = await runLocalAnalysis(local, { ...deps, lookup: lookup as never });
    expect(lookup.getTransaction).toHaveBeenCalledWith(parentId, expect.anything());
    expect(r.tx.vin[0].prevout?.value).toBe(100_000);
    expect(r.tx.fee).toBe(1_000);
    expect(r.outputTxCounts?.size).toBe(2);
    expect(r.result.findings.some((f) => f.id === "local-needs-amounts")).toBe(false);
    expect(local.tx.vin[0].prevout).toBeNull(); // input LocalTx untouched
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/analysis/__tests__/run-local-analysis.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `run-local-analysis.ts`**

```ts
// src/lib/analysis/run-local-analysis.ts
/**
 * Analysis pipeline for a transaction that is not on chain yet (PSBT or raw tx).
 * Network access only through `deps.lookup`, which the caller builds without the
 * IndexedDB cache and only after consent (or on a self-hosted backend).
 */
import { runTxHeuristicSteps, finalizeTxResult } from "@/lib/analysis/orchestrator";
import { getAddressedOutputs } from "@/lib/analysis/heuristics/tx-utils";
import { computeBoltzmann, isAutoComputable } from "@/lib/analysis/boltzmann-compute";
import { enhanceEntropyFinding } from "@/lib/analysis/boltzmann-enhance";
import type { LocalTx } from "@/lib/input/local-tx";
import type { MempoolClient } from "@/lib/api/mempool";
import type { MempoolTransaction } from "@/lib/api/types";
import type { TxContext } from "@/lib/analysis/heuristics/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { Finding, ScoringResult } from "@/lib/types";

export type LookupClient = Pick<MempoolClient, "getTransaction" | "getAddress">;

export interface LocalAnalysisDeps {
  lookup: LookupClient | null;
  signal: AbortSignal;
  onStep?: (stepId: string, impact?: number) => void;
  boltzmannTimeoutMs: number;
  isCustomApi: boolean;
}

export interface LocalAnalysisResult {
  result: ScoringResult;
  tx: MempoolTransaction;
  lookedUp: boolean;
  outputTxCounts: Map<string, number> | null;
  boltzmannResult: BoltzmannWorkerResult | null;
  boltzmannStatus: "idle" | "complete" | "error";
}

const MAX_PARENTS = 50;
const MAX_ADDRESSES = 20;
const CONCURRENCY = 4;

/** Findings that describe a broadcast tx and make no sense before broadcast. */
const NOT_FOR_LOCAL = new Set(["timing-unconfirmed"]);

const parentIds = (tx: MempoolTransaction) =>
  [...new Set(tx.vin.map((v) => v.txid).filter((id) => !id.startsWith("unknown_")))].slice(0, MAX_PARENTS);
const outputAddresses = (tx: MempoolTransaction) =>
  [...new Set(getAddressedOutputs(tx.vout).map((o) => o.scriptpubkey_address!))].slice(0, MAX_ADDRESSES);

/** How many requests a lookup would make (shown on the consent button). */
export function countLookups(local: LocalTx): { inputs: number; addresses: number } {
  return { inputs: parentIds(local.tx).length, addresses: outputAddresses(local.tx).length };
}

async function inBatches<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))));
  }
  return out;
}

function needsAmountsFinding(count: number): Finding {
  return {
    id: "local-needs-amounts",
    severity: "low",
    confidence: "high",
    params: { count },
    title: `${count} input amount${count > 1 ? "s" : ""} unknown`,
    description:
      "This transaction does not include the amounts of the coins it spends. Fee, change detection, " +
      "entropy and the Link Probability Matrix need them.",
    recommendation: "Complete the analysis with the lookup button, or paste a PSBT, which includes the amounts.",
    scoreImpact: 0,
  };
}

export async function runLocalAnalysis(local: LocalTx, deps: LocalAnalysisDeps): Promise<LocalAnalysisResult> {
  const { lookup, signal, onStep, boltzmannTimeoutMs, isCustomApi } = deps;
  const tx: MempoolTransaction = structuredClone(local.tx);

  let parentTxs: Map<string, MempoolTransaction> | undefined;
  let outputTxCounts: Map<string, number> | null = null;
  if (lookup) {
    const ids = parentIds(tx);
    const parents = await inBatches(ids, (id) => lookup.getTransaction(id, signal).catch(() => null));
    parentTxs = new Map(ids.flatMap((id, i) => (parents[i] ? [[id, parents[i]!] as const] : [])));
    for (const v of tx.vin) {
      if (v.prevout) continue;
      const o = parentTxs.get(v.txid)?.vout[v.vout];
      if (o) v.prevout = { ...o };
    }
    const addrs = outputAddresses(tx);
    const counts = await inBatches(addrs, (a) =>
      lookup.getAddress(a).then((d) => d.chain_stats.tx_count + d.mempool_stats.tx_count).catch(() => null),
    );
    outputTxCounts = new Map(addrs.flatMap((a, i) => (counts[i] === null ? [] : [[a, counts[i]!] as const])));
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  const missing = tx.vin.filter((v) => !v.prevout).length;
  if (missing === 0) {
    const inTotal = tx.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
    const outTotal = tx.vout.reduce((s, o) => s + o.value, 0);
    tx.fee = inTotal - outTotal;
  }

  const firstParent = tx.vin.length === 1 ? parentTxs?.get(tx.vin[0].txid) : undefined;
  const ctx: TxContext = {
    isCustomApi,
    ...(parentTxs && parentTxs.size > 0 ? { parentTxs } : {}),
    ...(firstParent ? { parentTx: firstParent } : {}),
    ...(outputTxCounts && outputTxCounts.size > 0 ? { outputTxCounts } : {}),
  };

  const boltzmannPromise = missing === 0 && isAutoComputable(tx)
    ? computeBoltzmann(tx, { timeoutMs: boltzmannTimeoutMs, signal }).catch(() => null)
    : Promise.resolve(null);

  const findings = (await runTxHeuristicSteps(tx, local.signedHex ?? undefined, onStep, ctx))
    .filter((f) => !NOT_FOR_LOCAL.has(f.id));
  if (missing > 0) findings.push(needsAmountsFinding(missing));

  const boltzmannResult = await boltzmannPromise;
  if (boltzmannResult && !boltzmannResult.timedOut) enhanceEntropyFinding(findings, boltzmannResult);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  return {
    result: finalizeTxResult(findings),
    tx,
    lookedUp: !!lookup,
    outputTxCounts,
    boltzmannResult: boltzmannResult ?? null,
    boltzmannStatus: boltzmannResult ? "complete" : missing === 0 && isAutoComputable(tx) ? "error" : "idle",
  };
}
```

Check the `getTransaction` signature in `src/lib/api/mempool.ts` (it takes `(txid, signal?)`), and `computeBoltzmann`'s options in `src/lib/analysis/boltzmann-compute.ts:37`; adjust the call if the option names differ.

Register the finding id in `src/lib/analysis/finding-metadata.ts` next to `"api-incomplete-prevout"`:
```ts
  "local-needs-amounts":       { adversaryTiers: [P], temporality: "historical" },
```
Add locale keys (en shown; es below; translate de/fr/pt/pl):
```json
"finding.local-needs-amounts.title": "{{count}} input amounts unknown",
"finding.local-needs-amounts.description": "This transaction does not include the amounts of the coins it spends. Fee, change detection, entropy and the Link Probability Matrix need them.",
"finding.local-needs-amounts.recommendation": "Complete the analysis with the lookup button, or paste a PSBT, which includes the amounts."
```
es: `"{{count}} importes de entrada desconocidos"`, `"Esta transacción no incluye los importes de las monedas que gasta. La comisión, la detección del cambio, la entropía y la Matriz de Probabilidad de Enlace los necesitan."`, `"Completa el análisis con el botón de consulta, o pega un PSBT, que incluye los importes."`

- [ ] **Step 4: Run the pipeline test**

Run: `pnpm vitest run src/lib/analysis/__tests__/run-local-analysis.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing hook privacy test**

```tsx
// src/hooks/__tests__/local-privacy.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { base64 } from "@scure/base";
import { buildPsbt } from "@/lib/input/__tests__/fixtures";

vi.setConfig({ testTimeout: 20_000 });
const idbPut = vi.fn();
vi.mock("@/lib/api/idb-cache", () => ({ idbGet: vi.fn(), idbPut, idbDelete: vi.fn(), idbClear: vi.fn() }));
vi.mock("@/lib/analysis/boltzmann-compute", () => ({ isAutoComputable: () => false, computeBoltzmann: vi.fn() }));
vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({
    network: "mainnet", setNetwork: vi.fn(),
    config: { mempoolBaseUrl: "https://mempool.space/api", explorerUrl: "https://mempool.space", label: "mainnet" },
    configFor: () => ({ mempoolBaseUrl: "https://mempool.space/api" }),
    customApiUrl: null, isUmbrel: false, isCustomApi: false,
  }),
}));

import { useScanner } from "../useScanner";

describe("local tx privacy", () => {
  beforeEach(() => { localStorage.clear(); window.location.hash = ""; });

  it("a PSBT scan writes nothing to localStorage, IndexedDB or the hash", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const psbt = base64.encode(buildPsbt({ sign: true, nonWitness: true }).toPSBT());
    const { result } = renderHook(() => useScanner());
    await act(async () => { result.current.handleSubmit(psbt); });
    await vi.waitFor(() => expect(result.current.analysis.phase).toBe("complete"));

    expect(window.location.hash).toBe("");
    expect(localStorage.getItem("recent-scans")).toBeNull();
    expect(idbPut).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("mempool"))).toHaveLength(0);
    expect(result.current.analysis.query).not.toContain("cHNidP");
  });
});
```

Check the real export names of `src/lib/api/idb-cache.ts` and mirror them in the mock. If `useScanner` needs other providers (i18n), copy the `react-i18next` mock from `useAnalysis.test.ts`.

- [ ] **Step 6: Run to verify failure**

Run: `pnpm vitest run src/hooks/__tests__/local-privacy.test.tsx`
Expected: FAIL (query contains the PSBT prefix, history entry written).

- [ ] **Step 7: Implement state, hook, scanner and results changes**

`src/lib/analysis/analysis-state.ts`: replace `psbtData: PSBTParseResult | null;` with
```ts
  /** In-memory PSBT/raw tx being analyzed (never persisted). */
  localTx: LocalTx | null;
  /** Consented lookup state for a local tx on a public backend (Task 8). */
  localLookup: { status: "available" | "running" | "done" | "failed"; inputs: number; addresses: number } | null;
```
and in `INITIAL_STATE` replace `psbtData: null,` with `localTx: null, localLookup: null,`. Update the import to `import type { LocalTx } from "@/lib/input/local-tx";`.

`src/hooks/useAnalysis.ts`: add `const localInputRef = useRef<string | null>(null);`, replace the whole `if (inputType === "psbt") { ... }` block with:

```ts
      // PSBT or raw tx: parse locally; network access only via an explicit lookup (Task 8)
      if (inputType === "psbt" || inputType === "rawtx") {
        localInputRef.current = input;
        const steps = getTxHeuristicSteps(ht);
        const startTime = Date.now();
        let local: LocalTx;
        try {
          local = parseLocalTx(input, network);
        } catch (err) {
          setState({
            ...INITIAL_STATE,
            phase: "error",
            query: t(inputType === "psbt" ? "local.kindPsbt" : "local.kindRaw", { defaultValue: inputType === "psbt" ? "PSBT" : "Raw transaction" }),
            inputType,
            error: t("errors.local_parse", {
              message: err instanceof Error ? err.message : "",
              defaultValue: "Could not read this transaction: {{message}}",
            }),
            errorCode: "not-retryable",
          });
          return;
        }
        const label = localTxLabel(local);
        setState({
          ...INITIAL_STATE,
          phase: "analyzing",
          query: t(label.key, { inputs: label.inputs, outputs: label.outputs, defaultValue: label.key === "local.queryPsbt" ? "PSBT · {{inputs}} in · {{outputs}} out" : "Raw transaction · {{inputs}} in · {{outputs}} out" }),
          inputType,
          steps,
          localTx: local,
          txData: local.tx,
        });
        try {
          const { runLocalAnalysis } = await import("@/lib/analysis/run-local-analysis");
          const r = await runLocalAnalysis(local, {
            lookup: null,
            signal: controller.signal,
            onStep,
            boltzmannTimeoutMs: (getAnalysisSettings().boltzmannTimeout ?? 300) * 1000,
            isCustomApi,
          });
          if (controller.signal.aborted) return;
          for (const cid of ["chain-backward", "chain-forward", "chain-cluster", "chain-spending", "chain-entity", "chain-taint"]) {
            onStep(cid); onStep(cid, 0);
          }
          setState((prev) => ({
            ...prev,
            phase: "complete",
            steps: markAllDone(prev.steps),
            result: r.result,
            txData: r.tx,
            boltzmannResult: r.boltzmannResult,
            boltzmannStatus: r.boltzmannStatus,
            durationMs: Date.now() - startTime,
          }));
        } catch (err) {
          if (controller.signal.aborted) return;
          setState((prev) => ({
            ...prev,
            phase: "error",
            error: err instanceof Error
              ? t("errors.local_parse", { message: err.message, defaultValue: "Could not read this transaction: {{message}}" })
              : t("errors.unexpected", { defaultValue: "An unexpected error occurred." }),
            errorCode: "not-retryable",
          }));
        }
        return;
      }
```
Error messages from btc-signer describe structure ("Wrong PSBT magic", "Unexpected end of input"), never the input itself; keep it that way (never interpolate `input`).

Add `const retryLocal = useCallback(() => { if (localInputRef.current) void analyze(localInputRef.current); }, [analyze]);` and return it from the hook. Remove the `parsePSBT` import; add `import { parseLocalTx, localTxLabel, type LocalTx } from "@/lib/input/local-tx";`.

If `run-local-analysis` should live in the lazily loaded engine like `runTxidAnalysis`, export it from `src/lib/analysis/load-engine.ts` instead of the dynamic import above; follow whatever `load-engine.ts` does for `runTxidAnalysis`.

`src/hooks/useScanner.ts`:
- import `detectInputType` and `useNetwork` already present (`network` from `useNetwork()`).
- Recent-scans effect: change the condition to `if (phase === "complete" && query && inputType && result && inputType !== "psbt" && inputType !== "rawtx")` and the `type` to `inputType === "txid" ? "txid" : "address"`.
- `handleSubmit`: replace `if (isPSBT(input)) { ... }` with
  ```ts
    const kind = detectInputType(input, network);
    if (kind === "psbt" || kind === "rawtx") { wallet.reset(); void analyze(input); return; }
  ```
  and drop the `isPSBT` import.

`src/hooks/useRecentScans.ts` and `src/hooks/useBookmarks.ts`: in each store parser, drop truncated PSBT entries saved by older versions:
```ts
import { isLocalPayloadPrefix } from "@/lib/analysis/detect-input";
// recent-scans parser:
return Array.isArray(parsed) ? parsed.filter((s: RecentScan) => typeof s?.input === "string" && !isLocalPayloadPrefix(s.input)) : [];
// bookmarks parser:
return Array.isArray(parsed) ? parsed.filter(isValidBookmark).filter((b) => !isLocalPayloadPrefix(b.input)) : [];
```
Add a test in `useRecentScans.test.ts`: seed `localStorage["recent-scans"]` with one `{input:"cHNidP8BAH...", ...}` and one txid entry, assert only the txid entry is returned.

`src/app/page.tsx`: replace the `psbtData` destructure with `localTx`, and `retryLocal` from `analysis`; pass to `Results`:
```tsx
            inputType={inputType === "psbt" || inputType === "rawtx" ? "txid" : inputType as "txid" | "address"}
            local={localTx}
            onRetryLocal={retryLocal}
```
and delete the `psbt={...}` prop. `ScanScreen` gets `txData={inputType === "txid" || localTx ? txData : null}`.

`src/components/results/Results.tsx`:
- Props: delete `psbt`; add `local?: LocalTx | null; onRetryLocal?: () => void;`.
- Replace the `PsbtBanner` lazy import with `const BeforeYouSend = lazy(() => import("@/components/flows/BeforeYouSend").then((m) => ({ default: m.BeforeYouSend })));` and render `{local && <Suspense fallback={null}><BeforeYouSend local={local} txData={txData} result={result} /></Suspense>}` where the banner was. (Task 3 ships a minimal `BeforeYouSend` that renders the existing banner metrics; Task 9 completes it.)
- `<InlineSearchBar onScan={onScan} initialValue={local ? "" : query} />`
- `{!local && <ResultActions ... />}`
- `VerdictBand onRetry={local ? (onRetryLocal ?? (() => {})) : () => onScan(query)}`
- `ResultsFooter explorerUrl={local ? null : explorerUrl}`.

`src/components/results/ResultsFooter.tsx`: change `explorerUrl: string;` to `explorerUrl: string | null;` and wrap the explorer link JSX in `{explorerUrl && (...)}`.

Minimal `src/components/flows/BeforeYouSend.tsx` for this task (move the body of `PsbtBanner.tsx` into it, reading metrics from `local`), then delete `PsbtBanner.tsx` and its test if any:
```tsx
"use client";
import { useTranslation } from "react-i18next";
import { formatSats } from "@/lib/format";
import type { LocalTx } from "@/lib/input/local-tx";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ScoringResult } from "@/lib/types";

export function BeforeYouSend({ local, txData }: { local: LocalTx; txData: MempoolTransaction | null; result: ScoringResult }) {
  const { t, i18n } = useTranslation();
  const tx = txData ?? local.tx;
  const known = tx.vin.every((v) => v.prevout);
  const vsize = Math.ceil(tx.weight / 4);
  const fee = known ? tx.fee : 0;
  const na = t("psbt.na", { defaultValue: "n/a" });
  const metrics = [
    { label: t("psbt.inputs", { defaultValue: "Inputs" }), value: String(tx.vin.length) },
    { label: t("psbt.outputs", { defaultValue: "Outputs" }), value: String(tx.vout.length) },
    { label: t("psbt.fee", { defaultValue: "Fee" }), value: fee > 0 ? formatSats(fee, i18n.language) : na },
    { label: t("psbt.feeRate", { defaultValue: "Fee rate" }), value: fee > 0 && vsize > 0 ? `${Math.round(fee / vsize)} sat/vB` : na },
  ];
  return (
    <section data-testid="before-you-send" aria-labelledby="bys-title" className="rounded-2xl border border-hairline bg-surface-inset p-5 space-y-3">
      <h2 id="bys-title" className="text-sm font-semibold text-foreground">
        {t("local.title", { defaultValue: "Before you send" })}
      </h2>
      <p className="text-xs text-muted">{t("flows.psbtLocal", { defaultValue: "Analyzed locally. Nothing is sent unless you choose to." })}</p>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <div key={m.label}><dt className="text-xs text-muted">{m.label}</dt><dd className="text-sm text-foreground tabular-nums">{m.value}</dd></div>
        ))}
      </dl>
    </section>
  );
}
```
Copy the exact class names and the `psbt.na` key from the current `PsbtBanner.tsx` (if it uses a different "n/a" key, use that) so visuals stay identical; keep `data-testid="psbt-banner"` on the section too if any e2e test uses it (grep `psbt-banner` in `e2e/`).

`src/components/scan/ScanScreen.tsx`: `const isPsbt = inputType === "psbt" || inputType === "rawtx";`, eyebrow uses `scan.eyebrowRawTx` ("Scanning transaction") for `rawtx`.

New locale keys (all 6 locales; en / es given):
| key | en | es |
|---|---|---|
| `local.queryPsbt` | PSBT · {{inputs}} in · {{outputs}} out | PSBT · {{inputs}} entradas · {{outputs}} salidas |
| `local.queryRaw` | Raw transaction · {{inputs}} in · {{outputs}} out | Transacción en bruto · {{inputs}} entradas · {{outputs}} salidas |
| `local.kindPsbt` | PSBT | PSBT |
| `local.kindRaw` | Raw transaction | Transacción en bruto |
| `local.title` | Before you send | Antes de enviar |
| `errors.local_parse` | Could not read this transaction: {{message}} | No se pudo leer esta transacción: {{message}} |
| `scan.eyebrowRawTx` | Scanning transaction | Analizando transacción |
| `flows.psbtLocal` (update) | Analyzed locally. Nothing is sent unless you choose to. | Analizado en tu navegador. No se envía nada salvo que tú lo decidas. |

Update `src/hooks/__tests__/useAnalysis.test.ts`: the two PSBT tests mock `parsePSBT`; change them to mock `@/lib/input/local-tx` (`parseLocalTx`) and assert the new error key text "Could not read this transaction: unexpected end of input".

- [ ] **Step 8: Run tests and gates**

Run: `pnpm vitest run src/hooks src/lib/analysis src/lib/input && pnpm type-check && pnpm lint`
Expected: PASS, including `local-privacy.test.tsx` and the locale-parity test.

- [ ] **Step 9: Commit**

```bash
git add src/lib/analysis src/hooks src/app/page.tsx src/components/results src/components/scan src/components/flows public/locales
git commit -m "feat(local): analyze PSBT and raw tx in memory only, Before you send panel"
```

---

### Task 4: File open and drag-and-drop

**Files:**
- Create: `src/lib/input/file.ts`, `src/components/InputExtras.tsx`
- Modify: `src/components/AddressInput.tsx`, `src/components/results/InlineSearchBar.tsx`
- Test: `src/lib/input/__tests__/file.test.ts`, `src/components/__tests__/InputExtras.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export const MAX_FILE_BYTES = 4 * 1024 * 1024;
  export class InputFileError extends Error { constructor(public reason: "too-large" | "unreadable") }
  export function bytesToPayload(bytes: Uint8Array): string; // PSBT magic -> hex; printable UTF-8 -> trimmed text; else hex
  export async function readInputFile(file: File): Promise<string>;
  // InputExtras.tsx
  export function InputExtras(props: { onPayload: (text: string) => void; onError: (message: string) => void; compact?: boolean }): JSX.Element;
  export function useFileDrop(onPayload: (text: string) => void, onError: (message: string) => void): { onDragOver: React.DragEventHandler; onDrop: React.DragEventHandler; dragging: boolean };
  ```
- Task 19 adds the QR button inside `InputExtras`.

- [ ] **Step 1: Failing tests**

```ts
// src/lib/input/__tests__/file.test.ts
import { describe, it, expect } from "vitest";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt } from "./fixtures";
import { bytesToPayload, readInputFile, MAX_FILE_BYTES, InputFileError } from "../file";

describe("bytesToPayload", () => {
  it("binary PSBT -> hex", () => {
    const bytes = buildPsbt({ sign: false }).toPSBT();
    expect(bytesToPayload(bytes)).toBe(bytesToHex(bytes));
  });
  it("text file -> trimmed text", () => {
    expect(bytesToPayload(new TextEncoder().encode("  cHNidP8BAH\n"))).toBe("cHNidP8BAH");
  });
  it("binary raw tx -> hex", () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    const raw = t.extract();
    expect(bytesToPayload(raw)).toBe(bytesToHex(raw));
  });
});

describe("readInputFile", () => {
  it("rejects files over 4 MB", async () => {
    const f = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "big.psbt");
    await expect(readInputFile(f)).rejects.toBeInstanceOf(InputFileError);
  });
  it("reads a .psbt file", async () => {
    const bytes = buildPsbt({ sign: false }).toPSBT();
    expect(await readInputFile(new File([bytes], "tx.psbt"))).toBe(bytesToHex(bytes));
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`pnpm vitest run src/lib/input/__tests__/file.test.ts`).

- [ ] **Step 3: Implement `file.ts`**

```ts
// src/lib/input/file.ts
import { bytesToHex } from "@/lib/bitcoin/hex";

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];

export class InputFileError extends Error {
  constructor(public reason: "too-large" | "unreadable") {
    super(reason);
    this.name = "InputFileError";
  }
}

/** File or QR bytes -> the canonical string the text field accepts. */
export function bytesToPayload(bytes: Uint8Array): string {
  if (PSBT_MAGIC.every((b, i) => bytes[i] === b)) return bytesToHex(bytes);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/^[\x20-\x7e\t\r\n]*$/.test(text)) return text.trim();
  } catch {
    // not UTF-8: binary
  }
  return bytesToHex(bytes);
}

export async function readInputFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new InputFileError("too-large");
  try {
    return bytesToPayload(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new InputFileError("unreadable");
  }
}
```

- [ ] **Step 4: Implement `InputExtras.tsx`**

```tsx
"use client";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileUp } from "lucide-react";
import { readInputFile, InputFileError } from "@/lib/input/file";

function useFileReader(onPayload: (text: string) => void, onError: (m: string) => void) {
  const { t } = useTranslation();
  return useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      onPayload(await readInputFile(file));
    } catch (err) {
      onError(err instanceof InputFileError && err.reason === "too-large"
        ? t("input.errorFileTooLarge", { defaultValue: "That file is larger than 4 MB." })
        : t("input.errorFileUnreadable", { defaultValue: "That file could not be read." }));
    }
  }, [onPayload, onError, t]);
}

/** Drag-and-drop on any wrapper element. */
export function useFileDrop(onPayload: (text: string) => void, onError: (m: string) => void) {
  const read = useFileReader(onPayload, onError);
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setDragging(false);
      void read(e.dataTransfer.files[0]);
    },
  };
}

/** Icon buttons inside the search fields: open a file (and, from Task 19, scan a QR). */
export function InputExtras({ onPayload, onError }: { onPayload: (text: string) => void; onError: (m: string) => void }) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const read = useFileReader(onPayload, onError);
  const label = t("input.openFile", { defaultValue: "Open a PSBT or transaction file" });
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        data-testid="open-file"
        onClick={() => fileRef.current?.click()}
        className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-muted hover:text-foreground transition-colors"
        aria-label={label}
        title={label}
      >
        <FileUp size={18} aria-hidden="true" />
      </button>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ""; }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Wire into both fields**

`AddressInput.tsx`: wrap the `<form>`'s inner `div.relative.group` handlers with `useFileDrop(submit, setError)` (spread `onDragOver/onDragLeave/onDrop`, add `ring-2 ring-bitcoin/40` to the frame while `dragging`); render `<InputExtras onPayload={submit} onError={setError} />` absolutely positioned left of the Scan button (`absolute right-[calc(theme(spacing.24))] top-1/2 -translate-y-1/2`; increase the input's right padding from `pr-24 sm:pr-20` to `pr-36 sm:pr-32`). `submit` already runs `cleanInput` + `detectInputType`, so a dropped file flows exactly like a paste.

`InlineSearchBar.tsx`: same, calling its existing submit logic (`onScan(cleaned)` after `cleanInput`/`detectInputType`; extract the body of its submit handler into `submitValue(raw: string)` and pass that).

Update copy (6 locales; en/es):
| key | en | es |
|---|---|---|
| `home.placeholder` | Address, txid, xpub, PSBT or raw tx | Dirección, txid, xpub, PSBT o tx en bruto |
| `input.placeholderScan` | Paste an address, txid, xpub, PSBT or raw transaction | Pega una dirección, txid, xpub, PSBT o transacción en bruto |
| `input.errorInvalid` | That doesn't look like an address, txid, xpub, PSBT or raw transaction. Check and try again. | Eso no parece una dirección, txid, xpub, PSBT ni transacción en bruto. Revísalo e inténtalo de nuevo. |
| `errors.invalid_input` | Not a Bitcoin address, txid, xpub, PSBT or raw transaction. | No es una dirección Bitcoin, txid, xpub, PSBT ni transacción en bruto. |
| `input.detectedPsbt` | PSBT | PSBT |
| `input.detectedRawTx` | Raw transaction | Transacción en bruto |
| `input.openFile` | Open a PSBT or transaction file | Abrir un archivo PSBT o de transacción |
| `input.errorFileTooLarge` | That file is larger than 4 MB. | Ese archivo ocupa más de 4 MB. |
| `input.errorFileUnreadable` | That file could not be read. | No se pudo leer ese archivo. |

`AddressInput.tsx` `InputTypeHint`: add `: type === "rawtx" ? t("input.detectedRawTx", { defaultValue: "Raw transaction" })`.

- [ ] **Step 6: Component test** (`src/components/__tests__/InputExtras.test.tsx`, jsdom): render `InputExtras` with `onPayload` spy, fire `change` on the hidden file input with a `File` of PSBT bytes, `await waitFor(() => expect(onPayload).toHaveBeenCalledWith(bytesToHex(bytes)))`.

- [ ] **Step 7: Run** `pnpm vitest run src/lib/input src/components/__tests__/InputExtras.test.tsx && pnpm type-check && pnpm lint` -> PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/input/file.ts src/lib/input/__tests__/file.test.ts src/components/InputExtras.tsx src/components/__tests__/InputExtras.test.tsx src/components/AddressInput.tsx src/components/results/InlineSearchBar.tsx public/locales
git commit -m "feat(input): open or drop PSBT and transaction files"
```

---

### Task 5: CLI and MCP accept raw transactions

**Files:**
- Modify: `cli/src/commands/scan-psbt.ts`, `cli/src/mcp/server.ts` (tool `scan_psbt` description + input handling)
- Test: `cli/src/__tests__/commands-scan-psbt.test.ts` (path per existing file; grep `commands-scan-psbt`)

**Interfaces:** Consumes `parseLocalTx`, `isRawTxHex`, `bytesToPayload` (Tasks 1, 4).

- [ ] **Step 1: Failing test**: add a case that calls `scanPsbt(<signed raw tx hex>, { json: true })` and expects JSON output with `inputs: 1, outputs: 2`; and a case reading a binary `.txn` file written to a temp dir with `fs.writeFileSync(path, rawBytes)`.

- [ ] **Step 2: Run** `cd cli && pnpm test -- commands-scan-psbt` -> FAIL.

- [ ] **Step 3: Implement**: in `scan-psbt.ts` read files as bytes (`readFileSync(input)`) and convert with `bytesToPayload`; replace the `isPSBT` check with `if (!isPSBT(data) && !isRawTxHex(data)) throw new Error("Invalid input: expected a PSBT (base64/hex/binary) or a raw transaction (hex/binary)");`; parse with `parseLocalTx(data, network)` and analyze `local.tx`, passing `local.signedHex ?? undefined` as rawHex; label the text output `"(PSBT)"` or `"(raw transaction)"` and add `status: local.status` to `psbtInfo`. No network calls (raw tx input amounts stay unknown; the `local-needs-amounts` finding says so). In `server.ts` update the `scan_psbt` description: "Analyze a PSBT or raw transaction (hex or base64) before broadcasting. Offline: no network access."

- [ ] **Step 4: Run** `cd cli && pnpm test && pnpm build` -> PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src
git commit -m "feat(cli): scan psbt also accepts raw transactions"
```

**PR 1 checkpoint:** run all gates (`pnpm type-check && pnpm lint && pnpm test && pnpm build`), then ask the owner before pushing `feat/before-you-send-1-input` and opening the PR.

---

# PR 2: Local analysis with consented lookups, checklist

### Task 6: Backend class

**Files:**
- Create: `src/lib/api/backend-class.ts`
- Test: `src/lib/api/__tests__/backend-class.test.ts`

**Interfaces:**
- Produces: `type BackendClass = "self-hosted" | "public"`; `backendClass(o: { isUmbrel: boolean; customApiUrl: string | null }): BackendClass`; `endpointHost(baseUrl: string): string` (hostname, or `location.host` for relative `/api`); `isOnionUrl(baseUrl: string): boolean`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { backendClass, endpointHost, isOnionUrl } from "../backend-class";

describe("backendClass", () => {
  it.each([
    [{ isUmbrel: true, customApiUrl: null }, "self-hosted"],
    [{ isUmbrel: false, customApiUrl: "http://192.168.1.5:3006/api" }, "self-hosted"],
    [{ isUmbrel: false, customApiUrl: "http://umbrel.local:3006/api" }, "self-hosted"],
    [{ isUmbrel: false, customApiUrl: "http://abcdefghijklmnop.onion/api" }, "self-hosted"],
    [{ isUmbrel: false, customApiUrl: "https://mempool.example.org/api" }, "public"],
    [{ isUmbrel: false, customApiUrl: null }, "public"],
  ] as const)("%o -> %s", (o, cls) => expect(backendClass(o)).toBe(cls));
});

it("endpointHost / isOnionUrl", () => {
  expect(endpointHost("https://mempool.space/api")).toBe("mempool.space");
  expect(isOnionUrl("http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api")).toBe(true);
});
```

- [ ] **Step 2: Run** -> FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/api/backend-class.ts
import { isLocalApi } from "./client";

export type BackendClass = "self-hosted" | "public";

/**
 * Self-hosted: Umbrel's /api proxy, or a custom URL on a private host (localhost,
 * RFC-1918, .local, .onion). mempool.space (clearnet or its onion) and custom URLs
 * on public hostnames are public: lookups there need the user's consent.
 */
export function backendClass({ isUmbrel, customApiUrl }: { isUmbrel: boolean; customApiUrl: string | null }): BackendClass {
  if (isUmbrel) return "self-hosted";
  return customApiUrl && isLocalApi(customApiUrl) ? "self-hosted" : "public";
}

export function endpointHost(baseUrl: string): string {
  if (baseUrl.startsWith("/")) return typeof window !== "undefined" ? window.location.host : "localhost";
  try { return new URL(baseUrl).hostname; } catch { return baseUrl; }
}

export function isOnionUrl(baseUrl: string): boolean {
  try { return new URL(baseUrl).hostname.endsWith(".onion"); } catch { return false; }
}
```

- [ ] **Step 4: Run** -> PASS. **Step 5: Commit** `git add src/lib/api/backend-class.ts src/lib/api/__tests__/backend-class.test.ts && git commit -m "feat(api): classify backends as self-hosted or public"`

---

### Task 7: Recommended fees endpoint

**Files:**
- Modify: `src/lib/api/mempool.ts` (add `getRecommendedFees`)
- Test: `src/lib/api/__tests__/mempool.test.ts` (or the existing client test file; grep `createMempoolClient` in `__tests__`)

**Interfaces:**
- Produces: `interface RecommendedFees { fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number; minimumFee: number }`; client method `getRecommendedFees(): Promise<RecommendedFees>` (GET `/v1/fees/recommended`).

- [ ] **Step 1: Failing test**: stub `fetch` to return `{fastestFee: 20, halfHourFee: 10, hourFee: 5, economyFee: 2, minimumFee: 1}` for `.../v1/fees/recommended`, call `createMempoolClient("https://x/api").getRecommendedFees()`, assert the object and the URL.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement** inside the returned object of `createMempoolClient`:
```ts
    getRecommendedFees(): Promise<RecommendedFees> {
      return get<RecommendedFees>("/v1/fees/recommended");
    },
```
Export the `RecommendedFees` interface from `mempool.ts`. If `cached-client.ts` wraps methods through an explicit policy table, add `getRecommendedFees` with a short TTL policy like other unconfirmed data, or leave it uncached (it is only called through the uncached client in Task 8).
- [ ] **Step 4: Run** -> PASS. **Step 5: Commit** `git commit -am "feat(api): recommended fees endpoint"` (stage only the two files).

---

### Task 8: Consented and automatic lookups in the hook

**Files:**
- Modify: `src/hooks/useAnalysis.ts`
- Test: `src/hooks/__tests__/useAnalysis.test.ts`

**Interfaces:**
- Consumes: `backendClass` (Task 6), `runLocalAnalysis`, `countLookups` (Task 3), `createMempoolClient` (`src/lib/api/mempool.ts`).
- Produces: `useAnalysis()` returns `completeLocalLookup: () => Promise<void>`; `state.localLookup` set as: self-hosted -> analysis runs with lookup immediately and `localLookup = { status: "done", ... }`; public with something to look up -> `{ status: "available", inputs, addresses }`; nothing to look up -> `null`.

- [ ] **Step 1: Failing tests** (add to `useAnalysis.test.ts`; extend the `NetworkContext` mock with a mutable `m.isUmbrel`, and mock `@/lib/api/mempool` `createMempoolClient` with `m.lookupClient`):

```ts
  it("public backend: local tx analyzed without network, lookup offered", async () => {
    m.parseLocalTx.mockReturnValue(LOCAL_RAW); // a LocalTx with 1 input, 2 addressed outputs, missingPrevouts [0]
    m.runLocalAnalysis.mockResolvedValue({ result: result(), tx: LOCAL_RAW.tx, lookedUp: false, outputTxCounts: null, boltzmannResult: null, boltzmannStatus: "idle" });
    const { result: hook } = renderHook(() => useAnalysis());
    await act(async () => { await hook.current.analyze(RAW_HEX); });
    expect(m.runLocalAnalysis).toHaveBeenCalledWith(LOCAL_RAW, expect.objectContaining({ lookup: null }));
    expect(hook.current.localLookup).toEqual({ status: "available", inputs: 1, addresses: 2 });
    expect(m.createMempoolClient).not.toHaveBeenCalled();
  });

  it("completeLocalLookup re-runs with an uncached client", async () => {
    // ...same setup, then:
    await act(async () => { await hook.current.completeLocalLookup(); });
    expect(m.createMempoolClient).toHaveBeenCalledWith(expect.stringContaining("/api"), expect.objectContaining({ timeoutMs: expect.any(Number) }));
    expect(m.runLocalAnalysis).toHaveBeenLastCalledWith(LOCAL_RAW, expect.objectContaining({ lookup: m.lookupClient }));
    expect(hook.current.localLookup?.status).toBe("done");
    expect(m.createApiClient).not.toHaveBeenCalled(); // never the IndexedDB-cached client
  });

  it("self-hosted backend: looks up automatically", async () => {
    m.isUmbrel = true;
    // ...analyze(RAW_HEX)
    expect(m.runLocalAnalysis).toHaveBeenCalledWith(LOCAL_RAW, expect.objectContaining({ lookup: m.lookupClient }));
    expect(hook.current.localLookup?.status).toBe("done");
  });
```

Define `LOCAL_RAW` in the test as a literal `LocalTx` (source "raw", status "signed", 1 vin with `prevout: null`, 2 vouts with `scriptpubkey_address` set). Mock `@/lib/analysis/run-local-analysis` (`runLocalAnalysis: m.runLocalAnalysis`, `countLookups: () => ({ inputs: 1, addresses: 2 })`).

- [ ] **Step 2: Run** -> FAIL.

- [ ] **Step 3: Implement**

In the local branch from Task 3, before running:
```ts
        const cls = backendClass({ isUmbrel, customApiUrl });
        const lookups = countLookups(local);
        const wantsLookup = lookups.inputs + lookups.addresses > 0;
        const lookup = cls === "self-hosted" && wantsLookup ? makeLookupClient(cfg, controller.signal) : null;
```
pass `lookup` into `runLocalAnalysis`, and in the completion `setState` add
```ts
            localLookup: !wantsLookup ? null : { status: lookup ? "done" : "available", ...lookups },
```
Helper inside the hook module:
```ts
/** Uncached, IP-linked lookups for a local tx: never createApiClient (IndexedDB cache). */
function makeLookupClient(cfg: NetworkConfig, signal: AbortSignal) {
  return createMempoolClient(cfg.mempoolBaseUrl, { signal, timeoutMs: isLocalApi(cfg.mempoolBaseUrl) ? 60_000 : 15_000 });
}
```
`completeLocalLookup`:
```ts
  const completeLocalLookup = useCallback(async () => {
    const local = state.localTx;
    if (!local || state.localLookup?.status === "running") return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => ({ ...prev, localLookup: prev.localLookup && { ...prev.localLookup, status: "running" } }));
    try {
      const { runLocalAnalysis } = await import("@/lib/analysis/run-local-analysis");
      const r = await runLocalAnalysis(local, {
        lookup: makeLookupClient(config, controller.signal),
        signal: controller.signal,
        boltzmannTimeoutMs: (getAnalysisSettings().boltzmannTimeout ?? 300) * 1000,
        isCustomApi,
      });
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        result: r.result, txData: r.tx, boltzmannResult: r.boltzmannResult, boltzmannStatus: r.boltzmannStatus,
        localLookup: prev.localLookup && { ...prev.localLookup, status: "done" },
      }));
    } catch {
      if (controller.signal.aborted) return;
      setState((prev) => ({ ...prev, localLookup: prev.localLookup && { ...prev.localLookup, status: "failed" } }));
    }
  }, [state.localTx, state.localLookup?.status, config, isCustomApi]);
```
Return `completeLocalLookup` and expose `outputTxCounts`: add `localOutputTxCounts: Map<string, number> | null` to `AnalysisState` (INITIAL `null`) and set it from `r.outputTxCounts` in both places; the checklist (Task 9) reads it.

- [ ] **Step 4: Run** `pnpm vitest run src/hooks/__tests__/useAnalysis.test.ts` -> PASS.

- [ ] **Step 5: Commit** `git add src/hooks src/lib/analysis/analysis-state.ts && git commit -m "feat(local): automatic lookups on own node, one-click consent on public backends"`

---

### Task 9: Pre-broadcast checklist and the full Before you send panel

**Files:**
- Create: `src/lib/analysis/pre-broadcast-checklist.ts`
- Modify: `src/components/flows/BeforeYouSend.tsx`, `src/components/results/Results.tsx`, `src/app/page.tsx`
- Test: `src/lib/analysis/__tests__/pre-broadcast-checklist.test.ts`, `src/components/flows/__tests__/BeforeYouSend.test.tsx`

**Interfaces:**
- Consumes: `LocalTx`, `ScoringResult`, `RecommendedFees`, `state.localLookup`, `state.localOutputTxCounts`, `completeLocalLookup`.
- Produces:
  ```ts
  export type SafetyId = "fee-absurd" | "fee-high" | "fee-low" | "dust" | "rbf-on" | "rbf-off" | "locktime-none" | "reused-output" | "unsigned" | "partial" | "signatures-later";
  export interface SafetyItem { id: SafetyId; tone: "bad" | "warn" | "info" | "good"; params?: Record<string, string | number> }
  export interface Checklist { reveals: Finding[]; safety: SafetyItem[]; feeRate: number | null }
  export function buildChecklist(input: { local: LocalTx; tx: MempoolTransaction; result: ScoringResult; fees: RecommendedFees | null; outputTxCounts: Map<string, number> | null }): Checklist;
  export const ABSURD_FEE_RATE = 1000; export const ABSURD_FEE_SHARE = 0.1; export const DUST_LIMIT = 546;
  ```
  `BeforeYouSend` props: `{ local: LocalTx; txData: MempoolTransaction | null; result: ScoringResult; lookup: AnalysisState["localLookup"]; outputTxCounts: Map<string, number> | null; onLookup: () => void; endpoint: string; onBroadcast?: () => void }` (`onBroadcast` used from Task 12).

- [ ] **Step 1: Failing tests**

```ts
// src/lib/analysis/__tests__/pre-broadcast-checklist.test.ts
import { describe, it, expect } from "vitest";
import { buildChecklist } from "../pre-broadcast-checklist";
import type { LocalTx } from "@/lib/input/local-tx";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ScoringResult } from "@/lib/types";

const out = (value: number, addr = "bc1qa", type = "v0_p2wpkh") =>
  ({ value, scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: type, scriptpubkey_address: addr });
const vin = (value: number | null, sequence = 0xfffffffd) =>
  ({ txid: "a".repeat(64), vout: 0, prevout: value === null ? null : out(value), scriptsig: "", scriptsig_asm: "", witness: [], is_coinbase: false, sequence });
const tx = (o: Partial<MempoolTransaction>): MempoolTransaction =>
  ({ txid: "psbt-preview", version: 2, locktime: 850_000, vin: [vin(100_000)], vout: [out(60_000), out(39_000, "bc1qb")], size: 141, weight: 564, fee: 1_000, status: { confirmed: false }, ...o });
const local = (status: LocalTx["status"]): LocalTx => ({ source: "psbt", status, tx: tx({}), missingPrevouts: [], signedHex: null, psbt: null });
const result = (findings: ScoringResult["findings"] = []) => ({ score: 80, grade: "B", findings } as unknown as ScoringResult);
const fees = { fastestFee: 20, halfHourFee: 10, hourFee: 5, economyFee: 2, minimumFee: 1 };
const ids = (c: ReturnType<typeof buildChecklist>) => c.safety.map((s) => s.id);

describe("buildChecklist", () => {
  it("absurd fee by rate and by share", () => {
    expect(ids(buildChecklist({ local: local("signed"), tx: tx({ fee: 150_000, vout: [out(1_000_000)] , vin: [vin(1_150_000)] }), result: result(), fees, outputTxCounts: null }))).toContain("fee-absurd");
    expect(ids(buildChecklist({ local: local("signed"), tx: tx({ fee: 20_000, vout: [out(80_000)], vin: [vin(100_000)] }), result: result(), fees, outputTxCounts: null }))).toContain("fee-absurd");
  });
  it("dust, rbf, locktime, unsigned", () => {
    const c = buildChecklist({ local: local("unsigned"), tx: tx({ locktime: 0, vin: [vin(100_000, 0xffffffff)], vout: [out(98_500), out(500, "bc1qd")] }), result: result(), fees, outputTxCounts: null });
    expect(ids(c)).toEqual(expect.arrayContaining(["dust", "rbf-off", "locktime-none", "unsigned", "signatures-later"]));
  });
  it("reused output address from looked-up history", () => {
    const c = buildChecklist({ local: local("signed"), tx: tx({}), result: result(), fees, outputTxCounts: new Map([["bc1qa", 3], ["bc1qb", 0]]) });
    expect(c.safety.find((s) => s.id === "reused-output")?.params).toEqual({ count: 1 });
  });
  it("reveals: top 5 negative findings by severity", () => {
    const f = (id: string, severity: string, scoreImpact: number) => ({ id, severity, scoreImpact, title: id, description: "", confidence: "high" });
    const c = buildChecklist({ local: local("signed"), tx: tx({}), result: result([
      f("a", "low", -1), f("b", "critical", -10), f("c", "good", 5), f("d", "high", -5), f("e", "medium", -3), f("g", "medium", -2), f("h", "low", -1),
    ] as never), fees, outputTxCounts: null });
    expect(c.reveals.map((x) => x.id)).toEqual(["b", "d", "e", "g", "a"]);
  });
  it("no fee items when input amounts are unknown", () => {
    const c = buildChecklist({ local: local("signed"), tx: tx({ vin: [vin(null)], fee: 0 }), result: result(), fees, outputTxCounts: null });
    expect(ids(c).some((i) => i.startsWith("fee-"))).toBe(false);
    expect(c.feeRate).toBeNull();
  });
});
```

- [ ] **Step 2: Run** -> FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/analysis/pre-broadcast-checklist.ts
import type { LocalTx } from "@/lib/input/local-tx";
import type { MempoolTransaction } from "@/lib/api/types";
import type { RecommendedFees } from "@/lib/api/mempool";
import type { Finding, ScoringResult } from "@/lib/types";

export type SafetyId = "fee-absurd" | "fee-high" | "fee-low" | "dust" | "rbf-on" | "rbf-off" | "locktime-none" | "reused-output" | "unsigned" | "partial" | "signatures-later";
export interface SafetyItem { id: SafetyId; tone: "bad" | "warn" | "info" | "good"; params?: Record<string, string | number> }
export interface Checklist { reveals: Finding[]; safety: SafetyItem[]; feeRate: number | null }

export const ABSURD_FEE_RATE = 1000;
export const ABSURD_FEE_SHARE = 0.1;
export const DUST_LIMIT = 546;
const MAX_REVEALS = 5;
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function buildChecklist({ local, tx, result, fees, outputTxCounts }: {
  local: LocalTx; tx: MempoolTransaction; result: ScoringResult; fees: RecommendedFees | null; outputTxCounts: Map<string, number> | null;
}): Checklist {
  const reveals = result.findings
    .filter((f) => f.scoreImpact < 0 && f.severity in SEVERITY_RANK)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.scoreImpact - b.scoreImpact)
    .slice(0, MAX_REVEALS);

  const safety: SafetyItem[] = [];
  if (local.status === "unsigned") safety.push({ id: "unsigned", tone: "info" });
  if (local.status === "partial") safety.push({ id: "partial", tone: "info" });
  if (local.status !== "signed") safety.push({ id: "signatures-later", tone: "info" });

  const known = tx.vin.every((v) => v.prevout);
  const vsize = Math.ceil(tx.weight / 4);
  const feeRate = known && vsize > 0 ? tx.fee / vsize : null;
  if (feeRate !== null) {
    const outTotal = tx.vout.reduce((s, o) => s + o.value, 0);
    if (feeRate > ABSURD_FEE_RATE || tx.fee > outTotal * ABSURD_FEE_SHARE) {
      safety.push({ id: "fee-absurd", tone: "bad", params: { rate: Math.round(feeRate), fee: tx.fee } });
    } else if (fees && feeRate > fees.fastestFee * 2) {
      safety.push({ id: "fee-high", tone: "warn", params: { rate: Math.round(feeRate), fastest: fees.fastestFee } });
    } else if (fees && feeRate < fees.economyFee) {
      safety.push({ id: "fee-low", tone: "warn", params: { rate: Math.round(feeRate * 10) / 10, economy: fees.economyFee } });
    }
  }

  const dust = tx.vout.filter((o) => o.scriptpubkey_type !== "op_return" && o.value < DUST_LIMIT).length;
  if (dust > 0) safety.push({ id: "dust", tone: "warn", params: { count: dust } });

  const rbf = tx.vin.some((v) => v.sequence < 0xfffffffe);
  safety.push({ id: rbf ? "rbf-on" : "rbf-off", tone: "info" });
  if (tx.locktime === 0) safety.push({ id: "locktime-none", tone: "info" });

  if (outputTxCounts) {
    const reused = tx.vout.filter((o) => o.scriptpubkey_address && (outputTxCounts.get(o.scriptpubkey_address) ?? 0) > 0).length;
    if (reused > 0) safety.push({ id: "reused-output", tone: "bad", params: { count: reused } });
  }

  return { reveals, safety, feeRate };
}
```

- [ ] **Step 4: Run** -> PASS.

- [ ] **Step 5: Complete `BeforeYouSend.tsx`**

Extend the Task 3 panel (keep metrics block):
1. Header row: title + status pill (`local.status.signed` "Signed, ready to broadcast" / `local.status.partial` "Partially signed" / `local.status.unsigned` "Not signed yet") + "Projected grade if broadcast: {{grade}}" (`local.projectedGrade`).
2. Lookup box when `lookup?.status === "available" | "running" | "failed"`:
   - text `local.lookupWhy`: "Complete the analysis: look up {{inputs}} inputs and {{addresses}} addresses on {{host}}."
   - privacy line `local.lookupReveals`: "This tells {{host}} which coins you are about to spend and where they go, linked to your IP address unless you use Tor."
   - button `local.lookupButton` "Look up on {{host}}" (`data-testid="local-lookup"`), disabled while running, spinner; on failure `local.lookupFailed` "The lookup failed. Try again." and the button stays.
3. Reveals list (`local.revealsTitle` "What this transaction reveals"): each finding's translated title (use the same `t("finding.<id>.title", { ...params, defaultValue: f.title })` call the findings list uses) and its recommendation in muted text; empty list -> `local.revealsNone` "No significant leaks found."
4. Safety list (`local.safetyTitle` "Before broadcasting"): one row per `SafetyItem`, icon/tone color via `text-severity-critical` (bad), `text-severity-medium` (warn), `text-muted` (info), `text-severity-good` (good); text keys `local.safety.<id>` with params:
   | id | en |
   |---|---|
   | fee-absurd | The fee is unusually high: {{rate}} sat/vB ({{fee}} sats). Check it before sending. |
   | fee-high | The fee rate ({{rate}} sat/vB) is more than twice the fastest estimate ({{fastest}} sat/vB). |
   | fee-low | The fee rate ({{rate}} sat/vB) is below the economy estimate ({{economy}} sat/vB). It may take a long time to confirm. |
   | dust | {{count}} output(s) below 546 sats (dust). |
   | rbf-on | Replace-by-fee is enabled: the fee can be bumped later. |
   | rbf-off | Replace-by-fee is disabled: the fee cannot be bumped later. |
   | locktime-none | nLockTime is 0. Wallets that set it to the current block height (anti-fee-sniping) blend in better. |
   | reused-output | {{count}} output address(es) already have history: sending to a reused address links this payment to it. |
   | unsigned | Sign it in your wallet, then paste or scan the signed transaction to broadcast it from here. |
   | partial | Some signatures are still missing. Finish signing in your wallet first. |
   | signatures-later | Signature-based wallet fingerprints become visible only once it is signed. |
   es: translate with tuteo (e.g. unsigned: "Fírmala en tu monedero y después pega o escanea la transacción firmada para emitirla desde aquí.").
5. Fees: fetch once on mount when the tx has all prevouts or after lookup: `createMempoolClient(config.mempoolBaseUrl).getRecommendedFees().catch(() => null)` inside a `useEffect` (this endpoint reveals nothing about the tx); store in state.
6. Broadcast slot: render nothing yet (Task 12 adds the button).

`Results.tsx` passes the new props (`lookup`, `outputTxCounts`, `onLookup`, `endpoint={endpointHost(config.mempoolBaseUrl)}`), threaded from `page.tsx` (`analysis.localLookup`, `analysis.localOutputTxCounts`, `analysis.completeLocalLookup`).

- [ ] **Step 6: Component test** (jsdom, i18n mock as in `useAnalysis.test.ts`): render `BeforeYouSend` with `lookup={{status:"available", inputs:3, addresses:2}}`, endpoint `mempool.space`; assert text "look up 3 inputs and 2 addresses on mempool.space", click `local-lookup`, assert `onLookup` called once; re-render with `status:"running"` and assert the button is disabled.

- [ ] **Step 7: Run** `pnpm vitest run src/lib/analysis src/components/flows && pnpm type-check && pnpm lint` -> PASS.

- [ ] **Step 8: Commit** `git add src/lib/analysis/pre-broadcast-checklist.ts src/lib/analysis/__tests__/pre-broadcast-checklist.test.ts src/components/flows src/components/results/Results.tsx src/app/page.tsx public/locales && git commit -m "feat(local): pre-broadcast checklist and lookup consent"`

**PR 2 checkpoint:** gates, then ask before pushing.

---

# PR 3: Broadcast

### Task 10: Broadcast client

**Files:**
- Create: `src/lib/api/broadcast.ts`
- Test: `src/lib/api/__tests__/broadcast.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BroadcastReason = "inputs-missing-or-spent" | "policy" | "other";
  export type BroadcastOutcome =
    | { kind: "sent"; txid: string; mismatch: boolean }
    | { kind: "already-confirmed"; txid: string }
    | { kind: "rejected"; code: number | null; message: string; reason: BroadcastReason }
    | { kind: "unknown" };
  export interface SendOpts { fetchImpl?: typeof fetch; timeoutMs?: number }
  export function parseRpcError(body: string): { code: number | null; message: string };
  export async function broadcastTx(baseUrl: string, hex: string, expectedTxid: string, opts?: SendOpts): Promise<BroadcastOutcome>;
  export async function testMempoolAccept(baseUrl: string, hex: string, opts?: SendOpts): Promise<{ allowed: true } | { allowed: false; reason: string } | null>;
  export async function getTxStatus(baseUrl: string, txid: string, opts?: SendOpts): Promise<"confirmed" | "mempool" | "not-found" | "error">;
  export const BROADCAST_TIMEOUT_MS = 30_000;
  ```

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect, vi } from "vitest";
import { broadcastTx, testMempoolAccept, getTxStatus, parseRpcError } from "../broadcast";

const res = (status: number, body: string) => new Response(body, { status });
const TXID = "b".repeat(64);

describe("broadcastTx", () => {
  it("POSTs hex as text/plain to {base}/tx exactly once", async () => {
    const f = vi.fn().mockResolvedValue(res(200, TXID));
    const out = await broadcastTx("https://mempool.space/api/", "0200", TXID, { fetchImpl: f });
    expect(out).toEqual({ kind: "sent", txid: TXID, mismatch: false });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://mempool.space/api/tx");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "text/plain" });
    expect(init.body).toBe("0200");
  });
  it("never retries a 5xx", async () => {
    const f = vi.fn().mockResolvedValue(res(502, "Bad gateway"));
    expect((await broadcastTx("https://x/api", "00", TXID, { fetchImpl: f })).kind).toBe("rejected");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("maps RPC codes", async () => {
    const body = (code: number, message: string) => `sendrawtransaction RPC error: {"code":${code},"message":"${message}"}`;
    const run = (b: string) => broadcastTx("https://x/api", "00", TXID, { fetchImpl: vi.fn().mockResolvedValue(res(400, b)) });
    expect(await run(body(-25, "bad-txns-inputs-missingorspent"))).toMatchObject({ kind: "rejected", code: -25, reason: "inputs-missing-or-spent" });
    expect(await run(body(-26, "min relay fee not met"))).toMatchObject({ kind: "rejected", reason: "policy" });
    expect(await run(body(-27, "Transaction already in block chain"))).toEqual({ kind: "already-confirmed", txid: TXID });
  });
  it("flags a txid mismatch", async () => {
    const out = await broadcastTx("https://x/api", "00", TXID, { fetchImpl: vi.fn().mockResolvedValue(res(200, "c".repeat(64))) });
    expect(out).toEqual({ kind: "sent", txid: "c".repeat(64), mismatch: true });
  });
  it("network error or timeout -> unknown", async () => {
    expect(await broadcastTx("https://x/api", "00", TXID, { fetchImpl: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) })).toEqual({ kind: "unknown" });
    const hang = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("t", "TimeoutError")))));
    expect(await broadcastTx("https://x/api", "00", TXID, { fetchImpl: hang as never, timeoutMs: 10 })).toEqual({ kind: "unknown" });
  });
});

describe("testMempoolAccept / getTxStatus / parseRpcError", () => {
  it("dry-run results", async () => {
    const ok = vi.fn().mockResolvedValue(res(200, JSON.stringify([{ txid: TXID, allowed: true }])));
    expect(await testMempoolAccept("https://x/api", "00", { fetchImpl: ok })).toEqual({ allowed: true });
    expect(ok.mock.calls[0][0]).toBe("https://x/api/txs/test");
    expect(ok.mock.calls[0][1].body).toBe('["00"]');
    const no = vi.fn().mockResolvedValue(res(200, JSON.stringify([{ txid: TXID, allowed: false, "reject-reason": "min relay fee not met" }])));
    expect(await testMempoolAccept("https://x/api", "00", { fetchImpl: no })).toEqual({ allowed: false, reason: "min relay fee not met" });
    expect(await testMempoolAccept("https://x/api", "00", { fetchImpl: vi.fn().mockResolvedValue(res(404, "")) })).toBeNull();
  });
  it("status", async () => {
    expect(await getTxStatus("https://x/api", TXID, { fetchImpl: vi.fn().mockResolvedValue(res(200, '{"confirmed":false}')) })).toBe("mempool");
    expect(await getTxStatus("https://x/api", TXID, { fetchImpl: vi.fn().mockResolvedValue(res(404, "")) })).toBe("not-found");
  });
  it("parseRpcError", () => {
    expect(parseRpcError('sendrawtransaction RPC error: {"code":-26,"message":"x"}')).toEqual({ code: -26, message: "x" });
    expect(parseRpcError("Bad gateway")).toEqual({ code: null, message: "Bad gateway" });
  });
});
```

- [ ] **Step 2: Run** -> FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/api/broadcast.ts
/**
 * Broadcasting a signed transaction. Plain fetch, never fetchWithRetry: a
 * retried POST could hide the real outcome. text/plain keeps it a CORS simple
 * request (mempool.space answers preflights with 404).
 */
export type BroadcastReason = "inputs-missing-or-spent" | "policy" | "other";
export type BroadcastOutcome =
  | { kind: "sent"; txid: string; mismatch: boolean }
  | { kind: "already-confirmed"; txid: string }
  | { kind: "rejected"; code: number | null; message: string; reason: BroadcastReason }
  | { kind: "unknown" };
export interface SendOpts { fetchImpl?: typeof fetch; timeoutMs?: number }

export const BROADCAST_TIMEOUT_MS = 30_000;
const TXID_RE = /^[0-9a-f]{64}$/;
const join = (base: string, path: string) => `${base.replace(/\/+$/, "")}${path}`;

export function parseRpcError(body: string): { code: number | null; message: string } {
  const json = body.match(/\{.*\}/s)?.[0];
  if (json) {
    try {
      const e = JSON.parse(json) as { code?: unknown; message?: unknown };
      if (typeof e.code === "number") return { code: e.code, message: typeof e.message === "string" ? e.message : body };
    } catch { /* fall through */ }
  }
  return { code: null, message: body.trim().slice(0, 300) };
}

async function send(url: string, init: RequestInit, opts?: SendOpts): Promise<Response> {
  const f = opts?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), opts?.timeoutMs ?? BROADCAST_TIMEOUT_MS);
  try {
    return await f(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function broadcastTx(baseUrl: string, hex: string, expectedTxid: string, opts?: SendOpts): Promise<BroadcastOutcome> {
  let r: Response;
  try {
    r = await send(join(baseUrl, "/tx"), { method: "POST", headers: { "Content-Type": "text/plain" }, body: hex }, opts);
  } catch {
    return { kind: "unknown" };
  }
  const body = (await r.text().catch(() => "")).trim();
  if (r.ok && TXID_RE.test(body)) return { kind: "sent", txid: body, mismatch: body !== expectedTxid };
  const { code, message } = parseRpcError(body || `HTTP ${r.status}`);
  if (code === -27) return { kind: "already-confirmed", txid: expectedTxid };
  const reason: BroadcastReason = code === -25 ? "inputs-missing-or-spent" : code === -26 ? "policy" : "other";
  return { kind: "rejected", code, message, reason };
}

export async function testMempoolAccept(baseUrl: string, hex: string, opts?: SendOpts) {
  try {
    const r = await send(join(baseUrl, "/txs/test"), { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify([hex]) }, opts);
    if (!r.ok) return null;
    const [first] = (await r.json()) as { allowed?: boolean; "reject-reason"?: string }[];
    if (!first || typeof first.allowed !== "boolean") return null;
    return first.allowed ? { allowed: true as const } : { allowed: false as const, reason: first["reject-reason"] ?? "rejected" };
  } catch {
    return null;
  }
}

export async function getTxStatus(baseUrl: string, txid: string, opts?: SendOpts) {
  try {
    const r = await send(join(baseUrl, `/tx/${txid}/status`), { method: "GET" }, opts);
    if (r.status === 404) return "not-found" as const;
    if (!r.ok) return "error" as const;
    return ((await r.json()) as { confirmed?: boolean }).confirmed ? ("confirmed" as const) : ("mempool" as const);
  } catch {
    return "error" as const;
  }
}
```

Also add a test asserting `public/sw.js` ignores non-GET (read the file text and assert it contains `if (event.request.method !== "GET") return;`) in `src/lib/api/__tests__/broadcast.test.ts`.

- [ ] **Step 4: Run** -> PASS. **Step 5: Commit** `git add src/lib/api/broadcast.ts src/lib/api/__tests__/broadcast.test.ts && git commit -m "feat(api): broadcast client without retries"`

---

### Task 11: After-broadcast navigation and indexing wait

**Files:**
- Modify: `src/lib/analysis/run-txid-analysis.ts` (`TxidAnalysisDeps.awaitIndexing?: boolean`)
- Modify: `src/hooks/useAnalysis.ts` (`analyze(input, opts?: { awaitIndexing?: boolean })`; `AnalysisState.awaitingIndex`)
- Modify: `src/hooks/useScanner.ts` (`handleBroadcastSuccess(txid: string)`)
- Modify: `src/components/scan/ScanScreen.tsx` (message while waiting)
- Test: `src/lib/analysis/__tests__/run-txid-analysis.test.ts`, `src/hooks/__tests__/useAnalysis.test.ts`

**Interfaces:**
- Produces: `useScanner().handleBroadcastSuccess(txid: string): void`; `AnalysisState.awaitingIndex: boolean` (INITIAL `false`); `INDEX_WAIT = { attempts: 10, delayMs: 3000 }` exported from `run-txid-analysis.ts`.

- [ ] **Step 1: Failing test** in `run-txid-analysis.test.ts`: `api.getTransaction` rejects twice with `new ApiError("NOT_FOUND")` then resolves; with `awaitIndexing: true` and fake timers (`vi.useFakeTimers()`, advance `INDEX_WAIT.delayMs` twice), `runTxidAnalysis` resolves and `getTransaction` was called 3 times; without `awaitIndexing` it rejects on the first NOT_FOUND.

- [ ] **Step 2: Run** -> FAIL.

- [ ] **Step 3: Implement** in `run-txid-analysis.ts`:
```ts
export const INDEX_WAIT = { attempts: 10, delayMs: 3000 } as const;

/** Right after a broadcast the backend may not have indexed the tx yet. */
async function getTxAwaitingIndex(api: ApiClient, txid: string, signal: AbortSignal): Promise<MempoolTransaction> {
  for (let i = 0; ; i++) {
    try {
      return await api.getTransaction(txid);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "NOT_FOUND") || i >= INDEX_WAIT.attempts - 1) throw err;
      await abortableSleep(INDEX_WAIT.delayMs, signal);
    }
  }
}
```
(`abortableSleep` from `@/lib/abort-signal`.) Replace `const tx = await api.getTransaction(txid);` with `const tx = deps.awaitIndexing ? await getTxAwaitingIndex(api, txid, controller.signal) : await api.getTransaction(txid);`. This GET goes through the normal cached client: once broadcast the tx is public.

In `useAnalysis.analyze`: accept `opts?: { awaitIndexing?: boolean }`; when set, skip `getCachedResult`, set `awaitingIndex: true` in the initial `fetching` state, pass `awaitIndexing` to `runTxidAnalysis`, and skip the NOT_FOUND network auto-detection (`if (... && !opts?.awaitIndexing)`).

In `useScanner`:
```ts
  const handleBroadcastSuccess = useCallback((txid: string) => {
    // The local tx is dropped with the state reset; from here it is a normal scan
    skipNextHashChangeRef.current = true;
    setHash(`tx=${txid}`);
    wallet.reset();
    void analyze(txid, { awaitIndexing: true });
  }, [analyze, wallet, skipNextHashChangeRef]);
```
`ScanScreen`: when `awaitingIndex`, source line `scan.awaitingIndex` "Just broadcast. Waiting for {{host}} to index it." (pass `awaitingIndex` from `page.tsx`).

- [ ] **Step 4: Run** `pnpm vitest run src/lib/analysis/__tests__/run-txid-analysis.test.ts src/hooks` -> PASS. **Step 5: Commit** `git commit -m "feat(broadcast): open the broadcast tx as a normal scan, waiting for indexing"` (stage the touched files).

---

### Task 12: Broadcast dialog

**Files:**
- Create: `src/components/flows/BroadcastDialog.tsx`
- Modify: `src/components/flows/BeforeYouSend.tsx` (broadcast button), `src/components/results/Results.tsx`, `src/app/page.tsx`
- Test: `src/components/flows/__tests__/BroadcastDialog.test.tsx`

**Interfaces:**
- Consumes: `broadcastTx`, `testMempoolAccept`, `getTxStatus` (Task 10); `backendClass`, `endpointHost`, `isOnionUrl` (Task 6); `handleBroadcastSuccess` (Task 11).
- Produces: `BroadcastDialog(props: { local: LocalTx; tx: MempoolTransaction; result: ScoringResult; baseUrl: string; cls: BackendClass; onClose: () => void; onSuccess: (txid: string) => void })`.

State machine: `idle` (dry-run may be running on self-hosted) -> `sending` -> `done` (calls `onSuccess`) | `rejected` | `unknown`. While `sending`: confirm button disabled, Escape and backdrop clicks ignored, close button hidden.

- [ ] **Step 1: Failing tests (Review Focus 3)**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
const broadcastTx = vi.fn();
vi.mock("@/lib/api/broadcast", () => ({ broadcastTx, testMempoolAccept: vi.fn().mockResolvedValue(null), getTxStatus: vi.fn() }));
// i18n mock as in useAnalysis.test.ts
import { BroadcastDialog } from "../BroadcastDialog";
// LOCAL_SIGNED, TX, RESULT literals (signed LocalTx, its tx, a ScoringResult with grade "B")

describe("BroadcastDialog", () => {
  it("names the endpoint and the clearnet privacy cost", () => {
    render(<BroadcastDialog local={LOCAL_SIGNED} tx={TX} result={RESULT} baseUrl="https://mempool.space/api" cls="public" onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByText(/https:\/\/mempool\.space\/api\/tx/)).toBeTruthy();
    expect(screen.getByText(/will see your IP address/)).toBeTruthy();
  });

  it("double click and Enter send exactly one POST; Escape is ignored while sending", async () => {
    let resolve!: (v: unknown) => void;
    broadcastTx.mockReturnValue(new Promise((r) => { resolve = r; }));
    const onClose = vi.fn(); const onSuccess = vi.fn();
    render(<BroadcastDialog local={LOCAL_SIGNED} tx={TX} result={RESULT} baseUrl="https://mempool.space/api" cls="public" onClose={onClose} onSuccess={onSuccess} />);
    const btn = screen.getByTestId("broadcast-confirm");
    fireEvent.click(btn); fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(broadcastTx).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    resolve({ kind: "sent", txid: TX.txid, mismatch: false });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(TX.txid));
  });

  it("unknown outcome offers a status check, never a resend", async () => {
    broadcastTx.mockResolvedValue({ kind: "unknown" });
    render(<BroadcastDialog local={LOCAL_SIGNED} tx={TX} result={RESULT} baseUrl="https://mempool.space/api" cls="public" onClose={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByTestId("broadcast-confirm"));
    await waitFor(() => expect(screen.getByTestId("broadcast-check-status")).toBeTruthy());
    expect(screen.queryByTestId("broadcast-confirm")).toBeNull();
  });

  it("critical finding changes the label to Broadcast anyway", () => {
    const critical = { ...RESULT, findings: [{ id: "h2-change-detected", severity: "critical", scoreImpact: -15, title: "Change", description: "", confidence: "high" }] };
    render(<BroadcastDialog local={LOCAL_SIGNED} tx={TX} result={critical as never} baseUrl="https://mempool.space/api" cls="public" onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByTestId("broadcast-confirm").textContent).toMatch(/Broadcast anyway/);
  });
});
```

- [ ] **Step 2: Run** -> FAIL.

- [ ] **Step 3: Implement `BroadcastDialog.tsx`**

Structure: copy the portal/overlay/focus-trap pattern of `src/components/wallet/XpubPrivacyWarning.tsx` (createPortal, `useFocusTrap(dialogRef, true)`, `role="alertdialog"`, `aria-modal`, backdrop `bg-black/60 backdrop-blur-sm`, panel `bg-surface-elevated rounded-2xl`), with these differences:

```tsx
  const [phase, setPhase] = useState<"idle" | "sending" | "rejected" | "unknown">("idle");
  const sendingRef = useRef(false); // synchronous guard: React state updates are async
  const [rejection, setRejection] = useState<{ message: string; reason: BroadcastReason } | null>(null);
  const [dryRun, setDryRun] = useState<{ allowed: boolean; reason?: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const endpointUrl = `${baseUrl.replace(/\/+$/, "")}/tx`;
  const worst = [...result.findings].filter((f) => f.scoreImpact < 0).sort((a, b) => rank(a) - rank(b))[0];
  const critical = worst?.severity === "critical";

  useEffect(() => {
    if (cls !== "self-hosted" || !local.signedHex) return;
    let live = true;
    void testMempoolAccept(baseUrl, local.signedHex).then((r) => { if (live && r) setDryRun(r); });
    return () => { live = false; };
  }, [cls, baseUrl, local.signedHex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !sendingRef.current) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirm = useCallback(async () => {
    if (sendingRef.current || !local.signedHex) return;
    sendingRef.current = true;
    setPhase("sending");
    const out = await broadcastTx(baseUrl, local.signedHex, tx.txid);
    if (out.kind === "sent" || out.kind === "already-confirmed") { onSuccess(out.txid); return; }
    sendingRef.current = false;
    if (out.kind === "unknown") { setPhase("unknown"); return; }
    setRejection({ message: out.message, reason: out.reason });
    setPhase("rejected");
  }, [baseUrl, local.signedHex, tx.txid, onSuccess]);
```
- The confirm button: `type="button"`, `data-testid="broadcast-confirm"`, `disabled={phase === "sending"}`, `onClick={confirm}`, label `critical ? t("broadcast.anyway", "Broadcast anyway") : t("broadcast.confirm", "Broadcast")`; rendered only in `idle` and `rejected` phases (a rejected tx can be fixed elsewhere; re-clicking after a definite rejection is safe). Not rendered in `unknown`.
- Do not wrap the dialog in a `<form>` (Enter must not submit). Pressing Enter on the focused button triggers a click in browsers; `sendingRef` makes it a no-op after the first.
- Backdrop click: `if (e.target === e.currentTarget && !sendingRef.current) onClose()`.
- Body content, in order: summary list (each `tx.vout`: address or "OP_RETURN" + `formatSats(value)`; fee + fee rate when known; "Projected grade: {{grade}}"); endpoint line `broadcast.endpoint` "Sends the signed transaction to {{name}} ({{url}})" where name = `t("broadcast.nameMempool")` "mempool.space" / `t("broadcast.nameOnion")` "mempool.space over Tor" (`isOnionUrl`) / `t("broadcast.nameNode")` "your node ({{host}})" for self-hosted; privacy note by class:
  - public + clearnet: `broadcast.privacyClearnet` "mempool.space will see your IP address together with this transaction. It is the first place your transaction is seen."
  - public + onion: `broadcast.privacyOnion` "Sent over Tor: your IP address is hidden, but mempool.space still sees the transaction first."
  - self-hosted: `broadcast.privacyNode` "Your own node relays it to its peers."
  - when `critical`: a highlighted box with the translated title of `worst` and `broadcast.criticalNote` "This transaction has a critical privacy leak."
  - dry-run result (self-hosted only): `broadcast.dryRunOk` "Your node would accept this transaction." / `broadcast.dryRunRejected` "Your node would reject it: {{reason}}".
- Rejected: node message in `font-mono text-xs` + reason line: `broadcast.reason.inputs-missing-or-spent` "One or more inputs are missing or already spent (wrong network, or already sent).", `broadcast.reason.policy` "The node rejected it by policy: fee too low, not final yet, or it conflicts with a transaction in the mempool.", `broadcast.reason.other` "The node rejected the transaction."
- Unknown: `broadcast.unknown` "It is unknown whether the transaction was sent. Check its status before trying again." + button `data-testid="broadcast-check-status"` (`broadcast.checkStatus` "Check status") calling `getTxStatus(baseUrl, tx.txid)`; on `mempool`/`confirmed` call `onSuccess(tx.txid)`; on `not-found` show `broadcast.statusNotFound` "Not found on {{host}}. It was probably not sent." and show the confirm button again (`setPhase("idle")`); on `error` show `broadcast.statusError` "Could not check. Try again in a moment."
- Custom URL CORS failure shows as `unknown` too; append `broadcast.corsHint` "If you use your own mempool instance, it may block broadcasts from the browser. Broadcast from your wallet or node instead." when `cls === "self-hosted"` and `!baseUrl.startsWith("/")`.

`BeforeYouSend.tsx`: when `local.status === "signed"`, render a button `data-testid="broadcast-open"` (`broadcast.open` "Broadcast...") that calls `onBroadcast`. `Results.tsx` holds `const [broadcastOpen, setBroadcastOpen] = useState(false)` and renders `<BroadcastDialog ... cls={backendClass({ isUmbrel, customApiUrl })} baseUrl={config.mempoolBaseUrl} onClose={() => setBroadcastOpen(false)} onSuccess={onBroadcastSuccess} />` lazily; `onBroadcastSuccess` is a new `Results` prop threaded from `page.tsx` (`handleBroadcastSuccess` from `useScanner`).

All `broadcast.*` keys go into the 6 locales (es with tuteo, e.g. `broadcast.privacyClearnet`: "mempool.space verá tu dirección IP junto con esta transacción. Es el primer sitio donde se ve tu transacción.").

- [ ] **Step 4: Run** `pnpm vitest run src/components/flows && pnpm type-check && pnpm lint` -> PASS.

- [ ] **Step 5: Commit** `git add src/components/flows src/components/results/Results.tsx src/app/page.tsx public/locales && git commit -m "feat(broadcast): confirm dialog with endpoint, privacy note and single-send guard"`

---

### Task 13: Copy and documentation updates

**Files:**
- Modify: `public/locales/*/common.json` (`faq.a_data`, `about.principle_client_*`, `welcome.not_p1`, `scan.sourcePsbt`, `about.cap_*` and `home.how_1_body` input lists, `settings.cacheNote` if it claims nothing leaves the browser)
- Modify: `docs/privacy-engine.md` (threat model near line 15 and lines ~11, ~1750, ~1754), `docs/development-guide.md` (endpoint list ~170-178: add `POST /tx`, `POST /txs/test`, `GET /v1/fees/recommended`, `GET /tx/:txid/status`; the note at ~199 "PSBTs are analyzed directly, never put in the URL hash" becomes "PSBTs and raw transactions are analyzed in memory: never put in the URL hash, history, bookmarks or cache"), `README.md` (input list), `docs/spec-cli-tool.md` untouched (CLI stays offline).
- Test: `src/lib/__tests__/copy-claims.test.ts`

- [ ] **Step 1: Failing test**: load `public/locales/en/common.json`; assert no value matches `/nothing (is|was) (ever )?sent/i` unless it also matches `/unless you choose/i`; assert `faq.a_data` contains "broadcast".
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Edit copy.** Canonical sentence (en): "Nothing is sent unless you choose to broadcast. Broadcasting sends only the signed transaction to the endpoint shown." es: "No se envía nada salvo que decidas emitirla. Al emitirla solo se envía la transacción firmada al destino indicado." Update `faq.a_data` to name both recipients: mempool.space (or your own instance) for lookups, and the broadcast endpoint only when you broadcast. Grep all 6 locale files for each key and rewrite each translation (no "we/us/our"). Update the docs listed above in the same style.
- [ ] **Step 4: Run** `pnpm vitest run src/lib/__tests__/copy-claims.test.ts && pnpm test` -> PASS.
- [ ] **Step 5: Commit** `git add public/locales docs README.md src/lib/__tests__/copy-claims.test.ts && git commit -m "docs: broadcast is opt-in, update every nothing-is-sent claim"`

**PR 3 checkpoint:** gates, then ask before pushing.

---

# PR 4: QR scanner

### Task 14: UR primitives (bytewords, CRC32, Xoshiro256**, sampler, CBOR)

**Files:**
- Create: `src/lib/input/ur/bytewords.ts`, `crc32.ts`, `xoshiro.ts`, `sampler.ts`, `cbor.ts`
- Test: `src/lib/input/ur/__tests__/primitives.test.ts`
- Add devDependency: `@ngraveio/bc-ur` (tests only, used as the reference encoder; never imported from `src/` outside `__tests__`)

**Interfaces:**
- Produces:
  ```ts
  // crc32.ts
  export function crc32(data: Uint8Array): number; // unsigned
  // bytewords.ts
  export function decodeMinimalBytewords(s: string): Uint8Array; // lowercase input; verifies and strips the 4-byte CRC32; throws on bad word/checksum
  // xoshiro.ts
  export class Xoshiro { constructor(seed: Uint8Array); next(): bigint; nextDouble(): number; nextInt(low: number, high: number): number }
  export function seedFor(seqNum: number, checksum: number): Uint8Array; // sha256(u32be(seqNum) || u32be(checksum))
  // sampler.ts
  export class RandomSampler { constructor(probs: number[]); next(rng: () => number): number }
  // cbor.ts
  export type Cbor = number | bigint | boolean | null | string | Uint8Array | Cbor[] | Map<number | string, Cbor> | { tag: number; value: Cbor };
  export function decodeCbor(bytes: Uint8Array): Cbor; // definite lengths only; throws on trailing bytes
  ```

- [ ] **Step 1: Get the canonical bytewords list**

Run: `curl -s https://raw.githubusercontent.com/BlockchainCommons/Research/master/papers/bcr-2020-012-bytewords.md | grep -oE '\b[a-z]{4}\b' | head -400 > /tmp/claude-1000/-home-user-am-i-exposed/d185653b-aaac-4491-8142-ca457266cb7e/scratchpad/bytewords.txt`
Then open the file and extract the 256 words in table order (the table in the "Bytewords" section lists them by byte value; the first is `able`, the last is `zoom`). Put them in `bytewords.ts` as `const WORDS = "able acid also ... zoom".split(" ");` and assert `WORDS.length === 256` in the test. The minimal form of a word is its first and last letter (`able` -> `ae`); minimal forms are unique.

- [ ] **Step 2: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { crc32 } from "../crc32";
import { decodeMinimalBytewords, WORDS } from "../bytewords";
import { Xoshiro, seedFor } from "../xoshiro";
import { RandomSampler } from "../sampler";
import { decodeCbor } from "../cbor";
// Reference implementation (dev dependency) for cross-checks
import { UR, UREncoder } from "@ngraveio/bc-ur";

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("bytewords", () => {
  it("has 256 unique minimal forms", () => {
    expect(WORDS).toHaveLength(256);
    expect(new Set(WORDS.map((w) => w[0] + w[3])).size).toBe(256);
  });
  it("decodes the reference encoder's single-part UR body", () => {
    // UR.fromBuffer wraps the buffer as a CBOR byte string: 0x44 = bytes(4)
    const body = new UREncoder(UR.fromBuffer(Buffer.from([1, 2, 3, 4])), 1000).nextPart().split("/").pop()!;
    expect(Array.from(decodeMinimalBytewords(body))).toEqual([0x44, 1, 2, 3, 4]);
  });
  it("rejects a bad checksum", () => {
    const body = new UREncoder(UR.fromBuffer(Buffer.from([0x41, 9])), 1000).nextPart().split("/").pop()!;
    const broken = body.slice(0, -2) + (body.endsWith("ae") ? "ad" : "ae");
    expect(() => decodeMinimalBytewords(broken)).toThrow();
  });
});

describe("xoshiro + sampler", () => {
  it("is deterministic and in range", () => {
    const a = new Xoshiro(seedFor(5, 0x12345678));
    const b = new Xoshiro(seedFor(5, 0x12345678));
    const xs = Array.from({ length: 20 }, () => a.nextInt(1, 10));
    expect(xs).toEqual(Array.from({ length: 20 }, () => b.nextInt(1, 10)));
    expect(xs.every((x) => x >= 1 && x <= 10)).toBe(true);
  });
  it("sampler returns valid indexes", () => {
    const rng = new Xoshiro(seedFor(1, 1));
    const s = new RandomSampler([1, 1 / 2, 1 / 3, 1 / 4]);
    for (let i = 0; i < 100; i++) expect(s.next(() => rng.nextDouble())).toBeLessThan(4);
  });
});

describe("cbor", () => {
  it("decodes bytes, text, arrays, maps, tags, ints, bools", () => {
    // tag 303 { 3: h'01', 6: tag 304 { 1: [44, true] }, 8: 0x11223344 }
    const bytes = Uint8Array.from([0xd9, 0x01, 0x2f, 0xa3, 0x03, 0x41, 0x01, 0x06, 0xd9, 0x01, 0x30, 0xa1, 0x01, 0x82, 0x18, 0x2c, 0xf5, 0x08, 0x1a, 0x11, 0x22, 0x33, 0x44]);
    const v = decodeCbor(bytes) as { tag: number; value: Map<number, unknown> };
    expect(v.tag).toBe(303);
    expect(v.value.get(8)).toBe(0x11223344);
    expect((v.value.get(6) as { tag: number }).tag).toBe(304);
  });
  it("throws on trailing bytes", () => {
    expect(() => decodeCbor(Uint8Array.from([0x01, 0x02]))).toThrow();
  });
});
```

The exact Xoshiro output is validated end to end in Task 15 (fountain parts from the reference encoder only decode if `seedFor`, `Xoshiro`, `RandomSampler` and the shuffle are bit-exact).

- [ ] **Step 3: Run** `pnpm add -D @ngraveio/bc-ur && pnpm vitest run src/lib/input/ur` -> FAIL (modules missing).

- [ ] **Step 4: Implement**

```ts
// crc32.ts
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
```

```ts
// bytewords.ts
import { crc32 } from "./crc32";
export const WORDS: string[] = "able acid ... zoom".split(" "); // 256 words from BCR-2020-012 (Step 1)
const MINIMAL = new Map(WORDS.map((w, i) => [w[0] + w[3], i]));

/** Minimal bytewords (2 letters per byte) -> payload, verifying the trailing CRC32. */
export function decodeMinimalBytewords(s: string): Uint8Array {
  const text = s.toLowerCase();
  if (text.length % 2 !== 0 || text.length < 10) throw new Error("Invalid bytewords length");
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const v = MINIMAL.get(text.slice(i * 2, i * 2 + 2));
    if (v === undefined) throw new Error("Invalid byteword");
    bytes[i] = v;
  }
  const body = bytes.subarray(0, bytes.length - 4);
  const sum = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4).getUint32(0);
  if (crc32(body) !== sum) throw new Error("Bytewords checksum mismatch");
  return body;
}
```

```ts
// xoshiro.ts
import { sha256 } from "@noble/hashes/sha2.js";
const MASK = (1n << 64n) - 1n;
const rotl = (x: bigint, k: bigint) => ((x << k) | (x >> (64n - k))) & MASK;

export function seedFor(seqNum: number, checksum: number): Uint8Array {
  const b = new Uint8Array(8);
  const v = new DataView(b.buffer);
  v.setUint32(0, seqNum);
  v.setUint32(4, checksum);
  return b;
}

/** Xoshiro256** seeded with SHA-256(seed), as in BCR-2020-005 / ur-js. */
export class Xoshiro {
  private s: bigint[] = [0n, 0n, 0n, 0n];
  constructor(seed: Uint8Array) {
    const d = sha256(seed);
    for (let i = 0; i < 4; i++) {
      let v = 0n;
      for (let n = 0; n < 8; n++) v = (v << 8n) | BigInt(d[i * 8 + n]);
      this.s[i] = v;
    }
  }
  next(): bigint {
    const s = this.s;
    const result = (rotl((s[1] * 5n) & MASK, 7n) * 9n) & MASK;
    const t = (s[1] << 17n) & MASK;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 45n);
    return result;
  }
  nextDouble(): number {
    return Number(this.next()) / 2 ** 64;
  }
  nextInt(low: number, high: number): number {
    return Math.floor(this.nextDouble() * (high - low + 1)) + low;
  }
}
```
Note: `seedFor` returns the 8-byte seed; the constructor hashes it (as `ur-js` does: `new Xoshiro(seed)` -> `sha256(seed)`). The repo imports `@noble/*` v2 with the `.js` suffix (`@noble/hashes/sha2.js`, see `src/lib/bitcoin/descriptor.ts:16`).

```ts
// sampler.ts
/** Vose alias method, matching ur-js RandomSampler. */
export class RandomSampler {
  private prob: number[];
  private alias: number[];
  constructor(probs: number[]) {
    const n = probs.length;
    const sum = probs.reduce((a, b) => a + b, 0);
    const P = probs.map((p) => (p * n) / sum);
    this.prob = new Array(n).fill(0);
    this.alias = new Array(n).fill(0);
    const S: number[] = [];
    const L: number[] = [];
    for (let i = n - 1; i >= 0; i--) (P[i] < 1 ? S : L).push(i);
    while (S.length > 0 && L.length > 0) {
      const a = S.pop()!;
      const g = L.pop()!;
      this.prob[a] = P[a];
      this.alias[a] = g;
      P[g] += P[a] - 1;
      (P[g] < 1 ? S : L).push(g);
    }
    while (L.length > 0) this.prob[L.pop()!] = 1;
    while (S.length > 0) this.prob[S.pop()!] = 1;
  }
  next(rng: () => number): number {
    const r1 = rng();
    const r2 = rng();
    const i = Math.floor(this.prob.length * r1);
    return r2 < this.prob[i] ? i : this.alias[i];
  }
}
```

```ts
// cbor.ts
export type Cbor = number | bigint | boolean | null | string | Uint8Array | Cbor[] | Map<number | string, Cbor> | { tag: number; value: Cbor };

/** Minimal definite-length CBOR reader (enough for UR registry types). */
export function decodeCbor(bytes: Uint8Array): Cbor {
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (n: number) => { if (pos + n > bytes.length) throw new Error("CBOR: unexpected end"); };
  const arg = (info: number): number | bigint => {
    if (info < 24) return info;
    if (info === 24) { need(1); return bytes[pos++]; }
    if (info === 25) { need(2); const v = view.getUint16(pos); pos += 2; return v; }
    if (info === 26) { need(4); const v = view.getUint32(pos); pos += 4; return v; }
    if (info === 27) { need(8); const v = view.getBigUint64(pos); pos += 8; return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v; }
    throw new Error("CBOR: indefinite lengths are not supported");
  };
  const item = (): Cbor => {
    need(1);
    const b = bytes[pos++];
    const major = b >> 5;
    const info = b & 0x1f;
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      throw new Error("CBOR: unsupported simple value");
    }
    const a = arg(info);
    const len = Number(a);
    switch (major) {
      case 0: return a;
      case 1: return typeof a === "bigint" ? -1n - a : -1 - a;
      case 2: need(len); pos += len; return bytes.slice(pos - len, pos);
      case 3: need(len); pos += len; return new TextDecoder().decode(bytes.subarray(pos - len, pos));
      case 4: return Array.from({ length: len }, () => item());
      case 5: {
        const m = new Map<number | string, Cbor>();
        for (let i = 0; i < len; i++) {
          const k = item();
          if (typeof k !== "number" && typeof k !== "string") throw new Error("CBOR: unsupported map key");
          m.set(k, item());
        }
        return m;
      }
      case 6: return { tag: len, value: item() };
      default: throw new Error("CBOR: bad major type");
    }
  };
  const v = item();
  if (pos !== bytes.length) throw new Error("CBOR: trailing bytes");
  return v;
}
```

- [ ] **Step 5: Run** `pnpm vitest run src/lib/input/ur` -> PASS. **Step 6: Commit** `git add package.json pnpm-lock.yaml src/lib/input/ur && git commit -m "feat(qr): UR primitives (bytewords, crc32, xoshiro, sampler, cbor)"`

---

### Task 15: UR fountain decoder and registry types

**Files:**
- Create: `src/lib/input/ur/fountain.ts`, `src/lib/input/ur/registry.ts`, `src/lib/input/ur/index.ts`
- Test: `src/lib/input/ur/__tests__/ur.test.ts`
- Add devDependency: `@keystonehq/bc-ur-registry` (tests only: builds reference `crypto-hdkey` / `crypto-account` / `crypto-output` payloads)

**Interfaces:**
- Produces:
  ```ts
  // index.ts
  export type UrResult =
    | { kind: "progress"; percent: number }
    | { kind: "done"; payload: string }        // canonical field string: PSBT hex, raw tx hex, text, or descriptor
    | { kind: "error"; reason: "unsupported-type" | "multisig" | "corrupt" };
  export class UrDecoder { receive(part: string): UrResult; reset(): void }
  export function isUrPart(text: string): boolean; // /^ur:/i
  // registry.ts
  export function urToPayload(type: string, cbor: Uint8Array): string; // throws Error("unsupported-type" | "multisig")
  ```

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { UR, UREncoder } from "@ngraveio/bc-ur";
import { CryptoPSBT, CryptoHDKey, CryptoKeypath, PathComponent, CryptoCoinInfo, CryptoAccount, CryptoOutput, ScriptExpressions, MultiKey } from "@keystonehq/bc-ur-registry";
import { HDKey } from "@scure/bip32";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt } from "@/lib/input/__tests__/fixtures";
import { isXpubOrDescriptor } from "@/lib/bitcoin/descriptor";
import { UrDecoder } from "../index";

const psbtBytes = buildPsbt({ sign: false, nonWitness: true }).toPSBT();
const encoderFor = (ur: UR, frag = 60) => new UREncoder(ur, frag);

describe("UrDecoder", () => {
  it("single-part ur:crypto-psbt -> PSBT hex", () => {
    const ur = new CryptoPSBT(Buffer.from(psbtBytes)).toUR();
    const d = new UrDecoder();
    expect(d.receive(encoderFor(ur, 10_000).nextPart())).toEqual({ kind: "done", payload: bytesToHex(psbtBytes) });
  });

  it("multi-part, uppercase, out of order and with drops", () => {
    const enc = encoderFor(new CryptoPSBT(Buffer.from(psbtBytes)).toUR());
    const parts = Array.from({ length: enc.fragmentsLength * 3 }, () => enc.nextPart().toUpperCase());
    const shuffled = parts.filter((_, i) => i % 3 !== 1).reverse(); // drop a third, reverse order
    const d = new UrDecoder();
    let last: ReturnType<UrDecoder["receive"]> = { kind: "progress", percent: 0 };
    for (const p of shuffled) { last = d.receive(p); if (last.kind === "done") break; }
    expect(last).toEqual({ kind: "done", payload: bytesToHex(psbtBytes) });
  });

  it("resets when a different sequence starts (Review Focus 5)", () => {
    const a = encoderFor(new CryptoPSBT(Buffer.from(psbtBytes)).toUR());
    const other = buildPsbt({ sign: true }).toPSBT();
    const b = encoderFor(new CryptoPSBT(Buffer.from(other)).toUR());
    const d = new UrDecoder();
    d.receive(a.nextPart()); d.receive(a.nextPart());
    let last: ReturnType<UrDecoder["receive"]> = { kind: "progress", percent: 0 };
    for (let i = 0; i < b.fragmentsLength * 3 && last.kind !== "done"; i++) last = d.receive(b.nextPart());
    expect(last).toEqual({ kind: "done", payload: bytesToHex(other) });
  });

  // A real BIP84 account key, so the decoded xpub can be compared byte for byte
  const master = HDKey.fromMasterSeed(new Uint8Array(32).fill(1));
  const account = master.derive("m/84'/0'/0'");
  const fp = Buffer.alloc(4); fp.writeUInt32BE(master.fingerprint);
  const pfp = Buffer.alloc(4); pfp.writeUInt32BE(account.parentFingerprint);
  const hdkey = () => new CryptoHDKey({
    isMaster: false,
    key: Buffer.from(account.publicKey!),
    chainCode: Buffer.from(account.chainCode!),
    origin: new CryptoKeypath([84, 0, 0].map((index) => new PathComponent({ index, hardened: true })), fp, 3),
    parentFingerprint: pfp,
    useInfo: new CryptoCoinInfo(0, 0),
  });

  it("ur:crypto-account -> wpkh descriptor whose xpub matches the real account key", () => {
    const acct = new CryptoAccount(fp, [new CryptoOutput([ScriptExpressions.WITNESS_PUBLIC_KEY_HASH], hdkey())]);
    const r = new UrDecoder().receive(encoderFor(acct.toUR(), 10_000).nextPart());
    expect(r).toEqual({ kind: "done", payload: `wpkh([${fp.toString("hex")}/84h/0h/0h]${account.publicExtendedKey})` });
    expect(isXpubOrDescriptor((r as { payload: string }).payload)).toBe(true);
  });

  it("multisig crypto-output is rejected with a clear reason", () => {
    const out = new CryptoOutput([ScriptExpressions.WITNESS_SCRIPT_HASH, ScriptExpressions.MULTISIG], new MultiKey(1, [hdkey()]));
    expect(new UrDecoder().receive(encoderFor(out.toUR(), 10_000).nextPart())).toEqual({ kind: "error", reason: "multisig" });
  });
});
```
The registry calls are test-only; if a constructor signature differs in the installed version, check its `dist/*.d.ts` and adapt the test, never the decoder.

- [ ] **Step 2: Run** `pnpm add -D @keystonehq/bc-ur-registry && pnpm vitest run src/lib/input/ur/__tests__/ur.test.ts` -> FAIL.

- [ ] **Step 3: Implement `fountain.ts`**

```ts
// fountain.ts
import { crc32 } from "./crc32";
import { decodeCbor } from "./cbor";
import { RandomSampler } from "./sampler";
import { Xoshiro, seedFor } from "./xoshiro";

export interface FountainPart { seqNum: number; seqLen: number; messageLen: number; checksum: number; fragment: Uint8Array }

export function parsePart(cbor: Uint8Array): FountainPart {
  const v = decodeCbor(cbor);
  if (!Array.isArray(v) || v.length !== 5) throw new Error("corrupt");
  const [seqNum, seqLen, messageLen, checksum, fragment] = v;
  if (typeof seqNum !== "number" || typeof seqLen !== "number" || typeof messageLen !== "number" || typeof checksum !== "number" || !(fragment instanceof Uint8Array)) throw new Error("corrupt");
  return { seqNum, seqLen, messageLen, checksum, fragment };
}

function shuffle<T>(items: T[], rng: Xoshiro): T[] {
  const remaining = [...items];
  const out: T[] = [];
  while (remaining.length > 0) out.push(remaining.splice(rng.nextInt(0, remaining.length - 1), 1)[0]);
  return out;
}

/** Fragment indexes mixed into part `seqNum` (BCR-2020-005 chooseFragments). */
export function chooseFragments(seqNum: number, seqLen: number, checksum: number): number[] {
  if (seqNum <= seqLen) return [seqNum - 1];
  const rng = new Xoshiro(seedFor(seqNum, checksum));
  const sampler = new RandomSampler(Array.from({ length: seqLen }, (_, i) => 1 / (i + 1)));
  const degree = sampler.next(() => rng.nextDouble()) + 1;
  return shuffle(Array.from({ length: seqLen }, (_, i) => i), rng).slice(0, degree);
}

const xorInto = (a: Uint8Array, b: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] ^= b[i]; };

export class FountainDecoder {
  private key: string | null = null;
  private simple = new Map<number, Uint8Array>();
  private mixed: { idx: Set<number>; data: Uint8Array }[] = [];
  private seqLen = 0;
  private messageLen = 0;
  private checksum = 0;

  /** Returns the message when complete, else null. Throws "corrupt" on checksum failure. */
  receive(p: FountainPart): Uint8Array | null {
    const key = `${p.seqLen}:${p.messageLen}:${p.checksum}`;
    if (key !== this.key) {
      this.key = key; this.simple.clear(); this.mixed = [];
      this.seqLen = p.seqLen; this.messageLen = p.messageLen; this.checksum = p.checksum;
    }
    this.add(new Set(chooseFragments(p.seqNum, p.seqLen, p.checksum)), p.fragment.slice());
    if (this.simple.size < this.seqLen) return null;
    const joined = new Uint8Array(this.seqLen * this.simple.get(0)!.length);
    for (let i = 0; i < this.seqLen; i++) joined.set(this.simple.get(i)!, i * this.simple.get(0)!.length);
    const msg = joined.slice(0, this.messageLen);
    if (crc32(msg) !== this.checksum) { this.key = null; throw new Error("corrupt"); }
    return msg;
  }

  get progress(): number {
    return this.seqLen ? this.simple.size / this.seqLen : 0;
  }

  private add(idx: Set<number>, data: Uint8Array) {
    for (const [i, frag] of this.simple) if (idx.has(i)) { idx.delete(i); xorInto(data, frag); }
    if (idx.size === 0) return;
    if (idx.size > 1) { this.mixed.push({ idx, data }); return; }
    const [i] = idx;
    if (this.simple.has(i)) return;
    this.simple.set(i, data);
    // Reduce mixed parts that contain the new simple fragment; cascade newly simple ones
    const pending = this.mixed;
    this.mixed = [];
    for (const m of pending) {
      if (m.idx.has(i)) { m.idx.delete(i); xorInto(m.data, data); }
      if (m.idx.size === 1) this.add(m.idx, m.data); else if (m.idx.size > 1) this.mixed.push(m);
    }
  }
}
```

- [ ] **Step 4: Implement `registry.ts`**

```ts
// registry.ts
import { createBase58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { bytesToPayload } from "@/lib/input/file";
import { decodeCbor, type Cbor } from "./cbor";

const b58c = createBase58check(sha256);
type Tagged = { tag: number; value: Cbor };
const isTagged = (v: Cbor): v is Tagged => typeof v === "object" && v !== null && "tag" in v;
const untag = (v: Cbor, tag: number): Cbor => (isTagged(v) && v.tag === tag ? v.value : v);
const asMap = (v: Cbor) => { if (!(v instanceof Map)) throw new Error("unsupported-type"); return v; };
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0); return b; };

/** crypto-hdkey (303) -> [fp/path]xpub */
function hdkeyToKeyExpr(v: Cbor): string {
  const m = asMap(untag(v, 303));
  const key = m.get(3), chain = m.get(4);
  if (!(key instanceof Uint8Array) || !(chain instanceof Uint8Array)) throw new Error("unsupported-type");
  const useInfo = m.get(5) ? asMap(untag(m.get(5)!, 305)) : null;
  const testnet = useInfo?.get(2) === 1;
  const origin = m.get(6) ? asMap(untag(m.get(6)!, 304)) : null;
  const comps = (origin?.get(1) as Cbor[] | undefined) ?? [];
  const path: { index: number; hardened: boolean }[] = [];
  for (let i = 0; i + 1 < comps.length; i += 2) path.push({ index: comps[i] as number, hardened: comps[i + 1] === true });
  const sourceFp = typeof origin?.get(2) === "number" ? (origin.get(2) as number) : null;
  const depth = typeof origin?.get(3) === "number" ? (origin.get(3) as number) : path.length;
  const last = path[path.length - 1];
  const childNum = last ? (last.index + (last.hardened ? 0x80000000 : 0)) >>> 0 : 0;
  const parentFp = typeof m.get(8) === "number" ? (m.get(8) as number) : 0;

  const ser = new Uint8Array(78);
  ser.set(u32(testnet ? 0x043587cf : 0x0488b21e), 0);
  ser[4] = depth;
  ser.set(u32(parentFp), 5);
  ser.set(u32(childNum), 9);
  ser.set(chain, 13);
  ser.set(key, 45);
  const xpub = b58c.encode(ser);
  if (sourceFp === null) return xpub;
  const pathStr = path.map((c) => `/${c.index}${c.hardened ? "h" : ""}`).join("");
  return `[${bytesToHex(u32(sourceFp))}${pathStr}]${xpub}`;
}

/** Script expression tags (BCR-2020-010) -> descriptor; multisig and others rejected. */
function outputToDescriptor(v: Cbor): string {
  const e = untag(v, 308);
  if (!isTagged(e)) throw new Error("unsupported-type");
  switch (e.tag) {
    case 404: return `wpkh(${hdkeyToKeyExpr(e.value)})`;
    case 403: return `pkh(${hdkeyToKeyExpr(e.value)})`;
    case 409: return `tr(${hdkeyToKeyExpr(e.value)})`;
    case 400: {
      const inner = e.value;
      if (isTagged(inner) && inner.tag === 404) return `sh(wpkh(${hdkeyToKeyExpr(inner.value)}))`;
      if (isTagged(inner) && (inner.tag === 406 || inner.tag === 407)) throw new Error("multisig");
      throw new Error("unsupported-type");
    }
    case 401: case 406: case 407: throw new Error("multisig");
    default: throw new Error("unsupported-type");
  }
}

const ACCOUNT_PREFERENCE = [404, 409, 400, 403];

/** UR type + CBOR body -> the canonical string the text field accepts. */
export function urToPayload(type: string, cbor: Uint8Array): string {
  const v = decodeCbor(cbor);
  switch (type) {
    case "crypto-psbt": case "psbt": case "bytes": {
      const bytes = untag(v, type === "psbt" ? 40310 : 310);
      if (!(bytes instanceof Uint8Array)) throw new Error("unsupported-type");
      return bytesToPayload(bytes);
    }
    case "crypto-output": case "output-descriptor":
      return outputToDescriptor(v);
    case "crypto-hdkey": case "hdkey":
      return hdkeyToKeyExpr(v).replace(/^\[[^\]]*\]/, ""); // a bare xpub scans as a wallet
    case "crypto-account": case "account-descriptor": {
      const outs = (asMap(untag(v, 311)).get(2) as Cbor[] | undefined) ?? [];
      const rank = (o: Cbor) => { const e = untag(o, 308); return isTagged(e) ? ACCOUNT_PREFERENCE.indexOf(e.tag) : -1; };
      const best = outs.filter((o) => rank(o) >= 0).sort((a, b) => rank(a) - rank(b))[0];
      if (!best) throw new Error(outs.length ? "multisig" : "unsupported-type");
      return outputToDescriptor(best);
    }
    default:
      throw new Error("unsupported-type");
  }
}
```

The descriptor parser in `src/lib/bitcoin/descriptor.ts` accepts `h` or `'` hardened markers in origins (regex at line ~245: `\/\d+['h]?`) and `tpub` keys; keep `h`.

- [ ] **Step 5: Implement `index.ts`**

```ts
// index.ts
import { decodeMinimalBytewords } from "./bytewords";
import { FountainDecoder, parsePart } from "./fountain";
import { urToPayload } from "./registry";

export type UrResult =
  | { kind: "progress"; percent: number }
  | { kind: "done"; payload: string }
  | { kind: "error"; reason: "unsupported-type" | "multisig" | "corrupt" };

export const isUrPart = (text: string) => /^ur:/i.test(text.trim());

export class UrDecoder {
  private fountain = new FountainDecoder();
  private type: string | null = null;

  reset() { this.fountain = new FountainDecoder(); this.type = null; }

  receive(part: string): UrResult {
    const m = part.trim().toLowerCase().match(/^ur:([a-z0-9-]+)\/(?:(\d+)-(\d+)\/)?([a-z]+)$/);
    if (!m) return { kind: "error", reason: "corrupt" };
    const [, type, seq, , body] = m;
    try {
      if (type !== this.type) { this.reset(); this.type = type; }
      const bytes = decodeMinimalBytewords(body);
      if (!seq) return { kind: "done", payload: urToPayload(type, bytes) };
      const msg = this.fountain.receive(parsePart(bytes));
      if (!msg) return { kind: "progress", percent: Math.round(this.fountain.progress * 100) };
      this.reset();
      return { kind: "done", payload: urToPayload(type, msg) };
    } catch (err) {
      const reason = err instanceof Error && (err.message === "multisig" || err.message === "unsupported-type") ? err.message : "corrupt";
      return { kind: "error", reason };
    }
  }
}
```
A corrupt single frame (bad checksum from a misread) must not kill the scan: the assembler (Task 17) ignores `corrupt` results for multi-part scans and keeps going.

- [ ] **Step 6: Run** `pnpm vitest run src/lib/input/ur` -> PASS. If the multi-part test fails while single-part passes, the Xoshiro/sampler/shuffle order differs from the reference: compare `chooseFragments` output against `@ngraveio/bc-ur`'s internal `chooseFragments` (import from `@ngraveio/bc-ur/dist/fountainUtils` in the test) for seqNum 1..50.

- [ ] **Step 7: Commit** `git add package.json pnpm-lock.yaml src/lib/input/ur && git commit -m "feat(qr): BC-UR fountain decoder, PSBT and wallet export types"`

---

### Task 16: BBQr decoder

**Files:**
- Create: `src/lib/input/bbqr.ts`
- Test: `src/lib/input/__tests__/bbqr.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BbqrResult = { kind: "progress"; received: number; total: number } | { kind: "done"; payload: string } | { kind: "error"; reason: "unsupported-type" | "corrupt" };
  export const isBbqrPart = (text: string) => boolean; // /^B\$[H2Z][A-Z]/
  export class BbqrDecoder { receive(part: string): Promise<BbqrResult>; reset(): void }
  ```

- [ ] **Step 1: Failing tests** (`deflateRawSync` from `node:zlib` is the independent reference for `Z`)

```ts
import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { base32 } from "@scure/base";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt } from "./fixtures";
import { BbqrDecoder } from "../bbqr";

const b36 = (n: number) => n.toString(36).toUpperCase().padStart(2, "0");
function encode(data: Uint8Array, enc: "H" | "2" | "Z", type: string, parts: number): string[] {
  const body = enc === "H" ? bytesToHex(data).toUpperCase()
    : base32.encode(enc === "Z" ? new Uint8Array(deflateRawSync(data, { windowBits: 10 })) : data).replace(/=+$/, "");
  const unit = enc === "H" ? 2 : 8;
  const size = Math.ceil(body.length / parts / unit) * unit;
  return Array.from({ length: parts }, (_, i) => `B$${enc}${type}${b36(parts)}${b36(i)}` + body.slice(i * size, (i + 1) * size));
}
const psbt = buildPsbt({ sign: false, nonWitness: true }).toPSBT();

describe("BbqrDecoder", () => {
  it.each(["H", "2", "Z"] as const)("encoding %s, 3 parts out of order -> PSBT hex", async (enc) => {
    const d = new BbqrDecoder();
    const [a, b, c] = encode(psbt, enc, "P", 3);
    expect(await d.receive(c)).toEqual({ kind: "progress", received: 1, total: 3 });
    await d.receive(a);
    expect(await d.receive(b)).toEqual({ kind: "done", payload: bytesToHex(psbt) });
  });
  it("U type -> text", async () => {
    const [p] = encode(new TextEncoder().encode("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"), "2", "U", 1);
    expect(await new BbqrDecoder().receive(p)).toEqual({ kind: "done", payload: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" });
  });
  it("J type is unsupported", async () => {
    const [p] = encode(new TextEncoder().encode("{}"), "2", "J", 1);
    expect(await new BbqrDecoder().receive(p)).toEqual({ kind: "error", reason: "unsupported-type" });
  });
  it("switching to a new sequence resets (Review Focus 5)", async () => {
    const d = new BbqrDecoder();
    await d.receive(encode(psbt, "H", "P", 3)[0]);
    const other = buildPsbt({ sign: true }).toPSBT();
    const parts = encode(other, "2", "P", 2);
    await d.receive(parts[0]);
    expect(await d.receive(parts[1])).toEqual({ kind: "done", payload: bytesToHex(other) });
  });
});
```
Check `deflateRawSync`'s `windowBits` minimum (Node requires 8..15; BBQr uses wbits 10). If Node rejects 10, use 15 for the test; the decoder handles any raw deflate stream.

- [ ] **Step 2: Run** -> FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/input/bbqr.ts
import { base32 } from "@scure/base";
import { hexToBytes } from "@/lib/bitcoin/hex";
import { bytesToPayload } from "./file";

export type BbqrResult =
  | { kind: "progress"; received: number; total: number }
  | { kind: "done"; payload: string }
  | { kind: "error"; reason: "unsupported-type" | "corrupt" };

const HEADER_RE = /^B\$([H2Z])([A-Z])([0-9A-Z]{2})([0-9A-Z]{2})(.*)$/;
export const isBbqrPart = (text: string) => HEADER_RE.test(text.trim());

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeBase32(s: string): Uint8Array {
  const pad = (8 - (s.length % 8)) % 8;
  return base32.decode(s + "=".repeat(pad));
}

export class BbqrDecoder {
  private key: string | null = null;
  private parts = new Map<number, string>();

  reset() { this.key = null; this.parts.clear(); }

  async receive(part: string): Promise<BbqrResult> {
    const m = part.trim().match(HEADER_RE);
    if (!m) return { kind: "error", reason: "corrupt" };
    const [, enc, type, totalS, idxS, body] = m;
    const total = parseInt(totalS, 36);
    const idx = parseInt(idxS, 36);
    if (!total || idx >= total) return { kind: "error", reason: "corrupt" };
    const key = `${enc}${type}${total}`;
    if (key !== this.key) { this.reset(); this.key = key; }
    this.parts.set(idx, body);
    if (this.parts.size < total) return { kind: "progress", received: this.parts.size, total };

    const joined = Array.from({ length: total }, (_, i) => this.parts.get(i)!).join("");
    this.reset();
    try {
      let bytes = enc === "H" ? hexToBytes(joined) : decodeBase32(joined);
      if (enc === "Z") bytes = await inflateRaw(bytes);
      if (type === "P" || type === "T") return { kind: "done", payload: bytesToPayload(bytes) };
      if (type === "U") return { kind: "done", payload: new TextDecoder().decode(bytes).trim() };
      return { kind: "error", reason: "unsupported-type" };
    } catch {
      return { kind: "error", reason: "corrupt" };
    }
  }
}
```

- [ ] **Step 4: Run** -> PASS. **Step 5: Commit** `git add src/lib/input/bbqr.ts src/lib/input/__tests__/bbqr.test.ts && git commit -m "feat(qr): BBQr decoder (hex, base32, deflate)"`

---

### Task 17: QR assembler

**Files:**
- Create: `src/lib/input/qr-assembler.ts`
- Test: `src/lib/input/__tests__/qr-assembler.test.ts`

**Interfaces:**
- Consumes: `UrDecoder`, `isUrPart`, `BbqrDecoder`, `isBbqrPart`.
- Produces:
  ```ts
  export type AssemblerState =
    | { kind: "idle" }
    | { kind: "progress"; format: "ur" | "bbqr"; percent: number; received?: number; total?: number }
    | { kind: "done"; payload: string }
    | { kind: "error"; reason: "unsupported-type" | "multisig" };
  export class QrAssembler { push(text: string): Promise<AssemblerState>; reset(): void }
  ```
  Rules: plain text -> `done` with `text.trim()` (the field's `cleanInput` handles BIP21/uppercase/URLs); identical repeated frames are ignored; `corrupt` frames are ignored (state unchanged); a UR frame after BBQr progress (or vice versa) resets the other decoder.

- [ ] **Step 1: Failing tests**: plain address -> `done` with that address; `"bitcoin:BC1Q..."` -> `done` (raw text passed through); UR multipart from `@ngraveio/bc-ur` with one garbage frame `"ur:crypto-psbt/1-3/zzzz"` in the middle -> still reaches `done`; BBQr then UR (Review Focus 5) -> `done` with the UR payload; `crypto-output` multisig -> `error` `multisig`.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement**

```ts
// src/lib/input/qr-assembler.ts
import { UrDecoder, isUrPart } from "./ur";
import { BbqrDecoder, isBbqrPart } from "./bbqr";

export type AssemblerState =
  | { kind: "idle" }
  | { kind: "progress"; format: "ur" | "bbqr"; percent: number; received?: number; total?: number }
  | { kind: "done"; payload: string }
  | { kind: "error"; reason: "unsupported-type" | "multisig" };

export class QrAssembler {
  private ur = new UrDecoder();
  private bbqr = new BbqrDecoder();
  private last: string | null = null;
  private state: AssemblerState = { kind: "idle" };

  reset() { this.ur.reset(); this.bbqr.reset(); this.last = null; this.state = { kind: "idle" }; }

  async push(text: string): Promise<AssemblerState> {
    if (text === this.last) return this.state;
    this.last = text;
    if (isUrPart(text)) {
      this.bbqr.reset();
      const r = this.ur.receive(text);
      if (r.kind === "error") return r.reason === "corrupt" ? this.state : (this.state = { kind: "error", reason: r.reason });
      return (this.state = r.kind === "done" ? r : { kind: "progress", format: "ur", percent: r.percent });
    }
    if (isBbqrPart(text)) {
      this.ur.reset();
      const r = await this.bbqr.receive(text);
      if (r.kind === "error") return r.reason === "corrupt" ? this.state : (this.state = { kind: "error", reason: "unsupported-type" });
      return (this.state = r.kind === "done" ? r : { kind: "progress", format: "bbqr", percent: Math.round((r.received / r.total) * 100), received: r.received, total: r.total });
    }
    return (this.state = { kind: "done", payload: text.trim() });
  }
}
```

- [ ] **Step 4: Run** -> PASS. **Step 5: Commit** `git add src/lib/input/qr-assembler.ts src/lib/input/__tests__/qr-assembler.test.ts && git commit -m "feat(qr): frame assembler for static, UR and BBQr codes"`

---

### Task 18: Frame decoding (native detector or zxing worker)

**Files:**
- Create: `scripts/copy-zxing.mjs`, `public/workers/qr.worker.js`, `src/lib/input/qr-decode.ts`
- Modify: `package.json` (`zxing-wasm` dependency; `predev` and `prebuild` run `node scripts/copy-zxing.mjs`), `.gitignore` (`public/vendor/zxing/`)
- Test: `src/lib/input/__tests__/qr-decode.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FrameDecoder { decode(source: ImageBitmap | ImageData): Promise<string | null>; close(): void }
  export async function createFrameDecoder(): Promise<FrameDecoder>; // native BarcodeDetector if it supports qr_code, else the worker
  export async function decodeImageFile(file: File): Promise<string | null>; // photo fallback
  ```
  Worker protocol: main -> worker `{ id: number, image: ImageData }` (buffer transferred); worker -> main `{ id: number, text: string | null }`.

- [ ] **Step 1: Add the dependency and inspect its build**

Run: `pnpm add zxing-wasm && ls node_modules/zxing-wasm/dist/ node_modules/zxing-wasm/dist/reader/ && grep -n "from ['\"]" node_modules/zxing-wasm/dist/reader/index.js | head`
Expected: an ESM `index.js` plus a `zxing_reader.wasm`; note whether `index.js` imports sibling chunk files by relative path (copy the whole `dist/reader` directory, plus any shared chunk directory it imports such as `dist/share`/`dist/cjs` equivalents). If it imports bare specifiers, use the package's `dist/iife/reader` (or `es` single-file) build instead; pick the build whose imports are all relative.

- [ ] **Step 2: Write `scripts/copy-zxing.mjs`**

```js
// Copies the zxing-wasm reader build into public/vendor/zxing (served same-origin, never from a CDN).
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("zxing-wasm/package.json"));
const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8")).version;
const out = join(process.cwd(), "public/vendor/zxing");
mkdirSync(out, { recursive: true });
cpSync(join(pkgDir, "dist"), out, { recursive: true });
console.log(`zxing-wasm ${version} copied to public/vendor/zxing`);
```
`package.json` scripts: `"predev": "node scripts/copy-zxing.mjs"`, and prefix `build` with `node scripts/copy-zxing.mjs && `. Add `public/vendor/zxing/` to `.gitignore`. Check the Dockerfile(s) run `pnpm build` (they then get the copy automatically).

- [ ] **Step 3: Write `public/workers/qr.worker.js`** (plain JS module worker)

```js
// QR decoding off the main thread with zxing-wasm, loaded from this origin only.
import { prepareZXingModule, readBarcodes } from "/vendor/zxing/reader/index.js";

prepareZXingModule({
  overrides: {
    // The package defaults to a jsdelivr URL: always serve the .wasm from this origin.
    locateFile: (path, prefix) => (path.endsWith(".wasm") ? "/vendor/zxing/reader/zxing_reader.wasm" : prefix + path),
  },
  fireImmediately: true,
});

self.onmessage = async (e) => {
  const { id, image } = e.data;
  try {
    const [hit] = await readBarcodes(image, { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 1 });
    self.postMessage({ id, text: hit && hit.isValid ? hit.text : null });
  } catch {
    self.postMessage({ id, text: null });
  }
};
```
Adjust the import path and `.wasm` file name to what Step 1 showed.

- [ ] **Step 4: Write `src/lib/input/qr-decode.ts`**

```ts
// src/lib/input/qr-decode.ts
export interface FrameDecoder { decode(source: ImageBitmap | ImageData): Promise<string | null>; close(): void }

interface NativeDetector { detect(src: ImageBitmapSource): Promise<{ rawValue: string }[]> }
type DetectorCtor = { new (o: { formats: string[] }): NativeDetector; getSupportedFormats(): Promise<string[]> };

function toImageData(src: ImageBitmap | ImageData): ImageData {
  if (src instanceof ImageData) return src;
  const c = new OffscreenCanvas(src.width, src.height);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, src.width, src.height);
}

async function nativeDecoder(): Promise<FrameDecoder | null> {
  const Ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    if (!(await Ctor.getSupportedFormats()).includes("qr_code")) return null;
    const d = new Ctor({ formats: ["qr_code"] });
    return {
      decode: async (src) => (await d.detect(src))[0]?.rawValue ?? null,
      close: () => {},
    };
  } catch {
    return null;
  }
}

function workerDecoder(): FrameDecoder {
  const worker = new Worker("/workers/qr.worker.js", { type: "module" });
  let seq = 0;
  const waiting = new Map<number, (t: string | null) => void>();
  worker.onmessage = (e: MessageEvent<{ id: number; text: string | null }>) => {
    waiting.get(e.data.id)?.(e.data.text);
    waiting.delete(e.data.id);
  };
  return {
    decode: (src) => new Promise((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve);
      const image = toImageData(src);
      worker.postMessage({ id, image }, [image.data.buffer]);
    }),
    close: () => { worker.terminate(); waiting.forEach((r) => r(null)); waiting.clear(); },
  };
}

export async function createFrameDecoder(): Promise<FrameDecoder> {
  return (await nativeDecoder()) ?? workerDecoder();
}

/** Photo fallback (works without a secure context): one static QR from an image file. */
export async function decodeImageFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const decoder = await createFrameDecoder();
  try {
    return await decoder.decode(bitmap);
  } finally {
    decoder.close();
    bitmap.close();
  }
}
```

- [ ] **Step 5: Test** (jsdom; stub `globalThis.BarcodeDetector` with a class whose `getSupportedFormats` resolves `["qr_code"]` and `detect` resolves `[{ rawValue: "hello" }]`; assert `createFrameDecoder()` uses it and returns "hello"; with no `BarcodeDetector` and a stubbed `Worker` class capturing `postMessage`, assert it posts `{ id: 1, image }` and resolves with the stubbed reply). Also assert `public/workers/qr.worker.js` text contains `locateFile` and no `jsdelivr`/`unpkg`.

- [ ] **Step 6: Run** `pnpm vitest run src/lib/input/__tests__/qr-decode.test.ts && pnpm build` -> PASS, and `ls out/vendor/zxing/reader/` shows the wasm.

- [ ] **Step 7: Commit** `git add package.json pnpm-lock.yaml .gitignore scripts/copy-zxing.mjs public/workers/qr.worker.js src/lib/input/qr-decode.ts src/lib/input/__tests__/qr-decode.test.ts && git commit -m "feat(qr): frame decoding via native BarcodeDetector or a self-hosted zxing worker"`

---

### Task 19: Scanner UI

**Files:**
- Create: `src/components/QrScanner.tsx`
- Modify: `src/components/InputExtras.tsx` (Scan QR button, lazy-loads the scanner)
- Test: `src/components/__tests__/QrScanner.test.tsx`

**Interfaces:**
- Consumes: `QrAssembler` (Task 17), `createFrameDecoder`, `decodeImageFile` (Task 18).
- Produces: `QrScanner(props: { onResult: (text: string) => void; onClose: () => void })`.

Behavior:
- Mount: if `!window.isSecureContext || !navigator.mediaDevices?.getUserMedia` -> photo mode only (`qr.insecure` "The camera needs HTTPS, localhost or the .onion address. You can take a photo of a static QR instead; animated QRs need the camera.").
- Otherwise call `getUserMedia({ video: { facingMode: "environment" } })` only now (the user just tapped). On `NotAllowedError` -> `qr.denied` "Camera access was blocked. Allow it in the browser settings, or take a photo of the QR."; on `NotFoundError`/other -> `qr.noCamera` "No camera found. Take a photo of the QR, or paste it."; in both cases show the photo button (Review Focus 4).
- Loop: every 120 ms draw the `<video>` into an offscreen canvas, `createImageBitmap(video)` -> `decoder.decode` -> `assembler.push(text)`; at most one decode in flight.
- Progress: `progress.format === "bbqr"` -> `qr.progressParts` "{{received}} of {{total}} parts"; `ur` -> `qr.progressPercent` "{{percent}}% received"; a thin bar `bg-bitcoin` with `width: percent%`.
- `done` -> stop tracks, `onResult(payload)`, `onClose()`. `error` -> `qr.multisig` "Multisig wallet exports are not supported yet." / `qr.unsupported` "This QR type is not supported." with a "Scan again" button that resets the assembler.
- Camera switch button when `enumerateDevices()` lists more than one `videoinput` (`qr.switchCamera` "Switch camera").
- Cleanup: on close, unmount, `pagehide` and `visibilitychange` to hidden: stop all tracks (`stream.getTracks().forEach((t) => t.stop())`), `decoder.close()`, clear the interval.
- Photo button: `<input type="file" accept="image/*" capture="environment">` -> `decodeImageFile` -> `assembler.push` -> same handling; `null` -> `qr.photoNoCode` "No QR code found in that photo.".
- Dialog chrome: same portal/overlay/focus-trap pattern as `XpubPrivacyWarning`, `aria-labelledby` -> title `qr.title` "Scan a QR code"; Escape closes.

`InputExtras.tsx`: add a second icon button (`ScanLine` from lucide, `data-testid="scan-qr"`, label `qr.open` "Scan a QR code") that sets `open` and renders `const QrScanner = lazy(() => import("./QrScanner").then((m) => ({ default: m.QrScanner })))` inside `Suspense`; `onResult={onPayload}`.

- [ ] **Step 1: Failing tests** (jsdom):
  1. `isSecureContext = false` -> renders the insecure message and the photo input; `getUserMedia` never called.
  2. `getUserMedia` rejects with `new DOMException("x", "NotAllowedError")` -> denied message + photo input visible (Review Focus 4).
  3. Close button stops tracks: provide a fake stream whose track `stop` is a spy; click close; expect `stop` called.
  4. Feeding the assembler: mock `@/lib/input/qr-decode` `createFrameDecoder` to return a decoder whose `decode` yields an address string; expect `onResult` called with it and tracks stopped.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement** `QrScanner.tsx` per the behavior list (state: `mode: "camera" | "photo"`, `message: string | null`, `progress: AssemblerState`; refs for stream, decoder, assembler, interval). Add all `qr.*` keys to the 6 locales (es tuteo: `qr.denied` "Se bloqueó el acceso a la cámara. Permítelo en los ajustes del navegador o haz una foto del QR.").
- [ ] **Step 4: Run** `pnpm vitest run src/components/__tests__/QrScanner.test.tsx && pnpm type-check && pnpm lint` -> PASS.
- [ ] **Step 5: Commit** `git add src/components/QrScanner.tsx src/components/InputExtras.tsx src/components/__tests__/QrScanner.test.tsx public/locales && git commit -m "feat(qr): camera scanner with progress, photo fallback and permission handling"`

---

### Task 20: End-to-end coverage

**Files:**
- Create: `e2e/helpers/local-tx-fixtures.ts`, `e2e/helpers/y4m.ts`, `e2e/before-you-send.spec.ts`, `e2e/qr-scanner.spec.ts`
- Modify: `e2e/helpers/mock-api.ts` (routes for synthesized parents, `POST /api/tx`, `/api/v1/fees/recommended`)
- Add devDependency: `qrcode` (+ `@types/qrcode`) for rendering QR matrices in the fake-camera video

**Interfaces:**
- `local-tx-fixtures.ts` exports `buildSignedFixture(): { psbtB64: string; rawHex: string; txid: string; parent: MempoolTransaction }` (same construction as `src/lib/input/__tests__/fixtures.ts`, but the parent is returned in mempool JSON shape with `txid = parent.id`).
- `y4m.ts` exports `writeQrVideo(path: string, frames: string[], opts?: { size?: number; fps?: number; repeat?: number }): void` (grayscale 4:2:0 Y4M: header `YUV4MPEG2 W{s} H{s} F{fps}:1 Ip A1:1 C420jpeg\n`, each frame `FRAME\n` + Y plane (QR modules black/white, 4-module quiet zone, scaled to fill) + U and V planes filled with 128).

- [ ] **Step 1: `before-you-send.spec.ts`**

```ts
import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";
import { buildSignedFixture } from "./helpers/local-tx-fixtures";

const fx = buildSignedFixture();

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
  await page.route(`**/api/tx/${fx.parent.txid}`, (r) => r.fulfill({ json: fx.parent }));
  await page.route("**/api/address/*", (r) => r.fulfill({ json: { chain_stats: { tx_count: 0 }, mempool_stats: { tx_count: 0 } } }));
  await page.route("**/api/v1/fees/recommended", (r) => r.fulfill({ json: { fastestFee: 20, halfHourFee: 10, hourFee: 5, economyFee: 2, minimumFee: 1 } }));
});

test("long PSBT: full analysis, nothing in history or hash", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("address-input").fill(fx.psbtB64);
  await page.getByTestId("scan-button").click();
  await expect(page.getByTestId("before-you-send")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  expect(await page.evaluate(() => localStorage.getItem("recent-scans"))).toBeNull();
});

test("raw hex: consent lookup completes the analysis", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/");
  await page.getByTestId("address-input").fill(fx.rawHex);
  await page.getByTestId("scan-button").click();
  await expect(page.getByTestId("local-lookup")).toBeVisible();
  expect(requests.some((u) => u.includes(fx.parent.txid))).toBe(false); // nothing before consent
  await page.getByTestId("local-lookup").click();
  await expect(page.getByTestId("local-lookup")).toBeHidden();
  expect(requests.some((u) => u.includes(fx.parent.txid))).toBe(true);
});

test("broadcast: one POST, then the txid scan", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/tx", async (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    posts++;
    expect(r.request().headers()["content-type"]).toContain("text/plain");
    await r.fulfill({ status: 200, body: fx.txid });
  });
  await page.route(`**/api/tx/${fx.txid}`, (r) => r.fulfill({ json: { ...fx.parent, txid: fx.txid } }));
  await page.goto("/");
  await page.getByTestId("address-input").fill(fx.psbtB64);
  await page.getByTestId("scan-button").click();
  await page.getByTestId("broadcast-open").click();
  await page.getByTestId("broadcast-confirm").dblclick();
  await expect(page).toHaveURL(new RegExp(`#tx=${fx.txid}`));
  expect(posts).toBe(1);
});

test("file drop of a binary PSBT", async ({ page }) => {
  await page.goto("/");
  const buffer = Buffer.from(fx.psbtB64, "base64");
  await page.getByTestId("open-file").click(); // ensures the input exists
  await page.locator('input[type="file"]').first().setInputFiles({ name: "tx.psbt", mimeType: "application/octet-stream", buffer });
  await expect(page.getByTestId("before-you-send")).toBeVisible();
});
```
In the broadcast test, the after-broadcast scan fetches `/api/tx/<txid>` and related endpoints; return minimal valid JSON for `outspends`/`status` routes if the scan errors (check `mock-api.ts` defaults first).

- [ ] **Step 2: `qr-scanner.spec.ts`** (fake camera; Chromium only)

```ts
import { test, expect } from "@playwright/test";
import * as path from "path";
import * as os from "os";
import { UR, UREncoder } from "@ngraveio/bc-ur";
import { CryptoPSBT } from "@keystonehq/bc-ur-registry";
import { mockMempoolApi } from "./helpers/mock-api";
import { buildSignedFixture } from "./helpers/local-tx-fixtures";
import { writeQrVideo } from "./helpers/y4m";

const fx = buildSignedFixture();
const video = path.join(os.tmpdir(), "aie-ur-psbt.y4m");
const enc = new UREncoder(new CryptoPSBT(Buffer.from(fx.psbtB64, "base64")).toUR(), 120);
writeQrVideo(video, Array.from({ length: enc.fragmentsLength * 4 }, () => enc.nextPart().toUpperCase()), { size: 480, fps: 5, repeat: 2 });

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`] },
  permissions: ["camera"],
});

test("animated UR PSBT scans into a Before you send result, with no CDN request", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => { if (/jsdelivr|unpkg|cdnjs|fastly/.test(r.url())) external.push(r.url()); });
  await mockMempoolApi(page);
  await page.goto("/");
  await page.getByTestId("scan-qr").click();
  await expect(page.getByText(/% received/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("before-you-send")).toBeVisible({ timeout: 60_000 });
  expect(external).toEqual([]);
});
```
`mockMempoolApi` aborts unmocked external requests, so a CDN fetch would also break the scan; the explicit assertion documents the rule. `UREncoder(UR, 120)`: unused `UR` import can be dropped.

Also add a photo-fallback test: render a single static QR PNG of an address with `qrcode`'s `toBuffer`, set `window.isSecureContext` false is not possible on localhost, so instead stub `navigator.mediaDevices.getUserMedia` to reject with `NotAllowedError` via `page.addInitScript`, click `scan-qr`, set the photo input file, and expect the address scan to start (`#addr=` in the URL).

- [ ] **Step 3: Run** `pnpm build && pnpm exec playwright test e2e/before-you-send.spec.ts e2e/qr-scanner.spec.ts --workers=1` -> PASS (run serially: memory is tight on the dev machine).

- [ ] **Step 4: Full e2e** `pnpm test:e2e` -> PASS.

- [ ] **Step 5: Commit** `git add e2e package.json pnpm-lock.yaml && git commit -m "test(e2e): before-you-send flows and fake-camera UR scan"`

**PR 4 checkpoint:** gates + e2e, then ask before pushing.

---

## Release (after all 4 PRs are approved and merged)

### Task 21: Real-world verification and 0.38.0

- [ ] **Step 1: Preview for the owner.** `pnpm build && npx serve out -l 3100` from the worktree; ask the owner to try: paste a real Sparrow PSBT, drop a `.psbt` file, scan Sparrow's animated UR and BBQr QR from a phone, broadcast on signet.
- [ ] **Step 2: Signet end to end.** With a funded signet wallet (Sparrow on signet), build and sign a tx, paste it on the preview with the network set to signet, broadcast through `mempool.space/signet`, confirm the page lands on `#tx=<txid>` and mempool.space/signet shows it.
- [ ] **Step 3: Umbrel image check.** After the merge, the release workflow builds the images. Run `scratchpad/umbrel-test/run.sh` with an extra stub service that answers `POST /api/tx` (a 10-line node server returning a fixed txid) as the mempool target, then `curl -s -X POST -H 'Content-Type: text/plain' --data 00 http://127.0.0.1:18080/api/tx` and confirm the stub saw the POST through nginx.
- [ ] **Step 4: Release.** Follow `CLAUDE.md` "Release Process" (bump `package.json` and `cli/package.json` to 0.38.0, gates, `chore: bump version to 0.38.0`, tag `v0.38.0`, push only with the owner's go, watch `docker-umbrel.yml`, `docker-tor-proxy.yml`, `deploy.yml`, verify image digests amd64+arm64, update the community store `docker-compose.yml` digests and `umbrel-app.yml` version + release notes, push the store).
- [ ] **Step 5: Memory and reply.** Update `project_release_0_37.md` (or a new `project_release_0_38.md`) and `MEMORY.md`; draft the reply for the original request (es, tuteo).
