import type { ChainalysisIdentification } from "./types";

// Cloudflare Worker proxy - avoids CORS and keeps API key server-side.
// Deploy from workers/chainalysis-proxy/ with `wrangler deploy`.
// Falls back to direct API call (works in non-browser environments).
const PROXY_BASE =
  process.env.NEXT_PUBLIC_CHAINALYSIS_PROXY_URL ||
  "https://chainalysis-proxy.copexit.workers.dev/address";

// Local Tor proxy route (Umbrel mode - routes through Tor SOCKS5)
const TOR_PROXY_BASE = "/tor-proxy/chainalysis/address";

const MAX_ADDRESSES = 20;
const TOR_TIMEOUT_MS = 30_000;

interface ChainalysisResponse {
  identifications: ChainalysisIdentification[];
}

export type ChainalysisRoute = "tor-proxy" | "direct";

export interface ChainalysisRoutingResult {
  route: ChainalysisRoute;
  sanctioned: boolean;
  identifications: ChainalysisIdentification[];
  matchedAddresses: string[];
}

async function checkSingleAddress(
  address: string,
  baseUrl: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<{ sanctioned: boolean; identifications: ChainalysisIdentification[] }> {
  const signals: AbortSignal[] = [];
  if (signal) signals.push(signal);
  if (timeoutMs) signals.push(AbortSignal.timeout(timeoutMs));

  const combinedSignal =
    signals.length > 0 ? AbortSignal.any(signals) : undefined;

  const res = await fetch(`${baseUrl}/${address}`, {
    headers: { Accept: "application/json" },
    signal: combinedSignal,
  });

  if (!res.ok) {
    throw new Error(`Chainalysis proxy returned ${res.status}`);
  }

  const data: ChainalysisResponse = await res.json();
  return {
    sanctioned: data.identifications.length > 0,
    identifications: data.identifications,
  };
}

async function checkAddresses(
  addresses: string[],
  baseUrl: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<{
  sanctioned: boolean;
  identifications: ChainalysisIdentification[];
  matchedAddresses: string[];
}> {
  const toCheck = addresses.slice(0, MAX_ADDRESSES);
  const allIdentifications: ChainalysisIdentification[] = [];
  const matchedAddresses: string[] = [];

  for (const addr of toCheck) {
    signal?.throwIfAborted();
    const result = await checkSingleAddress(addr, baseUrl, signal, timeoutMs);
    if (result.sanctioned) {
      matchedAddresses.push(addr);
      allIdentifications.push(...result.identifications);
    }
  }

  return {
    sanctioned: matchedAddresses.length > 0,
    identifications: allIdentifications,
    matchedAddresses,
  };
}

/** Route through the local Tor proxy sidecar (Umbrel mode). */
export async function checkChainalysisViaTor(
  addresses: string[],
  signal?: AbortSignal,
): Promise<ChainalysisRoutingResult> {
  const result = await checkAddresses(
    addresses,
    TOR_PROXY_BASE,
    signal,
    TOR_TIMEOUT_MS,
  );
  return { route: "tor-proxy", ...result };
}

/** Direct check via Cloudflare Worker (clearnet). */
export async function checkChainalysisDirect(
  addresses: string[],
  signal?: AbortSignal,
): Promise<ChainalysisRoutingResult> {
  const result = await checkAddresses(addresses, PROXY_BASE, signal);
  return { route: "direct", ...result };
}

/** Original API - uses direct Cloudflare Worker route. */
export async function checkChainalysis(
  addresses: string[],
  signal?: AbortSignal,
): Promise<{
  sanctioned: boolean;
  identifications: ChainalysisIdentification[];
  matchedAddresses: string[];
}> {
  return checkAddresses(addresses, PROXY_BASE, signal);
}
