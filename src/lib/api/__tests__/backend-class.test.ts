import { describe, it, expect } from "vitest";
import { isLocalApi } from "../client";
import { backendClass, endpointHost, isOnionUrl } from "../backend-class";

describe("backendClass", () => {
  it.each([
    [{ isUmbrel: true, customApiUrl: null }, "self-hosted"],
    [{ isUmbrel: false, customApiUrl: "http://192.168.1.5:3006/api" }, "self-hosted"],
    [{ isUmbrel: false, customApiUrl: "http://umbrel.local:3006/api" }, "self-hosted"],
    [{ isUmbrel: false, customApiUrl: "http://abcdefghijklmnop.onion/api" }, "self-hosted"],
    [{ isUmbrel: false, customApiUrl: "https://mempool.example.org/api" }, "public"],
    [{ isUmbrel: false, customApiUrl: "http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api" }, "public"],
    [{ isUmbrel: false, customApiUrl: "http://10.evil.com/api" }, "public"],
    [{ isUmbrel: false, customApiUrl: null }, "public"],
  ] as const)("%o -> %s", (o, cls) => expect(backendClass(o)).toBe(cls));
});

it("endpointHost / isOnionUrl", () => {
  expect(endpointHost("https://mempool.space/api")).toBe("mempool.space");
  expect(isOnionUrl("http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api")).toBe(true);
});

it("isLocalApi requires full private IPv4 quads", () => {
  expect(isLocalApi("http://10.evil.com/api")).toBe(false);
  expect(isLocalApi("http://192.168.1.example.org/api")).toBe(false);
  expect(isLocalApi("http://172.16.evil.com/api")).toBe(false);
  expect(isLocalApi("http://10.0.0.5/api")).toBe(true);
  expect(isLocalApi("http://192.168.1.5/api")).toBe(true);
  expect(isLocalApi("http://172.20.1.5/api")).toBe(true);
});
