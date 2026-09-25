/**
 * Regression corpus: everyday transactions from block 850000 run through the
 * full tx pipeline (with raw hex). The snapshot pins grade, score and every
 * finding with its impact, so any heuristic change shows up as a reviewable
 * diff. Update intentionally with `pnpm vitest run -u` and justify each delta.
 * Fixtures are (re)captured by scripts/capture-fixtures.mjs.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { analyzeTransaction } from "../orchestrator";
import type { MempoolTransaction } from "@/lib/api/types";

const CORPUS_DIR = join(__dirname, "../heuristics/__tests__/fixtures/api-responses/corpus");

const cases = readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(CORPUS_DIR, f), "utf-8")) as { tx: MempoolTransaction; hex: string });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("golden corpus - block 850000", () => {
  it.each(cases.map((c) => [c.tx.txid.slice(0, 16), c] as const))("%s", async (_id, { tx, hex }) => {
    const promise = analyzeTransaction(tx, hex);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect({
      grade: result.grade,
      score: result.score,
      findings: result.findings.map((f) => `${f.id} ${f.scoreImpact}`).sort(),
    }).toMatchSnapshot();
  });
});
