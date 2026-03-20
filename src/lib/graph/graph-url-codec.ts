/**
 * Binary encode/decode for sharing graph structures via URL hash.
 *
 * Format (all multi-byte integers are big-endian):
 *
 *   Header (5 bytes):
 *     [0]     version       uint8  = 1
 *     [1-2]   nodeCount     uint16
 *     [3-4]   rootIndex     uint16 (index of rootTxid in node table)
 *
 *   Multi-root section (variable):
 *     [0-1]   multiRootCount uint16
 *     [2..]   multiRootCount * uint16 indices
 *
 *   Network (1 byte):
 *     0 = mainnet, 1 = testnet4, 2 = signet
 *
 *   Node table (nodeCount entries, each 37 bytes):
 *     [0-31]  txid       32 raw bytes
 *     [32]    depth      int8 (signed)
 *     [33]    flags      uint8 (bit0 = hasParentEdge, bit1 = hasChildEdge)
 *     [34-35] edgeRef    uint16 (index of related txid, 0xFFFF if none)
 *     [36]    edgeIndex  uint8 (outputIndex or inputIndex)
 */

import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import type { SavedGraph, SavedGraphNode } from "./saved-graph-types";

const MAX_URL_LENGTH = 4000;
const NETWORK_MAP: BitcoinNetwork[] = ["mainnet", "testnet4", "signet"];

// ─── Helpers ────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array, offset: number): string {
  let hex = "";
  for (let i = 0; i < 32; i++) {
    hex += bytes[offset + i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** Standard base64url encoding (no padding). */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Standard base64url decoding. */
function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── Encode ─────────────────────────────────────────────────────────

/**
 * Encode a saved graph into a base64url string for URL sharing.
 * Returns null if the result exceeds MAX_URL_LENGTH characters.
 */
export function encodeGraphToUrl(saved: SavedGraph): string | null {
  const nodes = saved.nodes;
  const nodeCount = nodes.length;
  if (nodeCount === 0) return null;

  // Build txid -> index lookup
  const txidToIdx = new Map<string, number>();
  for (let i = 0; i < nodeCount; i++) {
    txidToIdx.set(nodes[i].txid, i);
  }

  const rootIndex = txidToIdx.get(saved.rootTxid) ?? 0;
  const multiRoots = saved.rootTxids
    .map((t) => txidToIdx.get(t))
    .filter((i): i is number => i !== undefined);

  // Calculate buffer size
  const headerSize = 5;
  const multiRootSize = 2 + multiRoots.length * 2;
  const networkSize = 1;
  const nodeTableSize = nodeCount * 37;
  const totalSize = headerSize + multiRootSize + networkSize + nodeTableSize;

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let offset = 0;

  // Header
  buf[offset++] = 1; // version
  view.setUint16(offset, nodeCount); offset += 2;
  view.setUint16(offset, rootIndex); offset += 2;

  // Multi-root
  view.setUint16(offset, multiRoots.length); offset += 2;
  for (const idx of multiRoots) {
    view.setUint16(offset, idx); offset += 2;
  }

  // Network
  buf[offset++] = Math.max(0, NETWORK_MAP.indexOf(saved.network));

  // Node table
  for (const node of nodes) {
    const txidBytes = hexToBytes(node.txid);
    buf.set(txidBytes, offset); offset += 32;

    // depth as signed int8
    view.setInt8(offset, node.depth); offset += 1;

    // flags
    let flags = 0;
    if (node.parentEdge) flags |= 1;
    if (node.childEdge) flags |= 2;
    buf[offset++] = flags;

    // edge reference
    if (node.parentEdge) {
      const refIdx = txidToIdx.get(node.parentEdge.fromTxid) ?? 0xFFFF;
      view.setUint16(offset, refIdx); offset += 2;
      buf[offset++] = node.parentEdge.outputIndex & 0xFF;
    } else if (node.childEdge) {
      const refIdx = txidToIdx.get(node.childEdge.toTxid) ?? 0xFFFF;
      view.setUint16(offset, refIdx); offset += 2;
      buf[offset++] = node.childEdge.inputIndex & 0xFF;
    } else {
      view.setUint16(offset, 0xFFFF); offset += 2;
      buf[offset++] = 0;
    }
  }

  const encoded = toBase64Url(buf);
  if (encoded.length > MAX_URL_LENGTH) return null;
  return encoded;
}

// ─── Decode ─────────────────────────────────────────────────────────

/**
 * Decode a base64url string back into graph structure.
 * Returns null on any parse error.
 */
export function decodeGraphFromUrl(
  encoded: string,
): Omit<SavedGraph, "id" | "name" | "savedAt"> | null {
  try {
    const buf = fromBase64Url(encoded);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let offset = 0;

    // Header
    const version = buf[offset++];
    if (version !== 1) return null;

    const nodeCount = view.getUint16(offset); offset += 2;
    const rootIndex = view.getUint16(offset); offset += 2;

    // Multi-root
    const multiRootCount = view.getUint16(offset); offset += 2;
    const multiRootIndices: number[] = [];
    for (let i = 0; i < multiRootCount; i++) {
      multiRootIndices.push(view.getUint16(offset)); offset += 2;
    }

    // Network
    const networkByte = buf[offset++];
    const network: BitcoinNetwork = NETWORK_MAP[networkByte] ?? "mainnet";

    // Node table - first pass: read txids
    const txids: string[] = [];
    const nodeStartOffset = offset;
    for (let i = 0; i < nodeCount; i++) {
      txids.push(bytesToHex(buf, offset));
      offset += 37; // skip full entry
    }

    // Second pass: read full node data
    offset = nodeStartOffset;
    const nodes: SavedGraphNode[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const txid = txids[i];
      offset += 32; // skip txid bytes

      const depth = view.getInt8(offset); offset += 1;
      const flags = buf[offset++];
      const edgeRefIdx = view.getUint16(offset); offset += 2;
      const edgeIndex = buf[offset++];

      const node: SavedGraphNode = { txid, depth };

      if ((flags & 1) && edgeRefIdx !== 0xFFFF && edgeRefIdx < nodeCount) {
        node.parentEdge = { fromTxid: txids[edgeRefIdx], outputIndex: edgeIndex };
      }
      if ((flags & 2) && edgeRefIdx !== 0xFFFF && edgeRefIdx < nodeCount) {
        node.childEdge = { toTxid: txids[edgeRefIdx], inputIndex: edgeIndex };
      }

      nodes.push(node);
    }

    const rootTxid = txids[rootIndex] ?? txids[0];
    const rootTxids = multiRootIndices
      .filter((i) => i < nodeCount)
      .map((i) => txids[i]);

    if (rootTxids.length === 0) rootTxids.push(rootTxid);

    return { network, rootTxid, rootTxids, nodes };
  } catch {
    return null;
  }
}
