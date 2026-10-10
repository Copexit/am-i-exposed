import { describe, it, expect } from "vitest";
import { localizeFees } from "../obs-format";

const t = (key: string, o: { defaultValue: string; amount?: string }) => {
  const dict: Record<string, string> = {
    "observatory.wabisabi.fees.freeRemixing": "Remezcla gratuita",
    "observatory.wabisabi.fees.freeUnder": "Gratis por debajo de {{amount}}",
  };
  return (dict[key] ?? o.defaultValue).replace("{{amount}}", o.amount ?? "");
};

describe("localizeFees", () => {
  it("translates the known phrases and keeps the rate", () => {
    expect(localizeFees("0% + Free remixing", t)).toBe("0% + Remezcla gratuita");
    expect(localizeFees("0.3% + Free remixing + Free under 0.03 BTC", t)).toBe("0.3% + Remezcla gratuita + Gratis por debajo de 0.03 BTC");
  });
  it("leaves unknown text untouched", () => {
    expect(localizeFees("1% + Something new", t)).toBe("1% + Something new");
  });
});
