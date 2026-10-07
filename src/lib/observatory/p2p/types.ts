/** Observatory P2P markets: one offer schema for RoboSats, Mostro and HodlHodl. */

export type Venue = "robosats" | "mostro" | "hodlhodl";
/** The MAKER's side: "sell" offers are where a visitor buys BTC. */
export type Side = "buy" | "sell";
export type Layer = "lightning" | "onchain" | "other";

export const VENUES: readonly Venue[] = ["robosats", "mostro", "hodlhodl"];

export interface P2pOffer {
  /** `${venue}:${host}:${d or id}` */
  id: string;
  venue: Venue;
  /** RoboSats coordinator key, Mostro instance pubkey, "hodlhodl" */
  host: string;
  side: Side;
  /** Uppercase ISO 4217, plus USDT/USDC; "BTC" (RoboSats swaps) and unknown codes kept but unpriced */
  currency: string;
  fiatMin: number | null;
  fiatMax: number | null;
  satsMax: number | null;
  /** % vs index; declared by the venue when it has one, else computed from price */
  premium: number | null;
  /** Fiat per BTC */
  price: number | null;
  methods: string[];
  layer: Layer;
  bondPct: number | null;
  createdAt: number;
  expiresAt: number | null;
  link: string | null;
}

export interface VenueHost {
  venue: Venue;
  key: string;
  name: string;
  /** unknown = onion-only seen from the public site */
  status: "up" | "down" | "unknown";
  inBook: number;
  version: string | null;
  makerFeePct: number | null;
  takerFeePct: number | null;
  bondPct: number | null;
  minSats: number | null;
  maxSats: number | null;
  volume24hBtc: number | null;
  lifetimeBtc: number | null;
  robotsToday: number | null;
  premium24h: number | null;
  notice: string | null;
  lastSeen: number | null;
  /** Mostro: fiat currencies the instance accepts (empty = any) */
  currencies?: string[];
}

/** "YYYY-MM-DD" UTC */
export interface DailyVolume { date: string; btc: number; trades: number }

/** code -> fiat per BTC */
export interface IndexPrices { source: string; prices: Record<string, number>; at: number }

export interface DepthPoint { premium: number; cumSats: number; offer?: P2pOffer }

export interface Market {
  currency: string;
  index: number | null;
  /** sells by premium asc, buys by premium desc */
  offers: P2pOffer[];
  /** cheapest sell offer (where to buy) */
  bestBuy: P2pOffer | null;
  /** highest buy offer (where to sell) */
  bestSell: P2pOffer | null;
  /** keyed by visitor intent: buy = maker sell offers */
  medianPremium: { buy: number | null; sell: number | null };
  liquiditySats: { buy: number; sell: number };
  /** keyed by MAKER side: cumulative sats by premium step */
  depth: { buy: DepthPoint[]; sell: DepthPoint[] };
  byVenue: Record<Venue, { offers: number; liquiditySats: number; medianPremium: number | null }>;
}

// Raw shapes

export interface NostrEvent { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }
export interface NostrSnapshot { events: NostrEvent[]; relays: { url: string; status: "eose" | "timeout" | "error"; count?: number }[]; fetchedAt: number }

export interface RoboInfo {
  num_public_buy_orders: number;
  num_public_sell_orders: number;
  book_liquidity: number;
  active_robots_today: number;
  last_day_nonkyc_btc_premium: number;
  last_day_volume: number;
  lifetime_volume: number;
  version: { major: number; minor: number; patch: number };
  maker_fee: number;
  taker_fee: number;
  bond_size: number;
  min_order_size: number;
  max_order_size: number;
  notice_severity: string;
  notice_message: string;
}
export type RoboLimits = Record<string, { code: string; price: number; min_amount: number; max_amount: number }>;
export type RoboHistorical = Record<string, { volume: number; num_contracts: number }>;

export interface HodlOffer {
  id: string;
  side: "buy" | "sell";
  currency_code: string;
  asset_layer: string;
  price: string;
  price_source: string;
  exchange_price_deviation: string | null;
  exchange_price_sign: string | null;
  exchange_price_unit: string | null;
  min_amount: string;
  max_amount: string;
  min_amount_sats: string | null;
  max_amount_sats: string | null;
  fee: { author_fee_rate: string };
  payment_methods?: { name: string }[];
  payment_method_instructions?: { payment_method_name: string }[];
  working_now: boolean;
  country_code: string;
}
export interface HodlPage { status: string; offers: HodlOffer[] }
