/**
 * Exchange CoinJoin policies - compiled from publicly documented incidents.
 *
 * IMPORTANT: This list is NOT comprehensive. Many exchanges may have
 * undocumented policies. Absence from this list does NOT mean an exchange
 * is safe for CoinJoin deposits. Policies change frequently.
 *
 * Last compiled: February 2026
 */

export type PolicyStatus = "blocks" | "flags" | "retroactive" | "no-known-restrictions" | "defunct";

export interface ExchangePolicy {
  name: string;
  policy: PolicyStatus;
  detail: string;
  status: "operating" | "bankrupt" | "shut-down";
}

export const EXCHANGE_POLICIES: ExchangePolicy[] = [
  {
    name: "Binance",
    policy: "blocks",
    detail: "Actively flags and freezes accounts. Has required users to promise not to use CoinJoin.",
    status: "operating",
  },
  {
    name: "Coinbase",
    policy: "flags",
    detail: "Flags CoinJoin-tainted deposits. Users report enhanced scrutiny and account restrictions.",
    status: "operating",
  },
  {
    name: "Gemini",
    policy: "retroactive",
    detail: "Froze accounts based on historical Wasabi Wallet usage discovered during reviews.",
    status: "operating",
  },
  {
    name: "Bitstamp",
    policy: "retroactive",
    detail: "Flagged CoinJoins months or years after the transaction occurred.",
    status: "operating",
  },
  {
    name: "Swan Bitcoin",
    policy: "blocks",
    detail: "Terminates accounts interacting with mixing services. Publicly sympathetic but operationally restrictive.",
    status: "operating",
  },
  {
    name: "Paxos",
    policy: "flags",
    detail: "Monitors withdrawals to mixing services. Has contacted users about mixing activity.",
    status: "operating",
  },
  {
    name: "Bitfinex",
    policy: "blocks",
    detail: "Freezes accounts after detected interactions with CoinJoin coordinators.",
    status: "operating",
  },
  {
    name: "BitVavo",
    policy: "blocks",
    detail: "Closed user accounts upon Wasabi Wallet withdrawals.",
    status: "operating",
  },
  {
    name: "BitMEX",
    policy: "retroactive",
    detail: "Flagged accounts months after withdrawal to JoinMarket for mixing.",
    status: "operating",
  },
  {
    name: "Kraken",
    policy: "no-known-restrictions",
    detail: "No confirmed public CoinJoin flagging incidents. Has chain analysis capabilities and complies with law enforcement.",
    status: "operating",
  },
  {
    name: "Boltz Exchange",
    policy: "flags",
    detail: "OFAC-compliant. Reports of blocking swaps involving recently mixed funds are unverified.",
    status: "operating",
  },
  {
    name: "BlockFi",
    policy: "blocks",
    detail: "Flagged deposits with CoinJoin history. Closed a loan because deposited coins had prior CoinJoin history from a previous owner.",
    status: "bankrupt",
  },
  {
    name: "Paxful",
    policy: "blocks",
    detail: "Froze accounts when users attempted withdrawals to Wasabi Wallet.",
    status: "shut-down",
  },
  {
    name: "Bitwala (Nuri)",
    policy: "retroactive",
    detail: "Froze accounts over 6-month-old CoinJoin transactions.",
    status: "shut-down",
  },
  {
    name: "Voyager",
    policy: "flags",
    detail: "Flagged accounts for mixing coins after withdrawal.",
    status: "bankrupt",
  },
  {
    name: "Bottlepay",
    policy: "blocks",
    detail: "Rejected and returned deposits of mixed funds from Whirlpool.",
    status: "shut-down",
  },
  {
    name: "Bisq",
    policy: "no-known-restrictions",
    detail: "Fully decentralized, non-custodial P2P exchange. Cannot apply chain surveillance.",
    status: "operating",
  },
  {
    name: "RoboSats",
    policy: "no-known-restrictions",
    detail: "P2P Lightning exchange with Tor-only connectivity. No chain surveillance capability.",
    status: "operating",
  },
  {
    name: "Hodl Hodl",
    policy: "no-known-restrictions",
    detail: "Non-custodial P2P trading with multisig escrow. No chain surveillance.",
    status: "operating",
  },
];

export const SAFE_ALTERNATIVES = EXCHANGE_POLICIES.filter(
  (e) => e.policy === "no-known-restrictions" && e.status === "operating" && e.name !== "Kraken",
);

export const COMPILED_DATE = "February 2026";
