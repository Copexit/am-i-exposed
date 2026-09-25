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

// Keys used in code but not yet present in any locale (they render the English
// defaultValue for every language). Known debt: this list may only shrink.
const KNOWN_MISSING_KEYS = new Set([
  "boltzmann.efficiencyLabel",
  "common.copyTxid",
  "common.openInNewTab",
  "errors.brave_shields",
  "errors.fetch_blocked",
  "finding.consolidationDetail",
  "finding.ricochetCol.amount",
  "finding.ricochetCol.block",
  "finding.ricochetCol.hop",
  "finding.ricochetCol.txid",
  "finding.ricochetDest",
  "finding.ricochetHopCount",
  "finding.ricochetVariant.classic",
  "finding.ricochetVariant.staggered",
  "finding.showScoreImpact",
  "finding.spentIn",
  "glossary.sectionLabel",
  "graphExplorer.analysis.fullScan",
  "graphExplorer.fullscreenLabel",
  "graphExplorer.maxNodesReached",
  "graphSaveLoad.copyFailed",
  "graphSaveLoad.limitReached",
  "graphSaveLoad.linkCopied",
  "graphSaveLoad.loadError",
  "graphSaveLoad.loadFailed",
  "graphSaveLoad.loadingGraph",
  "graphSaveLoad.networkMismatch",
  "graphSaveLoad.networkUnavailable",
  "graphSaveLoad.partialLoad",
  "graphSaveLoad.saved",
  "graphSaveLoad.tooLarge",
  "graphSaveLoad.updated",
  "input.detectedPsbt",
  "input.detectedXpub",
  "results.additionalFindings",
  "results.blockHeight",
  "results.chainBadge",
  "results.chainBadgeTooltip",
  "results.privacyStrengths",
  "results.scoreImpact",
  "results.unconfirmed",
  "settings.cypherpunkTooltip",
  "settings.entityUpdateAvailable",
  "settings.normieTooltip",
  "setup.docker_section_title",
  "umbrel.mempoolDownBody",
  "umbrel.mempoolDownReload",
  "umbrel.mempoolDownStep1",
  "umbrel.mempoolDownStep2",
  "umbrel.mempoolDownStep3",
  "umbrel.mempoolDownSteps",
  "umbrel.mempoolDownTitle",
  "viz.coinjoin.collapse",
  "viz.coinjoin.expand",
  "viz.flow.linkability",
  "viz.flow.linkabilityToggle",
  "wallet.graphCapped",
  "wallet.localApiBanner",
  "wallet.tracing",
  "wallet.tracingGeneric",
  "wallet.txGraph",
  "workspace.itemCount",
  "workspace.noData",
]);

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
    const unexpected = [...missing].filter((k) => !KNOWN_MISSING_KEYS.has(k));
    const fixed = [...KNOWN_MISSING_KEYS].filter((k) => !missing.has(k));
    expect(unexpected, "keys used in code but missing from en/common.json").toEqual([]);
    expect(fixed, "keys now present: remove them from KNOWN_MISSING_KEYS").toEqual([]);
  });
});
