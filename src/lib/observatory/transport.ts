/**
 * Thin HTTP transport helpers for the observatory clients.
 *
 * Uses plain fetch with a single attempt + AbortController timeout - the
 * upstream Cloudflare Worker is edge-cached so retries don't help, and a
 * 60s retry budget would leave the UI showing skeletons for too long if the
 * worker is unreachable. The JSON-RPC envelope is unwrapped here so the
 * rest of the code sees plain typed results.
 */

import { ApiError } from "@/lib/api/fetch-with-retry";
import { abortSignalAny, abortSignalTimeout } from "@/lib/abort-signal";

const DEFAULT_TIMEOUT_MS = 10_000;
const UMBREL_TIMEOUT_MS = 45_000;

interface JsonOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

function resolveTimeout(url: string, override?: number): number {
  if (override != null) return override;
  return url.startsWith("/tor-proxy/") ? UMBREL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

async function rawFetch(
  url: string,
  init: RequestInit,
  { signal, timeoutMs }: JsonOptions,
): Promise<Response> {
  const timeoutSignal = abortSignalTimeout(resolveTimeout(url, timeoutMs));
  const combined = signal ? abortSignalAny([signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: combined });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw err;
    }
    throw new ApiError("NETWORK_ERROR", err instanceof Error ? err.message : "fetch failed");
  }
  if (!response.ok) {
    throw new ApiError(
      response.status === 429 ? "RATE_LIMITED" : "API_UNAVAILABLE",
      `HTTP ${response.status}`,
    );
  }
  return response;
}

export async function getJson<T>(
  url: string,
  opts: JsonOptions = {},
): Promise<T> {
  const response = await rawFetch(
    url,
    { method: "GET", headers: { Accept: "application/json" } },
    opts,
  );
  return (await response.json()) as T;
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

let rpcId = 0;

export async function postJsonRpc<T>(
  url: string,
  method: string,
  params: unknown = {},
  opts: JsonOptions = {},
): Promise<T> {
  const id = ++rpcId;
  const response = await rawFetch(
    url,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
    },
    opts,
  );
  const envelope = (await response.json()) as JsonRpcResponse<T>;
  if (envelope.error) {
    throw new ApiError(
      "API_UNAVAILABLE",
      `JSON-RPC ${envelope.error.code}: ${envelope.error.message}`,
    );
  }
  if (envelope.result === undefined) {
    throw new ApiError("API_UNAVAILABLE", "JSON-RPC response missing result");
  }
  return envelope.result;
}
