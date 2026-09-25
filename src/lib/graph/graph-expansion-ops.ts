/**
 * Graph expansion operations: expand backward (input) and forward (output).
 *
 * Pure async functions extracted from useGraphExpansion to reduce hook size.
 * They accept accessor callbacks instead of directly using React refs/state.
 */

import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { GraphNode, GraphExpansionFetcher, GraphAction } from "./graph-reducer";

/** Minimal accessors that expansion operations need from the hook. */
export interface ExpansionContext {
  dispatch: (action: GraphAction) => void;
  getNodes: () => Map<string, GraphNode>;
  getMaxNodes: () => number;
  getFetcher: () => GraphExpansionFetcher | null;
}

/**
 * Address-based fallback to find a child tx spending a specific output.
 * Scans the output address's transaction history for one that references our txid:vout.
 */
async function findChildViaAddress(
  client: GraphExpansionFetcher,
  tx: MempoolTransaction,
  currentTxid: string,
  outputIndex: number,
  existingNodes: Map<string, GraphNode>,
): Promise<{ childTx: MempoolTransaction; outputIdx: number } | null> {
  if (!client.getAddressTxs) return null;

  const vout = tx.vout;
  for (let offset = 0; offset < vout.length; offset++) {
    const oi = (outputIndex + offset) % vout.length;
    const out = vout[oi];
    const addr = out?.scriptpubkey_address;
    if (!out || !addr || out.value === 0) continue;

    const addrTxs = await client.getAddressTxs(addr);
    for (const atx of addrTxs) {
      if (atx.txid === currentTxid) continue;
      if (existingNodes.has(atx.txid)) continue;
      const spendsOur = atx.vin.some(
        (v) => v.txid === currentTxid && v.vout === oi,
      );
      if (spendsOur) return { childTx: atx, outputIdx: oi };
    }
  }
  return null;
}

/** Expand backward: fetch the parent tx that created the given input. */
export async function expandInputOp(
  ctx: ExpansionContext,
  currentTxid: string,
  inputIndex: number,
): Promise<void> {
  const client = ctx.getFetcher();
  if (!client) {
    ctx.dispatch({ type: "SET_ERROR", txid: currentTxid, error: "No API client available" });
    return;
  }

  const nodes = ctx.getNodes();
  const node = nodes.get(currentTxid);
  if (!node) {
    ctx.dispatch({ type: "SET_ERROR", txid: currentTxid, error: "Transaction not found in graph" });
    return;
  }

  const vin = node.tx.vin[inputIndex];
  if (!vin || vin.is_coinbase) return;

  const parentTxid = vin.txid;
  if (nodes.has(parentTxid)) return; // already in graph
  if (nodes.size >= ctx.getMaxNodes()) {
    ctx.dispatch({ type: "SET_ERROR", txid: currentTxid, error: "Maximum nodes reached" });
    return;
  }

  ctx.dispatch({ type: "SET_LOADING", txid: parentTxid, loading: true });

  try {
    const parentTx = await client.getTransaction(parentTxid);
    ctx.dispatch({
      type: "ADD_NODE",
      node: {
        txid: parentTxid,
        tx: parentTx,
        depth: node.depth - 1,
        childEdge: { toTxid: currentTxid, inputIndex },
      },
    });
  } catch (err) {
    ctx.dispatch({
      type: "SET_ERROR",
      txid: parentTxid,
      error: err instanceof Error ? err.message : "Failed to fetch",
    });
  } finally {
    ctx.dispatch({ type: "SET_LOADING", txid: parentTxid, loading: false });
  }
}

/**
 * Expand forward: fetch the child tx that spends the given output.
 * Scans all outputs starting from the hint index to find an expandable one.
 * Falls back to address-based lookup if outspends endpoint is unavailable.
 */
export async function expandOutputOp(
  ctx: ExpansionContext,
  currentTxid: string,
  outputIndex: number,
): Promise<void> {
  const client = ctx.getFetcher();
  if (!client) {
    ctx.dispatch({ type: "SET_ERROR", txid: currentTxid, error: "No API client available" });
    return;
  }

  const nodes = ctx.getNodes();
  const node = nodes.get(currentTxid);
  if (!node) {
    ctx.dispatch({ type: "SET_ERROR", txid: currentTxid, error: "Transaction not found in graph" });
    return;
  }
  if (nodes.size >= ctx.getMaxNodes()) {
    ctx.dispatch({ type: "SET_ERROR", txid: `${currentTxid}:out`, error: "Maximum nodes reached" });
    return;
  }

  const loadKey = `${currentTxid}:out`;
  ctx.dispatch({ type: "SET_LOADING", txid: loadKey, loading: true });

  try {
    let outspends: MempoolOutspend[] = [];
    let outspendsFailed = false;
    try {
      outspends = await client.getTxOutspends(currentTxid);
    } catch {
      outspendsFailed = true;
    }

    // Try outspends first (fast path)
    const total = outspends.length;
    const needsFallback = outspendsFailed
      || total === 0
      || outspends.some((os) => os?.spent && !os.txid);

    if (!needsFallback) {
      for (let offset = 0; offset < total; offset++) {
        const oi = (outputIndex + offset) % total;
        const os = outspends[oi];
        if (!os?.spent || !os.txid) continue;
        if (ctx.getNodes().has(os.txid)) continue;

        const childTx = await client.getTransaction(os.txid);
        ctx.dispatch({
          type: "ADD_NODE",
          node: {
            txid: os.txid,
            tx: childTx,
            depth: node.depth + 1,
            parentEdge: { fromTxid: currentTxid, outputIndex: oi },
          },
        });
        return;
      }

      // Outspends worked but no expandable output found
      const allUnspent = outspends.every((os) => !os?.spent);
      ctx.dispatch({
        type: "SET_ERROR",
        txid: loadKey,
        error: allUnspent ? "Output not yet spent" : "All spent outputs already in graph",
      });
      return;
    }

    // Fallback: use address-based lookup
    if (client.getAddressTxs) {
      const result = await findChildViaAddress(client, node.tx, currentTxid, outputIndex, ctx.getNodes());
      if (result) {
        ctx.dispatch({
          type: "ADD_NODE",
          node: {
            txid: result.childTx.txid,
            tx: result.childTx,
            depth: node.depth + 1,
            parentEdge: { fromTxid: currentTxid, outputIndex: result.outputIdx },
          },
        });
        return;
      }
    }

    // Neither outspends nor address fallback found a child
    ctx.dispatch({
      type: "SET_ERROR",
      txid: loadKey,
      error: outspendsFailed
        ? "Output not yet spent or address has no other transactions"
        : "Output not yet spent",
    });
  } catch (err) {
    ctx.dispatch({
      type: "SET_ERROR",
      txid: loadKey,
      error: err instanceof Error ? err.message : "Failed to fetch",
    });
  } finally {
    ctx.dispatch({ type: "SET_LOADING", txid: loadKey, loading: false });
  }
}
