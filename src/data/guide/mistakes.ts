/** Common mistakes data - shared between CommonMistakes component and /guide page */

export interface MistakeEntry {
  titleKey: string;
  titleDefault: string;
  descKey: string;
  descDefault: string;
  /** Only show on results page when a specific finding ID is present */
  triggerFinding?: string;
}

export const MISTAKES: MistakeEntry[] = [
  {
    titleKey: "mistakes.coinjoinConsolidate",
    titleDefault: "CoinJoin then consolidate all outputs",
    descKey: "mistakes.coinjoinConsolidateDesc",
    descDefault: "Combining CoinJoin outputs in a single transaction re-links them via common input ownership heuristic (CIOH), undoing the entire mix.",
  },
  {
    titleKey: "mistakes.exchangeDirect",
    titleDefault: "Mix or redirect KYC exchange funds",
    descKey: "mistakes.exchangeDirectDesc",
    descDefault: "Exchange withdrawal addresses are in chain analysis databases. Exchanges now require signing or declaring destination addresses. Keep KYC funds in a clean lifecycle: exchange to cold wallet to exchange when selling. Mixing breaks the trace but not the history - the exchange still has your KYC record and could trigger compliance issues.",
  },
  {
    titleKey: "mistakes.wasabiThenSend",
    titleDefault: "Mix with Wasabi then send immediately",
    descKey: "mistakes.wasabiThenSendDesc",
    descDefault: "Wasabi's nVersion=1 fingerprint identifies the pre-CoinJoin transaction. Spending immediately after creates a timing correlation. Wait several blocks and use a different wallet for the spend.",
  },
  {
    titleKey: "mistakes.reuseAddress",
    titleDefault: "Change wallet but reuse the receiver's address",
    descKey: "mistakes.reuseAddressDesc",
    descDefault: "Switching wallets improves fingerprinting, but if you reuse the same receiving address, all prior transaction history is still linked.",
    triggerFinding: "h8-address-reuse",
  },
  {
    titleKey: "mistakes.torOnly",
    titleDefault: "Use Tor only without changing on-chain behavior",
    descKey: "mistakes.torOnlyDesc",
    descDefault: "Tor protects your IP address, not your blockchain footprint. If your transactions still have round amounts, address reuse, and identifiable fingerprints, Tor alone does not help.",
  },
  {
    titleKey: "mistakes.lnFromExchange",
    titleDefault: "Open Lightning channel directly from exchange withdrawal",
    descKey: "mistakes.lnFromExchangeDesc",
    descDefault: "This links your Lightning identity to your exchange account. Keep KYC funds separate - send to cold storage only. If you need Lightning for private spending, fund channels from non-KYC sources (P2P, ATM, mining, earning).",
  },
  {
    titleKey: "mistakes.singleLsp",
    titleDefault: "Rely on a single Lightning channel with one LSP",
    descKey: "mistakes.singleLspDesc",
    descDefault: "If your Lightning wallet has only one channel (e.g., Phoenix with ACINQ), the LSP knows every payment destination, amount, and timing. Mitigate by running your own node or maintaining multiple channels with different peers.",
  },
  {
    titleKey: "mistakes.rbfChangeReveal",
    titleDefault: "Fee bump a privacy-sensitive transaction",
    descKey: "mistakes.rbfChangeRevealDesc",
    descDefault: "Both RBF and CPFP reveal information about change outputs. RBF replacement shows which output value decreased (change), while CPFP reveals change by spending it as a child input. For privacy-sensitive transactions, set an adequate fee upfront to avoid fee bumping entirely.",
    triggerFinding: "h6-rbf-signaled",
  },
  {
    titleKey: "mistakes.crossContextConsolidation",
    titleDefault: "Consolidate UTXOs from different privacy contexts",
    descKey: "mistakes.crossContextConsolidationDesc",
    descDefault: "Merging KYC exchange withdrawals with P2P or CoinJoin outputs links all those identities via CIOH. Only consolidate UTXOs from the same privacy category.",
    triggerFinding: "consolidation-fan-in",
  },
  {
    titleKey: "mistakes.sameSwapService",
    titleDefault: "Use the same swap service for both entry and exit",
    descKey: "mistakes.sameSwapServiceDesc",
    descDefault: "Using the same service (e.g., Boltz) for both Liquid peg-in and peg-out, or for both BTC-to-XMR and XMR-to-BTC swaps, gives that service full visibility of your flow. Use different services for each direction.",
  },
];
