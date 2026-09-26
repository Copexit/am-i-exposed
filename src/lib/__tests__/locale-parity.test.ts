import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FINDING_METADATA } from "../analysis/finding-metadata";

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
      // Plural forms English lacks (pl _few/_many) are fine when English has the _other form
      const orphan = [...other].filter((k) => !en.has(k) && !en.has(k.replace(/_(zero|two|few|many)$/, "_other")));
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
      for (const [, key] of readFileSync(file, "utf8").matchAll(/\bt\(\s*"([a-zA-Z0-9_.-]+)"/g)) {
        if (key && !has(key)) missing.add(key);
      }
    }
    expect([...missing], "keys used in code but missing from en/common.json").toEqual([]);
  });

  it("every key stored in data for a later t() call (textKey, labelKey, ...) exists in English", () => {
    const en = readLocale("en");
    const missing = new Set<string>();
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      for (const [, key] of readFileSync(file, "utf8").matchAll(/\b\w*Key:\s*"([a-zA-Z0-9_]+\.[a-zA-Z0-9_.-]+)"/g)) {
        if (key && !(key in en)) missing.add(key);
      }
    }
    expect([...missing], "indirect keys missing from en/common.json").toEqual([]);
  });

  it("no locale value uses mustache sections, which i18next does not support", () => {
    for (const lang of locales) {
      for (const [k, v] of Object.entries(readLocale(lang))) {
        expect(v, `${lang}/${k}`).not.toMatch(/\{\{[#/^]/);
      }
    }
  });

  it("every emitted finding id has title and description keys in English", () => {
    const keys = Object.keys(readLocale("en"));
    // Same finding-literal shape as the finding-metadata coverage test.
    const literals = sourceFiles(join(process.cwd(), "src")).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      const matches = [...text.matchAll(/\bid:\s*"([a-z0-9-]+)",\s*\n\s*severity\b/g)];
      return matches.map((m, i) => ({
        id: m[1]!, // the regex capture group is not optional
        file: file.split("/src/")[1],
        // The literal runs to the next finding literal, capped so later code is not included
        body: text.slice(m.index, Math.min(matches[i + 1]?.index ?? text.length, m.index + 2000)),
      }));
    });
    const passesVariant = new Set(literals.filter((l) => /\b_variant:/.test(l.body)).map((l) => l.id));
    // Base key or an i18next context/plural key. A _variant key (finding.<id>.<field>.<variant>)
    // only counts when the emitter passes a _variant, since findingKeys() otherwise asks for the base key.
    const has = (id: string, field: string) => {
      const base = `finding.${id}.${field}`;
      return keys.some((k) => k === base || k.startsWith(`${base}_`) || (passesVariant.has(id) && k.startsWith(`${base}.`)));
    };
    // Registry ids catch emitters the literal scan below misses (other field order, template ids).
    const missing = Object.keys(FINDING_METADATA).flatMap((id) =>
      ["title", "description"].filter((field) => !has(id, field)).map((field) => `${id}.${field} (finding-metadata)`),
    );
    for (const { id, file } of literals) {
      for (const field of ["title", "description"]) {
        if (!has(id, field)) missing.push(`${id}.${field} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every {{placeholder}} in a locale value is passed by its literal t() call", () => {
    const data = Object.fromEntries(locales.map((lang) => [lang, readLocale(lang)]));
    const bad: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      // Only calls with a flat options object literal, so its keys are known.
      for (const [, tKey, opts] of readFileSync(file, "utf8").matchAll(/\bt\(\s*"([a-zA-Z0-9_.-]+)",\s*\{([^{}()]*)\}\s*\)/g)) {
        if (!tKey || opts === undefined) continue;
        const passed = new Set([...opts.matchAll(/(?:^|,)\s*([a-zA-Z_]\w*)\s*(?=[:,]|$)/g)].map((p) => p[1]));
        for (const lang of locales) {
          for (const key of [tKey, `${tKey}_other`]) {
            const value = data[lang]?.[key];
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

  it("has no known transliteration or mistranslation regressions", () => {
    // Words that were once shipped without diacritics or with a wrong term
    const banned: Record<string, RegExp> = {
      es: /\b(transaccion|direccion|analisis|tambien|despues|heuristica)\b/i,
      pt: /\b(transacao|endereco|voce|tambem|nao)\b/i, // "analise" is a valid imperative
      fr: /liabilit|\b(securite|donnees|reseau|detection)\b/i,
      de: /\b(fuer|ueber|koennen|muessen|Schluessel|Gebuehr)\b/,
    };
    for (const [lang, rx] of Object.entries(banned)) {
      const hits = Object.entries(readLocale(lang)).filter(([, v]) => rx.test(v)).map(([k]) => k);
      expect(hits, `${lang} values with ${rx}`).toEqual([]);
    }
  });
});

