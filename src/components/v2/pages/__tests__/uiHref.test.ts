import { describe, it, expect } from "vitest";
import { uiHref } from "../uiHref";

describe("uiHref", () => {
  it("leaves classic links untouched", () => {
    expect(uiHref("/", "/faq/")).toBe("/");
    expect(uiHref("/#tx=ab", "/observatory/")).toBe("/#tx=ab");
    expect(uiHref("/guide", null)).toBe("/guide");
  });
  it("prefixes site links in v2", () => {
    expect(uiHref("/", "/v2/faq/")).toBe("/v2/");
    expect(uiHref("/#tx=ab", "/v2/graph")).toBe("/v2/#tx=ab");
    expect(uiHref("/setup-guide/", "/v2/welcome/")).toBe("/v2/setup-guide/");
  });
  it("never double-prefixes or touches external / hash links", () => {
    expect(uiHref("/v2/guide/", "/v2/faq/")).toBe("/v2/guide/");
    expect(uiHref("#top", "/v2/faq/")).toBe("#top");
    expect(uiHref("https://x.org/", "/v2/faq/")).toBe("https://x.org/");
    expect(uiHref("//cdn.x/", "/v2/faq/")).toBe("//cdn.x/");
  });
});
