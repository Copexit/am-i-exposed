import { describe, it, expect } from "vitest";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt, coldcardJson } from "./fixtures";
import { bytesToPayload, readInputFile, MAX_FILE_BYTES, InputFileError } from "../file";

describe("bytesToPayload", () => {
  it("binary PSBT -> hex", () => {
    const bytes = buildPsbt({ sign: false }).toPSBT();
    expect(bytesToPayload(bytes)).toBe(bytesToHex(bytes));
  });
  it("text file -> trimmed text", () => {
    expect(bytesToPayload(new TextEncoder().encode("  cHNidP8BAH\n"))).toBe("cHNidP8BAH");
  });
  it("text file with a UTF-8 BOM -> text without it", () => {
    const b64 = new TextEncoder().encode("cHNidP8BAH\r\n");
    expect(bytesToPayload(new Uint8Array([0xef, 0xbb, 0xbf, ...b64]))).toBe("cHNidP8BAH");
  });
  it("wallet export .json (non-ASCII label) -> descriptor", () => {
    const { json } = coldcardJson({ desc: true });
    const text = JSON.stringify({ ...json, label: "Cartera fría" }, null, 2);
    expect(bytesToPayload(new TextEncoder().encode(text))).toBe((json.bip84 as { desc: string }).desc);
  });
  it("binary raw tx -> hex", () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    const raw = t.extract();
    expect(bytesToPayload(raw)).toBe(bytesToHex(raw));
  });
});

describe("readInputFile", () => {
  it("rejects files over 2 MB", async () => {
    const f = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "big.psbt");
    await expect(readInputFile(f)).rejects.toBeInstanceOf(InputFileError);
  });
  it("a multisig-only wallet export is rejected with reason multisig", async () => {
    const { json } = coldcardJson({ withMultisig: true });
    for (const k of ["bip44", "bip49", "bip84", "bip86"]) delete json[k];
    const bytes = new TextEncoder().encode(JSON.stringify(json));
    expect(() => bytesToPayload(bytes)).toThrow(InputFileError);
    await expect(readInputFile(new File([bytes], "wallet.json"))).rejects.toMatchObject({ reason: "multisig" });
  });
  it("reads a .psbt file", async () => {
    const bytes = buildPsbt({ sign: false }).toPSBT();
    expect(await readInputFile(new File([new Uint8Array(bytes)], "tx.psbt"))).toBe(bytesToHex(bytes));
  });
});
