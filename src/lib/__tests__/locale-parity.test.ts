import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = join(process.cwd(), "public/locales");

function readLocale(lang: string): Record<string, string> {
  const text = readFileSync(join(LOCALES_DIR, lang, "common.json"), "utf8");
  return JSON.parse(text);
}

describe("locale parity", () => {
  const locales = readdirSync(LOCALES_DIR).filter((d) => {
    try {
      return readFileSync(join(LOCALES_DIR, d, "common.json"), "utf8").length > 0;
    } catch {
      return false;
    }
  });

  it("all locales exist (en/es/pt/de/fr/pl)", () => {
    expect(locales).toEqual(expect.arrayContaining(["en", "es", "pt", "de", "fr", "pl"]));
  });

  it("every non-English locale has the same key set as English", () => {
    const en = new Set(Object.keys(readLocale("en")));
    for (const lang of locales) {
      if (lang === "en") continue;
      const other = new Set(Object.keys(readLocale(lang)));
      const missing = [...en].filter((k) => !other.has(k));
      const orphan = [...other].filter((k) => !en.has(k));
      expect(missing, `${lang} is missing ${missing.length} keys (sample: ${missing.slice(0, 5).join(", ")})`).toEqual([]);
      expect(orphan, `${lang} has ${orphan.length} orphaned keys (sample: ${orphan.slice(0, 5).join(", ")})`).toEqual([]);
    }
  });

  it("no locale value contains an em dash", () => {
    for (const lang of locales) {
      const data = readLocale(lang);
      for (const [k, v] of Object.entries(data)) {
        expect(v, `${lang}/${k} contains em dash`).not.toMatch(/—/);
      }
    }
  });
});
