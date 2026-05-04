/**
 * Binary encode/decode for sharing graph structures via URL hash.
 *
 * Version 2 format (all multi-byte integers are big-endian):
 *
 *   Header (5 bytes):
 *     [0]     version       uint8  = 2
 *     [1-2]   nodeCount     uint16
 *     [3-4]   rootIndex     uint16
 *
 *   Multi-root section (variable):
 *     [0-1]   multiRootCount uint16
 *     [2..]   multiRootCount * uint16 indices
 *
 *   Network (1 byte): 0=mainnet, 1=testnet4, 2=signet, 3=testnet3
 *
 *   Node table (nodeCount * 37 bytes):
 *     [0-31]  txid (32 raw bytes)
 *     [32]    depth (int8)
 *     [33]    flags (bit0=parentEdge, bit1=childEdge)
 *     [34-35] edgeRef (uint16, 0xFFFF=none)
 *     [36]    edgeIndex (uint8)
 *
 *   Extensions (v2):
 *     Node positions: count(uint16) + entries(nodeIdx:uint16, x:float32, y:float32)
 *     Node labels:    count(uint16) + entries(nodeIdx:uint16, len:uint8, utf8[len])
 *     Annotations:    count(uint16) + entries(type:uint8, x:float32, y:float32,
 *                     w:float32, h:float32, titleLen:uint8, utf8[titleLen])
 */

import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import type { SavedGraph, SavedGraphNode, GraphAnnotation } from "./saved-graph-types";

const MAX_URL_LENGTH = 6000;
const NETWORK_MAP: BitcoinNetwork[] = ["mainnet", "testnet4", "signet", "testnet3"];
const MAX_TITLE_BYTES = 60; // 20 chars * 3 bytes max for UTF-8
const TXID_BYTES = 32;
const NODE_RECORD_SIZE = 37; // 32 txid + 1 depth + 1 flags + 2 edgeRef + 1 edgeIndex
const NO_EDGE = 0xFFFF;

// ─── Helpers ────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(TXID_BYTES);
  for (let i = 0; i < TXID_BYTES; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array, offset: number): string {
  let hex = "";
  for (let i = 0; i < TXID_BYTES; i++) {
    hex += bytes[offset + i].toString(16).padStart(2, "0");
  }
  return hex;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function decodeUtf8(bytes: Uint8Array, offset: number, length: number): string {
  return new TextDecoder().decode(bytes.slice(offset, offset + length));
}

const ANNOTATION_TYPE_MAP: GraphAnnotation["type"][] = ["note", "rect", "circle"];

/** Write a capped UTF-8 label (uint8 length + bytes) into buf at offset. Returns new offset. */
function writeLabelBytes(buf: Uint8Array, offset: number, bytes: Uint8Array): number {
  const len = Math.min(bytes.length, MAX_TITLE_BYTES);
  buf[offset++] = len;
  buf.set(bytes.slice(0, MAX_TITLE_BYTES), offset);
  return offset + len;
}

/** Read a uint8-length-prefixed UTF-8 label from buf at offset. Returns [text, newOffset]. */
function readLabelBytes(buf: Uint8Array, offset: number): [string, number] {
  const len = buf[offset++];
  if (offset + len > buf.length) return ["", offset];
  const text = decodeUtf8(buf, offset, len);
  return [text, offset + len];
}

// ─── Encode ─────────────────────────────────────────────────────────

export function encodeGraphToUrl(saved: SavedGraph): string | null {
  const nodes = saved.nodes;
  const nodeCount = nodes.length;
  if (nodeCount === 0) return null;

  const txidToIdx = new Map<string, number>();
  for (let i = 0; i < nodeCount; i++) {
    txidToIdx.set(nodes[i].txid, i);
  }

  const rootIndex = txidToIdx.get(saved.rootTxid) ?? 0;
  const multiRoots = saved.rootTxids
    .map((t) => txidToIdx.get(t))
    .filter((i): i is number => i !== undefined);

  // Collect position overrides
  const posEntries: { idx: number; x: number; y: number }[] = [];
  if (saved.nodePositions) {
    for (const [txid, pos] of Object.entries(saved.nodePositions)) {
      const idx = txidToIdx.get(txid);
      if (idx !== undefined) posEntries.push({ idx, x: pos.x, y: pos.y });
    }
  }

  // Collect node labels (title only, max 20 chars)
  const nodeLabelEntries: { idx: number; bytes: Uint8Array }[] = [];
  if (saved.nodeLabels) {
    for (const [txid, label] of Object.entries(saved.nodeLabels)) {
      const idx = txidToIdx.get(txid);
      if (idx !== undefined && label) {
        const truncated = label.slice(0, 20);
        const bytes = encodeUtf8(truncated);
        nodeLabelEntries.push({ idx, bytes });
      }
    }
  }

  // Collect annotation titles (max 20 chars each)
  const annotEntries: { type: number; x: number; y: number; w: number; h: number; titleBytes: Uint8Array }[] = [];
  if (saved.annotations) {
    for (const a of saved.annotations) {
      const typeIdx = ANNOTATION_TYPE_MAP.indexOf(a.type);
      if (typeIdx < 0) continue;
      const titleBytes = encodeUtf8((a.title || "").slice(0, 20));
      annotEntries.push({
        type: typeIdx,
        x: a.x,
        y: a.y,
        w: a.width ?? (a.type === "circle" ? (a.radius ?? 50) : 180),
        h: a.height ?? (a.type === "circle" ? (a.radius ?? 50) : 100),
        titleBytes,
      });
    }
  }

  // Collect edge labels (keyed by "fromTxid->toTxid", max 20 chars)
  const edgeLabelEntries: { fromIdx: number; toIdx: number; bytes: Uint8Array }[] = [];
  if (saved.edgeLabels) {
    for (const [key, label] of Object.entries(saved.edgeLabels)) {
      const parts = key.split("->");
      if (parts.length !== 2 || !label) continue;
      const fromIdx = txidToIdx.get(parts[0]);
      const toIdx = txidToIdx.get(parts[1]);
      if (fromIdx === undefined || toIdx === undefined) continue;
      edgeLabelEntries.push({ fromIdx, toIdx, bytes: encodeUtf8(label.slice(0, 20)) });
    }
  }

  // Calculate buffer size
  const headerSize = 5;
  const multiRootSize = 2 + multiRoots.length * 2;
  const networkSize = 1;
  const nodeTableSize = nodeCount * NODE_RECORD_SIZE;
  const posSize = 2 + posEntries.length * 10;
  const nodeLabelSize = 2 + nodeLabelEntries.reduce((s, e) => s + 2 + 1 + e.bytes.length, 0);
  const annotSize = 2 + annotEntries.reduce((s, e) => s + 1 + 16 + 1 + e.titleBytes.length, 0);
  const edgeLabelSize = 2 + edgeLabelEntries.reduce((s, e) => s + 4 + 1 + e.bytes.length, 0);
  const totalSize = headerSize + multiRootSize + networkSize + nodeTableSize + posSize + nodeLabelSize + annotSize + edgeLabelSize;

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let offset = 0;

  // Header (version 2)
  buf[offset++] = 2;
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
    buf.set(txidBytes, offset); offset += TXID_BYTES;
    view.setInt8(offset, node.depth); offset += 1;

    let flags = 0;
    if (node.parentEdge) flags |= 1;
    if (node.childEdge) flags |= 2;
    buf[offset++] = flags;

    if (node.parentEdge) {
      const refIdx = txidToIdx.get(node.parentEdge.fromTxid) ?? NO_EDGE;
      view.setUint16(offset, refIdx); offset += 2;
      buf[offset++] = node.parentEdge.outputIndex & 0xFF;
    } else if (node.childEdge) {
      const refIdx = txidToIdx.get(node.childEdge.toTxid) ?? NO_EDGE;
      view.setUint16(offset, refIdx); offset += 2;
      buf[offset++] = node.childEdge.inputIndex & 0xFF;
    } else {
      view.setUint16(offset, NO_EDGE); offset += 2;
      buf[offset++] = 0;
    }
  }

  // ─── V2 Extensions ───────────────────────────────────────────

  // Node positions
  view.setUint16(offset, posEntries.length); offset += 2;
  for (const e of posEntries) {
    view.setUint16(offset, e.idx); offset += 2;
    view.setFloat32(offset, e.x); offset += 4;
    view.setFloat32(offset, e.y); offset += 4;
  }

  // Node labels
  view.setUint16(offset, nodeLabelEntries.length); offset += 2;
  for (const e of nodeLabelEntries) {
    view.setUint16(offset, e.idx); offset += 2;
    offset = writeLabelBytes(buf, offset, e.bytes);
  }

  // Annotations (titles only)
  view.setUint16(offset, annotEntries.length); offset += 2;
  for (const e of annotEntries) {
    buf[offset++] = e.type;
    view.setFloat32(offset, e.x); offset += 4;
    view.setFloat32(offset, e.y); offset += 4;
    view.setFloat32(offset, e.w); offset += 4;
    view.setFloat32(offset, e.h); offset += 4;
    offset = writeLabelBytes(buf, offset, e.titleBytes);
  }

  // Edge labels (fromIdx:uint16, toIdx:uint16, len:uint8, utf8[len])
  view.setUint16(offset, edgeLabelEntries.length); offset += 2;
  for (const e of edgeLabelEntries) {
    view.setUint16(offset, e.fromIdx); offset += 2;
    view.setUint16(offset, e.toIdx); offset += 2;
    offset = writeLabelBytes(buf, offset, e.bytes);
  }

  const encoded = toBase64Url(buf.slice(0, offset));
  if (encoded.length > MAX_URL_LENGTH) return null;
  return encoded;
}

// ─── Decode ─────────────────────────────────────────────────────────

export function decodeGraphFromUrl(
  encoded: string,
): Omit<SavedGraph, "id" | "name" | "savedAt"> | null {
  try {
    const buf = fromBase64Url(encoded);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let offset = 0;

    const version = buf[offset++];
    if (version !== 1 && version !== 2) return null;

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

    // Node table
    const txids: string[] = [];
    const nodeStartOffset = offset;
    for (let i = 0; i < nodeCount; i++) {
      txids.push(bytesToHex(buf, offset));
      offset += NODE_RECORD_SIZE;
    }

    offset = nodeStartOffset;
    const nodes: SavedGraphNode[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const txid = txids[i];
      offset += TXID_BYTES;
      const depth = view.getInt8(offset); offset += 1;
      const flags = buf[offset++];
      const edgeRefIdx = view.getUint16(offset); offset += 2;
      const edgeIndex = buf[offset++];

      const node: SavedGraphNode = { txid, depth };
      if ((flags & 1) && edgeRefIdx !== NO_EDGE && edgeRefIdx < nodeCount) {
        node.parentEdge = { fromTxid: txids[edgeRefIdx], outputIndex: edgeIndex };
      }
      if ((flags & 2) && edgeRefIdx !== NO_EDGE && edgeRefIdx < nodeCount) {
        node.childEdge = { toTxid: txids[edgeRefIdx], inputIndex: edgeIndex };
      }
      nodes.push(node);
    }

    const rootTxid = txids[rootIndex] ?? txids[0];
    const rootTxids = multiRootIndices
      .filter((i) => i < nodeCount)
      .map((i) => txids[i]);
    if (rootTxids.length === 0) rootTxids.push(rootTxid);

    // ─── V2 Extensions (optional) ──────────────────────────────

    let nodePositions: Record<string, { x: number; y: number }> | undefined;
    let nodeLabels: Record<string, string> | undefined;
    let annotations: GraphAnnotation[] | undefined;

    if (version >= 2 && offset < buf.length) {
      // Node positions
      const posCount = view.getUint16(offset); offset += 2;
      if (posCount > 0) {
        nodePositions = {};
        for (let i = 0; i < posCount && offset + 10 <= buf.length; i++) {
          const idx = view.getUint16(offset); offset += 2;
          const x = view.getFloat32(offset); offset += 4;
          const y = view.getFloat32(offset); offset += 4;
          if (idx < nodeCount) nodePositions[txids[idx]] = { x, y };
        }
      }

      // Node labels
      if (offset + 2 <= buf.length) {
        const labelCount = view.getUint16(offset); offset += 2;
        if (labelCount > 0) {
          nodeLabels = {};
          for (let i = 0; i < labelCount && offset + 3 <= buf.length; i++) {
            const idx = view.getUint16(offset); offset += 2;
            const [text, nextOff] = readLabelBytes(buf, offset);
            offset = nextOff;
            if (idx < nodeCount) nodeLabels[txids[idx]] = text;
          }
        }
      }

      // Annotations
      if (offset + 2 <= buf.length) {
        const annotCount = view.getUint16(offset); offset += 2;
        if (annotCount > 0) {
          annotations = [];
          for (let i = 0; i < annotCount && offset + 18 <= buf.length; i++) {
            const typeIdx = buf[offset++];
            const x = view.getFloat32(offset); offset += 4;
            const y = view.getFloat32(offset); offset += 4;
            const w = view.getFloat32(offset); offset += 4;
            const h = view.getFloat32(offset); offset += 4;
            const [title, nextOff] = readLabelBytes(buf, offset);
            offset = nextOff;
            const type = ANNOTATION_TYPE_MAP[typeIdx] ?? "note";
            annotations.push({
              id: crypto.randomUUID(),
              type,
              x, y,
              title,
              body: "", // body is not in URL, workspace only
              width: type !== "circle" ? w : undefined,
              height: type !== "circle" ? h : undefined,
              radius: type === "circle" ? w : undefined,
            });
          }
        }
      }
    }

    // Edge labels
    let edgeLabels: Record<string, string> | undefined;
    if (version >= 2 && offset + 2 <= buf.length) {
      const edgeLabelCount = view.getUint16(offset); offset += 2;
      if (edgeLabelCount > 0) {
        edgeLabels = {};
        for (let i = 0; i < edgeLabelCount && offset + 5 <= buf.length; i++) {
          const fromIdx = view.getUint16(offset); offset += 2;
          const toIdx = view.getUint16(offset); offset += 2;
          const [text, nextOff] = readLabelBytes(buf, offset);
          offset = nextOff;
          if (fromIdx < nodeCount && toIdx < nodeCount) {
            edgeLabels[`${txids[fromIdx]}->${txids[toIdx]}`] = text;
          }
        }
      }
    }

    return {
      network, rootTxid, rootTxids, nodes,
      nodePositions,
      nodeLabels,
      annotations,
      edgeLabels,
    };
  } catch {
    return null;
  }
}
