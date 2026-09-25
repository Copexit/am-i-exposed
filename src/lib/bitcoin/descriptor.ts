/**
 * BIP32 xpub / Output Descriptor Parser
 *
 * Parses extended public keys (xpub, ypub, zpub, tpub, upub, vpub) and
 * output descriptors to derive Bitcoin addresses for wallet-level analysis.
 *
 * Supports:
 * - BIP44 (P2PKH) - xpub/tpub
 * - BIP49 (P2SH-P2WPKH) - ypub/upub
 * - BIP84 (P2WPKH) - zpub/vpub
 * - BIP86 (P2TR) - xpub/tpub with explicit path
 * - Output descriptors: pkh(), sh(wpkh()), wpkh(), tr()
 */

import { HDKey } from "@scure/bip32";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { bech32, bech32m, createBase58check } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "./hex";

const b58check = createBase58check(sha256);

// ---------- Types ----------

export type ScriptType = "p2pkh" | "p2sh-p2wpkh" | "p2wpkh" | "p2tr";

export interface DerivedAddress {
  /** BIP32 derivation path relative to xpub (e.g. "0/0", "1/3") */
  path: string;
  /** Derived Bitcoin address string */
  address: string;
  /** Whether this is a change address (path starts with 1/) */
  isChange: boolean;
  /** Index within the receive or change chain */
  index: number;
}

export interface DescriptorParseResult {
  /** The script type implied by the descriptor/xpub version */
  scriptType: ScriptType;
  /** Network: mainnet or testnet */
  network: "mainnet" | "testnet";
  /** Derived receive addresses (0/0..0/n) */
  receiveAddresses: DerivedAddress[];
  /** Derived change addresses (1/0..1/n) */
  changeAddresses: DerivedAddress[];
  /** The raw xpub/ypub/zpub string */
  xpub: string;
}

// ---------- Version byte detection ----------

/** Version bytes for extended public keys (4 bytes, big-endian). */
const XPUB_VERSIONS: Record<string, {
  network: "mainnet" | "testnet";
  scriptType: ScriptType;
  /** Public version int for HDKey. */
  publicVersion: number;
  /** Private version int for HDKey (unused, but required by API). */
  privateVersion: number;
}> = {
  "0488b21e": { network: "mainnet", scriptType: "p2pkh", publicVersion: 0x0488B21E, privateVersion: 0x0488ADE4 },   // xpub
  "049d7cb2": { network: "mainnet", scriptType: "p2sh-p2wpkh", publicVersion: 0x049D7CB2, privateVersion: 0x049D7878 }, // ypub
  "04b24746": { network: "mainnet", scriptType: "p2wpkh", publicVersion: 0x04B24746, privateVersion: 0x04B2430C },  // zpub
  "043587cf": { network: "testnet", scriptType: "p2pkh", publicVersion: 0x043587CF, privateVersion: 0x04358394 },   // tpub
  "044a5262": { network: "testnet", scriptType: "p2sh-p2wpkh", publicVersion: 0x044A5262, privateVersion: 0x044A4E28 }, // upub
  "045f1cf6": { network: "testnet", scriptType: "p2wpkh", publicVersion: 0x045F1CF6, privateVersion: 0x045F18BC },  // vpub
};

/** Detect network, script type, and version bytes from xpub string. */
function detectXpubVersion(xpubStr: string): {
  network: "mainnet" | "testnet";
  scriptType: ScriptType;
  publicVersion: number;
  privateVersion: number;
} {
  const decoded = b58check.decode(xpubStr);
  const versionHex = bytesToHex(decoded.slice(0, 4));
  const info = XPUB_VERSIONS[versionHex];
  if (!info) {
    throw new Error(`Unknown xpub version: 0x${versionHex}`);
  }
  return info;
}

// ---------- Address derivation from public key ----------

/** Hash160 = RIPEMD160(SHA256(data)) */
function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

/** Derive a P2PKH address from a compressed public key. */
function pubkeyToP2PKH(pubkey: Uint8Array, testnet: boolean): string {
  const h = hash160(pubkey);
  const payload = new Uint8Array(21);
  payload[0] = testnet ? 0x6f : 0x00;
  payload.set(h, 1);
  return b58check.encode(payload);
}

/** Derive a P2SH-P2WPKH address from a compressed public key. */
function pubkeyToP2SH_P2WPKH(pubkey: Uint8Array, testnet: boolean): string {
  const keyhash = hash160(pubkey);
  // Witness script: OP_0 <20-byte keyhash>
  const witnessScript = new Uint8Array(22);
  witnessScript[0] = 0x00; // OP_0
  witnessScript[1] = 0x14; // PUSH 20 bytes
  witnessScript.set(keyhash, 2);
  const scriptHash = hash160(witnessScript);
  const payload = new Uint8Array(21);
  payload[0] = testnet ? 0xc4 : 0x05;
  payload.set(scriptHash, 1);
  return b58check.encode(payload);
}

/** Derive a P2WPKH (bech32) address from a compressed public key. */
function pubkeyToP2WPKH(pubkey: Uint8Array, testnet: boolean): string {
  const keyhash = hash160(pubkey);
  const words = bech32.toWords(keyhash);
  // Prepend witness version 0
  words.unshift(0);
  return bech32.encode(testnet ? "tb" : "bc", words);
}

/** Tagged hash as per BIP340: SHA256(SHA256(tag) || SHA256(tag) || msg) */
function taggedHash(tag: string, msg: Uint8Array): Uint8Array {
  const tagHash = sha256(new TextEncoder().encode(tag));
  const buf = new Uint8Array(tagHash.length + tagHash.length + msg.length);
  buf.set(tagHash, 0);
  buf.set(tagHash, tagHash.length);
  buf.set(msg, tagHash.length * 2);
  return sha256(buf);
}

/** Derive a P2TR (bech32m) address from a compressed public key using BIP86 key-path. */
function pubkeyToP2TR(pubkey: Uint8Array, testnet: boolean): string {
  // Get x-only public key (drop the 02/03 prefix byte)
  const xOnly = pubkey.slice(1);

  // BIP86: tweak = tagged_hash("TapTweak", x_only_pubkey) with no script tree
  const tweak = taggedHash("TapTweak", xOnly);

  // BIP341 requires even-y internal key for correct Taproot tweaking.
  // If the derived pubkey has odd y (03 prefix), negate it first.
  let P = secp256k1.Point.fromHex(bytesToHex(pubkey));
  if (pubkey[0] === 0x03) {
    P = P.negate();
  }
  const t = BigInt("0x" + bytesToHex(tweak));
  const tG = secp256k1.Point.BASE.multiply(t);
  const Q = P.add(tG);

  // Get the x-coordinate of Q (even y enforced by bip340)
  const qBytes = Q.toBytes(true); // compressed
  const xOnlyQ = qBytes.slice(1); // drop prefix

  const words = bech32m.toWords(xOnlyQ);
  words.unshift(1); // witness version 1
  return bech32m.encode(testnet ? "tb" : "bc", words);
}

/** Derive address from pubkey based on script type. */
function pubkeyToAddress(
  pubkey: Uint8Array,
  scriptType: ScriptType,
  testnet: boolean,
): string {
  switch (scriptType) {
    case "p2pkh":
      return pubkeyToP2PKH(pubkey, testnet);
    case "p2sh-p2wpkh":
      return pubkeyToP2SH_P2WPKH(pubkey, testnet);
    case "p2wpkh":
      return pubkeyToP2WPKH(pubkey, testnet);
    case "p2tr":
      return pubkeyToP2TR(pubkey, testnet);
  }
}

// ---------- Descriptor parsing ----------

// BIP-380 descriptor checksum
const DESCSUM_INPUT_CHARSET =
  "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const DESCSUM_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const DESCSUM_GENERATOR = [0xf5dee51989, 0xa9fdca3312, 0x1bab10e32d, 0x3706b1677a, 0x644d626ffd];

/** XOR of two 40-bit values held in plain numbers (JS bitwise ops are 32-bit). */
function xor40(a: number, b: number): number {
  const hi = (Math.floor(a / 2 ** 32) ^ Math.floor(b / 2 ** 32)) * 2 ** 32;
  return hi + ((a ^ b) >>> 0);
}

function descsumPolymod(symbols: number[]): number {
  let chk = 1;
  for (const value of symbols) {
    const top = Math.floor(chk / 2 ** 35);
    chk = (chk % 2 ** 35) * 32 + value; // low 5 bits are zero, so + is ^
    for (const [i, gen] of DESCSUM_GENERATOR.entries()) {
      if ((top >> i) & 1) chk = xor40(chk, gen);
    }
  }
  return chk;
}

/** Compute the 8-char BIP-380 checksum of a descriptor body, or null if it has invalid characters. */
export function descriptorChecksum(body: string): string | null {
  const symbols: number[] = [];
  // Base-3 accumulator of up to 3 high-bit groups (g0 * 9 + g1 * 3 + g2)
  let group = 0;
  let groupCount = 0;
  for (const c of body) {
    const v = DESCSUM_INPUT_CHARSET.indexOf(c);
    if (v < 0) return null;
    symbols.push(v & 31);
    group = group * 3 + (v >> 5);
    if (++groupCount === 3) {
      symbols.push(group);
      group = 0;
      groupCount = 0;
    }
  }
  if (groupCount > 0) symbols.push(group);

  const chk = xor40(descsumPolymod([...symbols, 0, 0, 0, 0, 0, 0, 0, 0]), 1);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += DESCSUM_CHARSET.charAt(Math.floor(chk / 2 ** (5 * (7 - i))) % 32);
  }
  return out;
}

/** Supported wrappers, with exactly balanced parentheses. */
const DESCRIPTOR_WRAPPERS: { open: string; close: string; scriptType: ScriptType }[] = [
  { open: "pkh(", close: ")", scriptType: "p2pkh" },
  { open: "wpkh(", close: ")", scriptType: "p2wpkh" },
  { open: "tr(", close: ")", scriptType: "p2tr" },
  { open: "sh(wpkh(", close: "))", scriptType: "p2sh-p2wpkh" },
];

/** Key expression: optional [fingerprint/origin], xpub, optional /0/*, /1/* or /<0;1>/* (BIP-389) */
const DESCRIPTOR_KEY_RE =
  /^(?:\[[a-fA-F0-9]{8}(?:\/\d+['h]?)*\])?([xyztuv]pub[1-9A-HJ-NP-Za-km-z]+)(?:\/(0|1|<0;1>)\/\*)?$/;

interface ParsedDescriptor {
  scriptType: ScriptType;
  xpub: string;
  /** Fixed chain index from descriptor (e.g. 0 for receive, 1 for change) */
  chainIndex?: number;
  /** The "#..." checksum suffix, if present (not yet validated) */
  checksum?: string;
  /** Descriptor without the checksum suffix */
  body: string;
}

/** Structural match of a supported descriptor. Does not validate the checksum. */
function matchDescriptor(descriptor: string): ParsedDescriptor | null {
  const trimmed = descriptor.trim();
  const hash = trimmed.indexOf("#");
  const body = hash < 0 ? trimmed : trimmed.slice(0, hash);
  const checksum = hash < 0 ? undefined : trimmed.slice(hash + 1);

  const wrapper = DESCRIPTOR_WRAPPERS.find((w) => body.startsWith(w.open) && body.endsWith(w.close));
  if (!wrapper) return null;
  const m = DESCRIPTOR_KEY_RE.exec(body.slice(wrapper.open.length, body.length - wrapper.close.length));
  const [, xpub, chain] = m ?? [];
  if (!xpub) return null;

  // "<0;1>" (multipath) derives both chains, same as no chain at all
  const chainIndex = chain !== undefined && chain !== "<0;1>" ? parseInt(chain, 10) : undefined;
  return { scriptType: wrapper.scriptType, xpub, chainIndex, checksum, body };
}

function parseDescriptor(descriptor: string): ParsedDescriptor | null {
  const desc = matchDescriptor(descriptor);
  if (desc?.checksum !== undefined) {
    if (!new RegExp(`^[${DESCSUM_CHARSET}]{8}$`).test(desc.checksum)) {
      throw new Error("Invalid descriptor checksum format: expected 8 characters after '#'");
    }
    if (descriptorChecksum(desc.body) !== desc.checksum) {
      throw new Error("Descriptor checksum mismatch: the descriptor may be mistyped or truncated");
    }
  }
  return desc;
}

// ---------- Public API ----------

/** Check if a string looks like an xpub, ypub, zpub, tpub, upub, or vpub. */
export function isExtendedPubkey(input: string): boolean {
  return /^[xyztuv]pub[a-zA-Z0-9]{100,120}$/.test(input);
}

/**
 * Check if a string is a supported output descriptor. Accepts exactly what
 * parseXpub() parses; the checksum is validated there, so a bad checksum
 * still routes to the parser and gets a specific error.
 */
export function isDescriptor(input: string): boolean {
  return matchDescriptor(input) !== null;
}

/** Check if input is an xpub or descriptor (for input type detection). */
export function isXpubOrDescriptor(input: string): boolean {
  return isExtendedPubkey(input) || isDescriptor(input);
}

/**
 * Parsed xpub/descriptor ready for incremental derivation.
 * Use with `deriveOneAddress()` for on-demand address derivation.
 */
export interface ParsedXpub {
  hdKey: HDKey;
  scriptType: ScriptType;
  network: "mainnet" | "testnet";
  xpub: string;
  /** If set, only derive this chain (0=receive, 1=change). */
  singleChain?: number;
}

/**
 * Parse an xpub/descriptor without deriving any addresses.
 * Returns an object that can be passed to `deriveOneAddress()`.
 */
export function parseXpub(
  input: string,
  scriptTypeOverride?: ScriptType,
): ParsedXpub {
  let xpubStr: string;
  let scriptType: ScriptType;
  let network: "mainnet" | "testnet";
  let singleChain: number | undefined;
  let publicVersion: number;
  let privateVersion: number;

  const desc = parseDescriptor(input);
  if (desc) {
    xpubStr = desc.xpub;
    scriptType = desc.scriptType;
    singleChain = desc.chainIndex;
    const version = detectXpubVersion(desc.xpub);
    network = version.network;
    publicVersion = version.publicVersion;
    privateVersion = version.privateVersion;
  } else if (isExtendedPubkey(input)) {
    xpubStr = input;
    const version = detectXpubVersion(input);
    network = version.network;
    scriptType = scriptTypeOverride ?? version.scriptType;
    publicVersion = version.publicVersion;
    privateVersion = version.privateVersion;
  } else {
    throw new Error("Invalid xpub or descriptor format");
  }

  const hdKey = HDKey.fromExtendedKey(xpubStr, {
    public: publicVersion,
    private: privateVersion,
  });

  return { hdKey, scriptType, network, xpub: xpubStr, singleChain };
}

/**
 * Derive a single address at the given chain (0=receive, 1=change) and index.
 */
export function deriveOneAddress(
  parsed: ParsedXpub,
  chain: 0 | 1,
  index: number,
): DerivedAddress {
  const child = parsed.hdKey.deriveChild(chain).deriveChild(index);
  if (!child.publicKey) throw new Error(`Failed to derive key at ${chain}/${index}`);
  return {
    path: `${chain}/${index}`,
    address: pubkeyToAddress(child.publicKey, parsed.scriptType, parsed.network === "testnet"),
    isChange: chain === 1,
    index,
  };
}

/**
 * Parse an xpub string or output descriptor and derive addresses.
 *
 * @param input - xpub/ypub/zpub/tpub/upub/vpub string, or output descriptor
 * @param gapLimit - number of addresses to derive per chain (default 20)
 * @param scriptTypeOverride - force a specific script type (for raw xpub with BIP86)
 */
export function parseAndDerive(
  input: string,
  gapLimit = 20,
  scriptTypeOverride?: ScriptType,
): DescriptorParseResult {
  const parsed = parseXpub(input, scriptTypeOverride);

  const receiveAddresses: DerivedAddress[] = [];
  const changeAddresses: DerivedAddress[] = [];

  // Derive receive addresses (chain 0)
  if (parsed.singleChain === undefined || parsed.singleChain === 0) {
    for (let i = 0; i < gapLimit; i++) {
      receiveAddresses.push(deriveOneAddress(parsed, 0, i));
    }
  }

  // Derive change addresses (chain 1)
  if (parsed.singleChain === undefined || parsed.singleChain === 1) {
    for (let i = 0; i < gapLimit; i++) {
      changeAddresses.push(deriveOneAddress(parsed, 1, i));
    }
  }

  return {
    scriptType: parsed.scriptType,
    network: parsed.network,
    receiveAddresses,
    changeAddresses,
    xpub: parsed.xpub,
  };
}
