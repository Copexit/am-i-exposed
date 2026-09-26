import { describe, it, expect } from "vitest";
import { isNavActive, classicHref, graphHref } from "./nav";

const TX = "a".repeat(64);

describe("v2 chrome nav", () => {
  it("marks Guide active on knowledge pages", () => {
    expect(isNavActive("/v2/guide/", "/v2/faq")).toBe(true);
    expect(isNavActive("/v2/guide/", "/v2/glossary/")).toBe(true);
    expect(isNavActive("/v2/about/", "/v2/about")).toBe(true);
    expect(isNavActive("/v2/about/", "/v2")).toBe(false);
  });
  it("maps to the classic page with the hash", () => {
    expect(classicHref("/v2", `#tx=${TX}`)).toBe(`/#tx=${TX}`);
    expect(classicHref("/v2/", "")).toBe("/");
    expect(classicHref("/v2/guide/", "#x")).toBe("/guide/#x");
  });
  it("deep-links graph from a tx scan only", () => {
    expect(graphHref("/v2/", `#tx=${TX}`)).toBe(`/v2/graph/#txid=${TX}`);
    expect(graphHref("/v2/", "#addr=1abc")).toBe("/v2/graph/");
    expect(graphHref("/v2/about", `#tx=${TX}`)).toBe("/v2/graph/");
  });
});
