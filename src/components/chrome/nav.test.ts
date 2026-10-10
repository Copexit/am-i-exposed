import { describe, it, expect } from "vitest";
import { isNavActive, graphHref } from "./nav";

const TX = "a".repeat(64);

describe("chrome nav", () => {
  it("marks Guide active on knowledge pages", () => {
    expect(isNavActive("/guide/", "/faq")).toBe(true);
    expect(isNavActive("/guide/", "/glossary/")).toBe(true);
    expect(isNavActive("/about/", "/about")).toBe(true);
    expect(isNavActive("/about/", "/")).toBe(false);
  });
  it("keeps the section active on its subroutes", () => {
    expect(isNavActive("/guide/", "/guide/labeling/")).toBe(true);
    expect(isNavActive("/observatory/", "/observatory/p2p/")).toBe(true);
    expect(isNavActive("/observatory/", "/observatoryx/")).toBe(false);
    expect(isNavActive("/about/", "/observatory/")).toBe(false);
  });
  it("deep-links graph from a tx scan only", () => {
    expect(graphHref("/", `#tx=${TX}`)).toBe(`/graph/#txid=${TX}`);
    expect(graphHref("/", "#addr=1abc")).toBe("/graph/");
    expect(graphHref("/about", `#tx=${TX}`)).toBe("/graph/");
  });
});
