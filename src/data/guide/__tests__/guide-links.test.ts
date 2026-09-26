import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { PATHWAYS, COMBINED_PATHWAYS } from "../pathways";

// Static section ids rendered by the guide page components.
const SECTION_IDS = ["combined-strategies", "common-mistakes", "maintaining-privacy", "privacy-techniques", "recovery-playbook", "verify", "wallet-comparison", "why"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("guide links", () => {
  it("every /guide#anchor in the app points at a real pathway, combination or section", () => {
    const ids = new Set([...PATHWAYS.map((p) => p.id), ...COMBINED_PATHWAYS.map((c) => c.id), ...SECTION_IDS]);
    const dangling: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      for (const [, id] of readFileSync(file, "utf8").matchAll(/["'`]\/guide\/?#([a-z0-9-]+)["'`]/g)) {
        if (id && !ids.has(id)) dangling.push(`${id} (${file.split("/src/")[1]})`);
      }
    }
    expect(dangling).toEqual([]);
  });
});
