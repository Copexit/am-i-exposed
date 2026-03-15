/** Privacy pathways data used by the /guide page and PrivacyPathways results section */

export interface PathwayData {
  id: string;
  category: "on-chain" | "off-chain";
  titleKey: string;
  titleDefault: string;
  iconName: string;
  descKey: string;
  descDefault: string;
  pros: { key: string; default: string }[];
  cons: { key: string; default: string }[];
  tools: string[];
  warnings?: { key: string; default: string }[];
}

export const PATHWAYS: PathwayData[] = [
  {
    id: "lightning",
    category: "off-chain",
    titleKey: "pathways.ln.title",
    titleDefault: "Lightning Network",
    iconName: "Zap",
    descKey: "pathways.ln.desc",
    descDefault:
      "Lightning payments happen off-chain, so they do not appear on the blockchain (except channel open/close transactions).",
    pros: [
      { key: "pathways.ln.pro1", default: "Payments are off-chain and invisible to chain analysis" },
      { key: "pathways.ln.pro2", default: "Fast and low-fee transactions" },
      { key: "pathways.ln.pro3", default: "Onion-routed for sender privacy" },
    ],
    cons: [
      { key: "pathways.ln.con1", default: "Channel opens and closes are visible on-chain" },
      { key: "pathways.ln.con2", default: "Channel capacity reveals approximate balance range" },
      { key: "pathways.ln.con3", default: "Routing privacy depends on network path and node connectivity" },
      { key: "pathways.ln.con4", default: "Single-channel LSP dependency: if your wallet has only one channel, the LSP sees all payment amounts and destinations" },
      { key: "pathways.ln.con5", default: "Public channels advertise capacity and peers to the routing gossip. Use private (unannounced) channels when not routing for others." },
      { key: "pathways.ln.con6", default: "Path selection favors short, cheap routes with small anonymity sets. Timing analysis and amount correlation can deanonymize payments across hops." },
      { key: "pathways.ln.con7", default: "Your node's public key is a persistent identifier. Anyone who knows it can track your channel opens, capacity changes, and routing behavior - similar to reusing a static address." },
    ],
    tools: ["Phoenix", "Breez", "Zeus"],
    warnings: [
      {
        key: "pathways.ln.warn1",
        default: "Open channels with non-KYC UTXOs for maximum privacy. Avoid opening from exchange withdrawal addresses - this links your Lightning identity to your exchange account.",
      },
      {
        key: "pathways.ln.warn2",
        default: "For maximum privacy, use Zeus connected to your own Lightning node. Phoenix and Breez route through single LSPs that can observe your payment activity.",
      },
      {
        key: "pathways.ln.warn3",
        default: "Best practice: open a channel and keep it open long-term. Manage funds via swap-in/swap-out (submarine swaps) instead of closing and reopening. If closing is necessary, leave a minimal balance on your side so the resulting on-chain UTXO is small, then dispose of it (add to mining fee, swap to LN, or donate).",
      },
      {
        key: "pathways.ln.warn4",
        default: "When paying centralized exchanges via Lightning, never connect your channel directly to the exchange node. Route payments through intermediate hops. Exchanges can flag CoinJoin-origin deposits on-chain but cannot trace Lightning payment routes.",
      },
    ],
  },
  {
    id: "monero",
    category: "off-chain",
    titleKey: "pathways.xmr.title",
    titleDefault: "Monero Atomic Swaps",
    iconName: "ArrowRightLeft",
    descKey: "pathways.xmr.desc",
    descDefault:
      "Atomic swaps allow exchanging BTC for XMR and back, completely breaking all on-chain links between the two Bitcoin transactions.",
    pros: [
      { key: "pathways.xmr.pro1", default: "Breaks all on-chain links completely" },
      { key: "pathways.xmr.pro2", default: "Monero has built-in privacy (ring signatures, stealth addresses)" },
      { key: "pathways.xmr.pro3", default: "No trusted intermediary needed with atomic swaps" },
    ],
    cons: [
      { key: "pathways.xmr.con1", default: "Requires cross-chain infrastructure" },
      { key: "pathways.xmr.con2", default: "Liquidity limitations on DEX platforms" },
      { key: "pathways.xmr.con3", default: "Slower than Lightning (on-chain settlement on both chains)" },
    ],
    tools: ["Haveno (DEX)", "UnstoppableSwap", "Unstoppable Wallet"],
    warnings: [
      {
        key: "pathways.xmr.warn1",
        default: "Regulatory risk: some jurisdictions restrict Monero. Research local regulations before using.",
      },
      {
        key: "pathways.xmr.warn2",
        default: "Use different services for the BTC-to-XMR and XMR-to-BTC legs. Avoid swapping similar amounts. Timing analysis can correlate entry and exit if both happen through the same platform.",
      },
      {
        key: "pathways.xmr.warn3",
        default: "Prefer non-custodial atomic swaps (UnstoppableSwap, Haveno) over custodial exchange services. Custodial services can freeze funds and comply with chain analysis requests. For small amounts, Unstoppable Wallet offers cheaper non-atomic swaps with exchange providers.",
      },
    ],
  },
  {
    id: "liquid",
    category: "off-chain",
    titleKey: "pathways.liquid.title",
    titleDefault: "Liquid Network",
    iconName: "Layers",
    descKey: "pathways.liquid.desc",
    descDefault:
      "Liquid is a Bitcoin sidechain with confidential transactions that hide amounts. Transaction amounts are encrypted and only visible to the sender and receiver.",
    pros: [
      { key: "pathways.liquid.pro1", default: "Confidential transactions hide amounts from observers" },
      { key: "pathways.liquid.pro2", default: "Faster block times (1 minute) than mainchain" },
      { key: "pathways.liquid.pro3", default: "L-BTC is 1:1 pegged to BTC" },
    ],
    cons: [
      { key: "pathways.liquid.con1", default: "Federated sidechain - requires trusting the Liquid federation members" },
      { key: "pathways.liquid.con2", default: "Peg-in and peg-out can be correlated by amount and timing. If the same service (e.g., Boltz) handles both directions, that service sees your complete flow." },
      { key: "pathways.liquid.con3", default: "Smaller user base limits anonymity set" },
      { key: "pathways.liquid.con4", default: "Federated consensus (11-of-15 functionaries) introduces trust assumptions different from Bitcoin's trustless model" },
    ],
    tools: ["Blockstream Green", "Boltz Exchange", "SideSwap"],
    warnings: [
      {
        key: "pathways.liquid.warn1",
        default: "Use different services for entry and exit (e.g., Boltz for peg-in, SideSwap for peg-out, or vice versa). Avoid entering and exiting with similar amounts within a short time window. If services collude or share data, privacy can be undone.",
      },
      {
        key: "pathways.liquid.warn2",
        default: "Liquid and Lightning can be used to receive change from on-chain transactions, accumulate small amounts off-chain over time, then consolidate to a single UTXO after a delay.",
      },
    ],
  },
  {
    id: "payjoin-v2",
    category: "off-chain",
    titleKey: "pathways.pj2.title",
    titleDefault: "PayJoin v2 (BIP77)",
    iconName: "ArrowRightLeft",
    descKey: "pathways.pj2.desc",
    descDefault:
      "Async, serverless PayJoin that breaks CIOH fundamentally. Both sender and receiver contribute inputs, making the transaction look like a normal payment on-chain.",
    pros: [
      { key: "pathways.pj2.pro1", default: "Breaks Common Input Ownership Heuristic by design" },
      { key: "pathways.pj2.pro2", default: "Looks like a normal transaction - no CoinJoin fingerprint" },
      { key: "pathways.pj2.pro3", default: "Async protocol - receiver does not need to be online simultaneously" },
    ],
    cons: [
      { key: "pathways.pj2.con1", default: "Both parties need PayJoin-compatible wallets" },
      { key: "pathways.pj2.con2", default: "Adoption is still growing - limited counterparties" },
    ],
    tools: ["Cake Wallet", "Bull Bitcoin", "BTCPay Server"],
    warnings: [
      {
        key: "pathways.pj2.warn1",
        default: "Both parties reveal information: the receiver contributes an input (potentially exposing a large UTXO to the payer), and the payer reveals a change output. Use coin control on both sides to select appropriately-sized inputs.",
      },
    ],
  },
  {
    id: "silent-payments",
    category: "off-chain",
    titleKey: "pathways.sp.title",
    titleDefault: "Silent Payments (BIP352)",
    iconName: "Lock",
    descKey: "pathways.sp.desc",
    descDefault:
      "Publish one static address, receive unique on-chain Taproot outputs for each payment. No notification transaction needed, outputs are standard P2TR.",
    pros: [
      { key: "pathways.sp.pro1", default: "Eliminates address reuse without out-of-band coordination" },
      { key: "pathways.sp.pro2", default: "Each payment creates a unique, unlinkable Taproot output" },
      { key: "pathways.sp.pro3", default: "No notification transaction (unlike BIP47)" },
    ],
    cons: [
      { key: "pathways.sp.con1", default: "Sender wallet must support BIP352" },
      { key: "pathways.sp.con2", default: "Scanning for received payments requires checking every transaction" },
    ],
    tools: ["Bitcoin Core 28+", "Cake Wallet", "Silentium"],
  },
  {
    id: "coin-control",
    category: "on-chain",
    titleKey: "pathways.cc.title",
    titleDefault: "Coin Control & UTXO Hygiene",
    iconName: "Coins",
    descKey: "pathways.cc.desc",
    descDefault:
      "Manually select which UTXOs to spend. Never merge KYC with non-KYC coins. Label everything by source and privacy context.",
    pros: [
      { key: "pathways.cc.pro1", default: "Prevents accidental cross-context contamination via CIOH" },
      { key: "pathways.cc.pro2", default: "No additional tools or counterparties needed" },
      { key: "pathways.cc.pro3", default: "Works with any wallet that supports manual UTXO selection" },
    ],
    cons: [
      { key: "pathways.cc.con1", default: "Requires manual effort and discipline for every transaction" },
      { key: "pathways.cc.con2", default: "Not all wallets support coin control" },
    ],
    tools: ["Sparrow Wallet", "Bitcoin Core", "Electrum"],
  },
  {
    id: "stonewall",
    category: "on-chain",
    titleKey: "pathways.stonewall.title",
    titleDefault: "Stonewall / Spending Privately",
    iconName: "Shield",
    descKey: "pathways.stonewall.desc",
    descDefault:
      "Single-user transaction that mimics a 2-person CoinJoin. Creates 4 outputs: payment, same-value decoy (back to sender), and two change outputs. Breaks CIOH and increases Boltzmann entropy without requiring coordination.",
    pros: [
      { key: "pathways.stonewall.pro1", default: "Breaks CIOH assumption (looks like 2 participants)" },
      { key: "pathways.stonewall.pro2", default: "Increases tx entropy measured by Boltzmann" },
      { key: "pathways.stonewall.pro3", default: "Available in Sparrow without external coordination" },
    ],
    cons: [
      { key: "pathways.stonewall.con1", default: "Requires multiple UTXOs of appropriate sizes" },
      { key: "pathways.stonewall.con2", default: "Uses more block space (4 outputs vs 2)" },
      { key: "pathways.stonewall.con3", default: "Analyst with enough context may distinguish from a real CoinJoin" },
    ],
    tools: ["Ashigaru", "Sparrow Wallet"],
  },
  {
    id: "batch-spending",
    category: "on-chain",
    titleKey: "pathways.batch.title",
    titleDefault: "Batch Spending",
    iconName: "Layers",
    descKey: "pathways.batch.desc",
    descDefault:
      "Combine multiple payments into a single transaction. Multiple outputs increase ambiguity for change detection since observers cannot determine which outputs are payments vs change.",
    pros: [
      { key: "pathways.batch.pro1", default: "Makes change detection harder (more candidate outputs)" },
      { key: "pathways.batch.pro2", default: "Reduces on-chain footprint and total fees" },
      { key: "pathways.batch.pro3", default: "Each additional output increases the Boltzmann entropy" },
    ],
    cons: [
      { key: "pathways.batch.con1", default: "All recipients can see each other's output amounts" },
      { key: "pathways.batch.con2", default: "Primarily useful when making multiple simultaneous payments" },
    ],
    tools: ["Sparrow Wallet", "Bitcoin Core", "Electrum"],
  },
  {
    id: "bnb-coin-selection",
    category: "on-chain",
    titleKey: "pathways.bnb.title",
    titleDefault: "Exact Amount Spending (BnB)",
    iconName: "Target",
    descKey: "pathways.bnb.desc",
    descDefault:
      "If a single UTXO covers the exact payment plus fee, spend it alone - no change output is created. Bitcoin Core automates this via Branch-and-Bound coin selection. Any wallet with coin control can achieve this manually.",
    pros: [
      { key: "pathways.bnb.pro1", default: "No change output means change detection heuristic cannot fire" },
      { key: "pathways.bnb.pro2", default: "Bitcoin Core uses BnB by default" },
      { key: "pathways.bnb.pro3", default: "Reduces transaction size (one fewer output)" },
    ],
    cons: [
      { key: "pathways.bnb.con1", default: "Only works when a UTXO combination matches the exact amount needed" },
      { key: "pathways.bnb.con2", default: "May require multiple UTXOs as inputs, triggering CIOH" },
      { key: "pathways.bnb.con3", default: "When exact match is impossible and consolidation is needed, prioritize combining UTXOs from the same entity (e.g., multiple withdrawals from the same exchange) rather than mixing coins from different sources." },
    ],
    tools: ["Bitcoin Core (default)", "Sparrow Wallet", "Electrum"],
    warnings: [
      {
        key: "pathways.bnb.warn1",
        default: "If left with small change (e.g., around 1000 sats), increase the mining fee to consume it entirely rather than creating a toxic change output.",
      },
    ],
  },
];

export interface CombinedPathwayData {
  id: string;
  titleKey: string;
  titleDefault: string;
  stepsKey: string;
  stepsDefault: string;
  strengthKey: string;
  strengthDefault: string;
}

export const COMBINED_PATHWAYS: CombinedPathwayData[] = [
  {
    id: "coinjoin-ln",
    titleKey: "pathways.combo.cjln.title",
    titleDefault: "CoinJoin -> Lightning",
    stepsKey: "pathways.combo.cjln.steps",
    stepsDefault: "Mix UTXOs with CoinJoin, then open Lightning channels with mixed outputs. Payments through LN are off-chain.",
    strengthKey: "pathways.combo.cjln.strength",
    strengthDefault: "On-chain mixing + off-chain spending. Channel opens are linked to CoinJoin outputs (which have high anonymity sets), not to your original funds. When paying exchanges via LN, route through intermediate hops - never connect your channel directly to the exchange node.",
  },
  {
    id: "coinjoin-liquid",
    titleKey: "pathways.combo.cjliq.title",
    titleDefault: "CoinJoin -> Liquid",
    stepsKey: "pathways.combo.cjliq.steps",
    stepsDefault: "Mix first with CoinJoin, then peg into Liquid for confidential transactions.",
    strengthKey: "pathways.combo.cjliq.strength",
    strengthDefault: "Combines CoinJoin anonymity set with Liquid's amount privacy. The peg-in links to a CoinJoin output, not your original identity. Note: after CoinJoin, history is already broken - Liquid peg-in adds optional amount privacy, not a required next step. Post-CoinJoin spending tools (Stonewall, PayJoin, coin control) are sufficient for most cases.",
  },
  {
    id: "btc-xmr-btc",
    titleKey: "pathways.combo.xmr.title",
    titleDefault: "BTC -> Monero -> BTC",
    stepsKey: "pathways.combo.xmr.steps",
    stepsDefault: "Swap BTC to XMR via atomic swap, hold in Monero, then swap back to BTC when needed.",
    strengthKey: "pathways.combo.xmr.strength",
    strengthDefault: "Complete chain break. The receiving BTC has zero on-chain link to the original BTC. Strongest privacy option available.",
  },
  {
    id: "exchange-coinjoin-ln",
    titleKey: "pathways.combo.excjln.title",
    titleDefault: "Exchange -> CoinJoin -> Lightning/Liquid",
    stepsKey: "pathways.combo.excjln.steps",
    stepsDefault: "Not recommended. This breaks the on-chain trace but NOT the KYC history - the exchange still has your identity record. Better approach: keep KYC UTXOs in a separate lifecycle (exchange to cold storage, back to exchange when selling, respecting tax obligations). For private spending, acquire Bitcoin without KYC (P2P, ATMs, mining, earning).",
    strengthKey: "pathways.combo.excjln.strength",
    strengthDefault: "CoinJoin breaks the trace but not the history. The exchange can be compelled to share your KYC record. This pathway adds chain-level deniability but does not protect against legal or regulatory inquiries tied to the original purchase.",
  },
  {
    id: "ln-liquid-btc",
    titleKey: "pathways.combo.lnliq.title",
    titleDefault: "Lightning -> Liquid -> BTC",
    stepsKey: "pathways.combo.lnliq.steps",
    stepsDefault: "Can go directly Lightning to Bitcoin via submarine swap (Boltz). The swap service does not know the origin of LN funds but sees the destination address. If multiple swaps are made and outputs later consolidated, the service can link them to one entity. For high-fee periods: swap LN to Liquid (e.g., Boltz), accumulate, then peg out to Bitcoin via a different service (e.g., SideSwap). Non-custodial atomic paths preserve self-custody.",
    strengthKey: "pathways.combo.lnliq.strength",
    strengthDefault: "Breaks the on-chain trail. The swap service sees the destination but not the origin. Use different services for the LN-to-Liquid and Liquid-to-BTC legs. Avoid consolidating multiple swap outputs to prevent linking them.",
  },
  {
    id: "coinjoin-p2p",
    titleKey: "pathways.combo.cjp2p.title",
    titleDefault: "CoinJoin -> P2P",
    stepsKey: "pathways.combo.cjp2p.steps",
    stepsDefault: "After CoinJoin, spend directly to the P2P counterparty on Bisq, Peach Bitcoin, HodlHodl, or RoboSats. The CoinJoin already breaks the history - the buyer cannot trace past the mix. An intermediate hop is not necessary since the counterparty has no prior chain analysis context.",
    strengthKey: "pathways.combo.cjp2p.strength",
    strengthDefault: "CoinJoin provides sufficient history break. The P2P buyer sees only a CoinJoin output (high anonymity set), not your original funds. Direct spending from post-mix is standard practice.",
  },
  {
    id: "atm-coinjoin-ln",
    titleKey: "pathways.combo.atmcjln.title",
    titleDefault: "No-KYC ATM -> CoinJoin -> Lightning",
    stepsKey: "pathways.combo.atmcjln.steps",
    stepsDefault: "Buy BTC at a no-KYC ATM (sub-$1000 in most jurisdictions), CoinJoin the output, then open a Lightning channel with the mixed UTXO.",
    strengthKey: "pathways.combo.atmcjln.strength",
    strengthDefault: "Breaks the link between physical purchase and spending identity. The ATM sees your face but not your spending, Lightning peers see your channel but not the ATM.",
  },
  {
    id: "p2p-monero-btc",
    titleKey: "pathways.combo.p2pxmr.title",
    titleDefault: "P2P -> Monero -> BTC",
    stepsKey: "pathways.combo.p2pxmr.steps",
    stepsDefault: "Buy Monero via P2P (Haveno, cash trade), then atomic swap XMR back to BTC.",
    strengthKey: "pathways.combo.p2pxmr.strength",
    strengthDefault: "Complete chain break - no on-chain link between the P2P purchase and the resulting BTC.",
  },
];
