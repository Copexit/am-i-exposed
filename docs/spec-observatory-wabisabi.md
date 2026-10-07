# Observatory v2: WabiSabi

Status: decisions delegated by the owner (2026-10-07: "All of that, we need, extremely clean, pretty, shocking, perfect, UI/UX"). Roadmap sub-project 3. Target release: 0.40.0.

---

## Why

wabisator.com shows WabiSabi CoinJoin activity as a live map. The am-i.exposed Observatory today has a stats dump: cards, sparklines and tables from LiquiSabi (4 coordinators). The owner wants `/observatory` to be "a place someone can land, get value, bookmark, and leave", at least as good as Wabisator and clearly better, and built so P2P exchanges (sub-project 4) drop in as more tabs.

## Goals

1. **A living map** of WabiSabi CoinJoins that is the first thing a visitor sees.
   - Each coordinator is a star sized by volume.
   - Each CoinJoin is a pulse.
   - Fresh bitcoin streams in from outside; remixed coins fly between and within coordinators.
   - Replay of 24 h, 7 d or 30 d, ending in live mode.
2. **A live coordinator board:** every coordinator's status, fees and rules, and its rounds filling up in real time (phase, inputs registered against the minimum, a countdown).
3. **Coordinator pages:**
   - volume history with all-time high;
   - recent rounds with anonsets;
   - largest CoinJoins;
   - remix partners.
4. **Remix flows:** how coins move between coordinators, as a readable visual and a table.
5. **Search:** a txid finds a CoinJoin in the loaded data. Any txid can be opened in the full am-i.exposed analysis. A date jumps the replay.
6. Everything reachable through bookmarkable URLs, in 6 languages, accessible, fast on a phone.

## Beats Wabisator on

- **Analysis link:** every CoinJoin opens in the full am-i.exposed analysis (heuristics, Boltzmann link probabilities, the CoinJoin services card) in one click.
- **Privacy:** visitors never contact a third party. Requests go through the am-i.exposed relay or, self-hosted, through Tor.
- **Deep links:** for tab, period, coordinator and highlighted CoinJoin.
- **Live board:** ticking countdowns and input progress against each coordinator's minimum.
- **Mobile-first layout.**
- **Accessibility:** a full table view, `prefers-reduced-motion` honoured, keyboard focus on every target, text alternatives for the canvas.
- **Languages:** 6 locales, light and dark themes.
- **One home** for WabiSabi, Whirlpool and P2P (later).

## Non-goals

- Running our own indexer: Wabisator stays the data backend (owner's choice, sub-project 1/2 registry).
- Any request that carries a visitor's own txid from the Observatory. Search never sends a typed txid anywhere: a txid not in the loaded data offers "Analyze in am-i.exposed" (`/#tx=...`), where the opt-in CoinJoin services card lives.
- Round-ID search (Wabisator's flow-map has no round IDs). Search covers txids and dates.
- Changes to the Whirlpool tab beyond moving it into the new shell.
- P2P services (sub-project 4); this spec only makes room for them.

---

## Data

All requests use aggregate Wabisator methods through `serviceRpc` (`/svc/wabisator/api.php`). The registry already allowlists them:

| Method | Use | Params | Refresh |
|---|---|---|---|
| `flow-map` | map, stats, flows, largest, search | `{ since, until }` unix seconds; until rounded down to 5 minutes (since = until minus the period) so the worker edge cache is shared | 24 h: 20 s, 7 d: 60 s, 30 d: 120 s while visible |
| `coordinators-status` | live board, star status | `{}` | 10 s while the tab is visible |
| `volume-history` | coordinator pages, all-time charts | `{}` | 10 min |
| `rounds-paginated` | coordinator rounds table | `{ coordinatorEndpoint: [key], page, pageSize: 25 }` | 60 s, on demand |

Response shapes are pinned by recorded fixtures in `src/lib/observatory/__tests__/fixtures/wabisator/`:
- `flow-map-1d.json`, `flow-map-7d.json`
- `coordinators-status.json`
- `volume-history.json`
- `rounds-kruw.json`

Key fields:
- **flow-map:** `Coordinators[]` (`Key`, `Name`, `Status`, `Volume`, `Coinjoins`, `FreshBtc`, `RemixInBtc`, `RemixOutBtc`, `InternalRemixBtc`). `Coinjoins[]` (`TxId`, `Coordinator`, `Time`, `Volume`, `Inputs`, `Outputs`, `FreshBtc`, `Anonset`, `FeeRate`, `Remixes[] {From, Btc, Coins}`). `Links[] {From, To, Btc, Coins}`. `Totals`. `Coverage`.
- **coordinators-status:** `Coordinators[]` (`Key`, `Name`, `Status`, `Fees`, `CoordinationFeeRate`, `Config` map, `RoundStates[] {RoundId, IsBlameRound, InputCount, MaxSuggestedAmount, InputRegistrationRemaining "0d 0h 0m 18s" (may be negative), Phase}`, `AbsoluteMinInputCount`, `Volume24h`, `Coinjoins24h`, `ReadMore`, `LastSeen`, `OfflineSince`).
- **volume-history:** `Coordinators{key: {Name, Daily[{Date, Volume, Coinjoins}], TotalVolume, TotalCoinjoins, Ath{Date, Volume}}}`.
- **rounds-paginated:** `Rounds[]` with `RoundId`, `IsBlame`, `RoundEndTime`, `TxId`, `InputCount`, `OutputCount`, `TotalInputAmount` (sats), `AverageStandardOutputsAnonSet`, `FinalMiningFeeRate`, `FreshInputsEstimateBtc`, plus `TotalCount` and `TotalPages`.

The tor-proxy sidecar's response cap rises from 1 MB to 4 MiB (a 30-day flow-map is about 0.9 MB), matching the worker.

Client data layer: `src/lib/observatory/wabisator-client.ts`.
- One typed function per method, through `serviceRpc` and `withObservatoryCache`, with a TTL equal to the refresh above.
- Polling only while `document.visibilityState === "visible"`.
- The last good data stays on screen when a refresh fails, with a quiet "Last updated" state.

---

## Page

`/observatory` keeps its route and metadata URL. Its title and description are updated to the WabiSabi map. The tab shell is registry-ready.

### Shell

- **Tabs:** WabiSabi (default), Whirlpool (existing content, unchanged). The shell renders tabs from a small list, so P2P becomes one entry later.
- **URL state in the hash, all bookmarkable:**
  - `#wabisabi`, `#whirlpool`
  - `&period=1|7|30`
  - `&coordinator=<key>`
  - `&tx=<txid>` (highlight a CoinJoin)
  - `&view=table`

  Back and forward restore state.
- **Sticky sub-navigation (WabiSabi):** Map, Live rounds, Coordinators, Flows, with section anchors.

### 1. Map ("sky")

A full-bleed canvas hero, about 70 vh on desktop and about 60 vh on mobile, on the page background with a subtle starfield grain.

- **Stars:**
  - One per coordinator, placed on a stable layout: deterministic positions from the coordinator key, so the same coordinator is always in the same place. Positions are spread to avoid overlap at every viewport size.
  - Radius proportional to the square root of period volume, with minimum and maximum sizes.
  - Each known coordinator has a fixed colour token (Kruw, OpenCoordinator, GingerWallet, Noderunners, Coinjoiner, SwissCoordinator, openwasabi). Unknown coordinators share a neutral colour.
  - An offline coordinator is drawn hollow and dim.
  - Labels show the name plus period volume, kept legible at all sizes.
- **Pulses:**
  - When the replay clock passes a CoinJoin's `Time`, its star emits an expanding ring scaled by the CoinJoin's volume.
  - It also briefly lights an "event" in a ticker (latest CoinJoins: time, coordinator, BTC, inputs, anonset).
- **Particles:**
  - Fresh bitcoin flies in from the canvas edge to the star, in light/white.
  - Remixed coins fly from the source coordinator's star in the source colour (`Remixes[].From`). Internal remix (the same coordinator) loops around the star.
  - Particle count scales with BTC (log scale), with a global cap (desktop 2200, mobile 900).
- **Timeline under the canvas:**
  - A volume histogram of the period, play/pause, a scrub bar with a playhead, and the period switch (24 h / 7 d / 30 d).
  - A "LIVE" pill when the playhead reaches now. The replay length is 60 / 90 / 120 s; after that the clock follows real time and new CoinJoins from refreshes pulse as they arrive.
- **Interaction:**
  - Hovering a star shows a tooltip (name, status, period volume, CoinJoins, fresh, remix in/out).
  - Clicking or pressing Enter on a star opens its coordinator page (section 3, scrolls there and sets `coordinator=`).
  - Hovering or clicking a pulse shows the CoinJoin (time, BTC, inputs/outputs, anonset, fee rate) with "Analyze in am-i.exposed".
- **Stats strip** over the bottom of the map, as glass panels: Volume, CoinJoins, Fresh bitcoin, Cross-coordinator remix, for the period.
- **Reduced motion:** no particles and no animated pulses. The map is static: stars plus flow lines whose width follows BTC. The ticker still works.
- **Performance:**
  - One `requestAnimationFrame` loop, devicePixelRatio aware.
  - Paused when off-screen (IntersectionObserver) or the tab is hidden.
  - Scene state precomputed in a pure module (`sky-model.ts`), with no React state per frame.
  - Target 60 fps on a mid-range phone with the 30-day period.
- **Accessibility:** the canvas has `role="img"` with an aria-label summary, and every fact it shows is also in the table view and the sections below. Stars have an invisible focusable button overlay for keyboard users.

### 2. Live rounds board

- **One card per online coordinator,** sorted by 24 h volume, each showing:
  - name, status dot, fees, and a "Read more" link (external, `rel="noopener noreferrer"`);
  - rules: min inputs, input types, amount range, current mining fee rate;
  - 24 h volume and CoinJoins.
- **Current rounds:** each `RoundState` is a row:
  - the phase as a stepped indicator: InputRegistration, ConnectionConfirmation, OutputRegistration, TransactionSigning, Ended;
  - a progress bar of inputs against `AbsoluteMinInputCount` (the minimum to start), which overflows gracefully past the minimum;
  - a countdown ticking every second from `InputRegistrationRemaining` (shown as "closing" when negative);
  - a blame-round tag.
- **Freshness:** a "refreshed Ns ago" indicator. Rounds animate smoothly between refreshes, so cards never re-layout or jump.
- **Inactive coordinators:** offline ones, or online with no 24 h activity, sit behind "Show N inactive".

### 3. Coordinator pages

An in-page section shown when `coordinator=` is set, with a close button and keyboard-dismissible. On mobile it is a full-screen sheet; on desktop it expands inline below the map.

- **Header:** colour, name, status, fees, link out.
- **KPIs:** period volume, CoinJoins, fresh, remix in/out, average anonset (volume-weighted from flow-map), all-time volume, all-time high day.
- **Volume history chart:** visx, matching the existing TrendChart style; ranges 30 d, 90 d, 1 y, All; the ATH marked.
- **Largest CoinJoins in the period:** top 10 by volume, each with an "Analyze" link.
- **Recent rounds:** `rounds-paginated`, 25 per page with pagination, showing:
  - time;
  - inputs and outputs;
  - BTC;
  - output anonset;
  - fee rate;
  - fresh BTC;
  - a blame tag;
  - an Analyze link per row.
- **Remix partners:** coins in from and out to other coordinators (from `Links`).

### 4. Remix flows

- **Desktop:** a chord-style diagram (or an equivalent ribbon diagram), one arc per coordinator in its colour. Ribbons follow BTC between coordinators; self-loops are internal remix, drawn as a separate inner band. The cross-coordinator total is highlighted.
- **Mobile:** ranked flow bars (From to To, BTC, coins).
- Both are backed by the same table in the table view.

### 5. Search

A search field in the WabiSabi header, accepting a txid or a date.

- **txid in the loaded period data:** highlight the CoinJoin (scroll the replay to it, pulse it, set `tx=`) and show its card.
- **txid not in the loaded data:** say it is not a recorded CoinJoin in this period, and offer "Analyze in am-i.exposed" (`/#tx=...`). Nothing is sent anywhere.
- **Date** (YYYY-MM-DD or YYYY-MM-DD HH:MM): if inside the period, move the playhead there; otherwise offer to switch to the period that contains it (30 d max).

### Table view

`view=table` replaces the canvas with:
- the coordinators table: Coordinator, Status, Volume, CoinJoins, Fresh, Remix in, Remix out, Internal remix;
- the remix flows table: From, To, BTC, Coins.

It is fully keyboard and screen-reader friendly.

### Visual quality bar (hard requirements, reviewed)

- **Visual language:** matches the site's design system (`src/app/globals.css` tokens, `eyebrow`, `num`, hairlines, panels). Dark and light themes are both designed, not inverted: the light-theme sky is a deep-ink canvas card, the dark-theme sky is near-black.
- **Typography:** large numbers in tabular figures.
- **Motion:** never janky; easing on every transition, nothing pops in without a fade.
- **Mobile, 390 px:** no horizontal page scroll. The map stays legible (labels collide-free), the board cards stack, and the drawer is a sheet.
- **Desktop, 1440 px:** the map is cinematic and the sections breathe. The coordinator page and flows read like a well-designed data journalism piece.
- **States:**
  - empty and loading: skeletons shaped like the final content;
  - error: a calm panel with retry, keeping the last data;
  - offline coordinators: present but quiet.
- **Copy:** short, in the project voice (no "we/us/our", no em dashes, passive or tool-named), in all 6 locales.
- **Screenshot review:** desktop and mobile, dark and light, each section, before merge.

---

## Testing

- **Unit (pure modules, against the fixtures):**
  - flow-map to scene model (stars, sizes, colours, events, bins, flows);
  - deterministic star layout without overlap;
  - replay clock (period to duration, scrub, live hand-off);
  - countdown parsing (`0d 0h 0m 18s`, negatives);
  - board selectors (sorting, inactive split, progress against the minimum);
  - coordinator KPIs (volume-weighted anonset, largest, partners);
  - search parsing (txid, dates, out-of-period);
  - hash state parse/serialize round-trip.
- **Component:** board card states, coordinator page sections, table view, search results, reduced motion (no particles), tab shell.
- **e2e** with `/svc/wabisator/api.php` mocked from the fixtures:
  - the page loads with the map canvas and stats;
  - switching period updates the stats;
  - table view shows the coordinators;
  - `#wabisabi&coordinator=kruw` opens the Kruw page with its rounds;
  - search for a fixture txid highlights it, and for an unknown txid offers the analyze link with no request carrying it;
  - the Whirlpool tab still renders;
  - no horizontal scroll at 390 px.
- **Visual QA** (controller, real network): screenshots of every section at 390 and 1440, dark and light, reviewed against the quality bar.

## Rollout

The worker needs no change, since the registry already allows these methods. Release as 0.40.0: GitHub Pages, both Docker images (sidecar cap raised), community store.
