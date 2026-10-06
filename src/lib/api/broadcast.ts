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
      const e = JSON.parse(json) as { code?: unknown; message?: unknown; error?: unknown };
      if (typeof e.code === "number") return { code: e.code, message: typeof e.message === "string" ? e.message : body };
      // Self-hosted mempool wraps the node error: {"error":"sendrawtransaction RPC error: {\"code\":-27}"}
      if (typeof e.error === "string") return parseRpcError(e.error);
    } catch { /* fall through */ }
  }
  return { code: null, message: body.trim().slice(0, 300) };
}

interface Sent { status: number; ok: boolean; body: string }

/** Timeout covers headers AND body; a throw means the outcome is unknown. */
async function send(url: string, init: RequestInit, opts?: SendOpts): Promise<Sent> {
  const f = opts?.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Race so a body that never settles (even if the mock ignores abort) still times out.
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => {
      const err = new DOMException("Timed out", "TimeoutError");
      controller.abort(err);
      rej(err);
    }, opts?.timeoutMs ?? BROADCAST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const r = await f(url, { ...init, signal: controller.signal });
        return { status: r.status, ok: r.ok, body: (await r.text()).trim() };
      })(),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function broadcastTx(baseUrl: string, hex: string, expectedTxid: string, opts?: SendOpts): Promise<BroadcastOutcome> {
  let r: Sent;
  try {
    r = await send(join(baseUrl, "/tx"), { method: "POST", headers: { "Content-Type": "text/plain" }, body: hex }, opts);
  } catch {
    return { kind: "unknown" };
  }
  // A 2xx with anything but a txid: the node may have accepted it.
  if (r.ok) return TXID_RE.test(r.body) ? { kind: "sent", txid: r.body, mismatch: r.body !== expectedTxid } : { kind: "unknown" };
  const { code, message } = parseRpcError(r.body || `HTTP ${r.status}`);
  if (code === null && r.status >= 500) return { kind: "unknown" };
  if (code === -27) return { kind: "already-confirmed", txid: expectedTxid };
  const reason: BroadcastReason = code === -25 ? "inputs-missing-or-spent" : code === -26 ? "policy" : "other";
  return { kind: "rejected", code, message, reason };
}

export async function testMempoolAccept(baseUrl: string, hex: string, opts?: SendOpts) {
  try {
    const r = await send(join(baseUrl, "/txs/test"), { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify([hex]) }, opts);
    if (!r.ok) return null;
    const [first] = JSON.parse(r.body) as { allowed?: boolean; "reject-reason"?: string }[];
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
    return (JSON.parse(r.body) as { confirmed?: boolean }).confirmed ? ("confirmed" as const) : ("mempool" as const);
  } catch {
    return "error" as const;
  }
}
