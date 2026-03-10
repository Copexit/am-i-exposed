# Xpub Wallet Privacy Analysis - Feature Specification

## Overview

Full-wallet privacy scanning via extended public key (xpub/ypub/zpub) or output descriptor. The tool derives all addresses from the key, fetches their on-chain history, runs privacy heuristics across the entire wallet, and presents a comprehensive dashboard with per-address and per-transaction drill-down.

**Critical safety requirement:** When using a third-party API (mempool.space), scanning an xpub exposes the entire wallet structure to the API operator. A blocking privacy warning dialog must intercept the scan before any API calls are made.

---

## Existing Infrastructure

The xpub pipeline already works end-to-end. This document describes the current state plus planned enhancements.

### Current Data Flow

```
User Input (xpub / ypub / zpub / tpub / output descriptor)
    |
    v
detectInputType() -> "xpub"
    |
    v
page.tsx handleSubmit() -> isXpubOrDescriptor() -> wallet.analyze()
    |
    v
useWalletAnalysis hook
    |-- parseAndDerive(input, gapLimit=20, scriptTypeOverride?)
    |   Returns: receiveAddresses[0..19], changeAddresses[0..19]
    |   Supports: BIP44 (P2PKH), BIP49 (P2SH-P2WPKH), BIP84 (P2WPKH), BIP86 (P2TR)
    |   Supports: xpub, ypub, zpub, tpub, upub, vpub, output descriptors
    |
    |-- Batch fetch (5 addresses at a time)
    |   For each address:
    |     api.getAddress(addr)       -> MempoolAddress (stats)
    |     api.getAddressUtxos(addr)  -> MempoolUtxo[]
    |     api.getAddressTxs(addr)    -> MempoolTransaction[]
    |
    |-- auditWallet(addressInfos)
    |   Checks: address reuse, UTXO hygiene, spending patterns, good practices
    |   Returns: WalletAuditResult { score, grade, findings, stats }
    |
    v
WalletAuditResults component
    |-- Grade card (A+ to F, score out of 100)
    |-- Stats grid (6 cells: active addresses, txs, UTXOs, balance, reused, dust)
    |-- Findings list (FindingCard for each wallet-level finding)
    |-- Coin Selection Advisor (collapsible, uses selectCoins())
```

### Key Files

| File | Purpose |
|------|---------|
| `src/hooks/useWalletAnalysis.ts` | Hook: derive -> fetch -> audit -> state |
| `src/lib/bitcoin/descriptor.ts` | Xpub/descriptor parsing and BIP32 address derivation |
| `src/lib/analysis/wallet-audit.ts` | Wallet-level privacy audit (reuse, hygiene, spending) |
| `src/components/wallet/WalletAuditResults.tsx` | Dashboard UI with grade, stats, findings |
| `src/components/wallet/CoinSelector.tsx` | Coin selection advisor within wallet results |
| `src/app/page.tsx` | Main page orchestration, hash routing (#xpub=...) |
| `src/lib/analysis/detect-input.ts` | Input type detection (txid, address, psbt, xpub) |

### Wallet Audit Checks (wallet-audit.ts)

| Check | What it detects | Score impact |
|-------|----------------|-------------|
| Address reuse | Addresses receiving 2+ times across wallet | -5 to -15 |
| Dust UTXOs | UTXOs below 546 sats (dust threshold) | -2 to -5 |
| Mixed script types | UTXOs across different script types (migration history) | -3 |
| UTXO bloat | More than 50 unspent outputs | -2 |
| Toxic change | UTXOs between 546-10,000 sats (uneconomical to spend) | -4 |
| Consolidation history | Transactions with 3+ inputs and 1-2 outputs | -3 to -5 |
| No reuse (positive) | All active addresses used exactly once | +5 |
| Uniform script (positive) | All UTXOs use same script type | +3 |

### API Call Budget

For a standard 20-address gap limit (20 receive + 20 change = 40 addresses):

- **Minimum:** 120 API calls (40 x 3: getAddress + getUtxos + getTxs)
- **With pagination:** Up to 280+ calls (if addresses have many transactions, getTxs paginates up to 4 pages)
- **Batch size:** 5 addresses per batch, sequential batches
- **Estimated time:** 10-20 seconds on mempool.space, 3-8 seconds on local API

---

## Feature 1: Third-Party API Privacy Warning (CRITICAL)

### The Problem

When a user scans an xpub through `mempool.space`, the API operator observes 40+ sequential address queries arriving from the same IP within seconds. This trivially reveals:

- All derived addresses belong to the same wallet
- The wallet's total balance and complete transaction history
- Future activity can be monitored by watching the same addresses

This is the exact kind of privacy leak the tool is supposed to help users avoid.

### Third-Party Detection

An API is considered "third-party" when the user is NOT running their own node:

```typescript
const isThirdPartyApi = !isUmbrel && !customApiUrl;
```

- **Umbrel** (`isUmbrel === true`): API routes through local `/api` proxy to the user's own mempool instance. No third party sees the queries.
- **Custom API** (`customApiUrl !== null`): The user explicitly configured an endpoint. They made an informed decision about trust.
- **Tor**: Does NOT exempt from the warning. Tor hides the user's IP address, but `mempool.space` still sees all address queries server-side and can correlate them. The wallet-linking risk is identical.
- **Default** (mempool.space clearnet or onion): Third-party. Warning required.

### Dialog Specification

**Trigger:** Blocks the scan before any API calls are made. The dialog appears after the user submits an xpub but before `wallet.analyze()` is called.

**Visual treatment:** Full-viewport backdrop with blur. Centered card with critical (red) severity accent. `ShieldAlert` icon. This should feel serious - it is the most important privacy decision in the entire tool.

**Content:**

```
[ShieldAlert icon]

Privacy Warning - Wallet Scan

Scanning this extended public key will query approximately 40 derived
addresses through mempool.space.

This reveals to the API operator that all queried addresses belong to
the same wallet. A third party observing these queries could:

  - Link all addresses and transactions to a single identity
  - Calculate total wallet balance and spending history
  - Monitor future activity across all derived addresses

For maximum privacy, connect to a personal mempool instance or
use the Umbrel app.

[ ] Do not show this warning again for this session

  [I understand the risk, proceed]    [Set up a private API]    [Cancel]
```

**Buttons:**

| Button | Style | Action |
|--------|-------|--------|
| "I understand the risk, proceed" | Primary, red/warning color | Proceed with scan (`wallet.analyze()`) |
| "Set up a private API" | Secondary, link style | Navigate to `/setup-guide` |
| "Cancel" | Tertiary, text-only | Return to idle state |

**Session dismissal:** "Do not show this warning again" stores acknowledgment in `sessionStorage` (not `localStorage`). The warning reappears each browser session. Key: `xpub-privacy-ack`.

**Accessibility:** Focus trap inside dialog. Escape key dismisses (same as Cancel). `aria-modal="true"`, `role="alertdialog"`.

### Local API Banner (Non-Blocking)

When `isUmbrel || customApiUrl` and a wallet scan is running, show a brief green reassurance in the loading state:

```
[ShieldCheck icon] Local API - address queries stay private
```

This appears above the progress bar in the wallet loading UI. Not blocking, not a dialog.

### Integration Points

**`page.tsx` changes:**
- New state: `pendingXpub: string | null`
- `handleSubmit()`: If xpub + third-party + not session-dismissed -> set `pendingXpub` (show dialog)
- `handleHash()`: Same guard for direct `#xpub=...` navigation (e.g., bookmarks)
- Dialog callbacks: `handleXpubConfirm` (proceed), `handleXpubCancel` (abort)
- Address count computed via `parseAndDerive()` (synchronous, no API calls)

---

## Feature 2: Enhanced Wallet Dashboard

### The Problem

The current dashboard shows wallet-level aggregate findings (e.g., "5 of 12 addresses reused") but provides no way to drill down into individual addresses or transactions. The data exists in the `addressInfos` array but is not rendered.

Users need to:
- See which specific addresses have problems
- Understand the severity per address
- Drill into individual address or transaction analysis
- Identify the "worst offenders" at a glance

### Per-Address Drill-Down Table

A collapsible section in the wallet dashboard showing all derived addresses.

**Collapsed view (table row per address):**

| Path | Address | TXs | Balance | Status |
|------|---------|-----|---------|--------|
| m/84'/0'/0'/0/3 | bc1q...xyz | 7 | 45,200 sats | Reused (3x) |
| m/84'/0'/0'/0/7 | bc1q...abc | 2 | 1,230 sats | Dust |
| m/84'/0'/0'/0/1 | bc1q...def | 1 | 500,000 sats | Clean |
| m/84'/0'/0'/1/0 | bc1q...ghi | 0 | 0 | Unused |

**Sorting: worst offenders first.**

Per-address privacy score (for sorting only, not displayed):
- Reused (`funded_txo_count > 1`): -10
- Has dust UTXOs (< 546 sats): -5
- Has toxic change (546-10,000 sats): -3
- Clean with activity: 0
- Unused: +1 (shown at bottom)

**Status badges:**
- "Reused" - red (`severity-critical` tokens), shows count
- "Dust" - amber (`severity-medium` tokens)
- "Toxic change" - orange (`severity-high` tokens)
- "Clean" - green (`severity-good` tokens)
- "Unused" - gray (`text-muted`)

**Expanded row (click to expand):**
- Full address with copy button
- Derivation path with receive/change indicator
- Balance breakdown: total received, total spent, current balance
- UTXO list: value, confirmations, txid (truncated)
- Transaction list: txid (truncated), date, inputs/outputs, direction (sent/received)
- "Scan this address" button - runs full individual address analysis via `handleSubmit(address)`

### Per-Transaction List

A separate collapsible section showing all unique transactions across the wallet.

**Deduplication:** The same txid appears under multiple addresses when a transaction involves multiple wallet addresses (e.g., consolidation). Build `Map<txid, { tx, walletAddresses[] }>` to deduplicate.

**Each row shows:**
- Truncated txid with copy button
- Date/time (from `status.block_time`, "Unconfirmed" if pending)
- Input count / Output count
- Fee in sats
- Wallet addresses involved (colored chips, max 3 shown + "+N more")
- "Scan" link to run individual transaction analysis

### Worst Offender Highlight

Between the stats grid and findings list, show a prominent card highlighting the most problematic address:

```
[AlertTriangle icon]
Worst privacy: m/84'/0'/0'/0/7
Reused 4 times, 2 dust UTXOs, 450 sats toxic change
[Jump to address details]
```

Only appears when at least one address has issues (reuse, dust, or toxic change). Clicking scrolls to the address table section.

### Dashboard Layout (Updated)

```
WalletAuditResults
    |-- Back button
    |-- Grade card (score, grade icon)
    |-- Stats grid (6 cells)
    |-- Worst offender card (NEW - conditional)
    |-- Findings list
    |-- Address Details (NEW - collapsible)
    |   |-- Filter: All / Active only / Problems only
    |   |-- Sorted table with expandable rows
    |-- Transaction History (NEW - collapsible)
    |   |-- Deduplicated tx list with wallet address chips
    |-- Coin Selection Advisor (existing)
    |-- Duration footer
```

---

## Data Types Reference

### WalletAddressInfo (already exists in wallet-audit.ts)

```typescript
interface WalletAddressInfo {
  derived: DerivedAddress;       // { path, address, isChange, index }
  addressData: MempoolAddress;   // { chain_stats, mempool_stats }
  txs: MempoolTransaction[];     // all transactions for this address
  utxos: MempoolUtxo[];          // current unspent outputs
}
```

### DerivedAddress (from descriptor.ts)

```typescript
interface DerivedAddress {
  path: string;      // e.g., "m/84'/0'/0'/0/3"
  address: string;   // e.g., "bc1q..."
  isChange: boolean; // true for change chain (1/*)
  index: number;     // derivation index
}
```

### WalletAuditResult (from wallet-audit.ts)

```typescript
interface WalletAuditResult {
  score: number;
  grade: Grade;
  findings: Finding[];
  activeAddresses: number;
  totalTxs: number;
  totalUtxos: number;
  totalBalance: number;
  reusedAddresses: number;
  dustUtxos: number;
}
```

---

## Implementation Files

| File | Status | Change |
|------|--------|--------|
| `src/components/wallet/XpubPrivacyWarning.tsx` | NEW | Portal modal with privacy warning, focus trap, session dismissal |
| `src/components/wallet/WalletAddressTable.tsx` | NEW | Per-address drill-down table with sorting and expandable rows |
| `src/components/wallet/WalletTxList.tsx` | NEW | Per-tx deduplicated list with wallet address chips |
| `src/app/page.tsx` | MODIFY | Add `pendingXpub` state, dialog flow, local API banner, `onScan` prop |
| `src/components/wallet/WalletAuditResults.tsx` | MODIFY | Add address table, tx list, worst offender card, `onScan` prop |
| `src/hooks/useWalletAnalysis.ts` | NO CHANGE | Data already available in `addressInfos` |
| `src/lib/analysis/wallet-audit.ts` | NO CHANGE | Audit logic sufficient for current scope |
| `src/lib/bitcoin/descriptor.ts` | NO CHANGE | Derivation already supports BIP44/49/84/86 |

---

## Privacy Considerations

1. **No addresses are logged or persisted** - same policy as single-address analysis
2. **Session-scoped warning** - `sessionStorage` not `localStorage` ensures the warning reappears each browser session
3. **Xpub never sent to API** - only derived addresses are queried individually
4. **Hash routing** - `#xpub=...` appears in browser URL but this is local only (no server requests for hash fragments)
5. **Gap limit** - default 20 addresses per chain. Higher gap limits mean more API queries and greater exposure to the API operator

## Verification Checklist

- [ ] `pnpm test` passes
- [ ] `npx tsc --noEmit` clean
- [ ] `pnpm lint` 0 errors
- [ ] `pnpm build` succeeds (static export)
- [ ] Default API + xpub: privacy warning dialog appears
- [ ] Custom API + xpub: dialog skipped, scan proceeds
- [ ] Umbrel + xpub: dialog skipped, green banner shows
- [ ] Tor + xpub: dialog still appears (Tor does not exempt)
- [ ] Dialog "I understand" button: scan proceeds
- [ ] Dialog "Cancel" button: returns to idle
- [ ] Dialog "Set up private API": navigates to /setup-guide
- [ ] Session dismiss checkbox: dialog hidden for rest of session, reappears next session
- [ ] Address table: expands, sorted worst-first, badges correct
- [ ] Address expand: shows UTXOs, txs, "Scan this address" works
- [ ] TX list: deduplicated, address chips shown, "Scan" works
- [ ] Worst offender card: appears only when issues exist
