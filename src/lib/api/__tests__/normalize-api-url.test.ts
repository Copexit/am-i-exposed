import { describe, it, expect } from "vitest";
import { normalizeApiUrl } from "../normalize-api-url";

describe("normalizeApiUrl", () => {
  it.each([
    ["https://mempool.space/api", "https://mempool.space/api"],
    ["  https://mempool.space/api/  ", "https://mempool.space/api"],
    ["https://mempool.space/api///", "https://mempool.space/api"],
    ["http://localhost:3006/api", "http://localhost:3006/api"],
    ["http://127.0.0.1:8999/api", "http://127.0.0.1:8999/api"],
    ["http://[::1]:3006/api", "http://[::1]:3006/api"],
    ["http://192.168.1.10/api", "http://192.168.1.10/api"],
    ["http://umbrel.local:3006/api", "http://umbrel.local:3006/api"],
    [
      "http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api",
      "http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api",
    ],
    ["HTTPS://Example.com/api", "HTTPS://Example.com/api"],
  ])("accepts %j", (input, expected) => {
    expect(normalizeApiUrl(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "not a url",
    "mempool.space/api",
    "/api",
    "localhost:3006/api",
    "http:mempool.space",
    "http://",
    "https:///api",
    "http://not a url",
    "ftp://mempool.space/api",
    "javascript:alert(1)",
    "data:text/plain,hi",
    "http://[bad/api",
  ])("rejects %j", (input) => {
    expect(normalizeApiUrl(input)).toBeNull();
  });
});
