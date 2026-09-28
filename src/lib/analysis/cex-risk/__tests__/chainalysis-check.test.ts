import { describe, it, expect, vi, afterEach } from "vitest";
import { checkChainalysis, ChainalysisRateLimitError, ChainalysisServiceError } from "../chainalysis-check";

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

  it("never reads a Chainalysis service error (HTTP 200, no identifications) as not sanctioned, and does not cache it", async () => {
    const addr = "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h";
    const outage = { message: "Server Error", status: "500", cause2: "cannot execute INSERT in a read-only transaction" };
    const fetchMock = vi.fn(async () => Response.json(outage));
    vi.stubGlobal("fetch", fetchMock);
    await expect(checkChainalysis([addr])).rejects.toBeInstanceOf(ChainalysisServiceError);

    fetchMock.mockImplementation(async () => Response.json({ identifications: [] }));
    await expect(checkChainalysis([addr])).resolves.toMatchObject({ sanctioned: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a non-JSON body as a service error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 200 })));
    await expect(checkChainalysis(["1BoatSLRHtKNngkdXEeobR76b53LETtpyT"])).rejects.toBeInstanceOf(ChainalysisServiceError);
  });
});
