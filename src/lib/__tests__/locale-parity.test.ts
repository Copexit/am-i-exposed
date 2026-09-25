import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = join(process.cwd(), "public/locales");

function readLocale(lang: string): Record<string, string> {
  const text = readFileSync(join(LOCALES_DIR, lang, "common.json"), "utf8");
  return JSON.parse(text);
}

/** Recursively list non-test .ts/.tsx files under src/. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
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

  it("every literal t() key used in src/ exists in the English locale", () => {
    const en = readLocale("en");
    const has = (k: string) => k in en || `${k}_one` in en || `${k}_other` in en;
    const missing = new Set<string>();
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      for (const m of readFileSync(file, "utf8").matchAll(/\bt\(\s*"([a-zA-Z0-9_.-]+)"/g)) {
        if (!has(m[1])) missing.add(m[1]);
      }
    }
    expect([...missing], "keys used in code but missing from en/common.json").toEqual([]);
  });

  it("every {{placeholder}} in a locale value is passed by its literal t() call", () => {
    const data = Object.fromEntries(locales.map((lang) => [lang, readLocale(lang)]));
    const bad: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      // Only calls with a flat options object literal, so its keys are known.
      for (const m of readFileSync(file, "utf8").matchAll(/\bt\(\s*"([a-zA-Z0-9_.-]+)",\s*\{([^{}()]*)\}\s*\)/g)) {
        const passed = new Set([...m[2].matchAll(/(?:^|,)\s*([a-zA-Z_]\w*)\s*(?=[:,]|$)/g)].map((p) => p[1]));
        for (const lang of locales) {
          for (const key of [m[1], `${m[1]}_other`]) {
            const value = data[lang][key];
            if (value === undefined) continue;
            for (const v of value.matchAll(/\{\{\s*(\w+)/g)) {
              if (!passed.has(v[1])) bad.push(`${lang}/${key}: {{${v[1]}}} (${file.split("/src/")[1]})`);
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
