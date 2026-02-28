import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecentScans } from "../useRecentScans";

beforeEach(() => {
  sessionStorage.clear();
  vi.resetModules();
});

describe("useRecentScans", () => {
  it("starts with empty scans", () => {
    const { result } = renderHook(() => useRecentScans());
    expect(result.current.scans).toHaveLength(0);
  });

  it("adds a scan", () => {
    const { result } = renderHook(() => useRecentScans());
    act(() => {
      result.current.addScan({
        input: "abc123",
        type: "txid",
        grade: "B",
        score: 78,
      });
    });
    expect(result.current.scans).toHaveLength(1);
    expect(result.current.scans[0].input).toBe("abc123");
  });

  it("caps at 5 recent scans", () => {
    const { result } = renderHook(() => useRecentScans());
    act(() => {
      for (let i = 0; i < 7; i++) {
        result.current.addScan({
          input: `tx${i}`,
          type: "txid",
          grade: "B",
          score: 70 + i,
        });
      }
    });
    expect(result.current.scans).toHaveLength(5);
    // Most recent should be first
    expect(result.current.scans[0].input).toBe("tx6");
  });

  it("clears all scans", () => {
    const { result } = renderHook(() => useRecentScans());
    act(() => {
      result.current.addScan({ input: "tx1", type: "txid", grade: "B", score: 80 });
    });
    expect(result.current.scans).toHaveLength(1);

    act(() => {
      result.current.clearScans();
    });
    expect(result.current.scans).toHaveLength(0);
  });

  it("uses sessionStorage (not localStorage)", () => {
    const { result } = renderHook(() => useRecentScans());
    act(() => {
      result.current.addScan({ input: "tx1", type: "txid", grade: "B", score: 80 });
    });
    expect(sessionStorage.getItem("recent-scans")).toBeTruthy();
    expect(localStorage.getItem("recent-scans")).toBeNull();
  });

  it("deduplicates on re-add", () => {
    const { result } = renderHook(() => useRecentScans());
    act(() => {
      result.current.addScan({ input: "tx1", type: "txid", grade: "B", score: 80 });
      result.current.addScan({ input: "tx2", type: "txid", grade: "C", score: 55 });
    });

    act(() => {
      result.current.addScan({ input: "tx1", type: "txid", grade: "A+", score: 95 });
    });
    expect(result.current.scans).toHaveLength(2);
    expect(result.current.scans[0].input).toBe("tx1");
    expect(result.current.scans[0].grade).toBe("A+");
  });
});
