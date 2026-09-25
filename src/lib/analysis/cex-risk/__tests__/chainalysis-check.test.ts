import { describe, it, expect, vi, afterEach } from "vitest";
import { checkChainalysis, ChainalysisRateLimitError } from "../chainalysis-check";

const ADDR = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";

afterEach(() => { vi.unstubAllGlobals(); });

describe("checkChainalysis", () => {
  it("reports a 429 as a rate limit, not a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429, headers: { "Retry-After": "60" } })));
    const err = await checkChainalysis([ADDR]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChainalysisRateLimitError);
  });

  it("does not re-query addresses already checked, so a retry after a 429 only spends quota on the rest", async () => {
    const a = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
    const b = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith(b) ? new Response("{}", { status: 429 }) : Response.json({ identifications: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(checkChainalysis([a, b])).rejects.toBeInstanceOf(ChainalysisRateLimitError);

    fetchMock.mockImplementation(async () => Response.json({ identifications: [] }));
    fetchMock.mockClear();
    await checkChainalysis([a, b, a]);
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([expect.stringContaining(b)]);
  });

  it("still reports other errors as plain failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
    const err = await checkChainalysis([ADDR]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ChainalysisRateLimitError);
  });
});
