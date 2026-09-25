// @vitest-environment jsdom
import { it, expect } from "vitest";
import { tick } from "../heuristic-registry";

// jsdom defines `window`; tests must still get the 0ms delay, not the
// browser's 50ms diagnostic-loader pause.
it("tick does not wait under a test DOM environment", async () => {
  let done = false;
  void tick().then(() => { done = true; });
  await Promise.resolve();
  await Promise.resolve();
  expect(done).toBe(true);
});
