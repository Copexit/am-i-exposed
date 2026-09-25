import { describe, it, expect } from "vitest";
import i18next from "i18next";
import { findingKey, findingKeys } from "../finding-utils";

describe("findingKey", () => {
  const i18n = i18next.createInstance();
  // initAsync: false - resources are ready synchronously.
  void i18n.init({
    lng: "es",
    fallbackLng: "en",
    initAsync: false,
    resources: {
      en: { translation: { "finding.x.title": "Base EN", "finding.x.title.v": "Variant EN" } },
      es: { translation: { "finding.x.title": "Base ES", "finding.x.title.v": "Variante ES", "finding.y.title": "Y ES" } },
    },
  });

  it("uses the variant key when it exists", () => {
    expect(i18n.t(findingKeys("x", "title", { _variant: "v" }), { defaultValue: "dflt" })).toBe("Variante ES");
  });

  it("falls back to the base key when the variant key is missing", () => {
    expect(i18n.t(findingKeys("y", "title", { _variant: "missing" }), { defaultValue: "dflt" })).toBe("Y ES");
  });

  it("uses the defaultValue when neither key exists", () => {
    expect(i18n.t(findingKeys("z", "title", { _variant: "v" }), { defaultValue: "dflt" })).toBe("dflt");
  });

  it("returns the plain base key without a variant", () => {
    expect(findingKey("x", "title")).toBe("finding.x.title");
  });
});

describe("finding locale text", () => {
  it("formats utxo-age-spread block heights with thousands separators", async () => {
    const en = (await import("../../../public/locales/en/common.json")).default as Record<string, string>;
    const i18n = i18next.createInstance();
    // initAsync: false - resources are ready synchronously.
    void i18n.init({ lng: "en", initAsync: false, resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
    const text = i18n.t(findingKeys("utxo-age-spread", "description"), {
      minHeight: 500000, maxHeight: 850000, spread: 350000, years: 6.7, defaultValue: "dflt",
    });
    expect(text).toContain("block 500,000 and the newest at block 850,000, a spread of 350,000 blocks");
  });
});
