/**
 * Canonical payment methods for P2P offers. Venues encode methods differently:
 * RoboSats joins catalog names with spaces in one `pm` tag, Mostro carries free
 * text per item, HodlHodl sends structured names with a type. Every raw label is
 * matched against this catalog; a label with no match maps to "other" so an
 * offer is never dropped by the filter. Names are plain data (no third-party icons).
 */
import { cleanLabel } from "./sanitize";

export type PmCategory = "instant" | "bank" | "wallet" | "cash" | "gift" | "crypto" | "other";

export interface PaymentMethod { id: string; name: string; category: PmCategory; re: RegExp }

// Patterns run on lowercased, accent-free text.
const C = (id: string, name: string, category: PmCategory, re: RegExp): PaymentMethod => ({ id, name, category, re });

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  // Instant bank rails
  C("sepa-instant", "SEPA Instant", "instant", /\binstant\s*sepa\b|\bsepa\s*(?:\(eu\)\s*)?inst/),
  C("pix", "PIX", "instant", /\bpix\b/),
  C("faster-payments", "Faster Payments", "instant", /\bfaster\s*payments?\b/),
  C("zelle", "Zelle", "instant", /\bzelle\b/),
  C("spei", "SPEI", "instant", /\bspei\b/),
  C("bizum", "Bizum", "instant", /\bbizum\b/),
  C("blik", "BLIK", "instant", /\bblik\b/),
  C("mbway", "MB WAY", "instant", /\bmb\s*way\b/),
  C("upi", "UPI", "instant", /\bupi\b|\bimps\b/),
  C("interac", "Interac e-Transfer", "instant", /\binterac\b/),
  C("payid", "PayID / Osko", "instant", /\bpayid\b|\bosko\b/),
  C("pago-movil", "Pago Móvil", "instant", /\bpago\s*movil\b/),
  C("bre-b", "Bre-B", "instant", /\bbre-?\s?b\b/),
  C("cbu-cvu", "CBU / CVU", "instant", /\bcbu\b|\bcvu\b/),
  C("pse", "PSE", "instant", /\bpse\b/),
  C("sbp", "SBP", "instant", /\bsbp\b/),
  C("sinpe", "SINPE", "instant", /\bsinpe\b/),
  C("sipap", "SIPAP", "instant", /\bsipap\b/),
  C("swish", "Swish", "instant", /\bswish\b/),
  C("twint", "TWINT", "instant", /\btwint\b/),
  C("wero", "Wero", "instant", /\bwero\b/),
  C("promptpay", "PromptPay", "instant", /\bpromptpay\b/),
  C("mobilepay", "MobilePay", "instant", /\bmobilepay\b/),
  C("ideal", "iDEAL", "instant", /\bideal\b/),
  // Bank transfers
  C("sepa", "SEPA", "bank", /(?<!instant\s*)\bsepa\b(?!\s*(?:\(eu\)\s*)?inst)/),
  C("bank", "Bank transfer", "bank", /\b(?:bank\s*(?:transfer|wire)|any national bank|transferencia|transferencia bancaria|wire|swift|ted|banco)\b/),
  C("n26", "N26", "bank", /\bn26\b/),
  C("bancolombia", "Bancolombia", "bank", /\bbancolombia\b/),
  C("sber", "Sber Bank", "bank", /\bsber\b/),
  C("tinkoff", "Tinkoff", "bank", /\btinkoff\b/),
  // Online payment systems, e-wallets and remittance
  C("revolut", "Revolut", "wallet", /\brevolut\b/),
  C("wise", "Wise", "wallet", /\bwise\b|\btransferwise\b/),
  C("paypal", "PayPal", "wallet", /\bpaypal\b/),
  C("venmo", "Venmo", "wallet", /\bvenmo\b/),
  C("cashapp", "Cash App", "wallet", /\bcash\s*app\b/),
  C("strike", "Strike", "wallet", /\bstrike\b/),
  C("mercadopago", "Mercado Pago", "wallet", /\bmercado\s*pago\b/),
  C("nequi", "Nequi", "wallet", /\bnequi\b/),
  C("daviplata", "DaviPlata", "wallet", /\bdaviplata\b/),
  C("lemon", "Lemon", "wallet", /\blemon\b/),
  C("yape", "Yape", "wallet", /\byape\b/),
  C("plin", "Plin", "wallet", /\bplin\b/),
  C("picpay", "PicPay", "wallet", /\bpicpay/),
  C("astropay", "AstroPay", "wallet", /\bastropay/),
  C("binance-pay", "Binance Pay", "wallet", /\bbinance[\s-]*pay\b/),
  C("paysera", "Paysera", "wallet", /\bpaysera\b/),
  C("skrill", "Skrill", "wallet", /\bskrill\b/),
  C("neteller", "Neteller", "wallet", /\bneteller\b/),
  C("advcash", "AdvCash", "wallet", /\badv\s*cash\b/),
  C("payoneer", "Payoneer", "wallet", /\bpayoneer\b/),
  C("paysend", "Paysend", "wallet", /\bpaysend\b/),
  C("satispay", "Satispay", "wallet", /\bsatispay\b/),
  C("monese", "Monese", "wallet", /\bmonese\b/),
  C("apple-pay", "Apple Pay", "wallet", /\bapple\s*pay\b/),
  C("google-pay", "Google Pay", "wallet", /\bgoogle\s*pay\b|\bgpay\b/),
  C("alipay", "Alipay", "wallet", /\balipay\b/),
  C("wechat-pay", "WeChat Pay", "wallet", /\bwechat\s*pay\b/),
  C("gcash", "GCash", "wallet", /\bgcash\b/),
  C("m-pesa", "M-Pesa", "wallet", /\bm-?\s?pesa\b/),
  C("mobile-money", "MTN / Airtel Money", "wallet", /\bmtn\b|\bmomo\b|\bairtel\b/),
  C("transfermovil", "Transfermóvil", "wallet", /\btransfermovil\b/),
  C("enzona", "EnZona", "wallet", /\benzona\b/),
  C("western-union", "Western Union", "wallet", /\bwestern\s*union\b/),
  C("moneygram", "MoneyGram", "wallet", /\bmoneygram\b/),
  C("remittance", "Remittance apps", "wallet", /\b(?:ria money|xoom|world\s*remit|remitly|sendwave|nala)\b/),
  // Cash
  C("cash", "Cash in person", "cash", /\b(?:f2f|in person|en persona|cara a cara|contanti|cash by mail)\b/),
  C("cardless", "Cardless ATM cash", "cash", /\b(?:sin tarjeta|cardless|hal\s*cash|retiro (?:de efectivo )?(?:en |por )?cajero|retiro cajero|efectivo (?:movil|bbva)|bbva efectivo|sacar (?:con codigo|sin tarjeta|dinero)|instant money|dimo)\b/),
  C("cash-deposit", "Cash deposit", "cash", /\b(?:deposito|cash deposit|cash in|oxxo)\b/),
  // Gift cards
  C("amazon", "Amazon gift card", "gift", /\bamazon\b/),
  C("gift-card", "Other gift cards", "gift", /\b(?:steam|google play|ozon|ebay|doordash|apple gift)\b/),
  // Crypto
  C("usdt", "USDT", "crypto", /\busdt\b|\btether\b/),
  C("usdc", "USDC", "crypto", /\busdc\b|\busd coin\b/),
  C("stablecoin", "Other stablecoins", "crypto", /\b(?:dai|busd|tusd|pyusd|dollar on chain)\b/),
  C("monero", "Monero", "crypto", /\bmonero\b|\bxmr\b/),
  C("btc", "Bitcoin (on-chain, L2, wrapped)", "crypto", /\bon-?\s?chain\b|\bl-?btc\b|\bwbtc\b|\brbtc\b|\blightning\b/),
];

export const OTHER_PM = "other";
const BY_ID = new Map(PAYMENT_METHODS.map((m) => [m.id, m]));
export const pmName = (id: string): string => BY_ID.get(id)?.name ?? "Other";
export const pmCategory = (id: string): PmCategory => BY_ID.get(id)?.category ?? "other";
export const isPmId = (id: string): boolean => id === OTHER_PM || BY_ID.has(id);

/** HodlHodl's own method types, for names outside the catalog (e.g. a named bank). */
const HODL_TYPE: Record<string, string> = {
  "bank wire": "bank",
  cash: "cash",
  "atm withdrawal": "cardless",
  stablecoins: "stablecoin",
  "bitcoin l2": "btc",
};

const fold = (s: string) => cleanLabel(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Canonical ids for an offer's raw labels (deduped, catalog order). A label that
 * matches nothing (and has no known HodlHodl type) adds "other".
 */
export function paymentMethodIds(labels: readonly string[], types: readonly (string | undefined)[] = []): string[] {
  const ids = new Set<string>();
  labels.forEach((raw, i) => {
    if (typeof raw !== "string") return;
    const text = fold(raw);
    if (!text) return;
    let hit = false;
    for (const m of PAYMENT_METHODS) if (m.re.test(text)) { ids.add(m.id); hit = true; }
    if (hit) return;
    const t = HODL_TYPE[(types[i] ?? "").trim().toLowerCase()];
    ids.add(t ?? OTHER_PM);
  });
  return PAYMENT_METHODS.map((m) => m.id).filter((id) => ids.has(id)).concat(ids.has(OTHER_PM) ? [OTHER_PM] : []);
}
