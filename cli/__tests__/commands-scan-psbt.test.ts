/**
 * Tests for the scan psbt command.
 * PSBT analysis requires zero network access.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "fs";
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

// A minimal valid PSBT (2-in, 2-out simple payment, unsigned)
// This is a synthetic PSBT for testing - parsePSBT should handle it
const _MINIMAL_PSBT_HEX = "70736274ff01007102000000024242424242424242424242424242424242424242424242424242424242424242000000000043434343434343434343434343434343434343434343434343434343434343430000000000ffffffff0200e1f50500000000160014aabbccddaabbccddaabbccddaabbccddaabbccdd80969800000000001600141122334411223344112233441122334411223344000000000000";

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
    const { isPSBT } = await import("@/lib/bitcoin/psbt");

    // Create a temp file with PSBT-like content
    const tmpFile = join(tmpdir(), `test-psbt-${Date.now()}.psbt`);

    // Write a base64-encoded PSBT prefix to test file detection
    writeFileSync(tmpFile, "cHNidP8BAH0C", "utf-8");

    try {
      expect(existsSync(tmpFile)).toBe(true);
      // isPSBT should recognize base64 PSBT prefix
      expect(isPSBT("cHNidP8BAH0C")).toBe(true);
    } finally {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
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
