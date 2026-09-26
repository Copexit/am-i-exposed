import { describe, it, expect } from "vitest";
import { isV2Path, scannerHref, v2Href } from "../paths";

describe("v2 paths", () => {
  it("recognizes v2 pathnames only", () => {
    expect(isV2Path("/v2")).toBe(true);
    expect(isV2Path("/v2/guide/")).toBe(true);
    expect(isV2Path("/v22/")).toBe(false);
    expect(isV2Path("/")).toBe(false);
  });

  it("keeps scanner links in the current UI", () => {
    expect(scannerHref("tx=ab", "/v2/")).toBe("/v2/#tx=ab");
    expect(scannerHref("tx=ab", "/guide/")).toBe("/#tx=ab");
  });

  it("maps a classic page to its v2 counterpart, keeping only hashes v2 understands", () => {
    expect(v2Href("/", "#tx=ab")).toBe("/v2/#tx=ab");
    expect(v2Href("/", "")).toBe("/v2/");
    expect(v2Href("/guide/", "")).toBe("/v2/guide/");
    expect(v2Href("/faq/", "#address-reuse")).toBe("/v2/faq/");
    expect(v2Href("/graph/", "#txid=ab")).toBe("/v2/graph/#txid=ab");
    expect(v2Href("/graph/", "#tx=ab")).toBe("/v2/graph/");
  });
});
