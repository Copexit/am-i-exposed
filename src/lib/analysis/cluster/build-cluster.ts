import type { MempoolTransaction } from "@/lib/api/types";
import type { ApiClient } from "@/lib/api/client";
import { createRateLimiter } from "@/lib/api/rate-limiter";
import { analyzeCoinJoin, isCoinJoinFinding } from "../heuristics/coinjoin";
import { analyzeChangeDetection } from "../heuristics/change-detection";
import { getAddressType } from "@/lib/bitcoin/address-type";

export interface ClusterProgress {
  phase: "inputs" | "change-follow";
  current: number;
  total: number;
}

export interface ClusterResult {
  addresses: string[];
  size: number;
  txsAnalyzed: number;
  coinJoinTxCount: number;
}

/**
 * H14: First-Degree Cluster Analysis (CIOH Graph Walk)
 *
 * Builds a one-hop address cluster using:
 * 1. CIOH on the target's transactions (collect co-input addresses)
 * 2. Follow change outputs one hop (fetch change address txs, apply CIOH again)
 *
 * CoinJoin transactions are excluded from clustering.
 * Capped at 50 most recent txs to avoid rate limiting.
 */
export async function buildFirstDegreeCluster(
  targetAddress: string,
  txs: MempoolTransaction[],
  api: ApiClient,
  signal?: AbortSignal,
  onProgress?: (progress: ClusterProgress) => void,
): Promise<ClusterResult> {
  const cluster = new Set<string>();
  cluster.add(targetAddress);

  const throttle = createRateLimiter(200);
  const cap = Math.min(txs.length, 50);
  let coinJoinTxCount = 0;
  let txsAnalyzed = 0;

  // Phase 1: Direct CIOH - for each tx where target is an input, collect co-inputs
  const changeAddresses: string[] = [];

  for (let i = 0; i < cap; i++) {
    if (signal?.aborted) break;
    onProgress?.({ phase: "inputs", current: i + 1, total: cap });

    const tx = txs[i];
    txsAnalyzed++;

    // Check if this is a CoinJoin - skip CIOH if so
    const coinJoinResult = analyzeCoinJoin(tx);
    const isCoinJoin = coinJoinResult.findings.some(isCoinJoinFinding);
    if (isCoinJoin) {
      coinJoinTxCount++;
      continue;
    }

    // Check if target address is an input
    const targetIsInput = tx.vin.some(
      (v) => v.prevout?.scriptpubkey_address === targetAddress,
    );
    if (!targetIsInput) continue;

    // CIOH: collect all co-input addresses
    for (const vin of tx.vin) {
      const addr = vin.prevout?.scriptpubkey_address;
      if (addr) cluster.add(addr);
    }

    // Detect change output for follow-up
    const changeResult = analyzeChangeDetection(tx);
    const changeDetected = changeResult.findings.some(
      (f) => f.id === "h2-change-detected",
    );
    const spendableOutputs = tx.vout.filter(
      (v) => v.scriptpubkey_type !== "op_return" && v.scriptpubkey_address,
    );
    if (changeDetected && spendableOutputs.length === 2) {
      // If one output goes back to the target address (self-reuse / address reuse),
      // the OTHER output is the payment recipient, not change. Skip this tx.
      const selfSend = spendableOutputs.some(
        (v) => v.scriptpubkey_address === targetAddress,
      );
      if (!selfSend) {
        // For 2-output txs where target is a sender, identify the change output.
        // Change goes back to the sender's wallet, so it should match the input
        // address type. Pick the output matching the target's address type prefix.
        const targetPrefix = getAddressType(targetAddress);
        const candidates = spendableOutputs.filter((vout) => {
          const addr = vout.scriptpubkey_address;
          if (!addr) return false;
          return getAddressType(addr) === targetPrefix;
        });
        // Only follow when exactly one output matches sender type.
        // If both outputs match (sender and receiver use same wallet type),
        // we can't reliably distinguish change from payment.
        if (candidates.length === 1) {
          const outAddr = candidates[0].scriptpubkey_address!;
          if (!changeAddresses.includes(outAddr)) {
            changeAddresses.push(outAddr);
          }
        }
      }
    }
  }

  // Phase 2: Follow change outputs one hop
  const changeToFollow = changeAddresses.slice(0, 10); // Cap change follows
  for (let i = 0; i < changeToFollow.length; i++) {
    if (signal?.aborted) break;
    onProgress?.({ phase: "change-follow", current: i + 1, total: changeToFollow.length });

    const changeAddr = changeToFollow[i];
    if (cluster.has(changeAddr)) {
      // Already in cluster, still follow its txs for CIOH
    }
    cluster.add(changeAddr);

    try {
      const changeTxs = await throttle(() => api.getAddressTxs(changeAddr), signal);
      const changeCap = Math.min(changeTxs.length, 20);

      for (let j = 0; j < changeCap; j++) {
        const ctx = changeTxs[j];
        txsAnalyzed++;

        // Skip CoinJoins
        const cjResult = analyzeCoinJoin(ctx);
        const isCJ = cjResult.findings.some(isCoinJoinFinding);
        if (isCJ) {
          coinJoinTxCount++;
          continue;
        }

        // If change address is an input, apply CIOH
        const isInput = ctx.vin.some(
          (v) => v.prevout?.scriptpubkey_address === changeAddr,
        );
        if (isInput) {
          for (const vin of ctx.vin) {
            const addr = vin.prevout?.scriptpubkey_address;
            if (addr) cluster.add(addr);
          }
        }
      }
    } catch {
      // Rate limited or network error - continue with partial results
    }
  }

  const addresses = [...cluster];
  return {
    addresses,
    size: addresses.length,
    txsAnalyzed,
    coinJoinTxCount,
  };
}

