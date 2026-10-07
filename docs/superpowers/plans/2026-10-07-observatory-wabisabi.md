# Observatory v2: WabiSabi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the WabiSabi tab of `/observatory` as a living map plus a live rounds board, coordinator pages, remix flows and search, backed by Wabisator through the existing `/svc` relay.

**Architecture:**
- **Pure TypeScript models** turn Wabisator responses into view models: scene, layout, replay clock, board, KPIs, flows, search, hash state. They are unit-tested against recorded fixtures.
- **A small data layer** (`wabisator-client.ts` plus `useWabisator`) polls aggregate methods through `serviceRpc` while the page is visible.
- **The UI** is React components, plus one canvas renderer for the map driven by a single `requestAnimationFrame` loop that reads the precomputed scene.
- **The tab shell** renders tabs from a list, so P2P (sub-project 4) is one more entry.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript strict, Tailwind 4 (tokens in `src/app/globals.css`), motion/react, visx (already used by `src/components/observatory/TrendChart.tsx`), react-i18next (6 flat-key locales with `_one/_other` plurals, pl `_one/_few/_many/_other`), Vitest + Testing Library (jsdom), Playwright.

**Spec:** `docs/spec-observatory-wabisabi.md`. Read it, especially "Page" and "Visual quality bar". The plan argues from it.

## Global Constraints

- **Workflow:**
  - pnpm only.
  - Work only in `/home/user/aie-obs` (branch `feat/observatory-wabisabi`). Never touch `/home/user/am-i-exposed`. Never `git stash`.
  - Commits: conventional, NO `Co-Authored-By` or any AI attribution; never `-c user.email/name`.
- **Gates for every task:**
  - `pnpm type-check`;
  - `pnpm lint` (0 warnings);
  - the task's tests;
  - `src/lib/__tests__/locale-parity.test.ts` when locales change.
- **Code:** TypeScript strict, no `any`.
- **Copy:**
  - No em dashes (U+2014, its \u escape, the HTML entity) anywhere.
  - No "we/us/our" in copy; passive or tool-named voice.
  - Spanish is Castilian tuteo.
  - Every t() key has a `defaultValue` and exists in all 6 locales (`public/locales/{en,es,pt,de,pl,fr}/common.json`).
- **Data:**
  - The Observatory sends no visitor txid anywhere. Only aggregate Wabisator methods (`flow-map`, `coordinators-status`, `volume-history`, `rounds-paginated`) via `serviceRpc("wabisator", "/api.php", method, params, { isUmbrel, signal })`.
  - Search never makes a request.
- **Refresh and cache:**
  - Poll only while `document.visibilityState === "visible"`.
  - Keep the last good data on refresh failure.
  - flow-map `until` rounded down to 300 s; `since = until - days*86400`.
  - Refresh intervals: flow-map 24 h 20 s, 7 d 60 s, 30 d 120 s; coordinators-status 10 s; volume-history 600 s; rounds-paginated 60 s.
- **Visual quality bar** (spec section): design tokens only (no hard-coded hex in components, except the coordinator palette defined once in `src/lib/observatory/coordinator-palette.ts` as tokens added to `globals.css` for both themes).
- **Layout and motion:**
  - No horizontal page scroll at 390 px.
  - `prefers-reduced-motion`: no particles or pulses.
  - Every interactive element is keyboard reachable, with a visible focus ring and touch target >= 40 px.
- **Existing behaviour:** the Whirlpool tab keeps working unchanged.
- **e2e:** run `pnpm build` first; `ss -ltnp | grep :3333` must be empty; then `CI=1 pnpm exec playwright test <files> --workers=1`; afterwards `git checkout -- public/sitemap.xml` if changed.

## Review Focus

1. **A coordinator present in `coordinators-status` but absent from `flow-map`** (no activity in the period), or the reverse: both must render, with zero volume, not crash. Tests in Task 2 (scene) and Task 3 (board).
2. **`InputRegistrationRemaining` negative ("0d 0h 0m -59s") or unparseable:** the countdown shows "closing" and never a negative number. Test in Task 2.
3. **An empty period** (0 CoinJoins: fresh coordinator or Wabisator outage returning empty arrays): the map renders the stars statically with an "No CoinJoins in this period" note, and stats show 0. Tests in Task 2 and Task 4.
4. **A deep link with an unknown coordinator key or a malformed txid** (`#wabisabi&coordinator=nope&tx=zz`): ignored gracefully and the page renders. Test in Task 2 (hash parse) and Task 8 (e2e).
5. **Huge 30-day data on a phone:** the scene precomputation is O(n) and particles are capped (desktop 2200, mobile 900). Test in Task 2 (cap respected for a synthetic 5,000-CoinJoin input).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/observatory/wabisator-types.ts` | Response types for the 4 methods (fields the UI reads) |
| `src/lib/observatory/wabisator-client.ts` | `getFlowMap`, `getCoordinatorsStatus`, `getVolumeHistory`, `getRounds` |
| `src/hooks/useWabisator.ts` | Visibility-aware polling hooks per method |
| `src/lib/observatory/coordinator-palette.ts` | Known coordinator keys -> CSS variable names, neutral fallback |
| `src/lib/observatory/sky-model.ts` | Star layout, scene (stars, events, particles plan, bins, flows), replay clock math |
| `src/lib/observatory/board.ts` | Countdown parsing, board view model, inactive split |
| `src/lib/observatory/coordinator-page.ts` | KPIs, largest CoinJoins, partners, volume series by range |
| `src/lib/observatory/obs-search.ts` | Query parsing (txid/date) and resolution against loaded data |
| `src/lib/observatory/obs-hash.ts` | Hash state parse/serialize (`tab, period, coordinator, tx, view`) |
| `src/components/observatory/wabisabi/*` | Tab UI: `WabiSabiTab`, `SkyMap` (canvas + overlay), `Timeline`, `Ticker`, `StatsStrip`, `LiveBoard`, `CoordinatorPage`, `RemixFlows`, `ObsSearch`, `TableView` |
| `src/components/observatory/ObservatoryPage.tsx` | Tab shell rendering tabs from a list; Whirlpool content untouched |
| `umbrel/tor-proxy/server.js` | Response cap 1 MB -> 4 MiB |

---

### Task 1: Data layer

**Files:**
- Create:
  - `src/lib/observatory/wabisator-types.ts`
  - `src/lib/observatory/wabisator-client.ts`
  - `src/hooks/useWabisator.ts`
  - `src/lib/observatory/__tests__/wabisator-client.test.ts`
  - `src/hooks/__tests__/useWabisator.test.ts`
- Modify:
  - `umbrel/tor-proxy/server.js` (`MAX_RESPONSE_BYTES = 4 * 1024 * 1024`)
  - `src/lib/observatory/cache.ts` (only if a per-call TTL parameter is missing; it already accepts `ttlMs`)

**Interfaces:**
- Consumes:
  - `serviceRpc` from `@/lib/services/client`;
  - `withObservatoryCache(key, fn, ttlMs)` from `@/lib/observatory/cache`;
  - `useNetwork()` (`isUmbrel`) from `@/context/NetworkContext`.
- Produces:

```ts
// wabisator-types.ts (only fields the UI reads; read the fixtures for exact names)
export interface FlowCoordinator { Key: string; Name: string; Status: string; Volume: number; Coinjoins: number; FreshBtc: number; RemixInBtc: number; RemixOutBtc: number; InternalRemixBtc: number }
export interface FlowCoinjoin { TxId: string; Coordinator: string; Time: number; Volume: number; Inputs: number; Outputs: number; FreshBtc: number; Anonset: number; FeeRate: number; Remixes: { From: string; Btc: number; Coins: number }[] }
export interface FlowLink { From: string; To: string; Btc: number; Coins: number }
export interface FlowMap { Since: string; Until: string; UpdatedAt: string; Coordinators: FlowCoordinator[]; Coinjoins: FlowCoinjoin[]; Links: FlowLink[]; Totals: { Volume: number; Coinjoins: number; FreshBtc: number; CrossRemixBtc: number; InternalRemixBtc: number } }
export interface RoundState { RoundId: string; IsBlameRound: boolean; InputCount: number; MaxSuggestedAmount: number; InputRegistrationRemaining: string; Phase: string }
export interface StatusCoordinator { Key: string; Name: string; Status: string; Fees: string; CoordinationFeeRate: number; ReadMore: string; Config: Record<string, string | number>; RoundStates: RoundState[]; AbsoluteMinInputCount: number; Volume24h: number; Coinjoins24h: number; LastSeen: string | null; OfflineSince: string | null }
export interface CoordinatorsStatus { UpdatedAt: string; Coordinators: StatusCoordinator[] }
export interface VolumeHistory { UpdatedAt: string; Coordinators: Record<string, { Name: string; Daily: { Date: string; Volume: number; Coinjoins: number }[]; TotalVolume: number; TotalCoinjoins: number; Ath: { Date: string; Volume: number } }> }
export interface RoundRow { RoundId: string; IsBlame: boolean; RoundEndTime: string; TxId: string; InputCount: number; OutputCount: number; TotalInputAmount: number; AverageStandardOutputsAnonSet: number; FinalMiningFeeRate: number; FreshInputsEstimateBtc: number }
export interface RoundsPage { Rounds: RoundRow[]; TotalCount: number; Page: number; PageSize: number; TotalPages: number }

// wabisator-client.ts
export type Period = 1 | 7 | 30;
export function flowMapWindow(period: Period, nowSec: number): { since: number; until: number }; // until = floor(now/300)*300
export function getFlowMap(period: Period, opts: { isUmbrel: boolean; signal?: AbortSignal; nowSec?: number }): Promise<FlowMap>;
export function getCoordinatorsStatus(opts: { isUmbrel: boolean; signal?: AbortSignal }): Promise<CoordinatorsStatus>;
export function getVolumeHistory(opts: { isUmbrel: boolean; signal?: AbortSignal }): Promise<VolumeHistory>;
export function getRounds(coordinator: string, page: number, opts: { isUmbrel: boolean; signal?: AbortSignal }): Promise<RoundsPage>;
export const REFRESH_MS: { flowMap: Record<Period, number>; status: number; volume: number; rounds: number };

// useWabisator.ts: generic polling hook + 4 thin wrappers
export interface Polled<T> { data: T | null; error: Error | null; loading: boolean; updatedAt: number | null; refresh: () => void }
export function usePolled<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>, intervalMs: number): Polled<T>;
export function useFlowMap(period: Period): Polled<FlowMap>;
export function useCoordinatorsStatus(): Polled<CoordinatorsStatus>;
export function useVolumeHistory(): Polled<VolumeHistory>;
export function useRounds(coordinator: string | null, page: number): Polled<RoundsPage>;
```

Behaviour:
- **`usePolled`:**
  - Fetches on mount and on key change.
  - Polls every `intervalMs` only while the document is visible, pausing on `visibilitychange` and fetching immediately on return if stale.
  - Aborts in-flight requests on key change or unmount.
  - Keeps the last `data` on error and sets `error`.
  - A `null` key means idle.
- **Client functions:**
  - Pass the cache TTL equal to the refresh interval.
  - The cache key includes the method and its params.

- [ ] **Step 1: Write failing tests.**
  - The client: mock `fetch` to return the fixture envelopes from `src/lib/observatory/__tests__/fixtures/wabisator/`.
    - Assert the URL is `/svc/wabisator/api.php` on the worker, or `/tor-proxy/svc/...` on Umbrel.
    - Assert the method and params, and that flow-map params are rounded: `flowMapWindow(1, 1_000_000_123)` gives `{ until: 999_999_900, since: 999_913_500 }`.
    - Assert that the parsed result has `Coinjoins.length > 0`.
  - The hook (jsdom, fake timers):
    - polls at the interval while visible and stops when hidden;
    - keeps data on a failed refresh;
    - aborts on key change.
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3:** implement; set the sidecar cap.
- [ ] **Step 4:** run the tests plus `umbrel/tor-proxy/__tests__/handler.test.js`; expect PASS. Then type-check and lint.
- [ ] **Step 5: Commit** `feat(observatory): Wabisator data layer with visibility-aware polling`

---

### Task 2: Pure models

**Files:**
- Create:
  - `src/lib/observatory/coordinator-palette.ts`
  - `src/lib/observatory/sky-model.ts`
  - `src/lib/observatory/board.ts`
  - `src/lib/observatory/coordinator-page.ts`
  - `src/lib/observatory/obs-search.ts`
  - `src/lib/observatory/obs-hash.ts`
  - tests for each under `src/lib/observatory/__tests__/`
- Modify: `src/app/globals.css` (coordinator colour tokens for both themes)

**Interfaces:**
- Consumes: Task 1 types.
- Produces:

```ts
// coordinator-palette.ts
export const KNOWN_COORDINATORS: readonly string[]; // kruw, opencoordinator, gingerwallet, coinjoin_nl, coinjoiner, swisscoordinator, openwasabi
export function coordinatorColorVar(key: string): string; // "var(--coord-kruw)" or "var(--coord-other)"
export function coordinatorColorToken(key: string): string; // "--coord-kruw" (for canvas getComputedStyle lookups)

// sky-model.ts
export interface Star { key: string; name: string; x: number; y: number; r: number; colorToken: string; volume: number; coinjoins: number; online: boolean } // x,y in 0..1 unit space
export interface SkyEvent { txid: string; t: number; star: string; volume: number; inputs: number; outputs: number; anonset: number; feeRate: number; freshBtc: number; remixes: { from: string; btc: number; coins: number }[] }
export interface Bin { t0: number; t1: number; volume: number; count: number }
export interface Flow { from: string; to: string; btc: number; coins: number; internal: boolean }
export interface Scene { since: number; until: number; stars: Star[]; events: SkyEvent[]; bins: Bin[]; flows: Flow[]; totals: FlowMap["Totals"]; empty: boolean }
export function layoutStars(keys: string[], volumes: Record<string, number>): Record<string, { x: number; y: number }>; // deterministic by key; no two centers closer than 0.18 in unit space
export function buildScene(flow: FlowMap, status: CoordinatorsStatus | null, binCount?: number): Scene; // union of coordinators from both; events sorted by t
export function particleBudget(events: SkyEvent[], cap: number): Map<string, number>; // txid -> particle count, log-scaled by BTC, total <= cap
export const REPLAY_SECONDS: Record<Period, number>; // {1:60, 7:90, 30:120}
export function replayTime(progress: number, scene: Scene): number; // 0..1 -> unix seconds
export function replayProgress(t: number, scene: Scene): number;

// board.ts
export function parseRemaining(s: string): number | null; // "0d 0h 1m 5s" -> 65; negative values allowed; unparseable -> null
export interface BoardRound { id: string; phase: string; phaseIndex: number; inputs: number; min: number; progress: number; closesAt: number | null; blame: boolean } // progress = inputs/min capped at 1 for the bar, closesAt = receivedAt + remaining*1000
export interface BoardCard { key: string; name: string; online: boolean; fees: string; readMore: string; rules: { label: string; value: string }[]; volume24h: number; coinjoins24h: number; rounds: BoardRound[] }
export const PHASES: readonly string[]; // InputRegistration, ConnectionConfirmation, OutputRegistration, TransactionSigning, Ended
export function buildBoard(status: CoordinatorsStatus, receivedAt: number): { active: BoardCard[]; inactive: BoardCard[] }; // active = online && (volume24h > 0 || rounds non-empty), sorted by volume24h desc
export function countdownLabel(closesAt: number | null, now: number): { kind: "time"; seconds: number } | { kind: "closing" } | { kind: "unknown" };

// coordinator-page.ts
export interface CoordinatorKpis { volume: number; coinjoins: number; freshBtc: number; remixIn: number; remixOut: number; internalRemix: number; avgAnonset: number | null; allTimeVolume: number | null; ath: { date: string; volume: number } | null }
export function coordinatorKpis(key: string, flow: FlowMap, history: VolumeHistory | null): CoordinatorKpis; // avgAnonset volume-weighted over the period's coinjoins
export function largestCoinjoins(key: string, flow: FlowMap, n?: number): FlowCoinjoin[]; // default 10, by Volume desc
export function remixPartners(key: string, flow: FlowMap): { into: Flow[]; from: Flow[] }; // excludes internal
export type HistoryRange = "30d" | "90d" | "1y" | "all";
export function volumeSeries(key: string, history: VolumeHistory, range: HistoryRange, today: string): { date: string; volume: number; coinjoins: number }[];

// obs-search.ts
export type SearchQuery = { kind: "txid"; txid: string } | { kind: "date"; t: number } | { kind: "invalid" };
export function parseSearch(input: string): SearchQuery; // 64-hex (trim, lowercase); YYYY-MM-DD or YYYY-MM-DD HH:MM (UTC); else invalid
export type SearchResult = { kind: "found"; event: SkyEvent } | { kind: "not-found"; txid: string } | { kind: "in-period"; t: number } | { kind: "out-of-period"; t: number; suggested: Period | null } | { kind: "invalid" };
export function resolveSearch(q: SearchQuery, scene: Scene, nowSec: number): SearchResult;

// obs-hash.ts
export interface ObsState { tab: string; period: Period; coordinator: string | null; tx: string | null; view: "map" | "table" }
export function parseObsHash(hash: string, knownTabs: readonly string[]): ObsState; // tolerant: unknown values -> defaults; tx must be 64-hex else null
export function serializeObsHash(s: ObsState): string; // "#wabisabi&period=7&coordinator=kruw"; omits defaults
```

- [ ] **Step 1: Write failing tests**, using the fixtures (`flow-map-1d.json`, `flow-map-7d.json`, `coordinators-status.json`, `volume-history.json`, `rounds-kruw.json`):
  - `buildScene` on 1 d:
    - star count = union of coordinators;
    - events sorted;
    - bins sum to `Totals.Volume`, within 1e-6;
    - flows equal `Links`;
    - `empty` false.
  - A coordinator only in status yields a star with volume 0, and a coordinator only in flow-map still gets a star (Review Focus 1).
  - An empty flow-map (all arrays empty) gives `empty` true and stars from status (Review Focus 3).
  - `layoutStars`:
    - is deterministic (same input, same output);
    - pairwise distance >= 0.18;
    - all within 0.08..0.92.
  - `particleBudget` with a synthetic 5,000-event input and cap 900: sum <= 900, every event >= 0 (Review Focus 5).
  - `parseRemaining`:
    - "0d 0h 1m 5s" -> 65;
    - "0d 0h 0m -59s" -> -59;
    - "x" -> null.

    `countdownLabel` gives `closing` when remaining <= 0 (Review Focus 2).
  - `buildBoard` on the status fixture: the active list is sorted by volume24h, phases are mapped to indexes, and progress is capped.
  - `coordinatorKpis("kruw", …)`:
    - volume equals the flow-map coordinator volume;
    - avgAnonset is the volume-weighted average (compute the expected value in the test from the fixture);
    - the ATH comes from history.
  - `largestCoinjoins` is sorted and limited.
  - `remixPartners` excludes internal flows.
  - `volumeSeries` returns the right ranges.
  - `parseSearch` and `resolveSearch`:
    - a fixture txid gives `found`;
    - an unknown txid gives `not-found`;
    - a date inside the period gives `in-period`;
    - a date 20 days ago with period 1 gives `out-of-period` suggesting 30;
    - a date 40 days ago gives a `null` suggestion;
    - junk gives `invalid`.
  - `parseObsHash` / `serializeObsHash`:
    - round-trip;
    - `#wabisabi&coordinator=nope&tx=zz` gives coordinator "nope" (validity is decided by the UI against loaded data), tx null, no throw (Review Focus 4);
    - an unknown tab gives the default `wabisabi`.
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3:** implement.
  - Coordinator colour tokens in `globals.css`, chosen to be distinct and harmonious on both the dark sky (near-black) and the light theme's ink sky. Use OKLCH-friendly hues with similar lightness: Kruw amber/bitcoin-adjacent, OpenCoordinator teal, GingerWallet ginger-red, Noderunners violet, Coinjoiner lime, SwissCoordinator rose, openwasabi sky-blue, other slate.
  - Define them under `:root` and the light theme selector used by the site (check `globals.css` for how light tokens are scoped).
- [ ] **Step 4:** run, expect PASS; type-check, lint.
- [ ] **Step 5: Commit** `feat(observatory): pure models for the WabiSabi map, board, coordinator pages, search and URL state`

---

### Task 3: Tab shell, URL state, WabiSabi skeleton, stats strip, table view

**Files:**
- Create:
  - `src/components/observatory/wabisabi/WabiSabiTab.tsx`
  - `src/components/observatory/wabisabi/StatsStrip.tsx`
  - `src/components/observatory/wabisabi/TableView.tsx`
  - `src/hooks/useObsState.ts`
  - component tests in `src/components/observatory/wabisabi/__tests__/`
- Modify:
  - `src/components/observatory/ObservatoryPage.tsx` (render tabs from a list `[{ id: "wabisabi", … }, { id: "whirlpool", … }]`; WabiSabi first and default; the Whirlpool branch untouched; remove the old LiquiSabi-based WabiSabi sections and their now-unused components/selectors/tests if nothing else uses them, keeping `liquisabi` in the registry)
  - `src/hooks/useObservatoryTab.ts` (default `wabisabi`; reconcile with `useObsState`, a single source of truth for the hash)
  - `src/app/observatory/layout.tsx` metadata (title "CoinJoin Observatory: live WabiSabi map and coordinators | am-i.exposed"; description mentions Wabisator and Whirlpool sources; keywords add "wabisator", "coinjoin map")
  - locales

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - `useObsState(): [ObsState, (patch: Partial<ObsState>) => void]`. It is hash-backed, and `replace` history entries apply for tx/coordinator changes.
  - `WabiSabiTab` lays out the section order:
    - search header;
    - sticky sub-nav (Map, Live rounds, Coordinators, Flows);
    - `#obs-map` (a placeholder slot for Task 4's `SkyMap`, rendering `StatsStrip` and a loading skeleton for now);
    - `#obs-live` (slot for Task 5);
    - `#obs-coordinator` (slot for Task 6, rendered when `coordinator` is set);
    - `#obs-flows` (slot for Task 7);
    - attribution footer (Wabisator for WabiSabi, whirlpoolstats.xyz for Whirlpool).

    Slots are props or children so later tasks plug in without re-layout.
  - `TableView({ scene })` renders two accessible tables: coordinators and flows.
  - `StatsStrip({ totals, period })` shows the 4 KPIs with tabular numbers, formatted BTC (2 decimals at 1+ BTC, 4 below) and integer counts.
- [ ] Steps:
  - TDD for `useObsState` (hash updates on change, back/forward restores state) and `TableView` (renders the fixture coordinators and flows).
  - The tab shell renders WabiSabi by default, and `#whirlpool` still renders the Whirlpool content.
  - Gates.
  - Commit `feat(observatory): tab shell, URL state, WabiSabi layout, stats and table view`.

---

### Task 4: The sky map (canvas, timeline, ticker)

**Files:**
- Create:
  - `src/components/observatory/wabisabi/SkyMap.tsx` (React wrapper: sizing, DPR, IntersectionObserver, visibility, keyboard star overlay, tooltips)
  - `src/components/observatory/wabisabi/sky-renderer.ts` (pure drawing over a `CanvasRenderingContext2D` plus a frame-state object; no React)
  - `src/components/observatory/wabisabi/Timeline.tsx` (histogram, scrubber, play/pause, period switch, LIVE pill)
  - `src/components/observatory/wabisabi/Ticker.tsx`
  - tests
- Modify: `WabiSabiTab.tsx` (mount in `#obs-map`); locales

**Interfaces:**
- Consumes:
  - `Scene`, `particleBudget`, `REPLAY_SECONDS`, `replayTime`, `replayProgress` (Task 2);
  - `useFlowMap`, `useCoordinatorsStatus` (Task 1);
  - `useObsState` (Task 3).
- Produces:
  - `SkyMap({ scene, period, highlightTx, onSelectStar(key), onSelectEvent(txid) })`;
  - `Timeline({ scene, progress, playing, live, onScrub(p), onTogglePlay(), onPeriod(p) })`.

Requirements (spec section 1 is the authority):
- **Rendering:**
  - Stars glow (radial gradient) in their token colour.
  - Pulses are expanding rings with an ease-out of about 1.6 s, scaled by volume.
  - Fresh particles come from the nearest canvas edge along a gentle curve, light/white.
  - Remix particles fly from the source star in its colour, along a quadratic curve. Internal remix orbits the star.
  - Labels show the name and period volume, with collision-avoided placement (above, below or side).
  - A subtle star-field grain background, stable per seed.
  - A "No CoinJoins in this period" overlay when `scene.empty`.
- **Clock:**
  - Replay progress advances at 1 / `REPLAY_SECONDS[period]` per second. At progress 1, live mode follows real time, and new events from refreshed flow-map data spawn pulses.
  - Scrubbing sets progress. Pausing freezes particles in place.
- **Performance:**
  - One rAF loop; skip frames while hidden or off-screen.
  - Particle cap: desktop 2200, below 640 px wide 900.
  - Rebuild only on scene change.
- **Reduced motion:** a static draw with flow lines whose width follows BTC, and no rAF loop.
- **Accessibility:**
  - The canvas has `role="img"` with a summary aria-label (period, CoinJoins, volume, top coordinator).
  - Absolutely positioned transparent buttons over each star (aria-label with name and volume), so Tab, Enter and Space select the coordinator.
  - Tooltips are also shown on focus.
- **Ticker:** the last 6 events up to the clock, with time, coordinator dot and name, BTC, inputs and anonset. A click highlights the event and offers "Analyze in am-i.exposed" (`/#tx=<txid>`).
- **Design:** read the existing observatory and home components for tone. Take the frontend-design approach seriously: the map is the signature visual of the site. It must look intentional and premium in both themes, never like a debug canvas.

- [ ] Steps:
  - TDD for `sky-renderer` helpers that are pure: label placement, edge-entry point, curve control point, colour resolution fallback.
  - `SkyMap` tests in jsdom with a mocked canvas context:
    - mounts;
    - star buttons exist with labels;
    - Enter calls `onSelectStar`;
    - reduced motion means no rAF scheduled.
  - `Timeline` tests: scrub and period callbacks, LIVE pill at progress 1.
  - Gates.
  - Commit `feat(observatory): living WabiSabi map with replay, live mode, ticker and timeline`.

---

### Task 5: Live rounds board

**Files:**
- Create:
  - `src/components/observatory/wabisabi/LiveBoard.tsx`
  - `src/components/observatory/wabisabi/RoundRow.tsx`
  - tests
- Modify: `WabiSabiTab.tsx` (mount in `#obs-live`); locales

**Interfaces:**
- Consumes: `useCoordinatorsStatus`, `buildBoard`, `countdownLabel`, `PHASES`, `coordinatorColorVar`.
- Produces: `LiveBoard({ onOpenCoordinator(key) })`.

Requirements (spec section 2):
- **Cards:** a responsive grid (1 column mobile, 2 tablet, 3 desktop). Each card has:
  - a colour edge, name, status dot (with a calm pulse when online, never flashy), fees and rules as compact key/value chips;
  - 24 h volume and CoinJoins;
  - a list of current rounds.
- **Round rows:**
  - a 5-step phase indicator with the current step highlighted;
  - an input progress bar against the minimum (overflow past the minimum shows the extra count, e.g. "273 / 100");
  - a 1 s ticking countdown, rendered with `countdownLabel` and a single shared 1 s interval for the whole board;
  - a blame tag.
- **Freshness and transitions:**
  - "Refreshed Ns ago".
  - Smooth width transitions on progress bars.
  - Stable keys by `RoundId` so rows do not jump; a new round fades in and an ended round fades out.
- **Inactive:** "Show N inactive" toggles a compact list of inactive coordinators.
- **Card action:** opens the coordinator page.

- [ ] Steps:
  - TDD:
    - sorting;
    - inactive toggle;
    - countdown ticks (fake timers);
    - negative remaining shows "closing";
    - progress text "273 / 100";
    - clicking the card action calls `onOpenCoordinator`.
  - Gates.
  - Commit `feat(observatory): live rounds board with phases, input progress and countdowns`.

---

### Task 6: Coordinator page

**Files:**
- Create:
  - `src/components/observatory/wabisabi/CoordinatorPage.tsx`
  - `src/components/observatory/wabisabi/VolumeHistoryChart.tsx` (visx, consistent with `TrendChart.tsx`)
  - `src/components/observatory/wabisabi/RoundsTable.tsx`
  - tests
- Modify: `WabiSabiTab.tsx` (render in `#obs-coordinator` when `coordinator` is set and known in the scene or status; an unknown key renders nothing and clears it from the hash quietly); locales

**Interfaces:**
- Consumes: `coordinatorKpis`, `largestCoinjoins`, `remixPartners`, `volumeSeries`, `HistoryRange`, `useVolumeHistory`, `useRounds`, `useObsState`.
- Produces: `CoordinatorPage({ coordinatorKey, scene, flow, onClose })`.

Requirements (spec section 3):
- **Placement:** inline expanded section on desktop. Full-screen sheet on mobile (below 640 px), with a close button, Escape to close, focus trapped while open and focus returned on close (reuse the existing `useFocusTrap` hook).
- **Header:** colour, name, status, fees, external link.
- **KPI grid:** 8 tiles, with skeletons while history loads.
- **Volume history chart:**
  - range switch 30 d, 90 d, 1 y, All;
  - an ATH marker with a label;
  - a tooltip on hover/focus;
  - axis labels in the user's locale.
- **Largest CoinJoins:** top 10 rows with time, BTC, inputs/outputs, anonset and an "Analyze" link (`/#tx=`).
- **Recent rounds table:**
  - paginated 25 per page with prev/next and "page X of Y";
  - columns: time, inputs/outputs, BTC (from sats), output anonset, fee rate, fresh BTC, blame tag, Analyze link;
  - horizontally scrollable inside its own container on mobile, never the page.
- **Remix partners:** two compact ranked lists (coins in from, coins out to) with coordinator colour dots and BTC.

- [ ] Steps:
  - TDD with the fixtures:
    - renders the Kruw KPIs;
    - the chart range switch changes the series length;
    - rounds pagination calls `useRounds` with the next page;
    - Escape closes on the mobile sheet;
    - an unknown coordinator renders nothing.
  - Gates.
  - Commit `feat(observatory): coordinator pages with history, rounds, largest CoinJoins and partners`.

---

### Task 7: Remix flows and search

**Files:**
- Create:
  - `src/components/observatory/wabisabi/RemixFlows.tsx` (chord/ribbon on wide screens, ranked bars below 640 px)
  - `src/components/observatory/wabisabi/ObsSearch.tsx`
  - tests
- Modify: `WabiSabiTab.tsx` (mount flows in `#obs-flows`, search in the header); locales

**Interfaces:**
- Consumes: `Scene.flows`, `coordinatorColorVar`, `parseSearch`, `resolveSearch`, `useObsState`.
- Produces: `RemixFlows({ scene, onOpenCoordinator })`; `ObsSearch({ scene, period, onFound(event), onJumpTo(t), onSwitchPeriod(p) })`.

Requirements (spec sections 4 and 5):
- **Flows, wide screens:**
  - SVG chord/ribbon diagram: arcs per coordinator sized by total BTC through it, ribbons between coordinators sized by `btc`, internal remix as an inner band per arc.
  - Hover/focus highlights a coordinator's ribbons and dims the rest.
  - A legend and the cross-coordinator total in a callout.
  - visx or d3-chord are allowed only if already installed. Check `package.json`; do not add a dependency. If neither is installed, compute the chord geometry in a small pure helper with tests.
- **Flows, narrow screens:** ranked bars, From colour to To colour, BTC and coins.
- **Search:**
  - **Field:** one input with placeholder "Search a CoinJoin txid or a date" and a submit button; results appear in a small panel under the field.
  - **Found:**
    - calls `onFound`, which highlights the event on the map and in the ticker, sets `tx=` and scrolls the map into view;
    - shows a card: coordinator, time, BTC, inputs/outputs, anonset and "Analyze in am-i.exposed".
  - **Not-found:**
    - says it is not a recorded WabiSabi CoinJoin in this period and offers "Analyze in am-i.exposed" (`/#tx=…`);
    - makes NO network request (assert in tests that `fetch` is not called).
  - **In-period:** moves the playhead.
  - **Out-of-period:** offers a switch to the suggested period, or says it is beyond 30 days.
  - **Invalid:** inline hint.

- [ ] Steps:
  - TDD:
    - chord helper geometry (angles sum to 2π minus gaps);
    - bars order;
    - search states including the no-fetch assertion.
  - Gates.
  - Commit `feat(observatory): remix flow diagram and CoinJoin search`.

---

### Task 8: Integration, docs, e2e

**Files:**
- Modify:
  - `WabiSabiTab.tsx` (final wiring: highlight `tx` from the URL on load if found, otherwise ignore it; sub-nav scroll-spy)
  - `e2e/helpers/mock-api.ts` (`mockObservatoryApi` also answers `/svc/wabisator/api.php` for the 4 aggregate methods from `src/lib/observatory/__tests__/fixtures/wabisator/`, using the 1 d fixture for period 1 and the 7 d fixture for 7 and 30)
  - `docs/development-guide.md` (Observatory section)
- Create: `e2e/observatory-wabisabi.spec.ts`

e2e cases (spec Testing):
1. `/observatory` loads with the WabiSabi tab, a canvas, the stats strip with non-zero CoinJoins, and the live board with at least 1 card.
2. Switching the period to 7 d updates the CoinJoins stat.
3. The table view toggle shows the coordinators table with Kruw.
4. `/observatory/#wabisabi&coordinator=kruw` shows the Kruw coordinator page with a rounds table row.
5. Search:
   - a txid from the 1 d fixture shows the found card;
   - an unknown 64-hex shows the analyze link, and no request to `/svc/wabisator` carries that txid in its body.
6. `#whirlpool` still renders the Whirlpool pool cards (existing mocks).
7. At 390 px wide: `document.documentElement.scrollWidth <= window.innerWidth` on the WabiSabi tab.
8. `#wabisabi&coordinator=nope&tx=zz` renders without errors (no page error events).

- [ ] Steps:
  - Write the e2e spec, then wire.
  - Gates: type-check, lint, the full `pnpm test`, build, the full e2e serially.
  - Commit `feat(observatory): integrate the WabiSabi Observatory, e2e and docs`.

---

### Task 9 (controller): visual QA and rollout

1. **Visual QA:**
   - Serve the build on :3000 (an origin the worker allows) against the live worker and Wabisator.
   - Screenshot every section at 390 and 1440, dark and light.
   - Review against the spec's visual quality bar. Iterate with fix dispatches until it meets the bar.
2. **Ship:** PR, CI, merge, release 0.40.0 (both images; the sidecar cap verified in the image), smoke test, community store, memory.
