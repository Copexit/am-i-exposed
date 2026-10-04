import { describe, it, expect } from "vitest";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt } from "./fixtures";
import { bytesToPayload, readInputFile, MAX_FILE_BYTES, InputFileError } from "../file";

describe("bytesToPayload", () => {
  it("binary PSBT -> hex", () => {
    const bytes = buildPsbt({ sign: false }).toPSBT();
    expect(bytesToPayload(bytes)).toBe(bytesToHex(bytes));
  });
  it("text file -> trimmed text", () => {
    expect(bytesToPayload(new TextEncoder().encode("  cHNidP8BAH\n"))).toBe("cHNidP8BAH");
  });
  it("binary raw tx -> hex", () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    const raw = t.extract();
    expect(bytesToPayload(raw)).toBe(bytesToHex(raw));
  });
});

describe("readInputFile", () => {
  it("rejects files over 4 MB", async () => {
    const f = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "big.psbt");
    await expect(readInputFile(f)).rejects.toBeInstanceOf(InputFileError);
  });
  it("reads a .psbt file", async () => {
    const bytes = buildPsbt({ sign: false }).toPSBT();
    expect(await readInputFile(new File([new Uint8Array(bytes)], "tx.psbt"))).toBe(bytesToHex(bytes));
  });
});
