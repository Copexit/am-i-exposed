# Wallet Heuristics

Status: decisions delegated by the owner (2026-10-07). Roadmap sub-project 5: "wallet heuristics designed from scratch". Target release: 0.41.0.

---

## Why

A tester asked for the wallet scan to penalize **merging change with other UTXOs**. The request points at a gap: the wallet audit (`src/lib/analysis/wallet-audit.ts`) only looks at address statistics and the UTXO set (reuse, dust, toxic change, script types, UTXO count, 3+ input consolidations). It never asks what the wallet *did* across its history, although the scan already holds that history and knows something no single-transaction analysis knows: **which addresses are the wallet's and which outputs were its change**.

Some privacy failures only exist at that level:
- a change output merged later with a coin from somewhere else;
- a CoinJoin output spent together with unmixed coins;
- a payment pattern that lets anyone pick the change, payment after payment;
- a chain of payments, each spending only the previous change.

This spec adds those heuristics, rules out the ones that do not hold up, and fixes how they score, show and read.

## Goals

1. Wallet-level heuristics that are sound (grounded in the literature), low in false positives, explainable in one sentence, and computable from the data the scan already has.
2. They count toward the wallet grade under the existing scoring model (base 70, sum of impacts, clamp 0-100, `scoreToGrade`).
3. Each finding names the transactions behind it, one click away from the full tx analysis.
4. A coin-origins breakdown of the UTXO set (mixed, CoinJoin change, change, self-transfer, received).
5. Same results in the web app, the CLI (`scan xpub`, text and JSON) and the MCP `scan_wallet` tool, since all of them call `auditWallet`.
6. 6 locales, offline tests, a golden wallet snapshot.

## Non-goals

- **Running the per-tx pipeline on every wallet tx and rolling the findings up.** It costs API calls (raw hex, chain modules), double-counts the same fact under two IDs, and the tx view already exists one click away.
- **New requests.** No extra API call, no trace data: `auditWallet` stays a pure function of `WalletAddressInfo[]`. The UTXO traces the web app fetches for the graph are not used, so the CLI (which does not trace) gets identical results.
- **Any PayJoin detection.** A transaction with an input from outside the wallet is skipped by every new heuristic and is never labelled (docs/privacy-engine.md, Non-Heuristics). PayJoin stays a recommended remedy.
- **Changing the existing wallet checks**, beyond one deduplication rule (consolidations already counted as merges).

---

## Data

Everything comes from `WalletAddressInfo[]` (`derived`, `addressData`, `txs`, `utxos`) produced by `scanChain`:

- **The wallet's addresses:** every scanned derived address (both chains, or the one chain a descriptor fixes).
- **The wallet's transactions:** the union of every address's `txs`, deduplicated by txid. Each tx carries `vin[].prevout` (address, value), `vout[]`, `status.block_height`.
- **Limits:** `getAddressTxs` stops at 4 pages (100 txs) per address, so a heavily reused address can have a truncated history. A coin whose funding tx is not in the scanned history has class `unknown`, and `unknown` never triggers a finding (no false positive from missing data).
- **Gap limit:** Own addresses beyond the scanned gap limit look external: a self-transfer to them reads as a payment, which can turn `self` into `change` and add change-exposure or peel-chain hits. The "Rescan with" larger gap limit control is the remedy.

### The behaviour model (`src/lib/analysis/wallet-behavior.ts`)

**Coin classes.** Every output paid to a wallet address gets one class, from its funding tx:

| Class | Rule (first match) |
|---|---|
| `unknown` | The funding tx is not in the scanned history, or the wallet funded only part of it (some inputs are outside: collaborative, PayJoin-shaped). |
| `received` (from a CoinJoin) | The funding tx is a CoinJoin with no wallet input and is not Whirlpool (a JoinMarket taker or a payment inside a round paid the wallet). |
| `mixed` | The funding tx is a CoinJoin (`isCoinJoinTx`) and the coin's value equals at least one other output's value in it. |
| `coinjoin-change` | The funding tx is a CoinJoin and the value is unique in it, or the coin is a Whirlpool tx0's toxic change (`detectTx0(tx).toxicChange`). |
| `received` | No input of the funding tx is the wallet's. |
| `change` | The wallet funded the tx and it also paid an address outside the wallet. |
| `self` | The wallet funded the tx and every addressed output is the wallet's (consolidation, self-transfer). |

Rulings:
- `isCoinJoinTx` covers Stonewall and simplified Stonewall. A Stonewall's equal output is `mixed`: it carries the Stonewall's ambiguity. Its other wallet output is `coinjoin-change`.
- A CoinJoin funded only by the wallet counts as one only when an equal-value output returns to the wallet (a solo Stonewall's decoy). An own batch paying several people the same amount is a solo spend (final review I3).
- Whirlpool mixes into a separate postmix account with no input from it, so a Whirlpool output with no wallet input stays `mixed` (final review I1).
- WabiSabi rounds use standard denominations, so equal values are the anonymity set. A unique-value output is the round's change.

**Solo spends.** A transaction the wallet built alone:
- every input is the wallet's;
- it is not a CoinJoin.

A tx with any outside input (collaborative, PayJoin-shaped, a CoinJoin someone else built) is skipped, never labelled. A CoinJoin the wallet joined is never a merge: CIOH does not hold there.

**Simple payments.** Solo spends with exactly one addressed output to the wallet (the change) and exactly one to someone else, excluding tx0s. Batches, changeless and self-transfers are left out, so "the change" is unambiguous.

**Ordering.** Oldest first (unconfirmed last), ties by txid, so the transaction lists in findings are stable.

---

## Heuristics kept

All five are new finding IDs in `FINDING_METADATA`, computed in `src/lib/analysis/wallet-heuristics.ts`, and called from `auditWallet`. The ground truth (which output is change) comes from the wallet itself, so each finding states a fact about this wallet. The confidence `high` reflects that the adversary's side (CIOH, change rules) is a heuristic.

### W1: Post-mix merge (`wallet-postmix-merge`)

**What:** a solo spend with 2+ inputs, at least one `mixed`.
- Variant `unmixed`: at least one other input is a known non-mixed class (`coinjoin-change`, `change`, `self`, `received`).
- Variant `mixed`: every other input is `mixed` or `unknown`. This includes two outputs of the same CoinJoin.

**Why:**
- CIOH (Meiklejohn et al. 2013, Androulaki et al. 2013) links every input of a non-CoinJoin spend.
- Merging a mixed output with an unmixed coin ties it to that coin's history. This is the post-mix failure documented by OXT Research (Understanding Bitcoin Privacy, part 4), the Samourai/Whirlpool "doxxic change" guidance and the Wasabi coin control docs. Möser and Böhme (2017) measured that such merges deanonymize a large share of CoinJoin outputs.
- Merging only mixed outputs intersects their anonymity sets (LaurentMT, Boltzmann).

**Score:** one finding.

| Case | Severity | Impact |
|---|---|---|
| 2+ `unmixed` spends | critical | -20 |
| 1 `unmixed` spend | critical | -15 |
| 2+ `mixed`-only spends | high | -12 |
| 1 `mixed`-only spend | high | -8 |

This is in line with tx-level Post-Mix Consolidation (-12 to -18).

**Params:** `count`, `unmixedCount`, `mixedOnlyCount`, `_variant` (`unmixed` | `mixed`), `_txids`, `more`.

### W2: Change merged with other coins (`wallet-change-merge`), the tester's request

**What:** a solo spend with 2+ inputs, no `mixed` input, and at least one input of class `change` or `coinjoin-change` that sat in a different linkage cluster (`wallet-clusters.ts`) from another input just before the spend. A spend counted by W1 is not counted here.

**Why:**
- Change carries the history of the payment that created it. The payment's recipient, and anyone who identified the change with the standard rules (Meiklejohn's one-time change address heuristic, Kappos et al. 2022), already attribute it to the sender.
- Spending it with a coin from a different transaction hands that coin, its funding source and its address to the same observers. It also joins the two clusters under CIOH.
- Merging two outputs of the same transaction adds no new source of funds, so it does not count.

**Score:**

| Merges | Severity | Impact |
|---|---|---|
| 1 | medium | -4 |
| 2-4 | high | -7 |
| 5+ | high | -10 |

**Params:** `count`, `_txids`, `more`.

**Already-linked coins do not count.** A change input merged only with coins its history already links adds no new link and is skipped. The linkage clusters (2026-10, tester report "17 spends merged change with other coins") are a union-find over the wallet's outpoints:
- the same address;
- coins co-spent in a solo spend, and a solo spend's wallet outputs with its inputs (same funding tx, common wallet-owned ancestors);
- a CoinJoin's `coinjoin-change` with the wallet's inputs of that CoinJoin (that link is what makes it toxic).

A `mixed` output, a receipt from outside (a batch payout to two wallet addresses is not known to link them) and any tx with an outside input never link. Spends are processed parents first, so each sees the clusters as they were when it was made. The coin selection advisor uses the same clusters.

**Receipts-only merges are not newly penalized.** Merging two `received` coins also links them, but:
- it is the baseline cost of spending from a wallet with many small receipts;
- 3+ input merges are already scored by `wallet-consolidation-history`;
- penalizing every 2-input spend would grade nearly every real wallet down for one fact the tx view already shows (`h3-cioh`).

The tester's point, that change propagates a known payment's history, is specific to change.

### W3: Change exposure (`wallet-change-exposed`)

**What:** over the wallet's simple payments, count those where a standard change-detection rule points at the **real** change. The change is known, so a rule that fires on the wrong output does not count. The rules:
- `type` (address type, Meiklejohn 2013, Bitcoin wiki Privacy "change address detection"): the change has the same address type as every input, and the payment's type differs.
- `round` (round amounts, H1): the payment is round (`isRoundAmount`) and the change is not.
- `optimal` (optimal change, Nick 2015): 2+ inputs, the change is smaller than every input, and the payment is not. Otherwise the smallest input would have been unnecessary.

A payment counts only when at least one rule picks the change and none picks the payment (2026-10): with contradicting rules an analyst cannot tell which output is the change. The rules themselves were rechecked against the golden wallets and kept; each fires only on the real change.

**Why:**
- These rules are what chain analysts run at scale (Kappos et al. 2022 validate them against ground truth).
- A wallet whose habits make them right lets anyone follow its change from payment to payment. Together with W4 that is the whole history.
- This folds in the "round payment habits" and "script type mixing across spends" candidates: both matter only because they expose change.

**Score:** the ratio `exposed / payments` decides.

| Ratio | Severity | Impact |
|---|---|---|
| > 50% | high | -6 |
| > 20% | medium | -4 |
| any exposed | low | -2 |
| none exposed | no finding | |

**Params:** `exposed`, `payments`, `ratio` (percent), `byType`, `byRound`, `byOptimal`, `_txids` (exposed payments), `more`.

### W4: Peel chain (`wallet-peel-chain`)

**What:** simple payments with exactly one input, linked when one spends the previous one's change. The wallet's only output in a simple payment is its change. The longest such chain counts if it has 3+ payments.

**Why:**
- Peel chains are the main way analysts follow a wallet through its payments (Kappos et al. 2022, "How to Peel a Million"; tx-level Peel Chain Detection).
- With the wallet's ground truth the chain is exact. Identify one payment and the rest follow.

**Score:**

| Longest chain | Severity | Impact |
|---|---|---|
| 6+ payments | high | -6 |
| 3-5 payments | medium | -3 |

This is below tx-level (-15 to -20) because W3 already scores how detectable each hop's change is.

**Params:** `count` (longest chain length), `chains` (chains of 3+), `_txids` (the longest chain, in order), `more`.

### W5: Coins kept apart (`wallet-no-merge`, good)

**What:** 3+ solo spends, none counted by W1, W2 or `wallet-consolidation-history`, and no W4 peel chain (a peel chain links the payments anyway; final review I4).

**Score:** good, +3. This mirrors `wallet-no-reuse` (+5) and `wallet-uniform-script` (+3), and rewards the coin control the other findings teach.

**Params:** `count` (solo spends).

### Deduplication

Each solo spend is counted under at most one merge finding, in this order: W1, W2, `wallet-consolidation-history`. `checkSpendingPatterns` receives the set W1 and W2 counted and skips it.

The other findings are separate facts and stack:
- W3 is about one payment's change;
- W4 is about the link between payments;
- W5 is about the absence of merges.

### Metadata (`src/lib/analysis/finding-metadata.ts`)

| ID | Adversary tiers | Temporality |
|---|---|---|
| `wallet-postmix-merge` | P, K, S | historical |
| `wallet-change-merge` | P, K | historical |
| `wallet-change-exposed` | P | ongoing_pattern |
| `wallet-peel-chain` | P, K | ongoing_pattern |
| `wallet-no-merge` | P | ongoing_pattern |

---

## Candidates rejected

| Candidate | Ruling | Reason |
|---|---|---|
| Change merged with unrelated UTXOs | **Kept** (W2) | |
| Post-CoinJoin toxic change merged with mixed outputs | **Folded into W1** | `coinjoin-change` with a `mixed` input is the W1 `unmixed` variant. |
| Mixed output merged with non-mixed | **Folded into W1** | Same rule. |
| Address reuse rate across the wallet | **Already implemented** | `wallet-address-reuse` scores the ratio and `wallet-no-reuse` rewards none. No change. |
| Script-type mixing across the wallet's spends | **Folded into W3** (`type` rule) | Its harm is change detection. The UTXO-set side is already `wallet-mixed-script-utxos` / `wallet-uniform-script`. |
| Consolidation patterns | **Already implemented** | `wallet-consolidation-history`, now deduplicated against W1 and W2. |
| Round-amount payment habits | **Folded into W3** (`round` rule) | Round amounts matter at wallet level because they reveal the change. A separate finding would score one fact twice. |
| Change-output index habits | **Rejected** | The position is only a leak to an adversary who already knows the wallet's rule, and per-tx fingerprinting (H11) covers that. Wallets that randomize or use BIP69 never trigger it, and wallets that do have no user setting to fix it, so it is not actionable. Sound statistics need 8+ payments. |
| Fee-rate / nLockTime / nSequence / version consistency | **Rejected** | A consistent fingerprint is the normal state of one wallet. Drift is mostly caused by software upgrades (Bitcoin Core changed RBF and anti-fee-sniping defaults across versions), which would be false positives. Not actionable, and per-tx H11 and `prospective-wallet-migration` already report it. |
| Timing / clustering of spends | **Rejected** | `block_time` has about 2 h error plus confirmation delay, so time-of-day profiles need many samples and are not actionable. Same-block spends of several mixed outputs are a real but rare signal; deferred to a later spec. |
| Gap-limit / dormant exposure | **Rejected** | Not an on-chain privacy leak. Scan completeness is already reported (`wallet-scan-partial`, the gap-limit note and rescan offer). Old public keys on reused addresses are a security topic, not privacy. |
| UTXO set health: dust, toxic change, bloat | **Already implemented** | `wallet-dust-utxos`, `wallet-toxic-change`, `wallet-utxo-bloat`. |
| UTXO set health: unmixed vs mixed counts | **Shown, not scored** | Holding both is not a leak, merging them is (W1). The coin-origins breakdown shows the counts. |
| Receipts-only merges (generic CIOH) | **Rejected** | See W2. |
| PayJoin | **Never** | docs/privacy-engine.md, Non-Heuristics. |

---

## Scoring

- The wallet base stays **70**. New impacts are summed with the existing ones, then clamped to 0-100 and graded with `scoreToGrade` (A+ >= 90, B >= 75, C >= 50, D >= 25, F < 25).
- **Worst new case:** W1 -20, W2 -10, W3 -6, W4 -6, a total of -42. A wallet that undid its CoinJoins and peels every payment lands in D or F. That matches the tx-level grade those transactions get one by one.
- **A careful wallet** (no reuse, coin control, one script type) gets +5 +3 +3 = **81, B**. A+ stays reserved for CoinJoin-level privacy, as at tx level.
- **Golden wallet** (`goldenWallet()` in the test fixtures, see Testing): **C 52**, from:
  - `wallet-postmix-merge` -15;
  - `wallet-change-merge` -4;
  - `wallet-change-exposed` -4 (2 of 5 payments);
  - `wallet-peel-chain` -3;
  - `wallet-no-reuse` +5;
  - `wallet-uniform-script` +3.

  The clean wallet scores **B 81**:
  - `wallet-no-merge` +3;
  - `wallet-no-reuse` +5;
  - `wallet-uniform-script` +3.

docs/privacy-engine.md gets a "Wallet-Level Heuristics" section and Impact Summary rows (level `Wallet`) for W1-W5. The overview's heuristic counts are updated, and docs/xpub-analysis.md's check table gets the new rows.

---

## UI (wallet results)

### Findings

The new findings render through the existing `FindingGroups`, `FindingsList` and `FindingCard`, with grouping, severity order and tier context unchanged. Two additions:

- **Transaction list on the card.** A finding with `params._txids` (a JSON array of at most 10 txids, `MAX_TX_REFS`) shows a "Transactions" list in its expanded body:
  - truncated txids as buttons that open the tx analysis (`onTxClick`, `onScan` on the wallet page);
  - "and N more" when `params.more > 0`.

  The new `TxRefList` lives in `FindingCardTables.tsx` beside `ConsolidationTable`, and `FindingCardBody` renders it. Buttons are at least 40 px tall, with a visible focus ring.

- **Coin origins.** The verdict band shows a compact segmented bar plus legend when the wallet holds UTXOs, from `WalletAuditResult.utxoOrigins`:
  - one segment per class with count > 0, width by sats;
  - the legend shows class, count and sats.

  Colours are tokens only: `mixed` uses `severity-good`, `coinjoin-change` uses `severity-high`, and the other classes use neutral `foreground` tints. The bar has `role="img"` with an aria-label summary; the legend is the text alternative. New component: `src/components/wallet/CoinOrigins.tsx`.

### Privacy

The txids live only in the in-memory result. Nothing new is logged, cached or sent.

## Copy and remediation

**Rules:**
- No em dashes.
- No "we/us/our"; passive or tool-named voice.
- Plain words, and every term the finding uses is explained in its description.

Remediation is the `recommendation` field, as for the existing wallet findings. English (the `defaultValue`s and `en` keys):

**`wallet-postmix-merge.unmixed`**
- Title: "{{count}} spend merged CoinJoin outputs with unmixed coins" (`_other`: "spends").
- Description: "CoinJoin outputs were spent together with coins that were never mixed (CoinJoin change, change or received coins). The common-input heuristic links each mixed output to the unmixed coin's history, which largely undoes the CoinJoin for it."
- Recommendation: "Spend each CoinJoin output on its own, never in the same transaction as unmixed coins or CoinJoin change. Freeze CoinJoin change and unmixed coins with coin control and spend or remix them separately."

**`wallet-postmix-merge.mixed`**
- Title: "{{count}} spend merged several CoinJoin outputs" (`_other`: "spends").
- Description: "Several CoinJoin outputs were spent together. Each was hidden among its round's peers; spent together, their possible histories intersect and the anonymity of each output shrinks."
- Recommendation: "Spend one CoinJoin output per transaction. When a payment needs more, use a collaborative transaction (Stonewall, PayJoin with a recipient that supports it) instead of merging mixed outputs."

**`wallet-change-merge`**
- Title: "{{count}} spend merged change with other coins" (`_other`: "spends").
- Description: "Change from an earlier payment was spent together with a coin from a different transaction. Whoever identified that change, including the earlier payment's recipient, now also sees the other coin and its history, and every address involved joins one cluster."
- Recommendation: "Use coin control: spend change on its own or with coins from the same transaction. When a payment needs more, spend the change completely in a payment that leaves no new change, or run it through a CoinJoin first."

**`wallet-change-exposed`**
- Title: "{{exposed}} of {{payments}} payments revealed their change".
- Description: "In {{exposed}} of {{payments}} simple payments a standard change-detection rule pointed at the real change output: address type ({{byType}}), round payment amount ({{byRound}}), or change smaller than every input ({{byOptimal}}). Anyone applying these rules can follow the wallet's change from payment to payment."
- Recommendation: "Use a wallet that gives change the payment's address type (Bitcoin Core does), avoid round payment amounts, and prefer changeless payments (exact-amount coin selection) or spend one coin that covers the payment."

**`wallet-peel-chain`**
- Title: "Peel chain of {{count}} payments".
- Description: "{{count}} payments in a row each spent only the change of the previous one. Anyone who identifies one payment in the chain can follow the rest. Chains of 3 or more payments: {{chains}}."
- Recommendation: "Break the chain: pay from a different coin, spend exact amounts so no change is left, run the change through a CoinJoin before the next payment, or use PayJoin or Stonewall when available."

**`wallet-no-merge`**
- Title: "Coins kept apart in {{count}} spends".
- Description: "None of the wallet's {{count}} spends merged change, CoinJoin outputs or many coins into one transaction. Keeping coins apart limits what each payment reveals."
- Recommendation: "Keep using coin control."

**UI strings:**
- `finding.txRefs` "Transactions"
- `finding.txRefsMore` "and {{count}} more"
- `wallet.coinOrigins` "Coin origins"
- `wallet.origin.mixed` "Mixed (CoinJoin)"
- `wallet.origin.coinjoin-change` "CoinJoin change"
- `wallet.origin.change` "Change"
- `wallet.origin.self` "Self-transfer"
- `wallet.origin.received` "Received"
- `wallet.origin.unknown` "Unknown origin"
- `wallet.coinOriginsAria` "{{count}} unspent coins by origin"

The coin-origins header shows the UTXO total (`flows.utxosAvailable`), each bar segment keeps a 4 px minimum so a class with few sats stays visible, and legend items wrap (inside themselves when wider than the card).

### i18n

- Every key exists in en, es, pt, de, fr and pl (`public/locales/*/common.json`), with plural forms where `count` is passed (`_one`/`_other`; pl `_one`/`_few`/`_many`/`_other`).
- Variant keys follow `findingKeys`: `finding.<id>.<field>.<variant>`, with plural suffixes after the variant.
- Spanish is Castilian tuteo.

## CLI parity

`scan xpub` and MCP `scan_wallet` call `auditWallet`, so the findings and score match the web app with no extra code. Output additions:
- **Text** (`formatWalletResult`): a "Coin origins:" line listing non-zero classes (`3 mixed, 1 CoinJoin change, 2 change`), shown when there are UTXOs.
- **JSON** (`walletJson`) and MCP: `walletInfo.utxoOrigins` / `utxoOrigins`.
- Findings already include `params` (with `_txids`). This is the user's own output, nothing is stored.

---

## Testing

- **Unit, behaviour model** (`wallet-behavior.test.ts`):
  - coin classes for each rule, including Stonewall, tx0 toxic change and a missing funding tx (`unknown`);
  - solo spends skip any tx with an outside input, and CoinJoins;
  - simple payments exclude batches, changeless spends, self-transfers and tx0s;
  - `utxoOrigins` sums;
  - a tx listed under several addresses is counted once.
- **Unit, heuristics** (`wallet-heuristics.test.ts`): every severity and impact step, both W1 variants, W1 over W2 precedence, W2 ignoring same-tx merges, W3 counting only rules that point at the real change, W4 longest chain and the 3/6 thresholds, W5 conditions, the `_txids` cap at 10 with `more`.
- **Audit integration** (`wallet-audit.test.ts`): consolidation deduplication, `utxoOrigins` on the result, an empty wallet and a wallet with no spends produce no new findings.
- **Golden wallet** (`wallet-golden.test.ts`): `goldenWallet()` and `cleanWallet()` are synthetic, offline histories (builder in `src/lib/analysis/__tests__/fixtures/wallet-history.ts`). A snapshot pins grade, score and every finding with its impact; any change is a reviewable diff (as in the tx golden corpus).
- **Locale text** (`finding-locale-text.test.ts`): each new finding renders without raw keys or `{{` in all 6 locales; a Polish plural spot check.
- **Components:** `TxRefList` (buttons call `onTxClick`, "and N more", bad JSON renders nothing); `CoinOrigins` (zero classes hidden, nothing for an empty set, aria label).
- **CLI:** formatter prints coin origins; JSON carries `utxoOrigins`.
- **e2e** (`e2e/wallet-scan.spec.ts`, offline mocks): a wallet whose change is merged with a receipt shows the `wallet-change-merge` finding, and its transaction button opens that tx's analysis.

## Rollout

- No worker, sidecar or API change.
- Release as 0.41.0 (GitHub Pages, both Docker images, community store), with a release note: "Wallet scans now check how coins were spent together: CoinJoin outputs merged with unmixed coins, change merged with other coins, payments that reveal their change and peel chains".
- Wallet grades can drop for wallets with these behaviours. That is intended, and docs/testing-reference.md records the golden wallet.

## References

- Meiklejohn, S., et al. "A Fistful of Bitcoins." IMC 2013 (multi-input heuristic, one-time change address heuristic).
- Androulaki, E., et al. "Evaluating User Privacy in Bitcoin." FC 2013 (multi-input and shadow address heuristics).
- Nick, J. "Data-Driven De-Anonymization in Bitcoin." ETH Zurich, 2015 (optimal change heuristic).
- Kappos, G., et al. "How to Peel a Million: Validating and Expanding Bitcoin Clusters." USENIX Security 2022 (peel chains, change heuristics against ground truth).
- Möser, M. and Böhme, R. "Anonymous Alone? Measuring Bitcoin's Second-Generation Anonymization Techniques." EuroS&PW 2017 (CoinJoin outputs re-linked by later spends).
- Möser, M. and Narayanan, A. "Resurrecting Address Clustering in Bitcoin." FC 2022 (change detection with wallet fingerprints).
- LaurentMT. Boltzmann and "Bitcoin Transactions & Privacy" (anonymity set intersection, link probabilities).
- OXT Research / ErgoBTC. "Understanding Bitcoin Privacy with OXT", parts 1-4 (change detection, wallet clustering, post-mix behaviour).
- Samourai Whirlpool docs (doxxic change, post-mix spending) and Wasabi Wallet docs (coin control, never merge private with non-private coins).
- Sparrow Wallet docs (UTXO freezing, coin control).
- Bitcoin Wiki, "Privacy" (change address detection, round numbers, change avoidance).
