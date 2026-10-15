# Graph investigation tools + encrypted backup - design and implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Read only your own task section plus "Global Constraints" and "Design".

**Goal:** Five features inspired by Chaingraph (MIT, github.com/remcoros/chaingraph; ideas reimplemented, no code copied), each going beyond it by reusing am-i.exposed's analysis engine:

1. "How are these connected?" path search between two points, with every hop scored by link certainty.
2. Encrypted backup export/import of everything stored in the browser, plus an optional password lock on the raw xpubs kept in wallet bookmarks.
3. Graph labels as BIP329 records (export/import with a conflict preview, shared with the wallet labels panel).
4. Chronological ("time") graph ordering and bundling of parallel outputs.
5. Multi-select with batch label/hide/isolate/remove, plus filter chips.

**Delivery:** two PRs built in parallel worktrees.
- PR A `feat/graph-investigation` (worktree `/home/user/aie-graph`): Tasks 1-7 (features 1, 3, 4, 5, docs).
- PR B `feat/encrypted-backup` (worktree `/home/user/aie-backup`): Tasks 8-10 (feature 2).

## Global Constraints

- pnpm only. Gates before reporting DONE: `pnpm type-check`, `pnpm lint` (0 warnings), `pnpm test`, and for UI tasks `pnpm build` plus the touched e2e specs (`pnpm test:e2e <spec>` after `pnpm build`; if port 3000 is busy, use the repo's playwright config with `PORT`/`--config` as other specs do, never kill other processes).
- TypeScript strict, no `any`. Tailwind semantic tokens (`bg-surface-inset` etc.), `motion/react`, `"use client"` on interactive files. Satoshis are integers.
- **Never use em dashes** (U+2014 as a character, its JS unicode escape, or the HTML entity) anywhere. Never "proprietary". UI copy never uses "we/us/our".
- i18n: every new UI string goes through `t("ns.key", { defaultValue })` and gets real translations in all 6 locales `public/locales/{en,es,pt,de,fr,pl}/common.json` (flat keys; Spanish is Castilian tuteo: "usa", "elige", never voseo; Polish plurals need `_one/_few/_many/_other`). `src/lib/__tests__/locale-parity.test.ts` must pass.
- Privacy: nothing user-entered (addresses, txids, xpubs, labels, passwords) is logged, sent anywhere except the configured mempool API (for chain data), or stored outside the existing local stores. Passwords are never stored.
- Network calls only through the existing graph fetcher / mempool client (respect the existing retry and rate limiting). No new dependencies.
- Git: commit in your worktree on your branch; Copexit identity is already configured (never pass `-c user.*`). No `Co-Authored-By`, no AI attribution in commits. Never `git stash`. Do not push.
- Follow existing patterns: graph pure logic in `src/lib/graph/`, graph UI in `src/components/viz/graph/`, hooks in `src/hooks/`. Keep files focused (new files over growing a 500-line file further).
- Touch targets and phone width (390px) must work; every new control is keyboard reachable and labelled.

## Design

### Existing pieces to reuse (verified)
- Graph state: `src/lib/graph/graph-reducer.ts` (`GraphNode {txid, tx, depth, parentEdge?, childEdge?}`, `GraphState`, `GraphAction`, undo stack cap 50, `DEFAULT_MAX_NODES` 200), driven by `src/hooks/useGraphExpansion.ts`. Fetcher interface `GraphExpansionFetcher {getTransaction, getTxOutspends, getAddressTxs?}` (graph-reducer.ts:66).
- UI state: `src/components/viz/graph/useGraphExplorerState.ts` (selectedNode single, filter `NodeFilter`, nodeLabels/edgeLabels Maps, changeOutputs `Set<"txid:vout">`, positions, annotations).
- Layout: `src/components/viz/graph/layout.ts` `layoutGraph(...)` one column per depth; edges are one `LayoutEdge` per (from,to) pair with `outputIndices` and `consolidationCount` (collapsed nodes already draw one edge with an "N outputs" label, GraphEdges.tsx:233-327); expanded nodes with ports draw one bezier per port (`edge-utils.ts` `buildConsolidationPaths`).
- Saved graphs: `src/lib/graph/saved-graph-types.ts` (`SavedGraph`, `serializeGraph`, `validateSavedGraph`), store `src/hooks/useSavedGraphs.ts` (localStorage `ami-saved-graphs`), share URL codec `graph-url-codec.ts` (do not change the URL format).
- Linkability: `src/hooks/useGraphBoltzmann.ts` (`boltzmannCache: Map<txid, BoltzmannWorkerResult>`, `matLnkProbabilities[outIdx][inIdx]`); change detection `analyzeChangeDetection` (`src/lib/analysis/heuristics/change-detection.ts`, finding `h2-change-detected` with `params.changeIndex`, `params.confidence`); CoinJoin type detection used by the graph (`src/components/viz/graph/` coinjoin-type helpers).
- BIP329: `src/lib/wallet/bip329.ts` (`Bip329Record`, `parseBip329`, `serializeBip329`, `recordKey`, `MAX_LABEL_LENGTH`), wallet labels panel `src/components/wallet/WalletLabelsPanel.tsx` (import currently overwrites on key clash).
- Persistence: localStorage stores via `src/hooks/createLocalStorageStore.ts`; bookmarks `src/hooks/useBookmarks.ts` (export `{version:1, bookmarks, graphs}` as `am-i-exposed-workspace.json`, merge by newer `savedAt`); saved wallets IndexedDB `src/lib/wallet/saved-wallets.ts`; settings `analysis-settings`, `ami-theme`, `ami-language`, `ami-network`, `ami-custom-api-url`. UI `src/components/settings/WorkspaceSettingsPanel.tsx`. No WebCrypto exists yet.

### Feature 1: connection search
- Pure async search `findConnections(a, b, fetcher, options, signal)` in `src/lib/graph/connection-search.ts`. Endpoints are txids; an address endpoint is resolved by the caller to the txids of its first page of history (`getAddressTxs`), so the endpoint is a set of txids.
- Four frontiers grow in rounds, always expanding the smallest non-empty frontier first: forward(A) via outspends, backward(A) via `vin[].txid`, forward(B), backward(B). Each tx reached records its predecessor link (`{txid, vout, vin}`) so paths can be rebuilt.
- Result kinds, all streamed through `onResult`:
  - `a-funds-b`: forward(A) meets backward(B);
  - `b-funds-a`;
  - `shared-ancestor`: backward(A) meets backward(B);
  - `shared-descendant`: forward(A) meets forward(B);
  - `direct`: A spends B or B spends A.
- Each result is a `ConnectionPath` (an ordered list of hops; a hop is a tx with the input it was entered by and the output it left by), plus the meeting txid.
  - Keep the 5 shortest of each kind. Paths through the same meeting tx with the same hop count are deduplicated.
- Budgets (all user-adjustable in the panel within bounds):
  - max hops per side: default 4, bounds 1-8;
  - max transactions fetched: default 150, bounds 20-600;
  - time: default 45 s, bounds 10-120 s;
  - per-tx branch cap of 60 outputs: wider txs are not expanded forward and are reported as a `branchLimit` stop.
- Skip rules:
  - "Stop at CoinJoins" is on by default: a tx detected as a CoinJoin is recorded as reached but not expanded through.
  - Coinbase inputs and unspent outputs are natural ends.
- Fetches are deduplicated, run with a concurrency of 3, use the injected fetcher (which hits the response cache), and abort on signal.
- Finishes with a `SearchSummary {txsFetched, stoppedBy: "done"|"hops"|"budget"|"time"|"aborted", branchLimited: number}`.
- **Scoring (beyond Chaingraph):** `scorePath(path, ctx)` in `src/lib/graph/path-scoring.ts` gives each hop a link certainty and the path a compound value.
  - Per hop, from the input the path enters by to the output it leaves by:
    - **certain (1.0):** the tx has 1 input, or 1 output, or Boltzmann (when cached for that txid) gives exactly 1 for [out][in];
    - **Boltzmann probability:** when cached, its value is used;
    - **probable:** the output is flagged as change by `analyzeChangeDetection` (≈0.8 for high confidence, 0.65 for medium, 0.55 for low);
    - **ambiguous:** otherwise, `1 / max(inputs, outputs)` as a floor estimate.
    - A CoinJoin hop with no cache is ambiguous, using the equal-output anonymity-set estimate.
  - Compound = product of the hop values. Tier: deterministic (all certain), likely (≥ 0.5), weak (≥ 0.1), ambiguous (< 0.1).
  - The UI says plainly that hops without a computed Boltzmann matrix are estimates.
- **UI:** a "Find connection" panel opened from the toolbar (icon button) and from the node sidebar ("Find connection from here").
  - Fields: From (prefilled with the selected node), To (a txid or address; a "pick a node in the graph" button sets To by clicking a node); a Budgets disclosure; Start/Cancel.
  - Live progress: txs fetched / budget, hops reached, elapsed time.
  - Result cards grouped by kind, each showing the hop count, the compound tier and percentage, a hop strip (short txids with a per-hop certainty colour, using the existing `probColor`), and an "Add to graph" button. Plus an "Add all".
  - Empty and stopped states explain why (budget, time, no path within N hops, CoinJoin stops) and offer "Search deeper" (the budget doubled within bounds).
  - Phone: the panel is a bottom sheet, matching the existing sidebar behaviour.
- **Add to graph:** a new reducer action `ADD_NODES` (a batch; one undo step) adds every path tx not already present. Depth and edges:
  - Depth is relative to an anchor already in the graph: forward hops get +1, backward hops -1. The `parentEdge`/`childEdge` fields are set from the hop links.
  - Nodes respect `maxNodes` (stop and report how many were skipped).
  - The added path is highlighted (a transient set of txids drawn with the focus ring) until the next click.

### Feature 3: graph labels as BIP329
- `src/lib/graph/graph-labels-bip329.ts`:
  - `graphLabelsToBip329(nodeLabels, edgeLabels, nodes)` maps:
    - a node label to a `{type:"tx", ref: txid, label}` record;
    - an edge label `from->to` to an `output` record `{ref: "from:vout"}` for each vout in that edge's output indices, so all outputs of a bundled edge share the label.
  - `bip329ToGraphLabels(records, nodes, edges)` is the inverse, restricted to txids/outputs present in the graph. It also returns the count of records that did not match anything in the graph.
- `src/lib/wallet/bip329-merge.ts` `mergeBip329(existing, incoming): {added, unchanged, conflicts: {key, existing, incoming}[]}` plus `applyMerge(existing, merge, replaceKeys: Set<string>)`. Default: keep existing on conflict.
- Shared UI `src/components/labels/Bip329ConflictPreview.tsx`: the counts plus a conflict table (key, existing, incoming, a per-row "use incoming" checkbox, and a "use all incoming" toggle). Apply/Cancel.
  - It is used by the graph import AND replaces the current overwrite-on-clash behaviour in `WalletLabelsPanel` (wallet import with zero conflicts applies directly as today).
- Graph UI:
  - the toolbar Save/Load menu gains "Export labels (BIP329)", which downloads `.jsonl` named `graph-labels-<first 8 of root txid>.jsonl`;
  - and "Import labels (BIP329)": a file picker, then a conflict preview when needed, then apply.
  - The plaintext warning line mirrors the wallet panel's.

### Feature 4: time ordering and bundled parallel outputs
- **Layout mode:** `layoutMode: "hops" | "time"` (default "hops") in the explorer UI state, toggled from the toolbar, and saved in `SavedGraph.layoutMode?` (optional, validated; old graphs load as "hops"). The URL codec is unchanged: shared graphs open in "hops".
  - In "time" mode:
    - The column key is `(block_height, intra-block level)`, where intra-block level = the longest chain of in-graph parents confirmed in the same block. Unconfirmed txs go after all confirmed ones, ordered by in-graph parent chain.
    - The columns are the sorted distinct keys. Rows inside a column follow the existing ordering.
    - A thin header above each column shows the height and a short date (the existing date formatter). Consecutive columns with a gap of more than 1 block show a gap marker "... N blocks".
    - Drag overrides and the expanded node keep working. The minimap and fit-to-view use the same layout output.
- **Parallel output bundling (port mode):** when the expanded node shows ports and 3+ outputs of tx A are spent by tx B, draw ONE thick bezier from the port group's midpoint to B, with an "×N" badge.
  - Clicking or tapping the badge toggles that pair to per-port beziers. The toggle state is UI-only (a Set of `from->to`), cleared on reset.
  - Linkability colouring of a bundled edge uses the max probability over its outputs (the same as the collapsed-node edge today). Its tooltip lists the vouts.

### Feature 5: multi-select, batch actions, chips
- **State** in `useGraphExplorerState`:
  - `selection: Set<txid>`;
  - `hidden: Set<txid>`;
  - `isolate: {txids: Set<txid>, hops: 1|2} | null`;
  - `selectMode: boolean` (touch).
- **Selecting:**
  - Ctrl/Cmd+click (or Shift+click) toggles a node in the selection without opening the sidebar.
  - In select mode (a toolbar toggle, needed on phones), a tap toggles.
  - Escape clears the selection, then exits select mode.
  - "Select all visible" lives in the batch bar.
  - Selected nodes get a distinct outline (a token colour, not a severity colour).
- **Batch bar:** a floating bar at the bottom of the canvas when the selection has 1 or more nodes. It shows the count, plus:
  - **Label…:** one text input; it sets the node label of each selected node in one state update.
  - **Hide:** adds them to `hidden`.
  - **Isolate 1 hop / 2 hops:** sets `isolate`.
  - **Remove:** a new reducer action `REMOVE_NODES` (one undo step), which never removes a root. Cascade removal of unreachable nodes behaves like the single `collapse`.
  - **Clear.**
- **Layout:** hidden txids are excluded from `layoutGraph` exactly like `NodeFilter` exclusions (the root and the expanded node are never hidden). Isolate keeps nodes within N hops (over in-graph edges) of any isolate txid.
- `SavedGraph.hiddenTxids?: string[]` is persisted (validated, optional). Isolate and selection are not persisted.
- **Filter chips:** a row above the canvas (wraps on phones) showing one removable chip per active constraint:
  - each disabled `NodeFilter` category ("CoinJoins hidden");
  - "N hidden" (× = show all);
  - "Isolated: 1 hop around N" (× = clear).
  - No chips are shown when nothing is active. The existing `hiddenCount` in the toolbar includes the manual hides.

### Feature 2: encrypted backup + wallet key lock (PR B)
- **`src/lib/crypto/envelope.ts`:**
  - `sealJson(value, password): Promise<SealedEnvelope>` and `openJson<T>(env, password): Promise<T>` (throws `WrongPasswordError` on a GCM auth failure).
  - Envelope: `{format:"am-i-exposed-sealed", v:1, kdf:"PBKDF2-SHA256", iterations:600000, salt:b64 (16 B), iv:b64 (12 B), gzip:true, ct:b64}`.
  - Uses WebCrypto AES-256-GCM, with gzip through `CompressionStream`/`DecompressionStream`. `isSealedEnvelope(x)` is a type guard.
  - Also `deriveKey`, exported for the vault (a single derivation per unlock).
- **Full backup** in `src/lib/backup/backup.ts`:
  - `buildBackup(opts: {includeWallets, includeSavedWallets, includeSettings})` gathers:
    - bookmarks (wallet entries only when `includeWallets`);
    - saved graphs;
    - saved wallet snapshots from IndexedDB (meta + data; only when `includeSavedWallets` and the cache setting is on);
    - settings (`analysis-settings`, `ami-theme`, `ami-language`, `ami-network`, `ami-custom-api-url`);
    - the wallet-lock vault (as is; it is already sealed).
    - Payload: `{version:2, createdAt, bookmarks, graphs, savedWallets?, settings?, walletVault?}`.
  - `restoreBackup(payload, {includeWallets})` merges with the existing rules:
    - bookmarks and graphs: the newer `savedAt` wins;
    - saved wallets: a missing key is added, and an existing key keeps whichever snapshot is newer;
    - settings: applied only when the user ticks "Also restore settings".
    - Returns counts.
  - Version 1 files and legacy formats still import through the existing `importBookmarks` path.
- **UI (`WorkspaceSettingsPanel`):**
  - Export opens a small dialog:
    - checkboxes: include wallet bookmarks (raw xpubs, with the existing warning), include saved wallet data, include settings;
    - "Protect with a password" is on by default; it asks for the password twice (at least 8 characters, with a strength hint only, no blocking) and shows "the password cannot be recovered".
    - The download is `am-i-exposed-backup-YYYY-MM-DD.json` (sealed) or `am-i-exposed-workspace.json` (plain v2).
  - Import:
    - A sealed file prompts for the password (wrong password: an inline error, retry).
    - Then a summary of what the file holds, with checkboxes (wallets, saved wallet data, settings), then Restore.
    - Existing wallet prompts are reused where they fit.
- **Wallet key lock:**
  - **Setting:** "Lock saved wallet keys with a password", under the bookmarks/workspace settings.
  - **Enabling** asks for the password twice. The raw xpub/descriptor of every wallet bookmark moves into one sealed vault in localStorage `ami-wallet-vault` (`SealedEnvelope` of `{entries: Record<placeholder, input>}`).
    - Each wallet bookmark's `input` is replaced by a stable placeholder `wallet-locked:<first 16 hex of sha256(input)>`, and the bookmark gets `locked: true`.
  - **Unlock:** the decrypted vault lives in memory only (module-level, lost on reload), with "Lock now" to clear it.
  - **Opening a locked wallet bookmark:** if locked, a password prompt appears; then it scans the real input.
  - **New wallet bookmarks while the lock is on:**
    - If the vault is unlocked, they go straight into it.
    - If it is locked, the save asks for the password.
  - **Disabling** asks for the password and restores the plaintext inputs.
  - "Forgot password" deletes the vault and the locked wallet bookmarks after a confirm.
  - Export/import carries the vault sealed. Import merges vault entries only when the same password opens both (otherwise it keeps the existing vault and reports the locked entries it skipped).
  - The xpub privacy warning and the opt-in flow are unchanged.

## Review Focus
1. Connection search on hosted mempool: budgets must hold (never more fetches than the budget, concurrency 3), cancel must stop requests, and a txid that is in no graph must work as From or To.
2. Paths whose hops pass through a tx already in the graph must not duplicate nodes; "Add to graph" must keep the graph connected (depths consistent, edges drawn) and respect `maxNodes`.
3. Time layout with same-block parent/child, unconfirmed txs, and a multi-root graph; a saved graph without `layoutMode`/`hiddenTxids` must still load.
4. BIP329 import into the graph or wallet with conflicts: nothing is overwritten silently. Records for txs not in the graph are counted, not dropped silently.
5. Sealed backups: a wrong password never partially imports, and a tampered ciphertext fails cleanly. Locked wallet bookmarks never expose the raw xpub in localStorage, and a reload re-locks.

---

## PR A tasks (worktree /home/user/aie-graph, branch feat/graph-investigation)

### Task 1: Connection search core

**Files:** create `src/lib/graph/connection-search.ts`, `src/lib/graph/__tests__/connection-search.test.ts`.

**Interfaces (produce):**
```ts
export type ConnectionKind = "direct" | "a-funds-b" | "b-funds-a" | "shared-ancestor" | "shared-descendant";
/** One tx on a path. inIndex: vin index the path enters by (undefined at the path start); outIndex: vout it leaves by (undefined at the end). */
export interface PathHop { txid: string; inIndex?: number; outIndex?: number }
export interface ConnectionPath { kind: ConnectionKind; hops: PathHop[]; meetTxid: string }
export interface ConnectionSearchOptions { maxHops: number; maxTxs: number; timeoutMs: number; stopAtCoinJoins: boolean; branchCap: number; concurrency?: number }
export const DEFAULT_CONNECTION_OPTIONS: ConnectionSearchOptions; // 4, 150, 45000, true, 60, concurrency 3
export interface ConnectionProgress { txsFetched: number; depthA: number; depthB: number; elapsedMs: number }
export interface SearchSummary { txsFetched: number; stoppedBy: "done" | "hops" | "budget" | "time" | "aborted"; branchLimited: number; coinJoinStops: number }
export async function findConnections(
  fromTxids: string[], toTxids: string[],
  fetcher: GraphExpansionFetcher,
  options: ConnectionSearchOptions,
  callbacks: { onResult(path: ConnectionPath): void; onProgress?(p: ConnectionProgress): void; isCoinJoin(tx: MempoolTransaction): boolean },
  signal?: AbortSignal,
): Promise<SearchSummary>;
```
- `hops` for `a-funds-b` run from A to B in chain order; `b-funds-a` from B to A; `direct` in chain order. A shared ancestor/descendant is one hop list from A through the meeting tx to B (direction changes at the meet tx); `ConnectionPath` has `pivot?: number` (index of the meet tx in `hops`), set for these two kinds so the UI can draw the bend.
- Seed transactions (fromTxids/toTxids) are fetched first and count toward `maxTxs`. If a from-txid equals a to-txid, emit nothing for it.
- `isCoinJoin` is injected so the core stays free of UI imports; Task 3 passes the graph's existing detector.
- Abort: check the signal before every fetch, and resolve `stoppedBy:"aborted"` without throwing.
- Time: compare against an injected or `performance.now()` clock (allow `options.now?` for tests).

**Tests (fake in-memory chain + fake fetcher counting calls):**
- direct spend;
- 3-hop A funds B;
- B funds A;
- shared ancestor;
- shared descendant;
- no path within maxHops gives `stoppedBy:"hops"` or `"done"` with no results;
- the budget is never exceeded (assert `fetcher calls <= maxTxs`) on a wide synthetic chain;
- a CoinJoin in the middle is not traversed when `stopAtCoinJoins`, but is traversed when false;
- branchCap is respected;
- abort mid-search stops further fetches;
- duplicate meeting points are deduplicated;
- the results are the shortest first, at most 5 per kind;
- the concurrency never exceeds 3 (track in-flight in the fake).

Commit: `feat(graph): bounded bidirectional connection search`.

### Task 2: Path scoring

**Files:** create `src/lib/graph/path-scoring.ts`, `src/lib/graph/__tests__/path-scoring.test.ts`.

**Interfaces:**
```ts
export type HopBasis = "deterministic" | "boltzmann" | "change" | "estimate";
export interface HopScore { txid: string; probability: number; basis: HopBasis }
export type PathTier = "deterministic" | "likely" | "weak" | "ambiguous";
export interface PathScore { hops: HopScore[]; compound: number; tier: PathTier; estimated: boolean }
export function scorePath(path: ConnectionPath, txs: ReadonlyMap<string, MempoolTransaction>, boltzmann: ReadonlyMap<string, BoltzmannWorkerResult>): PathScore;
```
- Only hops with both `inIndex` and `outIndex` are scored. The endpoints (start without inIndex, end without outIndex) score 1 and are omitted from `hops`. For shared-ancestor/descendant paths, the hop at `pivot` is scored the same way when it has both indices.
- Rules in order:
  1. 1 input or 1 output gives 1, deterministic.
  2. A Boltzmann cache entry for that txid gives `matLnkProbabilities[out][in]`, basis boltzmann. Note the matrix is sorted by value descending in the WASM path; check `useGraphBoltzmann`/`edge-utils.ts resolveEdgeLinkability` for how graph code maps real indices, and use the same mapping.
  3. `analyzeChangeDetection(tx)` flags `outIndex` as change: high 0.8, medium 0.65, low 0.55, basis change (check the finding's real confidence values in change-detection.ts and map each).
  4. Otherwise `1 / max(vin.length, vout.length)`, basis estimate.
- `estimated` = any hop basis is estimate or change. Tiers: all deterministic → "deterministic"; else compound ≥ 0.5 likely, ≥ 0.1 weak, else ambiguous.

**Tests:**
- each rule;
- product and tier boundaries (0.5, 0.1);
- a Boltzmann index mapping test with a non-sorted tx (the inputs and outputs in non-descending value order) asserting the correct cell;
- endpoints are excluded.

Commit: `feat(graph): score connection paths by link certainty`.

### Task 3: Connection panel UI + add path to graph

**Files:**
- **Create:**
  - `src/components/viz/graph/ConnectionPanel.tsx` (form, progress, results);
  - `src/components/viz/graph/ConnectionResultCard.tsx`;
  - `src/hooks/useConnectionSearch.ts`: state machine idle/running/done, with an AbortController and the address-to-txids resolution through `fetcher.getAddressTxs` (first page). Validate the input with the existing network-aware txid/address validators; an invalid input shows an inline error.
- **Modify:**
  - `src/lib/graph/graph-reducer.ts`: `ADD_NODES {nodes: GraphNode[]}` as one undo step, respecting maxNodes, skipping existing nodes. Add a reducer test.
  - `src/hooks/useGraphExpansion.ts`: expose `addPath(path, txs)`, which computes depth/edges from an anchor already in the graph; if no hop is in the graph, the first hop becomes an extra root via the existing multi-root support (check `rootTxids`). It returns `{added, skipped}`.
  - `GraphToolbar.tsx`: a "Find connection" icon button.
  - `GraphSidebar.tsx`: "Find connection from here".
  - `GraphExplorer.tsx` / `useGraphExplorerState.ts`: panel open state, pick-a-node mode (the next node click sets To and closes pick mode; Escape cancels), and a transient `highlightTxids` set drawn with the focus ring until the next canvas click.
  - Locale files.
- **Panel behaviour** follows the Feature 1 UI in "Design".
  - Show a hint that each fetched tx is a request to the configured backend, and that searches against the public mempool.space are rate limited, so the budget defaults are modest.
  - Score with `scorePath`, using the tx map gathered by the search (`useConnectionSearch` keeps the fetched txs in a Map via a wrapping fetcher) and the graph's `boltzmannCache`.
- **e2e:** extend `e2e/graph-explorer.spec.ts` with a mocked chain (use `mockExtraTxs`): root R funds child C two hops away, then open the panel, set To=C's txid, start, see the a-funds-b card, add to graph, and see C's node rendered. Also cover the phone viewport: the panel opens as a sheet and the button is reachable.

Commit(s): `feat(graph): find connection panel with scored paths`.

### Task 4: Graph labels <-> BIP329 with conflict preview

**Files:**
- **Create:** `src/lib/graph/graph-labels-bip329.ts` (+ test), `src/lib/wallet/bip329-merge.ts` (+ test), `src/components/labels/Bip329ConflictPreview.tsx`.
- **Modify:** `GraphToolbar.tsx` (or the save/load menu component), `useGraphExplorerState.ts` (bulk set labels), `src/components/wallet/WalletLabelsPanel.tsx`, locales.
- **Interfaces:**
```ts
export function graphLabelsToBip329(nodeLabels: ReadonlyMap<string,string>, edgeLabels: ReadonlyMap<string,string>, edges: ReadonlyArray<{fromTxid: string; toTxid: string; outputIndices?: number[]}>): Bip329Record[];
export function bip329ToGraphLabels(records: Bip329Record[], nodeTxids: ReadonlySet<string>, edges: ReadonlyArray<{fromTxid: string; toTxid: string; outputIndices?: number[]}>): { nodeLabels: Map<string,string>; edgeLabels: Map<string,string>; unmatched: number };
export interface Bip329Conflict { key: string; existing: Bip329Record; incoming: Bip329Record }
export interface Bip329Merge { added: Bip329Record[]; unchanged: number; conflicts: Bip329Conflict[] }
export function mergeBip329(existing: Bip329Record[], incoming: Bip329Record[]): Bip329Merge;
export function applyMerge(existing: Bip329Record[], merge: Bip329Merge, replaceKeys: ReadonlySet<string>): Bip329Record[];
```
- **Mapping rules:**
  - An edge label maps to output records for every vout in `outputIndices`, and only when `outputIndices` is known.
  - On import, an edge is labelled when any output record of that edge exists; if several differ, they are joined with " / " and truncated to `MAX_LABEL_LENGTH`.
  - The "aie:" auto parts are stripped with `userPart` before comparing.
  - Records with the same label (after normalisation) are counted as unchanged.
- **Graph import** builds the existing graph records, runs `mergeBip329`, shows the preview when there are conflicts or unmatched records, then applies through one state update.
- **Wallet panel:** an import that finds conflicts shows the same preview (the default keeps existing labels); no conflicts applies as today. Update its unit/e2e test expectations (`e2e/wallet-labels.spec.ts`) if the overwrite behaviour was asserted.

Commit: `feat(labels): graph labels as BIP329 with a conflict preview`.

### Task 5: Time layout + bundled parallel outputs

**Files:**
- **Modify:**
  - `src/components/viz/graph/layout.ts`: add a `layoutMode` param; keep the function signature backward compatible with an options object, or a trailing param matching the existing style.
  - `useGraphLayout.ts`, `useGraphExplorerState.ts`, `GraphToolbar.tsx` (the toggle).
  - `GraphCanvas.tsx` / a new `TimeAxis.tsx` (column headers and gap markers).
  - `edge-utils.ts` + `GraphEdges.tsx` (bundling and the badge toggle).
  - `saved-graph-types.ts` (`layoutMode?`), `useSaveLoadShare.ts` (save/restore it, including `handleUpdate`), and the locales.
- **Tests:**
  - `layout` unit tests for time mode: column order by height; same-block parent before child; unconfirmed last; multi-root; filter exclusions still apply.
  - `validateSavedGraph` accepts and rejects `layoutMode`.
  - `edge-utils` bundling: 3+ parallel ports produce one path plus the badge, 2 stay separate, and the toggle expands them.
- Visual check: run `pnpm dev` in the worktree on a free port (not 3000, check with `ss -ltn`), open `/graph` with a tx that has 3+ outputs into one child (any CoinJoin remix fixture from `docs/testing-reference.md`), and screenshot both modes at 1440 and 390 with Playwright into the scratchpad. Report the paths.

Commit: `feat(graph): chronological layout and bundled parallel outputs`.

### Task 6: Multi-select, batch bar, hide/isolate, chips

**Files:**
- **Create:** `src/components/viz/graph/BatchBar.tsx`, `src/components/viz/graph/FilterChips.tsx`, `src/lib/graph/isolate.ts` (pure: `nodesWithinHops(nodes, seeds, hops): Set<string>`, + test).
- **Modify:**
  - `useGraphExplorerState.ts`: selection, hidden, isolate and selectMode actions.
  - `GraphCanvas.tsx` / `GraphNodeRenderer.tsx`: modifier-click, select mode, the outline.
  - `layout.ts`: exclude hidden; isolate.
  - `graph-reducer.ts`: `REMOVE_NODES`, never removing roots, one undo step, cascade like REMOVE_NODE; plus a test.
  - `useGraphExpansion.ts` (`removeNodes`), `GraphToolbar.tsx` (the select-mode toggle; `hiddenCount` includes manual hides), `useKeyboardNavigation.ts` (Escape order: pick mode, then selection, then select mode, then existing behaviour).
  - `saved-graph-types.ts` (`hiddenTxids?`) + save/restore, and the locales.
- **Behaviour:** follows Feature 5 in "Design".
  - Selecting never opens the sidebar.
  - A plain click with a non-empty selection keeps today's behaviour (opens the sidebar) and leaves the selection as is.
- **Tests:**
  - reducer REMOVE_NODES (roots kept, undo restores all in one step);
  - `nodesWithinHops`;
  - the layout excludes hidden but keeps root and expanded;
  - saved graph round trip of `hiddenTxids`.
- **e2e:** select 2 nodes with Ctrl+click, hide them, see the "2 hidden" chip, click × and they return; on the phone, use the select-mode toggle and tap to select.

Commit: `feat(graph): multi-select with batch label, hide, isolate and remove`.

### Task 7: Docs + credit

**Files:** `docs/tx-graph-roadmap.md` (mark what shipped, with a short section per feature), `docs/development-guide.md` (new modules), `docs/README.md` if it indexes features, and a credit line wherever the docs list references/acknowledgements (create a "References" line in tx-graph-roadmap.md if none exists): "Connection search, output bundling and batch selection were inspired by Chaingraph (github.com/remcoros/chaingraph, MIT); no code was copied." Run the em-dash grep over the changed docs.

Commit: `docs: graph investigation tools and Chaingraph credit`.

## PR B tasks (worktree /home/user/aie-backup, branch feat/encrypted-backup)

### Task 8: Sealed envelope crypto

**Files:** create `src/lib/crypto/envelope.ts`, `src/lib/crypto/__tests__/envelope.test.ts`.

**Interfaces:**
```ts
export interface SealedEnvelope { format: "am-i-exposed-sealed"; v: 1; kdf: "PBKDF2-SHA256"; iterations: number; salt: string; iv: string; gzip: boolean; ct: string }
export class WrongPasswordError extends Error {}
export function isSealedEnvelope(x: unknown): x is SealedEnvelope;
export async function sealJson(value: unknown, password: string, opts?: { iterations?: number }): Promise<SealedEnvelope>;
export async function openJson<T = unknown>(env: SealedEnvelope, password: string): Promise<T>;
```
- Use `globalThis.crypto.subtle`, PBKDF2-SHA256 with 600000 iterations by default (tests may pass a low count through opts, but production code never does), AES-GCM 256, a random 16-byte salt and 12-byte IV per seal, and gzip via `CompressionStream` when available (set `gzip:false` if not). Base64 uses standard btoa/atob on byte strings; chunk it for large payloads.
- `openJson`:
  - validates the envelope fields;
  - rejects iterations < 100000 or > 10000000 as an invalid file;
  - throws `WrongPasswordError` on decrypt failure;
  - throws a plain Error on malformed JSON after decrypt.
- **Tests (Vitest node env has WebCrypto and CompressionStream):**
  - the round trip;
  - a wrong password throws WrongPasswordError;
  - a tampered ct throws;
  - a fresh salt/iv each seal;
  - a large payload (2 MB) round trip;
  - `isSealedEnvelope` guards;
  - iteration bounds.

Commit: `feat(backup): password-sealed JSON envelope (PBKDF2 + AES-GCM)`.

### Task 9: Full backup export/import

**Files:**
- **Create:** `src/lib/backup/backup.ts` (+ test with fake-indexeddb if already a devDependency, otherwise inject the saved-wallet functions), `src/components/settings/BackupExportDialog.tsx`, `src/components/settings/BackupImportDialog.tsx`.
- **Modify:** `WorkspaceSettingsPanel.tsx`, `src/lib/wallet/saved-wallets.ts` (add `exportSavedWallets()` / `importSavedWallets(entries)` if missing, keeping caps), the locales.
- **Behaviour:** follows "Feature 2" in "Design".
  - The v2 payload's `version: 2`.
  - The import accepts: a sealed envelope (prompt for the password, then the inner payload); a plain v2; and v1/legacy, routed to the existing `importBookmarks`.
  - The import never writes anything until the user confirms the summary.
  - A wrong password shows an inline error and allows a retry.
  - Settings restore is opt-in.
  - The storage-full error reuses the existing message.
- **Tests:**
  - build/restore round trip (bookmarks, graphs, saved wallets, settings);
  - merge rules (newer savedAt wins);
  - wallet bookmarks excluded unless opted in;
  - v1 file still imports;
  - a sealed file with the wrong password writes nothing.
- **e2e:** a new `e2e/backup.spec.ts`: create a bookmark and a saved graph, export with a password (capture the download), clear localStorage, import the file, enter a wrong password and see the error, enter the right one, and see the bookmark and graph restored.

Commit: `feat(backup): full encrypted backup and restore`.

### Task 10: Wallet key lock

**Files:**
- **Create:** `src/lib/backup/wallet-vault.ts` (+ test): vault seal/open, an in-memory unlocked state with a subscribe API, `lockNow()`, and `placeholderFor(input)` (async sha256 via WebCrypto or the existing @noble sha256).
- **Modify:**
  - `src/hooks/useBookmarks.ts`: a `locked?: boolean` field, preserved through import/export validation; `parseXpub` validation is skipped for locked placeholders.
  - The places that open a wallet bookmark (find them: the home bookmark list / history components, and where `bookmark.input` is scanned) get a resolve step: if locked, ask for the password, then resolve.
  - A new `src/components/settings/WalletLockSettings.tsx` and `src/components/history/UnlockWalletsPrompt.tsx`.
  - The save-wallet-bookmark flow: if the lock is on, store it in the vault.
  - Backup integration (Task 9's `buildBackup`/`restoreBackup` carry `walletVault`).
  - The locales.
- **Behaviour:** follows "Wallet key lock" in "Design".
  - Placeholder inputs must never be sent to the API or shown as an address: the bookmark row shows the label, the script type and a lock icon.
  - "Lock now" appears in the settings while unlocked.
- **Tests:**
  - enable lock: localStorage holds no raw xpub (`expect(JSON.stringify(localStorage)).not.toContain(xpub)`);
  - unlock resolves;
  - a wrong password fails;
  - disable restores;
  - forgot-password removes;
  - new bookmark while unlocked goes to the vault;
  - reload (re-import the module / reset the memory state) re-locks.
- **e2e:** extend `e2e/backup.spec.ts` or `wallet-saved.spec.ts`: save a wallet bookmark (use the existing mocked wallet), enable the lock, reload, click the bookmark, see the password prompt, enter the password, and the wallet scan starts.

Commit: `feat(backup): optional password lock for saved wallet keys`.
