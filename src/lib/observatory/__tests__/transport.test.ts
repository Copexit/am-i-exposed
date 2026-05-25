import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getJson, postJsonRpc } from "../transport";
import { ApiError } from "@/lib/api/fetch-with-retry";

const mockFetch = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(
    () => new AbortController().signal,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function jsonOk<T>(body: T) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getJson", () => {
  it("parses and returns the JSON body", async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ hello: "world" }));
    const result = await getJson<{ hello: string }>("https://example.com/x");
    expect(result).toEqual({ hello: "world" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/x",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

describe("postJsonRpc", () => {
  it("wraps the payload in a JSON-RPC 2.0 envelope and unwraps result", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonOk({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
    );
    const result = await postJsonRpc<{ ok: boolean }>(
      "https://example.com/api",
      "dashboard",
    );
    expect(result).toEqual({ ok: true });
    const [, init] = mockFetch.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("dashboard");
    expect(body.id).toBeTypeOf("number");
  });

  it("throws ApiError when the envelope carries an error", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonOk({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "Method not found" },
      }),
    );
    await expect(
      postJsonRpc("https://example.com/api", "nope"),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("throws ApiError when the envelope is missing both result and error", async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ jsonrpc: "2.0", id: 1 }));
    await expect(
      postJsonRpc("https://example.com/api", "broken"),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
