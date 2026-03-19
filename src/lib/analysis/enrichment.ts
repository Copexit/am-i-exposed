import type { Finding } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ApiClient } from "@/lib/api/client";

/**
 * Enrich a BIP47 notification finding with the notification address tx count.
 * The notification address is reused by every party opening a BIP47 channel
 * to that PayNym, so the tx count reveals how many channels have been opened.
 * Mutates the finding in-place. Silently no-ops on error.
 */
export async function enrichBip47Finding(
  findings: Finding[],
  api: ApiClient,
  signal: AbortSignal,
): Promise<void> {
  const bip47 = findings.find((f) => f.id === "bip47-notification");
  if (!bip47) return;

  const addr = bip47.params?.notificationAddress;
  if (typeof addr !== "string" || addr === "") return;

  try {
    const addrInfo = await api.getAddress(addr);
    if (signal.aborted) return;

    const txCount =
      addrInfo.chain_stats.tx_count + addrInfo.mempool_stats.tx_count;

    bip47.params = {
      ...bip47.params,
      notificationTxCount: txCount,
      channelInfo: txCount > 1
        ? ` The notification address has received ${txCount} transactions, indicating ${txCount} BIP47 payment channels have been opened to this PayNym. While this address is reused and publicly visible, the actual payment addresses derived through each channel are unique and cannot be linked without knowledge of the payment codes.`
        : " This appears to be the first notification to this address. The notification address is reused and publicly visible, but the actual payment addresses derived through the channel are unique and cannot be linked without knowledge of the payment codes.",
    };
  } catch {
    // Non-critical enrichment - do not fail the analysis
  }
}

/**
 * Trace the full Ricochet hop chain (up to 4 forward hops from hop 0).
 *
 * Ricochet creates a chain of single-input transactions that add "distance"
 * between a CoinJoin and a final destination. This enrichment follows the
 * chain forward and annotates the finding with hop details and variant type.
 * Mutates the finding in-place. Silently no-ops on error.
 */
export async function enrichRicochetFinding(
  findings: Finding[],
  api: ApiClient,
  tx: MempoolTransaction,
  signal: AbortSignal,
): Promise<void> {
  const hop0 = findings.find((f) => f.id === "ricochet-hop0");
  if (!hop0 || !hop0.params) return;

  const ricochetVout = hop0.params.ricochetOutputIndex;
  if (typeof ricochetVout !== "number" || ricochetVout < 0) return;

  interface HopInfo {
    hop: number;
    txid: string;
    blockHeight: number;
    value: number;
    outputCount: number;
  }

  try {
    // Hop 0 from the original transaction
    const hops: HopInfo[] = [
      {
        hop: 0,
        txid: tx.txid,
        blockHeight: tx.status?.block_height ?? 0,
        value: tx.vout[ricochetVout]?.value ?? 0,
        outputCount: tx.vout.length,
      },
    ];

    let currentTxid = tx.txid;
    let currentVout = ricochetVout;

    // Follow up to 4 forward hops
    for (let hopNum = 1; hopNum <= 4; hopNum++) {
      if (signal.aborted) return;

      // Fetch outspends for the current tx
      const outspends = await api.getTxOutspends(currentTxid);
      if (signal.aborted) return;

      const outspend = outspends[currentVout];
      if (!outspend?.spent || !outspend.txid) break; // chain ends here

      // Fetch the next hop tx
      const hopTx = await api.getTransaction(outspend.txid);
      if (signal.aborted) return;

      // Validate hop structure: 1 input is required.
      // Outputs: 1 (pure sweep) or 2 (PayNym variant with fee split) are valid.
      if (hopTx.vin.length !== 1) break;
      if (hopTx.vout.length < 1 || hopTx.vout.length > 2) break;

      // Determine which output continues the chain.
      // For 1-output hops, it is vout 0.
      // For 2-output hops, the larger output continues the chain.
      let nextVout = 0;
      if (hopTx.vout.length === 2) {
        nextVout = hopTx.vout[0].value >= hopTx.vout[1].value ? 0 : 1;
      }

      hops.push({
        hop: hopNum,
        txid: hopTx.txid,
        blockHeight: hopTx.status?.block_height ?? 0,
        value: hopTx.vout[nextVout].value,
        outputCount: hopTx.vout.length,
      });

      currentTxid = hopTx.txid;
      currentVout = nextVout;
    }

    // Need at least 2 hops (hop 0 + one forward) to be meaningful
    if (hops.length < 2) return;

    // Determine variant based on block height spacing
    const confirmedHops = hops.filter((h) => h.blockHeight > 0);
    let variant: "classic" | "staggered" | "partial";

    if (confirmedHops.length < hops.length) {
      variant = "partial";
    } else if (confirmedHops.length >= 2) {
      const isConsecutive = confirmedHops.every(
        (h, i) => i === 0 || h.blockHeight === confirmedHops[i - 1].blockHeight + 1,
      );
      variant = isConsecutive ? "classic" : "staggered";
    } else {
      variant = "partial";
    }

    const lastHop = hops[hops.length - 1];
    const hopCount = hops.length;

    const variantLabel =
      variant === "classic" ? "classic (consecutive blocks)" :
      variant === "staggered" ? "staggered (non-consecutive blocks)" :
      "partial (some hops unconfirmed or unspent)";

    hop0.params = {
      ...hop0.params,
      hops: JSON.stringify(hops),
      hopCount,
      variant,
      destinationTxid: lastHop.txid,
    };

    hop0.description =
      `Ricochet hop chain traced: ${hopCount} hops (${variantLabel}). ` +
      `This transaction pays the Ashigaru Ricochet fee (100,000 sats) and initiates a chain of ` +
      `${hopCount - 1} forward hop${hopCount - 1 === 1 ? "" : "s"} to create transactional distance. ` +
      "Ricochet provides retrospective anonymity (distancing past history) rather than " +
      "prospective anonymity (like CoinJoin). " +
      "The PayNym variant is undetectable by design - this detection means the non-PayNym variant was used.";

    hop0.recommendation =
      "Ricochet is a good practice when sending to exchanges or services that perform chain analysis. " +
      "For even better privacy, use the PayNym variant which eliminates the detectable fee address fingerprint.";
  } catch {
    // Non-critical enrichment - do not fail the analysis
  }
}
