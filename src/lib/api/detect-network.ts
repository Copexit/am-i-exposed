/**
 * Probe mempool.space backends to determine which Bitcoin network a txid
 * belongs to. Used as a fallback when the user's selected network returns
 * 404 for a txid scan, so the analysis can auto-switch instead of surfacing
 * a confusing "not found" error.
 *
 * Only used against the public mempool.space API. Self-hosted (Umbrel) and
 * custom API setups are excluded by the caller because they cannot answer
 * for networks they do not run.
 */

import { NETWORK_CONFIG, type BitcoinNetwork } from "@/lib/bitcoin/networks";

const PROBE_NETWORKS: readonly BitcoinNetwork[] = [
  "mainnet",
  "testnet4",
  "signet",
  "testnet3",
];

/**
 * Probe the other public mempool.space networks (everything except `fromNetwork`)
 * for the given txid. Returns the first network whose `/tx/{txid}/hex` endpoint
 * responds OK, or `null` if none do.
 *
 * Probes run concurrently via `Promise.any`. The `/hex` endpoint is used because
 * it returns 404 for unknown txids on every network. The `/status` endpoint is
 * unsuitable: mempool.space returns `{"confirmed":false}` with HTTP 200 for
 * non-existent txids, which would make every probe spuriously succeed and pick
 * whichever network responded first.
 */
export async function detectTxidNetwork(
  txid: string,
  fromNetwork: BitcoinNetwork,
  signal?: AbortSignal,
): Promise<BitcoinNetwork | null> {
  if (!/^[a-fA-F0-9]{64}$/.test(txid)) return null;

  const others = PROBE_NETWORKS.filter((n) => n !== fromNetwork);

  const probes = others.map(async (net) => {
    const url = `${NETWORK_CONFIG[net].mempoolBaseUrl}/tx/${txid}/hex`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${net}: ${res.status}`);
    return net;
  });

  try {
    return await Promise.any(probes);
  } catch {
    return null;
  }
}
