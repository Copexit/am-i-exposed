import { describe, it, expect } from "vitest";
import { checkOfac } from "../ofac-check";

describe("checkOfac", () => {
  it("returns not sanctioned for random addresses", () => {
    const result = checkOfac(["bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"]);
    expect(result.checked).toBe(true);
    expect(result.sanctioned).toBe(false);
    expect(result.matchedAddresses).toHaveLength(0);
  });

  it("returns lastUpdated date string", () => {
    const result = checkOfac([]);
    expect(result.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("handles empty address array", () => {
    const result = checkOfac([]);
    expect(result.sanctioned).toBe(false);
    expect(result.matchedAddresses).toHaveLength(0);
  });

  it("detects known OFAC sanctioned address", () => {
    // First address in the bundled list
    const result = checkOfac(["123WBUDmSJv4GctdVEz6Qq6z8nXSKrJ4KX"]);
    expect(result.sanctioned).toBe(true);
    expect(result.matchedAddresses).toContain("123WBUDmSJv4GctdVEz6Qq6z8nXSKrJ4KX");
  });

  it("normalizes bech32 addresses to lowercase for comparison", () => {
    // Check a non-sanctioned bech32 address in mixed case
    const result = checkOfac(["BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4"]);
    expect(result.sanctioned).toBe(false);
  });

  it("does not lowercase legacy base58 addresses", () => {
    // Base58 addresses are case-sensitive - lowercasing would change the checksum
    const result = checkOfac(["123wbudmsjv4gctdvez6qq6z8nxskrj4kx"]);
    // Lowercase version should NOT match the real address
    expect(result.sanctioned).toBe(false);
  });
});
