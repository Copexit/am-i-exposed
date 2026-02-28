import { describe, it, expect } from "vitest";
import { detectInputType, cleanInput } from "../detect-input";

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

  it("truncates at 512 chars", () => {
    const long = "a".repeat(600);
    expect(cleanInput(long).length).toBe(512);
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
