# v2 functionality parity

Every user-visible capability of the classic UI, and where it lives in v2.
The flip from classic to v2 needs every row checked. "Gate" is the classic
gating; v2 has no Normie/Cypherpunk modes (one progressive layout), and keeps
dev-mode gates as they are.

Status: `[x]` done and verified in v2, `[ ]` open.

## Page level (`src/app/v2/page.tsx`, shared `useScanner`)

- [x] Hash routing `#tx=` `#addr=` `#check=` `#xpub=`, back/forward, pending-hash loader
- [x] Submit: txid, address, PSBT (analyzed directly), xpub/descriptor (+ privacy warning modal on third-party API)
- [x] Recent scans saved on completion; bookmarks store
- [x] Dynamic document title; aria-live status line; Backspace goes back (useKeyboardNav, same as classic; Escape is deliberately not bound)
- [x] Service worker registration
- [x] TipToast, NetworkSwitchToast (auto-switched network), InstallPrompt, AppStoreAnnouncement
- [x] AppStoreAnnouncement shown on the home screen only, so it never covers results (still a classic bug)
- [x] MempoolDownDialog (root layout, both UIs)
- [x] PrivacyNotice (third-party API disclosure) in v2 chrome

## Loader (`V2Scan`)

- [x] Query echo, data source label (mempool.space / local / custom)
- [x] Trace progress: backward/forward, depth x/max, txs fetched, elapsed vs timeout
- [x] Per-check list with running score (base + impacts, clamped), show all
- [x] Address scans (address steps), PSBT

## Results (`V2Results`) - tx and address

| Classic | Gate | v2 location | Status |
|---|---|---|---|
| InlineSearchBar rescan | all | top bar | [x] |
| New scan / back | (Esc/logo only) | top bar "New scan" | [x] |
| BookmarkButton | Pro | ResultActions | [x] |
| ExportButton (copy report) | all | ResultActions | [x] |
| ShareCardButton | all | ResultActions (v2 evidence-tag card) | [x] |
| ShareButtons (X, copy link) | all | ResultActions | [x] |
| HeroInfoCard: copy query, tx type, address type, block/time, unconfirmed | all | VerdictBand meta | [x] |
| ScoreDisplay grade/score/tagline | all | VerdictBand GradeDial + h1 | [x] |
| SeverityRing | Pro, >3 findings | replaced by counts row + exposure matrix | [x] |
| F-grade banner / sentiment banner | all | VerdictBand (F warning, tagline) | [x] |
| DestinationAlert (address) | all | EvidencePanel | [x] |
| PrimaryRecommendation (1-2 recs) | all | VerdictBand "Top recommendation" | [x] |
| CoinJoinStructure (tiers, consolidation, linkability) | all / Pro+Boltzmann | TxStage (tiers, co-spent tags, linkability mode) | [x] |
| TxFlowDiagram (badges, anon sets, entities, HodlHodl/Bisq, spent, USD, linkability, show all, fullscreen, rescan) | all | TxStage (every tag from the view model with provenance) | [x] |
| FindingFilterBar (adversary/temporality) | Pro | FindingsList "Filter" | [x] |
| Findings critical/high expanded | all | FindingsList "Leaks" | [x] |
| Additional findings (medium/low) | Pro only | FindingsList "Minor signals" (collapsed) | [x] |
| Privacy strengths | Pro only | FindingsList "Privacy strengths" (collapsed) | [x] |
| FindingCard detail (description, change signals, tier context, recommendation, ricochet/consolidation tables, learn more, score impact) | all/Pro | FindingItem -> FindingCardBody | [x] |
| GraphExplorerPanel (all graph features) | Pro, txid | AnalystWorkspace | [x] |
| AddressSummary (entity banner, balances) | all, address | EvidencePanel | [x] |
| DeepAnalysisTxid: TaintPathDiagram, LinkabilityHeatmap | Pro, txid | AnalystWorkspace | [x] |
| DeepAnalysisAddress: UTXO bubbles, privacy timeline, fingerprint timeline, tx breakdown, cluster | Pro/all | AnalystWorkspace | [x] |
| ScoreWaterfall (hover/click to finding) | Pro | ExplainRail ScoreBreakdown (fixed per-step clamp bug) | [x] |
| CexRiskPanel (OFAC + opt-in Chainalysis) | Pro | ExplainRail | [x] |
| ExchangeWarningPanel | CoinJoin | ExplainRail | [x] |
| CommonMistakes | Pro, B or worse | ExplainRail | [x] |
| AnalystView | all, txid | ExplainRail (Stage overlay later) | [x] |
| Remediation, RecoveryFlow | Pro+Dev | ExplainRail (dev) | [x] |
| ResultsFooter (scoring explainer, explorer link, disclaimer) | all | footer | [x] |
| PsbtBanner | psbt | V2PsbtBanner | [x] |

## Other flows

- [x] Destination-only result (risk level, findings, disclaimer, back)
- [x] Error view (retry unless not-retryable, new scan, `error-message` testid)
- [x] Wallet loading (derive/fetch/trace/analyze progress, local API banner, slow API note)
- [x] Wallet results (stats, worst address, findings, wallet graph, address table, tx list, coin selector)

## Chrome and pages

- [x] Header: nav, connection badge, settings (all panels), dev-mode logo gesture, Classic link with hash
- [x] Footer: credits, links, version, back to classic
- [x] Classic header "Try the new am-i.exposed" pill carrying the hash
- [x] /v2/ guide, faq, glossary, about, welcome, setup-guide, agents, observatory, graph
- [x] In-page scanner links stay in v2 (scannerHref)

## Deliberate v2 differences

- No Normie/Cypherpunk toggle: every panel is available in the progressive layout (pending owner decision after beta review).
- Analysis status notices (incomplete fetch, partial trace) are shown in the verdict, not counted as issues.
- Score breakdown does not clamp per step (classic ScoreWaterfall did, which could misreport the path).
- Stage tags never fall back to re-detection (classic fell back to self-address and dust-threshold guesses).
