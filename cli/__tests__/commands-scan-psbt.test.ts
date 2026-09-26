/**
 * Tests for the scan psbt command.
 * PSBT analysis requires zero network access.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let captured: string[] = [];
const originalLog = console.log;
const originalError = console.error;

beforeEach(() => {
  vi.useFakeTimers();
  captured = [];
  console.log = (...args: unknown[]) => captured.push(args.map(String).join(" "));
  console.error = () => {};
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  console.log = originalLog;
  console.error = originalError;
});

// prettier-ignore
const PSBT_COMPLETE = "cHNidP8BAFICAAAAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAD/////AZBfAQAAAAAAFgAUzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc0AAAAAAAEBH6CGAQAAAAAAFgAUq6urq6urq6urq6urq6urq6urq6sAAA==";

describe("scan psbt - input handling", () => {
  it("rejects non-PSBT input", async () => {
    const { scanPsbt } = await import("../src/commands/scan-psbt");
    await expect(
      scanPsbt("not-a-psbt", {
        json: true,
        network: "mainnet",
        entities: false,
        color: true,
      } as never),
    ).rejects.toThrow("Invalid PSBT");
  });

  it("reads PSBT from file path", async () => {
    vi.useRealTimers(); // the analysis pipeline yields via setTimeout between heuristics
    const { scanPsbt } = await import("../src/commands/scan-psbt");
    const dir = mkdtempSync(join(tmpdir(), "aie-psbt-"));
    const file = join(dir, "tx.psbt");
    // 1 input (100000 sats P2WPKH witnessUtxo), 1 output (90000 sats), fee 10000
    writeFileSync(file, `${PSBT_COMPLETE}\n`, "utf-8");
    try {
      await scanPsbt(file, { json: true, network: "mainnet", entities: false, color: true } as never);
      expect(captured.join("\n")).toContain("10000");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});

describe("PSBT detection", () => {
  it("detects base64 PSBT (cHNidP8 prefix)", async () => {
    const { isPSBT } = await import("@/lib/bitcoin/psbt");
    expect(isPSBT("cHNidP8BAH0CAAAAA")).toBe(true);
  });

  it("detects hex PSBT (70736274ff prefix)", async () => {
    const { isPSBT } = await import("@/lib/bitcoin/psbt");
    expect(isPSBT("70736274ff01000000")).toBe(true);
  });

  it("rejects non-PSBT strings", async () => {
    const { isPSBT } = await import("@/lib/bitcoin/psbt");
    expect(isPSBT("hello world")).toBe(false);
    expect(isPSBT("0200000001")).toBe(false);
    expect(isPSBT("")).toBe(false);
  });
});
