/**
 * Broadcasting a signed transaction. Plain fetch, never fetchWithRetry: a
 * retried POST could hide the real outcome. text/plain keeps it a CORS simple
 * request (mempool.space answers preflights with 404).
 */
export type BroadcastReason = "inputs-missing-or-spent" | "policy" | "other";
export type BroadcastOutcome =
  | { kind: "sent"; txid: string; mismatch: boolean }
  | { kind: "already-confirmed"; txid: string }
  | { kind: "rejected"; code: number | null; message: string; reason: BroadcastReason }
  | { kind: "unknown" };
export interface SendOpts { fetchImpl?: typeof fetch; timeoutMs?: number }

export const BROADCAST_TIMEOUT_MS = 30_000;
const TXID_RE = /^[0-9a-f]{64}$/;
const join = (base: string, path: string) => `${base.replace(/\/+$/, "")}${path}`;

export function parseRpcError(body: string): { code: number | null; message: string } {
  const json = body.match(/\{.*\}/s)?.[0];
  if (json) {
    try {
      const e = JSON.parse(json) as { code?: unknown; message?: unknown };
      if (typeof e.code === "number") return { code: e.code, message: typeof e.message === "string" ? e.message : body };
    } catch { /* fall through */ }
  }
  return { code: null, message: body.trim().slice(0, 300) };
}

async function send(url: string, init: RequestInit, opts?: SendOpts): Promise<Response> {
  const f = opts?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), opts?.timeoutMs ?? BROADCAST_TIMEOUT_MS);
  try {
    return await f(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function broadcastTx(baseUrl: string, hex: string, expectedTxid: string, opts?: SendOpts): Promise<BroadcastOutcome> {
  let r: Response;
  try {
    r = await send(join(baseUrl, "/tx"), { method: "POST", headers: { "Content-Type": "text/plain" }, body: hex }, opts);
  } catch {
    return { kind: "unknown" };
  }
  const body = (await r.text().catch(() => "")).trim();
  if (r.ok && TXID_RE.test(body)) return { kind: "sent", txid: body, mismatch: body !== expectedTxid };
  const { code, message } = parseRpcError(body || `HTTP ${r.status}`);
  if (code === -27) return { kind: "already-confirmed", txid: expectedTxid };
  const reason: BroadcastReason = code === -25 ? "inputs-missing-or-spent" : code === -26 ? "policy" : "other";
  return { kind: "rejected", code, message, reason };
}

export async function testMempoolAccept(baseUrl: string, hex: string, opts?: SendOpts) {
  try {
    const r = await send(join(baseUrl, "/txs/test"), { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify([hex]) }, opts);
    if (!r.ok) return null;
    const [first] = (await r.json()) as { allowed?: boolean; "reject-reason"?: string }[];
    if (!first || typeof first.allowed !== "boolean") return null;
    return first.allowed ? { allowed: true as const } : { allowed: false as const, reason: first["reject-reason"] ?? "rejected" };
  } catch {
    return null;
  }
}

export async function getTxStatus(baseUrl: string, txid: string, opts?: SendOpts) {
  try {
    const r = await send(join(baseUrl, `/tx/${txid}/status`), { method: "GET" }, opts);
    if (r.status === 404) return "not-found" as const;
    if (!r.ok) return "error" as const;
    return ((await r.json()) as { confirmed?: boolean }).confirmed ? ("confirmed" as const) : ("mempool" as const);
  } catch {
    return "error" as const;
  }
}
