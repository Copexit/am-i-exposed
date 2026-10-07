import { describe, it, expect } from "vitest";
import { sanitizeMethods, sanitizeNotice } from "../sanitize";

describe("sanitizeMethods", () => {
  it("strips contact details", () => {
    expect(sanitizeMethods(["SPEI", "retiro sin tarjeta @nantulec"])).toEqual(["SPEI", "retiro sin tarjeta"]);
    expect(sanitizeMethods(["Nequi 🟡🔵 https://t.me/x +57 300 123 4567"])).toEqual(["Nequi"]);
    expect(sanitizeMethods(["Revolut", "revolut", "SEPA", "Zelle", "Wise", "PayPal"])).toEqual(["Revolut", "SEPA", "Zelle", "Wise"]);
    expect(sanitizeMethods(["[link] @user [number]"])).toEqual([]);
    expect(sanitizeMethods(["wa.me/34600111222 Bizum"])).toEqual(["Bizum"]);
  });

  it("keeps brackets inside labels and truncates long ones", () => {
    expect(sanitizeMethods(["Pago Movil (VES)"])).toEqual(["Pago Movil (VES)"]);
    const long = sanitizeMethods(["A very long payment method label that goes on"])[0] ?? "";
    expect(long.length).toBe(32);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("sanitizeNotice", () => {
  it("returns null for empty and strips links", () => {
    expect(sanitizeNotice("")).toBeNull();
    expect(sanitizeNotice("Maintenance tonight, see https://x.example")).toBe("Maintenance tonight, see");
    expect(sanitizeNotice("\n<h1>PIX <small>(BRL)</small></h1>\n<p>Ask for the name.</p>")).toBe("PIX (BRL) Ask for the name");
  });
});
