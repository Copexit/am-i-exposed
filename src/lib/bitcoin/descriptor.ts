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
import { bech32, bech32m, createBase58check, hex as hexCodec } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1.js";

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

// ---------- Helpers ----------

/** Convert Uint8Array to hex string (browser-safe, no Buffer). */
function toHex(bytes: Uint8Array): string {
  return hexCodec.encode(bytes);
}

/** Convert hex string to BigInt. */
function hexToBigInt(h: string): bigint {
  return BigInt("0x" + h);
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
  const versionHex = toHex(decoded.slice(0, 4));
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
  let P = secp256k1.Point.fromHex(toHex(pubkey));
  if (pubkey[0] === 0x03) {
    P = P.negate();
  }
  const t = hexToBigInt(toHex(tweak));
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

/** Match output descriptor patterns: pkh(xpub/...), wpkh(xpub/...), sh(wpkh(xpub/...)), tr(xpub/...) */
const DESCRIPTOR_RE =
  /^(?:(pkh|wpkh|tr)\(|sh\(wpkh\()(?:\[([a-f0-9]{8})(?:\/[0-9'h]+)*\])?((?:[xyztuvw]pub|tpub)[a-zA-Z0-9]+)(?:\/(\d+)\/\*)?(?:\))+$/;

interface ParsedDescriptor {
  scriptType: ScriptType;
  xpub: string;
  /** Fixed chain index from descriptor (e.g. 0 for receive, 1 for change) */
  chainIndex?: number;
}

function parseDescriptor(descriptor: string): ParsedDescriptor | null {
  const clean = descriptor.replace(/#[a-f0-9]+$/, "").trim(); // strip checksum
  const m = DESCRIPTOR_RE.exec(clean);
  if (!m) return null;

  const funcName = m[1]; // pkh, wpkh, tr, or undefined (sh(wpkh(...)))
  const xpub = m[3];
  const chainIdx = m[4] !== undefined ? parseInt(m[4], 10) : undefined;

  let scriptType: ScriptType;
  if (!funcName) {
    // sh(wpkh(...))
    scriptType = "p2sh-p2wpkh";
  } else {
    switch (funcName) {
      case "pkh": scriptType = "p2pkh"; break;
      case "wpkh": scriptType = "p2wpkh"; break;
      case "tr": scriptType = "p2tr"; break;
      default: return null;
    }
  }

  return { scriptType, xpub, chainIndex: chainIdx };
}

// ---------- Public API ----------

/** Check if a string looks like an xpub, ypub, zpub, tpub, upub, or vpub. */
export function isExtendedPubkey(input: string): boolean {
  return /^[xyztuvw]pub[a-zA-Z0-9]{100,120}$/.test(input) ||
    /^tpub[a-zA-Z0-9]{100,120}$/.test(input);
}

/** Check if a string looks like an output descriptor. */
export function isDescriptor(input: string): boolean {
  return /^(pkh|wpkh|tr|sh)\(/.test(input);
}

/** Check if input is an xpub or descriptor (for input type detection). */
export function isXpubOrDescriptor(input: string): boolean {
  return isExtendedPubkey(input) || isDescriptor(input);
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
  let xpubStr: string;
  let scriptType: ScriptType;
  let network: "mainnet" | "testnet";
  let singleChain: number | undefined;
  let publicVersion: number;
  let privateVersion: number;

  // Try descriptor format first
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
  const testnet = network === "testnet";

  const receiveAddresses: DerivedAddress[] = [];
  const changeAddresses: DerivedAddress[] = [];

  // Derive receive addresses (chain 0)
  if (singleChain === undefined || singleChain === 0) {
    for (let i = 0; i < gapLimit; i++) {
      const child = hdKey.deriveChild(0).deriveChild(i);
      if (!child.publicKey) throw new Error(`Failed to derive key at 0/${i}`);
      receiveAddresses.push({
        path: `0/${i}`,
        address: pubkeyToAddress(child.publicKey, scriptType, testnet),
        isChange: false,
        index: i,
      });
    }
  }

  // Derive change addresses (chain 1)
  if (singleChain === undefined || singleChain === 1) {
    for (let i = 0; i < gapLimit; i++) {
      const child = hdKey.deriveChild(1).deriveChild(i);
      if (!child.publicKey) throw new Error(`Failed to derive key at 1/${i}`);
      changeAddresses.push({
        path: `1/${i}`,
        address: pubkeyToAddress(child.publicKey, scriptType, testnet),
        isChange: true,
        index: i,
      });
    }
  }

  return {
    scriptType,
    network,
    receiveAddresses,
    changeAddresses,
    xpub: xpubStr,
  };
}
