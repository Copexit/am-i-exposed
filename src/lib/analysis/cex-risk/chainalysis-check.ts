import type { ChainalysisIdentification } from "./types";

// Cloudflare Worker proxy - avoids CORS and keeps API key server-side.
// Deploy from workers/chainalysis-proxy/ with `wrangler deploy`.
// Falls back to direct API call (works in non-browser environments).
const PROXY_BASE =
  process.env.NEXT_PUBLIC_CHAINALYSIS_PROXY_URL ||
  "https://chainalysis-proxy.copexit.workers.dev/address";

const MAX_ADDRESSES = 20;

interface ChainalysisResponse {
  identifications: ChainalysisIdentification[];
}

async function checkSingleAddress(
  address: string,
  signal?: AbortSignal,
): Promise<{ sanctioned: boolean; identifications: ChainalysisIdentification[] }> {
  const res = await fetch(`${PROXY_BASE}/${address}`, {
    headers: { Accept: "application/json" },
    signal,
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

export async function checkChainalysis(
  addresses: string[],
  signal?: AbortSignal,
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
    const result = await checkSingleAddress(addr, signal);
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
