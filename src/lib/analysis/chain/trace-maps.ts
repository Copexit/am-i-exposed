/**
 * Utility functions for building index-keyed maps from trace layers.
 *
 * Used by runChainAnalysis to convert trace-layer data (txid-keyed maps)
 * into input-index/output-index keyed maps that the per-step analysis
 * functions expect.
 */

import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { TraceLayer } from "./recursive-trace";
import { isOpReturnOutput } from "../heuristics/tx-utils";

/**
 * Build a map of (input index -> parent transaction) from depth-1 backward
 * layer and an optional pre-fetched single parentTx.
 */
export function buildParentTxsByIdx(
  tx: MempoolTransaction,
  backwardLayers: TraceLayer[],
  parentTx: MempoolTransaction | null,
): Map<number, MempoolTransaction> {
  const parentTxsByIdx = new Map<number, MempoolTransaction>();

  if (backwardLayers.length > 0) {
    const depth1 = backwardLayers[0];
    for (let i = 0; i < tx.vin.length; i++) {
      if (tx.vin[i].is_coinbase) continue;
      const ptx = depth1.txs.get(tx.vin[i].txid);
      if (ptx) parentTxsByIdx.set(i, ptx);
    }
  }

  // Also use the pre-fetched single parentTx if available
  if (parentTx && tx.vin.length === 1 && !parentTxsByIdx.has(0)) {
    parentTxsByIdx.set(0, parentTx);
  }

  return parentTxsByIdx;
}

/**
 * Build a map of (output index -> child transaction) from depth-1 forward
 * layer, outspends, and an optional pre-fetched single childTx.
 */
export function buildChildTxsByIdx(
  outspends: MempoolOutspend[] | null,
  forwardLayers: TraceLayer[],
  childTx: MempoolTransaction | null,
): Map<number, MempoolTransaction> {
  const childTxsByIdx = new Map<number, MempoolTransaction>();

  if (forwardLayers.length > 0 && outspends) {
    const depth1 = forwardLayers[0];
    for (let i = 0; i < outspends.length; i++) {
      const os = outspends[i];
      if (os?.spent && os.txid) {
        const ctxn = depth1.txs.get(os.txid);
        if (ctxn) childTxsByIdx.set(i, ctxn);
      }
    }
  }

  // Also use the pre-fetched single childTx
  if (childTx && outspends) {
    for (let i = 0; i < outspends.length; i++) {
      if (outspends[i]?.txid === childTx.txid && !childTxsByIdx.has(i)) {
        childTxsByIdx.set(i, childTx);
      }
    }
  }

  return childTxsByIdx;
}

/**
 * Build a flat map of address -> transactions from the target tx and all
 * trace layers. Used by the clustering analysis step.
 */
export function buildTxsByAddress(
  tx: MempoolTransaction,
  backwardLayers: TraceLayer[],
  forwardLayers: TraceLayer[],
): Map<string, MempoolTransaction[]> {
  const txsByAddress = new Map<string, MempoolTransaction[]>();

  const addTxToMap = (atx: MempoolTransaction) => {
    for (const vin of atx.vin) {
      const addr = vin.prevout?.scriptpubkey_address;
      if (addr) {
        const arr = txsByAddress.get(addr) ?? [];
        arr.push(atx);
        txsByAddress.set(addr, arr);
      }
    }
    for (const vout of atx.vout) {
      const addr = vout.scriptpubkey_address;
      if (addr && !isOpReturnOutput(vout)) {
        const arr = txsByAddress.get(addr) ?? [];
        arr.push(atx);
        txsByAddress.set(addr, arr);
      }
    }
  };

  addTxToMap(tx);
  for (const layer of [...backwardLayers, ...forwardLayers]) {
    for (const [, ltx] of layer.txs) addTxToMap(ltx);
  }

  return txsByAddress;
}
