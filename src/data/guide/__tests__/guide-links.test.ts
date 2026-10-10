import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { PATHWAYS, COMBINED_PATHWAYS } from "../pathways";
import { GUIDE_TOPIC_IDS, guideTopicFor } from "../topics";

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
  it("every /guide/#anchor in the app points at a real pathway, combination or section", () => {
    const ids = new Set([...PATHWAYS.map((p) => p.id), ...COMBINED_PATHWAYS.map((c) => c.id), ...SECTION_IDS]);
    const dangling: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      for (const [, id] of readFileSync(file, "utf8").matchAll(/["'`]\/guide\/?#([a-z0-9-]+)["'`]/g)) {
        if (id && !ids.has(id)) dangling.push(`${id} (${file.split("/src/")[1]})`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("anchors of the sections that moved to /guide/labeling/ and /guide/spending/ point at those routes", () => {
    const misplaced: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      for (const [, id] of readFileSync(file, "utf8").matchAll(/["'`]\/guide\/?#([a-z0-9-]+)["'`]/g)) {
        if (id && guideTopicFor(id)) misplaced.push(`${id} (${file.split("/src/")[1]})`);
      }
      for (const [, topic, id] of readFileSync(file, "utf8").matchAll(/["'`]\/guide\/(labeling|spending)\/#([a-z0-9-]+)["'`]/g)) {
        if (!GUIDE_TOPIC_IDS[topic as "labeling" | "spending"].includes(id!)) misplaced.push(`${topic}#${id} (${file.split("/src/")[1]})`);
      }
    }
    expect(misplaced).toEqual([]);
  });

  it("old /guide/ anchors map to the topic route that holds them", () => {
    expect(guideTopicFor("labeling-coins")).toBe("labeling");
    expect(guideTopicFor("labeling-rule-6")).toBe("labeling");
    expect(guideTopicFor("spending-rule-2")).toBe("spending");
    expect(guideTopicFor("spending-ranking")).toBe("spending");
    expect(guideTopicFor("stonewall")).toBeNull();
  });

  it("internal guide links use the trailing-slash form /guide/#id (no host redirect)", () => {
    const slashless: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      for (const [match] of readFileSync(file, "utf8").matchAll(/["'`]\/guide#[a-z0-9-]*/g)) {
        slashless.push(`${match.slice(1)} (${file.split("/src/")[1]})`);
      }
    }
    expect(slashless).toEqual([]);
  });
});
