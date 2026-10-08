import { describe, it, expect } from "vitest";
import { isPmId, paymentMethodIds, pmName, PAYMENT_METHODS } from "../payment-methods";
import { filterMethod, methodCounts } from "../market";
import { robosatsOffers } from "../normalize-robosats";
import { mostroOffers } from "../normalize-mostro";
import { hodlhodlOffers } from "../normalize-hodlhodl";
import { NOW, robosatsOrders, mostroOrders, mostroInfo, hodl0, hodl500 } from "./fixtures";

describe("paymentMethodIds", () => {
  it("RoboSats: catalog names joined by spaces split into several methods", () => {
    // pm tags as recorded, joined the way the normalizer joins them
    expect(paymentMethodIds(["Revolut Wise Instant SEPA"])).toEqual(["sepa-instant", "revolut", "wise"]);
    expect(paymentMethodIds(["Instant SEPA, Paysera"])).toEqual(["sepa-instant", "paysera"]);
    expect(paymentMethodIds(["Amazon USA GiftCard"])).toEqual(["amazon"]);
    expect(paymentMethodIds(["Paypal Friends & Family Venmo"])).toEqual(["paypal", "venmo"]);
    expect(paymentMethodIds(["USDT USDC Binance Pay"])).toEqual(["binance-pay", "usdt", "usdc"]);
    expect(paymentMethodIds(["SBP Sber Bank Tinkoff Bank Ozon GiftCard"])).toEqual(["sbp", "sber", "tinkoff", "gift-card"]);
    expect(paymentMethodIds(["On-Chain BTC LBTC WBTC"])).toEqual(["btc"]);
    expect(paymentMethodIds(["Retiro sin tarjeta - BBVA - HSBC"])).toEqual(["cardless"]);
  });

  it("Mostro: messy free text, accents, emoji and handles", () => {
    expect(paymentMethodIds(["Pago Móvil", "Transferencia bancaria"])).toEqual(["pago-movil", "bank"]);
    expect(paymentMethodIds(["pix", " TED"])).toEqual(["pix", "bank"]);
    expect(paymentMethodIds(["SEPA"])).toEqual(["sepa"]);
    expect(paymentMethodIds(["SEPA instant"])).toEqual(["sepa-instant"]);
    expect(paymentMethodIds(["⚡⚡🟡 Lemón 🍋🟣 Yape 🇵🇪🟢 Plin 🇵🇪 🟢"])).toEqual(["lemon", "yape", "plin"]);
    expect(paymentMethodIds(["@user ➡️ Nequi Bre-B:🔑 (Todos los Bancos)"])).toEqual(["bre-b", "nequi"]);
    expect(paymentMethodIds(["USDC💲🔵🟢💲USDT - TODAS LAS REDES 🖐️⭐ ⚠️🟨 BINANCE PAY ⬛⚠️"])).toEqual(["binance-pay", "usdt", "usdc"]);
    expect(paymentMethodIds(["Mercado Pago", "CVU", "CBU"])).toEqual(["cbu-cvu", "mercadopago"]);
    expect(paymentMethodIds(["Contanti al tabacchino 25.00"])).toEqual(["cash"]);
  });

  it("unknown labels map to other, never dropped; a multi-method offer keeps both", () => {
    expect(paymentMethodIds(["Saldo móvil"])).toEqual(["other"]);
    expect(paymentMethodIds(["PIX", "APENAS PARA NOVATOS APRENDER A USAR O MOSTRO"])).toEqual(["pix", "other"]);
    expect(paymentMethodIds(["", "  ", "@handle"])).toEqual([]);
  });

  it("HodlHodl: structured names, with the type as fallback for named banks", () => {
    expect(paymentMethodIds(["SEPA (EU) Instant"], ["Bank wire"])).toEqual(["sepa-instant"]);
    expect(paymentMethodIds(["SEPA (EU) bank transfer"], ["Bank wire"])).toEqual(["sepa", "bank"]);
    expect(paymentMethodIds(["Barclays", "Tether", "Cardless Cash"], ["Bank wire", "Stablecoins", "ATM withdrawal"])).toEqual(["bank", "cardless", "usdt"]);
    expect(paymentMethodIds(["Binance USD (BUSD)", "Some wallet"], ["Stablecoins", "Online payment system"])).toEqual(["stablecoin", "other"]);
  });

  it("catalog ids are unique and resolvable", () => {
    const ids = PAYMENT_METHODS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isPmId("other") && isPmId("pix") && !isPmId("toString")).toBe(true);
    expect(pmName("pix")).toBe("PIX");
    expect(pmName("other")).toBe("Other");
  });
});

describe("normalized offers carry canonical methods", () => {
  const all = [
    ...robosatsOffers(robosatsOrders.events, null, NOW),
    ...mostroOffers(mostroOrders.events, mostroInfo.events, null, NOW),
    ...hodlhodlOffers([hodl0, hodl500], null, NOW),
  ];

  it("every venue maps at least 90% of its offers to a catalog method", () => {
    for (const v of ["robosats", "mostro", "hodlhodl"] as const) {
      const list = all.filter((o) => o.venue === v);
      const mapped = list.filter((o) => o.pm.some((id) => id !== "other")).length;
      expect(mapped / list.length, v).toBeGreaterThan(0.9);
    }
  });

  it("filterMethod keeps offers with any matching method; methodCounts sorts by count, other last", () => {
    const pix = filterMethod(all, "pix");
    expect(pix.length).toBeGreaterThan(0);
    expect(pix.every((o) => o.pm.includes("pix"))).toBe(true);
    expect(filterMethod(all, null)).toBe(all);
    const counts = methodCounts(all);
    expect(counts.at(-1)?.id).toBe("other");
    const known = counts.slice(0, -1).map((c) => c.count);
    expect(known).toEqual([...known].sort((a, b) => b - a));
    expect(counts.find((c) => c.id === "pix")?.count).toBe(pix.length);
  });
});

describe("review fixes", () => {
  it("cash in person / in hand are cash, not cash deposit; cash-in still is", () => {
    expect(paymentMethodIds(["Cash in person"])).toEqual(["cash"]);
    expect(paymentMethodIds(["Cash in hand"])).toEqual(["cash"]);
    expect(paymentMethodIds(["Any national bank (Cash in)"], ["Cash"])).toEqual(["bank", "cash-deposit"]);
    expect(paymentMethodIds(["Cash-in at the counter"])).toEqual(["cash-deposit"]);
  });

  it("efectivo, in persona and a bare bank", () => {
    expect(paymentMethodIds(["Efectivo"])).toEqual(["cash"]);
    expect(paymentMethodIds(["Contanti in persona"])).toEqual(["cash"]);
    expect(paymentMethodIds(["BBVA Efectivo Móvil"])).toEqual(["cardless"]);
    expect(paymentMethodIds(["Retiro de efectivo en cajero BBVA"])).toEqual(["cardless"]);
    expect(paymentMethodIds(["Monzo Bank"])).toEqual(["bank"]);
    expect(paymentMethodIds(["Sber Bank SBP"])).toEqual(["sbp", "sber"]);
  });

  it("dictionary words count only in short labels or with the method's capitalisation", () => {
    expect(paymentMethodIds(["wise"])).toEqual(["wise"]);
    expect(paymentMethodIds(["ideal"])).toEqual(["ideal"]);
    expect(paymentMethodIds(["dai"])).toEqual(["stablecoin"]);
    expect(paymentMethodIds(["be wise and release quickly please"])).toEqual(["other"]);
    expect(paymentMethodIds(["PIX, ideal para quem está começando"])).toEqual(["pix"]);
    expect(paymentMethodIds(["Dai, pago veloce con Satispay"])).toEqual(["satispay"]);
    expect(paymentMethodIds(["Revolut Wise Instant SEPA Bizum Paysera"])).toEqual(["sepa-instant", "bizum", "revolut", "wise", "paysera"]);
    expect(paymentMethodIds(["USDT DAI on any network you like"])).toEqual(["usdt", "stablecoin"]);
  });

  it("caps very long labels before matching", () => {
    expect(paymentMethodIds([`${"x ".repeat(400)}Revolut`])).toEqual(["other"]);
    expect(paymentMethodIds([`Revolut ${"x ".repeat(10_000)}`])).toEqual(["revolut"]);
  });
});
