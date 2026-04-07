/** Wallet data used by the /guide page */

interface WalletEntry {
  name: string;
  type: ("desktop" | "mobile" | "hardware")[];
  nSequence: "good" | "bad";
  antiFeeSniping: boolean;
  coinJoin: boolean;
  payJoin: boolean | "v1-only" | "stowaway";
  bip47: boolean;
  silentPayments: boolean | "send-only";
  coinControl: boolean | "partial";
  ownNode: boolean | "partial" | "is-node";
  tor: boolean | "partial" | "native" | "orbot-vpn" | "orbot-proxy";
  trackers: number;
  trackerDetails?: string;
  url: string;
}

export const RECOMMENDED_WALLETS: WalletEntry[] = [
  {
    name: "Sparrow",
    type: ["desktop"],
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: true,
    payJoin: "v1-only",
    bip47: true,
    silentPayments: "send-only",
    coinControl: true,
    ownNode: true,
    tor: true,
    trackers: 0,
    url: "https://sparrowwallet.com",
  },
  {
    name: "Bitcoin Core",
    type: ["desktop"],
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: false,
    payJoin: false,
    bip47: false,
    silentPayments: "send-only",
    coinControl: true,
    ownNode: "is-node",
    tor: true,
    trackers: 0,
    url: "https://bitcoincore.org",
  },
  {
    name: "Electrum",
    type: ["desktop", "mobile"],
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: false,
    payJoin: false,
    bip47: false,
    silentPayments: false,
    coinControl: true,
    ownNode: true,
    tor: "orbot-proxy",
    trackers: 0,
    url: "https://electrum.org",
  },
  {
    name: "Ashigaru",
    type: ["mobile"],
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: true,
    payJoin: "stowaway",
    bip47: true,
    silentPayments: false,
    coinControl: true,
    ownNode: true,
    tor: "native",
    trackers: 0,
    url: "https://ashigaru.rs",
  },
  {
    name: "Trezor Suite",
    type: ["hardware"],
    nSequence: "good",
    antiFeeSniping: false,
    coinJoin: false,
    payJoin: false,
    bip47: false,
    silentPayments: false,
    coinControl: true,
    ownNode: true,
    tor: "partial",
    trackers: 1,
    trackerDetails: "Sentry",
    url: "https://trezor.io/trezor-suite",
  },
  {
    name: "Blockstream App",
    type: ["desktop", "mobile"],
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: false,
    payJoin: false,
    bip47: false,
    silentPayments: "send-only",
    coinControl: "partial",
    ownNode: true,
    tor: true,
    trackers: 1,
    trackerDetails: "Countly",
    url: "https://blockstream.com/green",
  },
  {
    name: "Nunchuk",
    type: ["desktop", "mobile"],
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: false,
    payJoin: false,
    bip47: false,
    silentPayments: "send-only",
    coinControl: true,
    ownNode: true,
    tor: "orbot-vpn",
    trackers: 2,
    trackerDetails: "Branch + Google Crashlytics",
    url: "https://nunchuk.io",
  },
  {
    name: "Wasabi",
    type: ["desktop"],
    nSequence: "bad",
    antiFeeSniping: false,
    coinJoin: true,
    payJoin: false,
    bip47: false,
    silentPayments: "send-only",
    coinControl: true,
    ownNode: true,
    tor: "native",
    trackers: 0,
    url: "https://wasabiwallet.io",
  },
  {
    name: "Cake Wallet",
    type: ["mobile"],
    nSequence: "good",
    antiFeeSniping: false,
    coinJoin: false,
    payJoin: true,
    bip47: false,
    silentPayments: true,
    coinControl: true,
    ownNode: true,
    tor: true,
    trackers: 0,
    url: "https://cakewallet.com",
  },
  {
    name: "Bull Bitcoin",
    type: ["mobile"],
    nSequence: "good",
    antiFeeSniping: true,
    coinJoin: false,
    payJoin: true,
    bip47: false,
    silentPayments: false,
    coinControl: true,
    ownNode: true,
    tor: "orbot-proxy",
    trackers: 0,
    url: "https://bullbitcoin.com",
  },
  {
    name: "Blue Wallet",
    type: ["desktop", "mobile"],
    nSequence: "good",
    antiFeeSniping: false,
    coinJoin: false,
    payJoin: false,
    bip47: true,
    silentPayments: "send-only",
    coinControl: true,
    ownNode: true,
    tor: "orbot-vpn",
    trackers: 1,
    trackerDetails: "Bugsnag",
    url: "https://bluewallet.io",
  },
  {
    name: "BitBoxApp",
    type: ["hardware"],
    nSequence: "good",
    antiFeeSniping: false,
    coinJoin: false,
    payJoin: false,
    bip47: false,
    silentPayments: "send-only",
    coinControl: true,
    ownNode: true,
    tor: "native",
    trackers: 0,
    url: "https://bitbox.swiss/bitboxapp/",
  },
];

export const WALLETS_TO_AVOID = [
  { name: "Exodus", reasonKey: "walletGuide.avoidExodus", reasonDefault: "Clear fingerprint (nVersion=1, nLockTime=0), no coin control, no Tor, centralized servers" },
  { name: "Trust Wallet", reasonKey: "walletGuide.avoidTrustWallet", reasonDefault: "No coin control, no Tor support, sends all queries through centralized infrastructure" },
  { name: "Coinbase Wallet", reasonKey: "walletGuide.avoidCoinbaseWallet", reasonDefault: "Integrated with Coinbase exchange, queries go through Coinbase servers, no privacy features" },
  { name: "Exchange wallets", reasonKey: "walletGuide.avoidExchangeWallets", reasonDefault: "Custodial - the exchange controls your keys and sees all your transactions" },
];

interface CriteriaRow {
  criteria: string;
  criteriaKey: string;
  good: string;
  goodKey: string;
  bad: string;
  badKey: string;
}

export const WALLET_CRITERIA: CriteriaRow[] = [
  {
    criteria: "nSequence",
    criteriaKey: "walletGuide.criteria.nSequence",
    good: "0xFFFFFFFE (signals locktime support)",
    goodKey: "walletGuide.criteriaGood.nSequence",
    bad: "0xFFFFFFFF (no locktime, no RBF)",
    badKey: "walletGuide.criteriaBad.nSequence",
  },
  {
    criteria: "nLockTime",
    criteriaKey: "walletGuide.criteria.nLockTime",
    good: "Current block height (anti-fee-sniping)",
    goodKey: "walletGuide.criteriaGood.nLockTime",
    bad: "Always 0 (no anti-fee-sniping)",
    badKey: "walletGuide.criteriaBad.nLockTime",
  },
  {
    criteria: "RBF",
    criteriaKey: "walletGuide.criteria.rbf",
    good: "Signaled or configurable",
    goodKey: "walletGuide.criteriaGood.rbf",
    bad: "No support",
    badKey: "walletGuide.criteriaBad.rbf",
  },
  {
    criteria: "Addresses",
    criteriaKey: "walletGuide.criteria.addresses",
    good: "Always new (BIP44/84 HD derivation)",
    goodKey: "walletGuide.criteriaGood.addresses",
    bad: "Reused or manually managed",
    badKey: "walletGuide.criteriaBad.addresses",
  },
  {
    criteria: "Connection",
    criteriaKey: "walletGuide.criteria.connection",
    good: "Own node or Tor",
    goodKey: "walletGuide.criteriaGood.connection",
    bad: "Centralized server only",
    badKey: "walletGuide.criteriaBad.connection",
  },
];
