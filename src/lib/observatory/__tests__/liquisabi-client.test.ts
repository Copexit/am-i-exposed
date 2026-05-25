import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { _resetForTest } from "@/lib/api/idb-cache";
import { getLiquiSabiDashboard } from "../liquisabi-client";
import dashboardFixture from "./fixtures/liquisabi-dashboard.json";

const mockFetch = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal("fetch", mockFetch);

beforeEach(async () => {
  mockFetch.mockReset();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(
    () => new AbortController().signal,
  );
  await _resetForTest();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("aie-cache");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const URL = "https://example.test/liquisabi/api";

describe("getLiquiSabiDashboard", () => {
  it("POSTs a JSON-RPC envelope with method=dashboard and unwraps result", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: dashboardFixture }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const result = await getLiquiSabiDashboard(URL);
    expect(result.Coordinators).toHaveLength(3);
    expect(result.Coordinators[0].Coordinator.Name).toBe("Kruw.io");

    const [, init] = mockFetch.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      jsonrpc: "2.0",
      method: "dashboard",
    });
  });

  it("caches the second call", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: dashboardFixture }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await getLiquiSabiDashboard(URL);
    const again = await getLiquiSabiDashboard(URL);
    expect(again.Coordinators).toHaveLength(3);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
