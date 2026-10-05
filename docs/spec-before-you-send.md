# Before You Send - PSBT and raw transaction analysis, QR input, broadcast

Status: design approved in conversation (2026-10-04), pending spec review. Target release: 0.38.0.

---

## Why

A user can analyze a transaction only after it is on chain, unless they paste a PSBT. Community feedback (a public request to paste the raw hex of a transaction "before sending it to the network", and a tester asking for an option to broadcast from the same page after checking it) asks for a complete "check before you send" flow.

Investigating that request exposed a live bug: `cleanInput` (`src/lib/analysis/detect-input.ts`) truncates every input to 512 characters. A realistic 1-input, 2-output PSBT with `non_witness_utxo` (what Sparrow and Bitcoin Core attach to segwit v0 inputs) is about 676 base64 characters, so most real PSBTs are cut, still detected as PSBT by prefix, and fail to parse. Unit tests only use PSBTs up to 172 characters. In addition, after a PSBT scan the truncated 32-character query is saved as a "txid" in recent scans and bookmarks, and used by share links, retry and the explorer link.

## Goals

1. Any real PSBT or raw transaction (signed or unsigned) can be pasted, dropped as a file, or scanned from a QR, and is analyzed with the same engine, including the Link Probability Matrix.
2. The QR scanner and file input read everything the text field accepts (txid, address, BIP21 URI, xpub, descriptor, mempool URL, PSBT, raw tx), including animated BC-UR and BBQr QR codes and UR wallet exports.
3. Nothing about a not-yet-broadcast transaction is persisted anywhere or sent anywhere without an explicit, explained user action.
4. A fully signed transaction can be broadcast from the results, only after a confirm step that names the endpoint and its privacy cost.

## Non-goals

- Signing, combining or editing PSBTs.
- Broadcast or any network access from the CLI or MCP server (they stay offline; raw hex support is added there).
- Chain tracing beyond the parent transactions of a local transaction (its outputs do not exist on chain yet).
- New heuristics. PayJoin detection stays a non-heuristic (see `docs/privacy-engine.md`).

---

## Decisions (owner, 2026-10-04)

| Topic | Decision |
|---|---|
| Sequencing | One release with everything (bug fix included), built as 4 stacked PRs |
| Broadcast | Available on every backend, explicit opt-in confirm step |
| Prevout lookup for raw tx | Automatic on self-hosted backends, one consented click on public ones |
| Persistence | Pre-broadcast data never stored; after broadcast the page switches to `#tx=<txid>` |
| Extras | File drop/pick, pre-broadcast checklist, QR camera scan (UR + BBQr), unsigned raw tx |
| Architecture | One local-transaction pipeline (approach A), no new route |
| QR fallback decoder | `zxing-wasm`, lazy, self-hosted, in a Web Worker |
| QR scope | Reads every accepted input, not only PSBTs |
| UR wallet exports | Included (`crypto-output`, `crypto-account`, `crypto-hdkey`) |
| Address lookups | Included in the consented lookup (inputs' parents and output-address history) |
| Dry-run (testmempoolaccept) | Self-hosted backends only |

---

## 1. Input layer

### Single entry point

`resolveInput(payload: string | Uint8Array): ResolvedInput` in `src/lib/input/`.

```ts
type ResolvedInput =
  | { kind: "scan"; value: string }          // txid, address, xpub/descriptor: existing path + hash routing
  | { kind: "local"; tx: LocalTx }           // PSBT or raw tx: memory only
  | { kind: "invalid"; reason: InvalidReason };
```

Paste, text field submit, file input, drag-and-drop and the QR scanner all call it. `detectInputType` keeps its role for the `scan` kinds.

### Recognized formats (one decoder module each, unit-tested in isolation)

| Module | Input | Output |
|---|---|---|
| `text.ts` | trimmed text; strips control chars and inner whitespace/newlines for base64/hex payloads; `bitcoin:` BIP21 (address taken, params ignored); uppercase bech32 (QR alphanumeric mode) lowercased; mempool/blockstream URLs (existing) | normalized string |
| `psbt.ts` (existing, extended) | base64 `cHNidP...`, hex `70736274ff...`, binary bytes starting `psbt\xff`; PSBT v0 and v2 | `LocalTx` |
| `raw-tx.ts` | hex or binary raw tx, signed or unsigned, segwit or legacy; strict parse via `Transaction.fromRaw` (no trailing bytes, at least 1 input and 1 output) so other long hex is never mistaken for a tx | `LocalTx` |
| `ur.ts` | `ur:crypto-psbt`, `ur:psbt` (tags 310 / 40310), `ur:bytes`, `ur:crypto-output`, `ur:crypto-account`, `ur:crypto-hdkey`; single-part and multi-part fountain (BCR-2020-005), minimal bytewords, CRC32, Xoshiro256** seeded with SHA-256 (`@noble/hashes`), tiny CBOR reader | bytes, or descriptor/xpub string |
| `bbqr.ts` | `B$` + encoding (`H` hex, `2` base32, `Z` base32 + raw deflate via native `DecompressionStream("deflate-raw")`) + file type (`P` PSBT, `T` tx, `U` text; `J` rejected with a message) + total + index (base36) | bytes or text |
| `file.ts` | `File` up to 4 MB, sniffed by content not extension: PSBT magic, raw tx bytes, else UTF-8 text through `text.ts` | payload |

UR and BBQr decoders are written in-house (about 450 lines total). The `@ngraveio/bc-ur` stack needs Node `Buffer` polyfills; the `bbqr` npm package has no license field and inlines pako, qrcode and upng.

### Length handling

`cleanInput` keeps `MAX_INPUT_LENGTH = 512` for short inputs. Text that starts with a PSBT magic, or is pure hex longer than 64 characters, or is a UR/BBQr payload, bypasses the 512 cap and is limited to 4 MB instead. Control characters are still stripped. `detect-input.test.ts` asserting the 512 cut is updated accordingly.

### Field UI (`AddressInput`, `InlineSearchBar`)

- Two icon buttons inside the field: **Open file** and **Scan QR**. Dropping a file onto the field also works.
- Placeholders: `home.placeholder` "Address, txid, xpub, PSBT or raw tx"; `input.placeholderScan` updated the same way.
- Invalid copy (`input.errorInvalid`, `errors.invalid_input`) lists all accepted formats.
- New detected label: `input.detectedRawTx` "Raw transaction (signed)" / "(unsigned)".

### QR scanner

- Lazy-loaded component, opened only by a tap; the camera permission prompt appears only after that tap.
- `getUserMedia({ video: { facingMode: "environment" } })`, camera switch when several exist, tracks stopped on close, on navigation and on `visibilitychange` to hidden.
- Decoding: native `BarcodeDetector` when available (Chrome Android, Chrome macOS/ChromeOS), otherwise `zxing-wasm` reader in a worker under `public/workers/`, with its `.wasm` self-hosted under `public/wasm/zxing/` and `locateFile` overridden (its dist hardcodes a jsdelivr URL and the CSP `connect-src https:` would allow it). The page CSP has no `wasm-unsafe-eval`, so WASM must stay in a worker.
- Multi-part progress: BBQr "12 of 31 parts"; UR fountain "% complete". Completes automatically and closes.
- Each decoded frame goes through `resolveInput`; a single static QR of any accepted kind works the same way.
- Without a secure context (`window.isSecureContext === false`, e.g. Umbrel over `http://umbrel.local`), the button becomes **Photo of a QR** (`<input type="file" accept="image/*" capture="environment">`), decoded by the same worker via `createImageBitmap`. A note explains that animated QRs need HTTPS, localhost or the .onion address.

### CLI / MCP

`scan psbt` (and the MCP `scan_psbt` tool) also accept raw tx hex and `.txn` files through the same `src/lib/input` decoders. No network access is added.

---

## 2. Analyzing a local transaction

### `LocalTx`

```ts
interface LocalTx {
  source: "psbt" | "raw";
  status: "unsigned" | "partial" | "signed";
  tx: MempoolTransaction;          // engine shape, txid computed locally when possible, else "psbt-preview"
  missingPrevouts: number[];       // input indexes without a known value/script
  signedHex: string | null;        // extractable, broadcastable hex when status === "signed"
  network: BitcoinNetwork;
  psbt?: PSBTParseResult;          // existing banner data
}
```

- `signed`: a PSBT that finalizes and extracts cleanly with `@scure/btc-signer`, or a raw tx where every input has a witness or scriptSig.
- `partial`: a PSBT with some partial signatures.
- The vin/vout building in `parsePSBT` (`describeScript`, `MEMPOOL_SCRIPT_TYPE`) is shared with the raw parser, not duplicated.

### Backend classes

| Class | Backends | Lookups |
|---|---|---|
| self-hosted | Umbrel `/api`; custom URL whose host is localhost, `*.local`, a private IP range or a `.onion` | automatic |
| public | mempool.space clearnet, mempool.space onion, custom URL on a public hostname | one consented click |

### Consented lookup

One button on the results, for example: "Complete the analysis: look up 3 inputs and 2 addresses on mempool.space". The text explains what is revealed: the coins about to be spent and where they go, linked to the IP address unless Tor is used.

It fetches:
- Parent transactions of inputs with missing amounts, and of all inputs for context (coin age spread, post-mix and entity parent checks, CPFP parent check), via `enrichPrevouts` (cap 50 parents, concurrency 4).
- Output-address history (`outputTxCounts`), for "sending to a reused address" and change-to-known-address checks.

All of it goes through a client built with `createMempoolClient` directly, without `withCachePolicy`, so nothing reaches IndexedDB, and without retries on these IP-linked calls. Prices and `/api/v1/fees/recommended` reveal nothing about the transaction and use the normal client.

### Engine run

- Same `analyzeTransaction`, with a `local: true` context flag that:
  - drops `timing-unconfirmed`;
  - turns signature-based wallet fingerprints (low-R, sighash) on unsigned or partial transactions into "visible after signing" instead of "absent".
- Before lookup, everything that does not need input amounts runs (structure, output script types, round amounts, address reuse inside the transaction, BIP69, locktime and RBF fingerprints). Findings that need amounts are listed as "needs input amounts", never silently omitted.
- Link Probability Matrix: runs once all input amounts are known, with the same rules as the txid path (auto up to 8x8, on demand above). PSBTs gain it.
- The six chain steps stay skipped for local transactions, except the parent context above.
- The grade is the same model, labeled "Projected grade if broadcast". The PSBT/raw banner replaces the txid header.

### "Before you send" checklist (top of results, local transactions only)

1. **What this transaction reveals**: the 3 to 5 most severe findings in plain words, each with its existing recommendation (coin control, avoid merging, PayJoin only as a recommendation).
2. **Safety checks** (no extra network access beyond the fee estimate):
   - fee rate vs the current mempool estimate (`/api/v1/fees/recommended`);
   - absurd fee: above 1,000 sat/vB or above 10% of the amount sent;
   - dust outputs;
   - RBF signaled;
   - anti-fee-sniping locktime;
   - status: unsigned or partial shows "Sign in your wallet, then paste or scan the signed transaction to broadcast".

---

## 3. Broadcast

### Eligibility

- `status === "signed"` and `signedHex` present.
- Transaction network matches the backend network; a mismatch is blocked with a clear message.
- Never automatic, never bound to Enter or a shortcut, absent from CLI/MCP.

### Confirm dialog

- Summary: each output with its amount, fee, fee rate, projected grade.
- Exact endpoint in words and URL: "mempool.space (https://mempool.space/api/tx)", "mempool.space over Tor (...onion)", "your node (umbrel.local)".
- Privacy note per class:
  - clearnet: mempool.space sees the IP address together with the transaction, and is the first place it is seen;
  - onion: sent over Tor, the IP is hidden, mempool.space still sees the transaction first;
  - self-hosted: the own node relays it to its peers.
- Critical findings: the highest-severity finding is shown and the button reads "Broadcast anyway". Nothing blocks the broadcast.
- Dry-run: on self-hosted backends, `POST /api/txs/test` (testmempoolaccept, body `["<hex>"]`) runs when the dialog opens and shows any reject reason. A 404 skips it silently. Public backends get no dry-run (it would reveal the transaction without relaying it).

### Request

- `POST {base}/tx`, body = hex, `Content-Type: text/plain` (a CORS simple request, no preflight; verified against mempool.space on 2026-10-04: `access-control-allow-origin: *`, plain-text RPC errors; its preflight returns 404, so no custom headers may be added).
- Plain `fetch`, never `fetch-with-retry`. One request in flight, button locked, 30 s timeout.
- Success: response txid compared with the locally computed txid (warning if different); `LocalTx` wiped from memory; navigate to `#tx=<txid>`, which is a normal scan and is saved like any other. The scan tolerates a short indexing delay ("Just broadcast, waiting for the backend to index it", retry with backoff for up to about 30 s).
- Errors: show the node message plus a plain-language line:
  - `-25` inputs missing or already spent;
  - `-26` fee too low, non-final, or conflicts with a mempool transaction;
  - `-27` already in the chain: treated as success, navigate to `#tx`.
- Timeout or network error: "Unknown whether it was sent", with a **Check status** button (`GET /tx/:txid/status`). A blind retry is never offered.

### Copy and documentation updates (all 6 locales, Castilian tuteo for es)

Every "nothing is sent" claim is updated to "Nothing is sent unless you choose to broadcast. Broadcasting sends only the signed transaction to the endpoint shown.":
- `faq.a_data`, `flows.psbtLocal` (PSBT banner), `scan.sourcePsbt`, `about.principle_client_*`, `welcome.not_p1`, `settings.cacheNote` if affected;
- `docs/privacy-engine.md` threat model, `docs/development-guide.md` endpoint list (add `POST /tx`, `POST /txs/test`) and the "PSBTs are never put in the URL hash" note (extended to raw transactions);
- README input list; About capability list (`about.cap_*`), `home.how_1_body`.
- CLI/MCP "zero network access" claims stay true and unchanged.

### Self-hosted verification

- Umbrel: `umbrel/nginx.conf.template` `/api/` already proxies all methods to the local mempool; verified in the Docker run test with a stub mempool that records the POST.
- Custom URLs: a self-hosted mempool may not send CORS headers for POST; the error then says to broadcast from the wallet or node.

---

## 4. Persistence and privacy rules

- A `LocalTx` lives only in React state inside `useScanner`. It is never written to the URL hash, recent scans, bookmarks, the IndexedDB result cache, share links, logs or `console`.
- Reload or a new scan drops it.
- Results for a local transaction hide bookmark, share and explorer link; retry re-runs from memory; the inline search starts empty.
- Migration on load: recent-scan and bookmark entries whose query starts with `cHNidP` or `70736274ff` (truncated PSBTs saved as txids) are removed.
- Error messages never echo the input.
- The service worker already ignores non-GET requests (`public/sw.js`), so broadcast and dry-run POSTs are never cached; a test keeps it that way.

---

## Testing

### Unit

- Decoders: UR official vectors (BCR-2020-005, including out-of-order and missing fountain parts), BBQr vectors from the spec repo (H, 2, Z), realistic PSBTs over 512 characters with `non_witness_utxo`, signed and unsigned raw transactions (legacy and segwit), BIP21, uppercase QR text, binary file sniffing, UR wallet exports to descriptor/xpub.
- `resolveInput` table: every format to the right kind; random long hex is `invalid`, not a transaction.
- Engine: `local` flag adaptations, "needs input amounts" listing, checklist rules (fee thresholds, dust, RBF, locktime).
- Broadcast client: text/plain body, exactly one request on 5xx, error code mapping, timeout to "unknown" state, `-27` as success.
- Backend class detection for each backend kind.
- Persistence: hook test asserting localStorage, IndexedDB and `location.hash` are untouched after PSBT and raw scans; migration removes truncated entries.
- Golden corpus unchanged for txid scans.

### E2E (offline mock API)

- Paste a 676-character PSBT: grade and Link Probability Matrix shown.
- Raw hex: consent button, mocked parents and address history, full results.
- File drop of a binary `.psbt`.
- Mocked broadcast: confirm dialog, navigation to `#tx=`.
- Photo-of-QR path with a QR image fixture.
- Live scanner: Chromium fake camera (`--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<y4m>`) playing a generated animated UR PSBT; asserts progress and result, and asserts zero requests to any CDN host.

### Real-world, before release

- A real signed signet transaction broadcast through `mempool.space/signet`.
- Umbrel image run test with a stub mempool confirming POST passes through nginx.
- Animated UR and BBQr exports displayed by Sparrow, scanned with a phone; a hardware wallet (Coldcard Q, Keystone, Passport or SeedSigner) if available.

---

## Delivery

Four stacked PRs, each green on CI, merged together for 0.38.0:

1. **Input layer**: `src/lib/input/` (text, raw-tx, file), truncation fix, `LocalTx` in memory, persistence rules and migration, file open/drop, CLI raw hex.
2. **Local analysis**: backend classes, consented/auto lookup with the uncached client, `local` engine flag, Link Probability Matrix for local transactions, checklist.
3. **Broadcast**: broadcast client, confirm dialog, dry-run, status check, copy and doc updates.
4. **QR scanner**: UR and BBQr decoders, scanner UI, zxing-wasm worker and self-hosted assets, photo fallback, fake-camera e2e.

Then: preview on :3100 for owner testing, merge, release 0.38.0 (GH Pages, tag, Docker images, community store), reply to the original request.

## Dependencies

- New: `zxing-wasm` (MIT, reader build only, about 412 KB gz, lazy and self-hosted).
- Existing reused: `@scure/btc-signer`, `@scure/base`, `@noble/hashes`.
- Browser APIs: `BarcodeDetector` (optional), `DecompressionStream("deflate-raw")`, `getUserMedia`, `createImageBitmap`.

---

## Plan-time amendments (2026-10-04)

Found while writing `docs/plan-before-you-send.md` against the code; they simplify the design without changing behavior the owner approved.

1. **One canonical string instead of a `resolveInput` union.** File and QR sources convert bytes to the string the text field already accepts (PSBT/raw tx as hex, text as text, UR wallet exports as a descriptor). `detectInputType` gains `"rawtx"`; `parseLocalTx` builds the `LocalTx`. Every source then follows the exact path of a paste.
2. **Lookup GETs keep the normal retry on 429/5xx.** A retried GET reveals nothing new; they still bypass the IndexedDB cache. Only the broadcast POST is never retried.
3. **No network-mismatch block before broadcast.** A raw transaction carries no network information, so a mismatch cannot be detected reliably. A wrong-network broadcast is rejected by the node (`-25`, inputs missing), and that message says so.
4. **No engine flag.** The engine does not penalize missing signatures, so signature fingerprints need no change: the checklist shows "visible only once it is signed" instead. `timing-unconfirmed` is filtered in `runLocalAnalysis`.
5. **"Before you send" replaces the PSBT banner** and carries the "Projected grade if broadcast" label.
6. **Unknown input amounts** are reported by a new zero-impact finding `local-needs-amounts`.
7. **Test-only dev dependencies**: `@ngraveio/bc-ur`, `@keystonehq/bc-ur-registry` and `qrcode` serve as independent reference encoders in tests and the fake-camera video; nothing from them ships.
8. **zxing-wasm assets** are copied into `public/vendor/zxing/` at `predev`/`build` time (gitignored) rather than committed.
