import type { ChainalysisIdentification } from "./types";

const API_BASE = "https://public.chainalysis.com/api/v1/address";
const API_KEY =
  "***REDACTED_API_KEY***";

const MAX_ADDRESSES = 20;

interface ChainalysisResponse {
  identifications: ChainalysisIdentification[];
}

async function checkSingleAddress(
  address: string,
): Promise<{ sanctioned: boolean; identifications: ChainalysisIdentification[] }> {
  const res = await fetch(`${API_BASE}/${address}`, {
    headers: {
      Accept: "application/json",
      "X-API-KEY": API_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`Chainalysis API returned ${res.status}`);
  }

  const data: ChainalysisResponse = await res.json();
  return {
    sanctioned: data.identifications.length > 0,
    identifications: data.identifications,
  };
}

export async function checkChainalysis(
  addresses: string[],
): Promise<{
  sanctioned: boolean;
  identifications: ChainalysisIdentification[];
  matchedAddresses: string[];
}> {
  const toCheck = addresses.slice(0, MAX_ADDRESSES);
  const allIdentifications: ChainalysisIdentification[] = [];
  const matchedAddresses: string[] = [];

  for (const addr of toCheck) {
    const result = await checkSingleAddress(addr);
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
