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
 *
 * `baseUrlFor` maps each network to the API base of the user's current backend
 * family (e.g. the onion endpoint for mainnet on Tor). Defaults to clearnet.
 */
export async function detectTxidNetwork(
  txid: string,
  fromNetwork: BitcoinNetwork,
  signal?: AbortSignal,
  baseUrlFor: (net: BitcoinNetwork) => string = (net) => NETWORK_CONFIG[net].mempoolBaseUrl,
): Promise<BitcoinNetwork | null> {
  if (!/^[a-fA-F0-9]{64}$/.test(txid)) return null;

  const others = PROBE_NETWORKS.filter((n) => n !== fromNetwork);

  const probes = others.map(async (net) => {
    const url = `${baseUrlFor(net)}/tx/${txid}/hex`;
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

/** Mainnet address prefixes: bech32 `bc1`, legacy `1`, P2SH `3`. Everything else valid is a test-network format. */
function isMainnetAddress(address: string): boolean {
  return /^bc1/i.test(address) || /^[13]/.test(address);
}

/**
 * The network an address belongs to when its format rules out `fromNetwork`,
 * else `null`. The prefix separates mainnet from the test networks; test
 * networks share formats (`tb1`, `m`/`n`, `2`), so for a test address scanned
 * on mainnet the one where it has history wins, falling back to testnet4.
 * Same backend constraints as {@link detectTxidNetwork}.
 */
export async function detectAddressNetwork(
  address: string,
  fromNetwork: BitcoinNetwork,
  signal?: AbortSignal,
  baseUrlFor: (net: BitcoinNetwork) => string = (net) => NETWORK_CONFIG[net].mempoolBaseUrl,
): Promise<BitcoinNetwork | null> {
  if (isMainnetAddress(address)) return fromNetwork === "mainnet" ? null : "mainnet";
  if (fromNetwork !== "mainnet") return null;

  const tests = PROBE_NETWORKS.filter((n) => n !== "mainnet");
  const probes = tests.map(async (net) => {
    const res = await fetch(`${baseUrlFor(net)}/address/${address}`, { signal });
    if (!res.ok) throw new Error(`${net}: ${res.status}`);
    const a = (await res.json()) as { chain_stats?: { tx_count?: number }; mempool_stats?: { tx_count?: number } };
    if ((a.chain_stats?.tx_count ?? 0) + (a.mempool_stats?.tx_count ?? 0) === 0) throw new Error(`${net}: no history`);
    return net;
  });
  try {
    return await Promise.any(probes);
  } catch {
    return signal?.aborted ? null : tests[0] ?? null;
  }
}
