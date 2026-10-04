import { describe, it, expect } from "vitest";
import { backendClass, endpointHost, isOnionUrl } from "../backend-class";

describe("backendClass", () => {
  it.each([
    [{ isUmbrel: true, customApiUrl: null }, "self-hosted"],
    [{ isUmbrel: false, customApiUrl: "http://192.168.1.5:3006/api" }, "self-hosted"],
    [{ isUmbrel: false, customApiUrl: "http://umbrel.local:3006/api" }, "self-hosted"],
    [{ isUmbrel: false, customApiUrl: "http://abcdefghijklmnop.onion/api" }, "self-hosted"],
    [{ isUmbrel: false, customApiUrl: "https://mempool.example.org/api" }, "public"],
    [{ isUmbrel: false, customApiUrl: null }, "public"],
  ] as const)("%o -> %s", (o, cls) => expect(backendClass(o)).toBe(cls));
});

it("endpointHost / isOnionUrl", () => {
  expect(endpointHost("https://mempool.space/api")).toBe("mempool.space");
  expect(isOnionUrl("http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api")).toBe(true);
});
