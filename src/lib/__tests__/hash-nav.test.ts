// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { setHash } from "../hash-nav";

describe("setHash", () => {
  beforeEach(() => { window.history.replaceState(null, "", "/"); });

  it("pushes a history entry and fires hashchange", () => {
    const events: string[] = [];
    const on = () => events.push(window.location.hash);
    window.addEventListener("hashchange", on);
    const before = window.history.length;
    setHash("tx=abc");
    window.removeEventListener("hashchange", on);
    expect(window.location.hash).toBe("#tx=abc");
    expect(window.history.length).toBe(before + 1);
    expect(events).toEqual(["#tx=abc"]);
  });

  it("clears the hash without leaving a bare '#'", () => {
    setHash("addr=x");
    setHash("");
    expect(window.location.href.endsWith("/")).toBe(true);
    expect(window.location.hash).toBe("");
  });

  it("is a no-op for the current hash", () => {
    setHash("#tx=abc");
    let fired = 0;
    const on = () => { fired++; };
    window.addEventListener("hashchange", on);
    setHash("tx=abc");
    window.removeEventListener("hashchange", on);
    expect(fired).toBe(0);
  });

  it("replace rewrites the current entry", () => {
    setHash("xpub=z");
    const before = window.history.length;
    setHash("", { replace: true });
    expect(window.history.length).toBe(before);
    expect(window.location.hash).toBe("");
  });
});
