import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const LIB_DIR = join(process.cwd(), "src/lib");

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("layering", () => {
  it("src/lib never imports React hooks from src/hooks (the CLI and MCP share src/lib)", () => {
    const offenders = tsFiles(LIB_DIR).filter((f) =>
      /from\s+["'](@\/hooks\/|(\.\.\/)+hooks\/)/.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map((f) => relative(process.cwd(), f))).toEqual([]);
  });
});
