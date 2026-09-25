import { describe, it, expect } from "vitest";
import {
  parseAndDerive,
  isExtendedPubkey,
  isDescriptor,
  isXpubOrDescriptor,
  descriptorChecksum,
} from "../descriptor";

describe("isExtendedPubkey", () => {
  it("recognizes xpub", () => {
    expect(isExtendedPubkey(
      "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8",
    )).toBe(true);
  });

  it("recognizes zpub", () => {
    expect(isExtendedPubkey(
      "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs",
    )).toBe(true);
  });

  it("rejects short strings", () => {
    expect(isExtendedPubkey("xpub123")).toBe(false);
  });

  it("rejects addresses", () => {
    expect(isExtendedPubkey("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe(false);
  });
});

describe("isDescriptor", () => {
  it("recognizes wpkh descriptor", () => {
    expect(isDescriptor("wpkh(xpub6CUG/0/*)")).toBe(true);
  });

  it("recognizes sh(wpkh()) descriptor", () => {
    expect(isDescriptor("sh(wpkh(xpub6CUG/0/*))")).toBe(true);
  });

  it("rejects plain xpub", () => {
    expect(isDescriptor(
      "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8",
    )).toBe(false);
  });
});

describe("isXpubOrDescriptor", () => {
  it("matches xpub", () => {
    expect(isXpubOrDescriptor(
      "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8",
    )).toBe(true);
  });

  it("matches descriptor", () => {
    expect(isXpubOrDescriptor("wpkh(xpub6CUG/0/*)")).toBe(true);
  });
});

describe("parseAndDerive", () => {
  // BIP84 test vector from BIP84 spec (zpub)
  // Account xpub for m/84'/0'/0' from mnemonic:
  // "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  const zpub =
    "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

  it("derives BIP84 receive addresses from zpub", () => {
    const result = parseAndDerive(zpub, 3);
    expect(result.scriptType).toBe("p2wpkh");
    expect(result.network).toBe("mainnet");
    expect(result.receiveAddresses).toHaveLength(3);
    expect(result.changeAddresses).toHaveLength(3);

    // BIP84 test vector: first receive address (m/84'/0'/0'/0/0)
    expect(result.receiveAddresses[0]?.address).toBe(
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    );
    expect(result.receiveAddresses[0]?.path).toBe("0/0");
    expect(result.receiveAddresses[0]?.isChange).toBe(false);

    // Second receive address (m/84'/0'/0'/0/1)
    expect(result.receiveAddresses[1]?.address).toBe(
      "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g",
    );
  });

  it("derives BIP84 change addresses from zpub", () => {
    const result = parseAndDerive(zpub, 2);
    expect(result.changeAddresses).toHaveLength(2);

    // BIP84 test vector: first change address (m/84'/0'/0'/1/0)
    expect(result.changeAddresses[0]?.address).toBe(
      "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el",
    );
    expect(result.changeAddresses[0]?.path).toBe("1/0");
    expect(result.changeAddresses[0]?.isChange).toBe(true);
  });

  // BIP32 Test Vector 1 - seed = 000102030405060708090a0b0c0d0e0f
  // Master public key (chain m)
  const xpubBip32 =
    "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";

  it("derives BIP44 (P2PKH) addresses from xpub", () => {
    const result = parseAndDerive(xpubBip32, 2);
    expect(result.scriptType).toBe("p2pkh");
    expect(result.network).toBe("mainnet");
    expect(result.receiveAddresses).toHaveLength(2);

    // Derived 0/0 P2PKH address
    expect(result.receiveAddresses[0]?.address).toBe(
      "12CL4K2eVqj7hQTix7dM7CVHCkpP17Pry3",
    );
  });

  it("rejects invalid input", () => {
    expect(() => parseAndDerive("not-an-xpub")).toThrow();
  });

  it("respects gapLimit parameter", () => {
    const result = parseAndDerive(zpub, 5);
    expect(result.receiveAddresses).toHaveLength(5);
    expect(result.changeAddresses).toHaveLength(5);
  });

  it("derives P2TR addresses when scriptType overridden", () => {
    const result = parseAndDerive(xpubBip32, 2, "p2tr");
    expect(result.scriptType).toBe("p2tr");
    expect(result.receiveAddresses[0]?.address).toMatch(/^bc1p/);
  });

  // BIP86 test vector: account xpub for m/86'/0'/0' from mnemonic:
  // "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  const xpubBip86 =
    "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";

  it("derives correct BIP86 P2TR addresses (even-y enforcement)", () => {
    const result = parseAndDerive(xpubBip86, 2, "p2tr");
    expect(result.scriptType).toBe("p2tr");

    // BIP86 test vector: first receive address (m/86'/0'/0'/0/0)
    expect(result.receiveAddresses[0]?.address).toBe(
      "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
    );

    // BIP86 test vector: first change address (m/86'/0'/0'/1/0)
    expect(result.changeAddresses[0]?.address).toBe(
      "bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7",
    );
  });

  it("parses wpkh descriptor", () => {
    const desc = `wpkh(${zpub}/0/*)`;
    const result = parseAndDerive(desc, 2);
    expect(result.scriptType).toBe("p2wpkh");
    expect(result.receiveAddresses).toHaveLength(2);
    // With chain index 0 specified, only receive addresses
    expect(result.changeAddresses).toHaveLength(0);
  });
});

// Bitcoin Core doc/descriptors.md example (BIP32 test vector 1 xpub, with checksum)
const CORE_PKH =
  "pkh([d34db33f/44'/0'/0']xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/1/*)";
const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

describe("descriptorChecksum (BIP-380)", () => {
  it("matches the BIP-380 test vector", () => {
    expect(descriptorChecksum("raw(deadbeef)")).toBe("89f8spxm");
  });

  it("matches the Bitcoin Core documentation example", () => {
    expect(descriptorChecksum(CORE_PKH)).toBe("ml40v0wf");
  });

  it("returns null for characters outside the descriptor charset", () => {
    // BIP-380 invalid vector: "raw(\u00dc)#00000000"
    expect(descriptorChecksum("raw(\u00dc)")).toBeNull();
  });
});

describe("parseAndDerive - descriptor checksum", () => {
  it("accepts a descriptor with a valid bech32-charset checksum", () => {
    const withSum = parseAndDerive(`${CORE_PKH}#ml40v0wf`, 2);
    const without = parseAndDerive(CORE_PKH, 2);
    expect(withSum.changeAddresses.map((a) => a.address)).toEqual(
      without.changeAddresses.map((a) => a.address),
    );
    expect(withSum.changeAddresses).toHaveLength(2);
    expect(withSum.receiveAddresses).toHaveLength(0);
  });

  it("rejects a descriptor with a wrong checksum", () => {
    expect(() => parseAndDerive(`${CORE_PKH}#ml40v0wq`, 2)).toThrow(/checksum/i);
  });

  it("rejects a malformed checksum", () => {
    expect(() => parseAndDerive(`${CORE_PKH}#ml40v0w`, 2)).toThrow(/checksum/i);
    expect(isDescriptor(`${CORE_PKH}#ml40v0w`)).toBe(true);
  });
});

describe("parseAndDerive - descriptor syntax", () => {
  it("expands <0;1>/* multipath into receive and change chains", () => {
    const multi = parseAndDerive(`wpkh([d34db33f/84h/0h/0h]${ZPUB}/<0;1>/*)`, 3);
    const bare = parseAndDerive(ZPUB, 3);
    expect(multi.receiveAddresses).toEqual(bare.receiveAddresses);
    expect(multi.changeAddresses).toEqual(bare.changeAddresses);
    expect(isDescriptor(`wpkh(${ZPUB}/<0;1>/*)`)).toBe(true);
  });

  it("rejects unbalanced parentheses", () => {
    for (const bad of [`wpkh(${ZPUB}/0/*)))`, `sh(wpkh(${ZPUB}/0/*)`, `sh(wpkh(${ZPUB}/0/*)))`]) {
      expect(isDescriptor(bad)).toBe(false);
      expect(() => parseAndDerive(bad, 1)).toThrow();
    }
  });

  it("does not claim unsupported descriptor types", () => {
    expect(isDescriptor(`sh(wsh(multi(1,${ZPUB}/0/*)))`)).toBe(false);
    expect(isDescriptor(`wsh(multi(1,${ZPUB}/0/*))`)).toBe(false);
  });
});
