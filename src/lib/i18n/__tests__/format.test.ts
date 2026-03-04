import { describe, it, expect, vi, afterEach } from "vitest";
import { formatTimeAgo } from "../format";

describe("formatTimeAgo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setNow(unixSeconds: number) {
    vi.useFakeTimers();
    vi.setSystemTime(unixSeconds * 1000);
  }

  const NOW = 1700000000; // arbitrary fixed timestamp

  it("formats seconds ago", () => {
    setNow(NOW);
    const result = formatTimeAgo(NOW - 30, "en");
    expect(result).toMatch(/30/);
    expect(result).toMatch(/ago/i);
  });

  it("formats minutes ago", () => {
    setNow(NOW);
    const result = formatTimeAgo(NOW - 300, "en");
    expect(result).toMatch(/5/);
    expect(result).toMatch(/ago/i);
  });

  it("formats hours ago", () => {
    setNow(NOW);
    const result = formatTimeAgo(NOW - 7200, "en");
    expect(result).toMatch(/2/);
    expect(result).toMatch(/ago/i);
  });

  it("formats days ago", () => {
    setNow(NOW);
    const result = formatTimeAgo(NOW - 86400 * 3, "en");
    expect(result).toMatch(/3/);
    expect(result).toMatch(/ago/i);
  });

  it("formats months ago", () => {
    setNow(NOW);
    const result = formatTimeAgo(NOW - 86400 * 60, "en");
    expect(result).toMatch(/2/);
    expect(result).toMatch(/ago/i);
  });

  it("formats years ago", () => {
    setNow(NOW);
    const result = formatTimeAgo(NOW - 86400 * 400, "en");
    // narrow style may output "last yr." or "1 yr. ago"
    expect(result).toMatch(/yr|year/i);
  });

  it("handles zero difference", () => {
    setNow(NOW);
    const result = formatTimeAgo(NOW, "en");
    expect(result).toBeTruthy();
  });

  it("returns a non-empty string for all time ranges", () => {
    setNow(NOW);
    const offsets = [1, 120, 7200, 86400, 2592000, 31536000];
    for (const offset of offsets) {
      const result = formatTimeAgo(NOW - offset, "en");
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
