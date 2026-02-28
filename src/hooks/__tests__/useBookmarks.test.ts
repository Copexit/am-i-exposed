import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBookmarks } from "../useBookmarks";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("useBookmarks", () => {
  it("starts with empty bookmarks", () => {
    const { result } = renderHook(() => useBookmarks());
    expect(result.current.bookmarks).toHaveLength(0);
  });

  it("adds a bookmark", () => {
    const { result } = renderHook(() => useBookmarks());
    act(() => {
      result.current.addBookmark({
        input: "abc123",
        type: "txid",
        grade: "B",
        score: 78,
      });
    });
    expect(result.current.bookmarks).toHaveLength(1);
    expect(result.current.bookmarks[0].input).toBe("abc123");
    expect(result.current.bookmarks[0].grade).toBe("B");
  });

  it("removes a bookmark", () => {
    const { result } = renderHook(() => useBookmarks());
    act(() => {
      result.current.addBookmark({ input: "tx1", type: "txid", grade: "A+", score: 95 });
      result.current.addBookmark({ input: "tx2", type: "txid", grade: "C", score: 55 });
    });
    expect(result.current.bookmarks).toHaveLength(2);

    act(() => {
      result.current.removeBookmark("tx1");
    });
    expect(result.current.bookmarks).toHaveLength(1);
    expect(result.current.bookmarks[0].input).toBe("tx2");
  });

  it("updates a label", () => {
    const { result } = renderHook(() => useBookmarks());
    act(() => {
      result.current.addBookmark({ input: "tx1", type: "txid", grade: "B", score: 80 });
    });
    act(() => {
      result.current.updateLabel("tx1", "My Transaction");
    });
    expect(result.current.bookmarks[0].label).toBe("My Transaction");
  });

  it("clears all bookmarks", () => {
    const { result } = renderHook(() => useBookmarks());
    act(() => {
      result.current.addBookmark({ input: "tx1", type: "txid", grade: "B", score: 80 });
      result.current.addBookmark({ input: "tx2", type: "txid", grade: "C", score: 55 });
    });
    expect(result.current.bookmarks).toHaveLength(2);

    act(() => {
      result.current.clearBookmarks();
    });
    expect(result.current.bookmarks).toHaveLength(0);
  });

  it("isBookmarked returns correct value", () => {
    const { result } = renderHook(() => useBookmarks());
    act(() => {
      result.current.addBookmark({ input: "tx1", type: "txid", grade: "B", score: 80 });
    });
    expect(result.current.isBookmarked("tx1")).toBe(true);
    expect(result.current.isBookmarked("tx2")).toBe(false);
  });

  it("deduplicates on re-add (moves to top)", () => {
    const { result } = renderHook(() => useBookmarks());
    act(() => {
      result.current.addBookmark({ input: "tx1", type: "txid", grade: "B", score: 80 });
      result.current.addBookmark({ input: "tx2", type: "txid", grade: "C", score: 55 });
    });
    expect(result.current.bookmarks[0].input).toBe("tx2");

    act(() => {
      result.current.addBookmark({ input: "tx1", type: "txid", grade: "A+", score: 95 });
    });
    // tx1 should be at the top now, and only appear once
    expect(result.current.bookmarks).toHaveLength(2);
    expect(result.current.bookmarks[0].input).toBe("tx1");
    expect(result.current.bookmarks[0].grade).toBe("A+");
  });
});
