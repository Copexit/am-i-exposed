import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const M = join(process.cwd(), "public/media");
const LANGS = ["en", "es", "de", "fr", "pt", "pl"] as const;
const cues = (vtt: string) => vtt.split(/\r?\n/).filter((l) => l.includes("-->"));

describe("media assets", () => {
  it.each(["promo-en-16x9", "promo-es-16x9", "promo-en-9x16", "promo-es-9x16", "tutorial-en-16x9", "tutorial-es-16x9"])("%s mp4 + webp exist and are small", (n) => {
    expect(existsSync(join(M, `${n}.mp4`))).toBe(true);
    expect(existsSync(join(M, `${n}.webp`))).toBe(true);
    expect(statSync(join(M, `${n}.mp4`)).size).toBeLessThan(20 * 1024 * 1024);
  });
  it.each(LANGS)("tutorial-%s.vtt is WebVTT", (l) => {
    const v = readFileSync(join(M, `tutorial-${l}.vtt`), "utf-8");
    expect(v.startsWith("WEBVTT")).toBe(true);
    expect(cues(v).length).toBeGreaterThan(50);
  });
  it("de/fr/pt/pl keep the English cue timings", () => {
    const en = cues(readFileSync(join(M, "tutorial-en.vtt"), "utf-8"));
    for (const l of ["de", "fr", "pt", "pl"]) expect(cues(readFileSync(join(M, `tutorial-${l}.vtt`), "utf-8"))).toEqual(en);
  });
});
