import { describe, it, expect } from "vitest";
import { base64 } from "@scure/base";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt } from "@/lib/input/__tests__/fixtures";
import { cleanInput, detectInputType, MAX_PAYLOAD_LENGTH } from "../detect-input";

describe("detectInputType", () => {
  // txid: 64 hex chars
  it("detects txid (64 hex chars)", () => {
    const txid = "a".repeat(64);
    expect(detectInputType(txid)).toBe("txid");
  });

  it("detects txid with mixed case hex", () => {
    const txid = "aAbBcCdDeEfF" + "0".repeat(52);
    expect(detectInputType(txid)).toBe("txid");
  });

  // Mainnet addresses
  it("detects bc1q address (P2WPKH mainnet)", () => {
    expect(detectInputType("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe("address");
  });

  it("detects bc1p address (P2TR mainnet)", () => {
    expect(detectInputType("bc1p" + "a".repeat(58))).toBe("address");
  });

  it("detects 1... address (P2PKH mainnet)", () => {
    expect(detectInputType("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe("address");
  });

  it("detects 3... address (P2SH mainnet)", () => {
    expect(detectInputType("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe("address");
  });

  // Testnet addresses
  it("detects tb1q address (testnet)", () => {
    expect(detectInputType("tb1q" + "q".repeat(38))).toBe("address");
  });

  it("detects tb1p address (testnet P2TR)", () => {
    expect(detectInputType("tb1p" + "q".repeat(58))).toBe("address");
  });

  it("detects m... address (testnet P2PKH)", () => {
    expect(detectInputType("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn")).toBe("address");
  });

  it("detects 2... address (testnet P2SH)", () => {
    expect(detectInputType("2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc")).toBe("address");
  });

  // URL extraction
  it("extracts txid from mempool.space URL", () => {
    expect(detectInputType("https://mempool.space/tx/" + "a".repeat(64))).toBe("txid");
  });

  it("extracts address from mempool.space URL", () => {
    expect(detectInputType("https://mempool.space/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe("address");
  });

  // xpub / descriptor inputs
  it("detects xpub as xpub type", () => {
    expect(detectInputType(
      "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8",
    )).toBe("xpub");
  });

  it("detects zpub as xpub type", () => {
    expect(detectInputType(
      "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs",
    )).toBe("xpub");
  });

  it("detects wpkh descriptor as xpub type", () => {
    expect(detectInputType("wpkh(xpub6CUG/0/*)")).toBe("xpub");
  });

  // PSBT inputs
  it("detects base64 PSBT", () => {
    expect(detectInputType("cHNidP8BAFICAAAAAQEBAQEBAQEBx")).toBe("psbt");
  });

  it("detects hex PSBT", () => {
    expect(detectInputType("70736274ff0100520200000001")).toBe("psbt");
  });

  // Invalid inputs
  it("returns invalid for short hex", () => {
    expect(detectInputType("abc123")).toBe("invalid");
  });

  it("returns invalid for random string", () => {
    expect(detectInputType("hello world")).toBe("invalid");
  });

  it("returns invalid for empty string", () => {
    expect(detectInputType("")).toBe("invalid");
  });
});

describe("cleanInput", () => {
  it("strips control characters", () => {
    expect(cleanInput("\x00abc\x1f")).toBe("abc");
  });

  it("strips zero-width characters", () => {
    expect(cleanInput("abc\u200bdef\u200f")).toBe("abcdef");
  });

  it("trims whitespace", () => {
    expect(cleanInput("  abc  ")).toBe("abc");
  });

  it("extracts txid from URL", () => {
    const txid = "b".repeat(64);
    expect(cleanInput(`https://mempool.space/tx/${txid}`)).toBe(txid);
  });

  it("extracts address from URL", () => {
    const addr = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
    expect(cleanInput(`https://mempool.space/address/${addr}`)).toBe(addr);
  });
});

describe("cleanInput payloads", () => {
  it("still caps short, non-payload input at 512 chars", () => {
    expect(cleanInput("x".repeat(600))).toHaveLength(512);
  });

  it("keeps a full PSBT longer than 512 chars", () => {
    const b64 = base64.encode(buildPsbt({ sign: false, nonWitness: true }).toPSBT());
    expect(b64.length).toBeGreaterThan(512);
    expect(cleanInput(b64)).toBe(b64);
  });

  it("joins a line-wrapped base64 PSBT", () => {
    const b64 = base64.encode(buildPsbt({ sign: false, nonWitness: true }).toPSBT());
    const wrapped = (b64.match(/.{1,64}/g) ?? []).join("\n") + "\n";
    expect(cleanInput(wrapped)).toBe(b64);
    expect(cleanInput((b64.match(/.{1,76}/g) ?? []).join(" "))).toBe(b64);
  });

  it("caps payloads at MAX_PAYLOAD_LENGTH", () => {
    expect(cleanInput("cHNidP" + "A".repeat(MAX_PAYLOAD_LENGTH))).toHaveLength(MAX_PAYLOAD_LENGTH);
  });

  it("takes the address from a BIP21 URI and lowercases uppercase bech32", () => {
    expect(cleanInput("bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?amount=0.1")).toBe("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
    expect(cleanInput("BITCOIN:BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4")).toBe("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
    expect(cleanInput("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4")).toBe("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
  });
});

describe("detectInputType rawtx", () => {
  it("detects a signed raw tx", () => {
    const t = buildPsbt({ sign: true });
    t.finalize();
    expect(detectInputType(bytesToHex(t.extract()))).toBe("rawtx");
  });
  it("random even hex is invalid, not rawtx", () => {
    expect(detectInputType("00".repeat(80))).toBe("invalid");
    expect(detectInputType("0100000000".repeat(30))).toBe("invalid");
    expect(detectInputType("ff".repeat(1000))).toBe("invalid");
  });
  it("64-hex stays a txid and PSBT hex stays psbt", () => {
    expect(detectInputType("a".repeat(64))).toBe("txid");
    expect(detectInputType(bytesToHex(buildPsbt({ sign: false }).toPSBT()))).toBe("psbt");
  });
});
