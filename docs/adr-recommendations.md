# ADR: Contextual Recommendations - High Signal, Low Noise

**Status:** Accepted
**Date:** 2026-03-12

## Problem

The results page renders 8 recommendation panels (Remediation, MaintenanceGuide, CommonMistakes, PrivacyPathways, RecoveryFlow, WalletGuide, CexRiskPanel, ExchangeWarningPanel) producing 40+ items across stacked accordions. This creates information overload, redundancy (same advice in 4 panels), no prioritization, and paradox of choice.

## Decision

### Architecture: Two Pages, One Bridge

**Results page = action.** Only shows:
- PrimaryRecommendation card (always visible, #1 action based on exact findings)
- Remediation panel (structured step-by-step remediations from findings)
- Triggered mistakes (CommonMistakes entries with matching `triggerFinding`)
- Recovery Flow (D/F grades only)
- CexRiskPanel / ExchangeWarningPanel (CoinJoin only)
- Link to guide page

**Guide page = education.** Standalone `/guide` page with all educational content:
- Privacy Techniques (pathways + combined strategies)
- Wallet Comparison
- Common Mistakes (all, unfiltered)
- Recovery Playbook
- Maintaining Privacy

**Bridge.** Finding cards link to relevant guide sections via `FINDING_TO_PATHWAYS` mapping.

### Recommendation Engine: Deterministic Cascade

A cascade walks rules top-to-bottom and returns the FIRST match. This mirrors actual chain analysis damage hierarchy:

1. Deterministic links (address reuse, same-address-IO) - 100% certain, any analyst exploits them
2. Post-mix to entity - undoes CoinJoin AND hands entity a backward trace
3. CIOH/consolidation - creates permanent clusters
4. Change detection - probabilistic, good wallets can make it ambiguous
5. Round amounts, entropy, fingerprints - supporting signals, rarely standalone

## Requirements

**R1: Show the #1 best action prominently.** Always-visible card, contextual to THIS scan.

**R2: Optionally show #2 alternative.** Only if it addresses a genuinely different concern.

**R3: Finding-aware.** Uses actual findings (IDs, severity, params), grade, wallet fingerprint, tx type.

**R4: Wallet-aware.** Never recommend the tool the user already has. Recommend the NEXT step.

**R5: All educational content preserved.** Nothing deleted. Moved to `/guide` page.

**R6: No generic content on results page.** Before adding content, ask: "Does this depend on the user's specific findings?" If no, it goes to `/guide`.

**R7: One remediation per finding.** A finding should not appear in structured remediation + generic action + pathway badge + triggered mistake simultaneously.

## Cascade Priority Tiers

### Tier 0 - Deterministic Failures (immediate)

| Condition | Recommendation |
|---|---|
| `h2-same-address-io` / `h2-self-send` | Your wallet sends change back to the input address. Switch to a wallet that generates fresh change addresses: Sparrow, Ashigaru, or Bitcoin Core. |
| `h8-address-reuse` (any reuse, 1+) | If this is your address: generate a new address for every receive. If you intend to send to this address: ask the receiver to share a new address. |

**NOT in Tier 0:** `h2-sweep` (1-in-1-out). Sweeps have no privacy loss - no consolidation, no change. Good practice for wallet migration, exact-amount payments, UTXO swaps.

### Tier 1 - Critical Findings (immediate)

| Condition | Recommendation |
|---|---|
| `entity-known-output` + `post-mix-consolidation` | Do not send mixed coins to a CEX that practices KYC. Many exchanges freeze CoinJoin-tainted deposits. Even if the exchange does not block CoinJoin, sending privacy-focused coins to a KYC entity defeats the purpose. Never cross KYC and non-KYC paths. |
| `post-mix-consolidation` (no entity) | Do not consolidate post-CoinJoin funds to an amount similar to what you put into the CoinJoin - amount correlation links input to output, undoing the mix. Use a single UTXO when spending. If you must consolidate, ensure the total does not approximate your original CoinJoin input. |
| `dust-attack` | Freeze this UTXO and do not join it with any other UTXO. If you can spend it alone, send it back to the sender. |

### Tier 2 - Structural Issues (soon)

| Condition | Recommendation |
|---|---|
| `entity-known-output` (CoinJoin UTXOs) | Avoid sending mixed UTXOs to centralized entities. If you have no choice, open a Lightning channel with them and send that way. |
| `entity-known-output` (non-CoinJoin) | Sending to a known entity links your UTXOs to your identity at that entity. Use Lightning if possible. |
| `h3-cioh` (any consolidation, not CoinJoin) | Every time you consolidate, you give extra information to those who sent you each coin. Choose a single UTXO that covers the payment. If you must consolidate, do it with coins from the same origin. If forced to consolidate from different origins, use Stonewall. |
| `peel-chain` + `h2-change-detected` | Do not make payments with change from previous payments - you link transactions in cascade, leaving a clear trail. Manage change individually. Use change by participating in PayJoin as a receiver to increase ambiguity. |
| `h2-change-detected` compound (2+ corroborators) | In basic transactions, change is easily detectable by heuristics. Participate in collaborative transactions between sender and receiver (PayJoin/Stowaway) to make external analysis significantly harder. |

### Tier 3 - Moderate (when-convenient)

| Condition | Recommendation |
|---|---|
| `exchange-withdrawal-pattern` | Use separate wallets to keep KYC funds apart from non-KYC funds. |
| `h2-change-detected` single signal | Use change individually - spend it totally or use it in collaborative transactions like PayJoin as a receiver. |
| `h5-low-entropy` / `h5-zero-entropy` | Increase entropy with collaborative payments: PayJoin/Stowaway or Stonewall. |
| `h1-round-amount` | Avoid round amounts. If unavoidable, use Lightning (amounts not visible on-chain). |

### Tier 4 - Positive (when-convenient)

| Condition | Recommendation |
|---|---|
| A+ with CoinJoin | Keep doing this. Spend post-mix one UTXO at a time. Avoid consolidating all mixed UTXOs. |
| A+ without CoinJoin | Strong privacy. Consider PayJoin or Lightning for even better privacy. |
| B with/without CoinJoin | Consider CoinJoin, PayJoin, or Lightning for stronger privacy. |
| Fallback | Review the findings above for specific improvements. |

## Expert Principles

These principles were validated by a Bitcoin privacy specialist and must be preserved:

1. **Collaborative transactions first**: PayJoin/Stowaway are the primary recommendation for change detection, low entropy, and CIOH.
2. **PayJoin as RECEIVER**: Disposing toxic change by participating in a PayJoin as receiver breaks the chain link.
3. **Tiered CIOH remediation**: (1) Single UTXO > (2) Same-origin consolidation > (3) Stonewall if forced.
4. **"Avoid" not "never"**: Post-mix partial consolidation is less bad than consolidating ALL. The risk is amount correlation.
5. **KYC/non-KYC separation**: Separate wallets. Never cross-contaminate. CEXes freeze CoinJoin deposits.
6. **Lightning for round amounts**: Off-chain payments hide amounts from blockchain observers.
7. **Dust send-back**: Safe when spent alone as a standalone transaction.
8. **Sweeps are fine**: 1-in-1-out transactions have no consolidation and no change. Not a privacy problem.
9. **Address reuse is critical from first reuse**: No threshold distinction. 1 reuse = catastrophic.

## Anti-Regression Rules

1. **Results Page Test**: Content must reference the user's specific findings/score/wallet. Generic reference content goes to guide page.
2. **No generic accordions**: Collapsible sections identical regardless of scan belong on guide page.
3. **Cap Zone 7**: At most: PrimaryRec + Remediation + Recovery (D/F) + Contextual Warnings.
4. **New educational content -> guide page**: "Taproot best practices", "Lightning privacy tips" -> guide page.
5. **Guide is canonical**: Remediations link to guide sections, don't duplicate explanations inline.
6. **No new standalone panels** in Zone 7 without amending this ADR.
7. **Review trigger**: Any PR adding content to ResultsPanel Zone 7 must justify why it's scan-specific.

## Key Files

| File | Role |
|------|------|
| `src/lib/recommendations/primary-recommendation.ts` | Cascade engine |
| `src/components/PrimaryRecommendation.tsx` | Hero card UI |
| `src/components/ResultsPanel.tsx` | Zone 7 integration |
| `src/lib/recommendations/pathway-matcher.ts` | Finding-to-guide deep links |
| `src/data/guide/*.ts` | Shared educational data |
| `src/app/guide/page.tsx` | Standalone guide page |
