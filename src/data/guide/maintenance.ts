/** Maintenance guide data used by the /guide page */

interface MaintenanceSection {
  titleKey: string;
  titleDefault: string;
  tipsKeys: { key: string; default: string }[];
}

export const MAINTENANCE_SECTIONS: MaintenanceSection[] = [
  {
    titleKey: "maintenance.utxoHygiene",
    titleDefault: "UTXO hygiene",
    tipsKeys: [
      { key: "maintenance.utxoHygiene1", default: "Label every UTXO by source (exchange, P2P, CoinJoin, mining, payment). Never merge UTXOs from different sources." },
      { key: "maintenance.utxoHygiene2", default: "Segregate KYC-sourced UTXOs from non-KYC. Treat them as separate wallets with separate spending strategies." },
      { key: "maintenance.utxoHygiene3", default: "Freeze dust outputs (under 1,000 sats). Spending them costs more in fees than they are worth and can link your addresses." },
      { key: "maintenance.utxoHygiene4", default: "Consolidation is generally bad for privacy. Same-source consolidation (e.g., multiple withdrawals from the same exchange) is acceptable during low-fee periods. Different-source consolidation reveals more to observers of each UTXO - if unavoidable, keep amounts small. Ideal: maintain UTXOs of varied sizes (not too small, not too large) to handle any payment without forced consolidation." },
      { key: "maintenance.utxoHygiene5", default: "Label every UTXO by source (e.g., 'KYC-exchange', 'P2P-cash', 'CoinJoin-mixed'). Use BIP329 label export when migrating wallets. Labels prevent accidental cross-contamination of privacy contexts." },
      { key: "maintenance.utxoHygiene6", default: "When consolidation is necessary, prioritize combining UTXOs from the same source or entity (e.g., multiple withdrawals from the same exchange). Same-source consolidation does not create new linkage between different identities." },
    ],
  },
  {
    titleKey: "maintenance.postSpend",
    titleDefault: "Post-spend discipline",
    tipsKeys: [
      { key: "maintenance.postSpend1", default: "Spend one UTXO per transaction whenever possible. Multiple inputs link addresses via Common Input Ownership." },
      { key: "maintenance.postSpend2", default: "Avoid consolidating CoinJoin outputs. Each mixed output is an independent privacy unit. Consolidating all of them can link input to output, undoing the mix. If partial consolidation is unavoidable (e.g., within the same denomination), do it knowingly, or use spending tools like PayJoin or Stonewall instead of raw consolidation." },
      { key: "maintenance.postSpend3", default: "After CoinJoin, wait at least a few blocks before spending. Immediate post-mix spending creates timing correlation." },
    ],
  },
  {
    titleKey: "maintenance.network",
    titleDefault: "Network privacy",
    tipsKeys: [
      { key: "maintenance.network1", default: "Connect your wallet through Tor to hide which addresses you query from the node operator." },
      { key: "maintenance.network2", default: "Run your own Bitcoin node and mempool instance. This eliminates all third-party address queries." },
      { key: "maintenance.network3", default: "Use a VPN or Tor when accessing block explorers in a web browser." },
    ],
  },
  {
    titleKey: "maintenance.wallet",
    titleDefault: "Wallet consistency",
    tipsKeys: [
      { key: "maintenance.wallet1", default: "Stick with one wallet family to avoid mixing fingerprints. Switching wallets mid-UTXO-lifetime creates detectable patterns." },
      { key: "maintenance.wallet2", default: "Ensure your wallet uses anti-fee-sniping (nLockTime = current block height) and standard nSequence values." },
    ],
  },
  {
    titleKey: "maintenance.spending",
    titleDefault: "Spending strategy",
    tipsKeys: [
      { key: "maintenance.spending1", default: "If a UTXO exactly covers the payment plus fee, spend that single UTXO - no change output is created. When no single UTXO matches, choose inputs carefully: prefer coins from the same source. Bitcoin Core automates this via Branch-and-Bound (BnB) selection." },
      { key: "maintenance.spending2", default: "Match input and output script types (all P2WPKH or all P2TR). Mixed script types fingerprint the change output." },
      { key: "maintenance.spending3", default: "If you need to speed up a transaction, prefer CPFP - it can be applied by either the payer or receiver. RBF can only be applied by the sender and reveals which output is change (the output whose value decreases in the replacement). For privacy-sensitive payments, set an adequate fee upfront to avoid needing either." },
      { key: "maintenance.spending4", default: "Batching multiple payments into one transaction increases ambiguity for change detection, but all recipients can see each other's outputs and amounts. This may reveal more about your economic activity than sending individually. Use batching only when the privacy gain (entropy) outweighs the information shared with recipients." },
      { key: "maintenance.spending5", default: "Use Sparrow's 'Spending Privately' feature to construct Stonewall-like transactions that mimic CoinJoin structure using only your own UTXOs." },
    ],
  },
];
