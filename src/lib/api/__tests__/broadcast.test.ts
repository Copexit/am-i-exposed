import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { broadcastTx, testMempoolAccept, getTxStatus, parseRpcError } from "../broadcast";

const res = (status: number, body: string) => new Response(body, { status });
const TXID = "b".repeat(64);

describe("broadcastTx", () => {
  it("POSTs hex as text/plain to {base}/tx exactly once", async () => {
    const f = vi.fn().mockResolvedValue(res(200, TXID));
    const out = await broadcastTx("https://mempool.space/api/", "0200", TXID, { fetchImpl: f });
    expect(out).toEqual({ kind: "sent", txid: TXID, mismatch: false });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://mempool.space/api/tx");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "text/plain" });
    expect(init.body).toBe("0200");
  });
  it("never retries a 5xx without RPC code; outcome is unknown", async () => {
    const f = vi.fn().mockResolvedValue(res(502, "Bad gateway"));
    expect(await broadcastTx("https://x/api", "00", TXID, { fetchImpl: f })).toEqual({ kind: "unknown" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("5xx with RPC code keeps the mapping; 4xx without code is rejected", async () => {
    const f5 = vi.fn().mockResolvedValue(res(500, 'RPC error: {"code":-26,"message":"x"}'));
    expect(await broadcastTx("https://x/api", "00", TXID, { fetchImpl: f5 })).toMatchObject({ kind: "rejected", reason: "policy" });
    const f4 = vi.fn().mockResolvedValue(res(400, "nope"));
    expect(await broadcastTx("https://x/api", "00", TXID, { fetchImpl: f4 })).toMatchObject({ kind: "rejected", reason: "other" });
  });
  it("2xx with a non-txid body, a failing body read, or a hanging body -> unknown", async () => {
    expect(await broadcastTx("https://x/api", "00", TXID, { fetchImpl: vi.fn().mockResolvedValue(res(200, "<html>ok</html>")) })).toEqual({ kind: "unknown" });
    const bad = { status: 200, ok: true, text: () => Promise.reject(new TypeError("body")) };
    expect(await broadcastTx("https://x/api", "00", TXID, { fetchImpl: vi.fn().mockResolvedValue(bad) })).toEqual({ kind: "unknown" });
    const hang = { status: 200, ok: true, text: () => new Promise<string>(() => {}) };
    expect(await broadcastTx("https://x/api", "00", TXID, { fetchImpl: vi.fn().mockResolvedValue(hang), timeoutMs: 10 })).toEqual({ kind: "unknown" });
  });
  it("maps RPC codes", async () => {
    const body = (code: number, message: string) => `sendrawtransaction RPC error: {"code":${code},"message":"${message}"}`;
    const run = (b: string) => broadcastTx("https://x/api", "00", TXID, { fetchImpl: vi.fn().mockResolvedValue(res(400, b)) });
    expect(await run(body(-25, "bad-txns-inputs-missingorspent"))).toMatchObject({ kind: "rejected", code: -25, reason: "inputs-missing-or-spent" });
    expect(await run(body(-26, "min relay fee not met"))).toMatchObject({ kind: "rejected", reason: "policy" });
    expect(await run(body(-27, "Transaction already in block chain"))).toEqual({ kind: "already-confirmed", txid: TXID });
    // Umbrel's mempool backend: JSON-wrapped, escaped, no message
    expect(await run('{"error":"sendrawtransaction RPC error: {\\"code\\":-27}"}')).toEqual({ kind: "already-confirmed", txid: TXID });
    expect(await run('{"error":"sendrawtransaction RPC error: {\\"code\\":-25,\\"message\\":\\"bad-txns-inputs-missingorspent\\"}"}'))
      .toMatchObject({ kind: "rejected", code: -25, message: "bad-txns-inputs-missingorspent", reason: "inputs-missing-or-spent" });
  });
  it("flags a txid mismatch", async () => {
    const out = await broadcastTx("https://x/api", "00", TXID, { fetchImpl: vi.fn().mockResolvedValue(res(200, "c".repeat(64))) });
    expect(out).toEqual({ kind: "sent", txid: "c".repeat(64), mismatch: true });
  });
  it("network error or timeout -> unknown", async () => {
    expect(await broadcastTx("https://x/api", "00", TXID, { fetchImpl: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) })).toEqual({ kind: "unknown" });
    const hang = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("t", "TimeoutError")))));
    expect(await broadcastTx("https://x/api", "00", TXID, { fetchImpl: hang as never, timeoutMs: 10 })).toEqual({ kind: "unknown" });
  });
});

describe("testMempoolAccept / getTxStatus / parseRpcError", () => {
  it("dry-run results", async () => {
    const ok = vi.fn().mockResolvedValue(res(200, JSON.stringify([{ txid: TXID, allowed: true }])));
    expect(await testMempoolAccept("https://x/api", "00", { fetchImpl: ok })).toEqual({ allowed: true });
    expect(ok.mock.calls[0]![0]).toBe("https://x/api/txs/test");
    expect(ok.mock.calls[0]![1].body).toBe('["00"]');
    const no = vi.fn().mockResolvedValue(res(200, JSON.stringify([{ txid: TXID, allowed: false, "reject-reason": "min relay fee not met" }])));
    expect(await testMempoolAccept("https://x/api", "00", { fetchImpl: no })).toEqual({ allowed: false, reason: "min relay fee not met" });
    expect(await testMempoolAccept("https://x/api", "00", { fetchImpl: vi.fn().mockResolvedValue(res(404, "")) })).toBeNull();
  });
  it("status", async () => {
    expect(await getTxStatus("https://x/api", TXID, { fetchImpl: vi.fn().mockResolvedValue(res(200, '{"confirmed":false}')) })).toBe("mempool");
    expect(await getTxStatus("https://x/api", TXID, { fetchImpl: vi.fn().mockResolvedValue(res(404, "")) })).toBe("not-found");
  });
  it("parseRpcError", () => {
    expect(parseRpcError('sendrawtransaction RPC error: {"code":-26,"message":"x"}')).toEqual({ code: -26, message: "x" });
    expect(parseRpcError("Bad gateway")).toEqual({ code: null, message: "Bad gateway" });
  });
});

describe("service worker", () => {
  it("ignores non-GET requests", () => {
    const sw = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
    expect(sw).toContain('if (event.request.method !== "GET") return;');
  });
});
