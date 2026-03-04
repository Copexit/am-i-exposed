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

  describe("exportBookmarks", () => {
    it("triggers a download with current bookmarks as JSON", () => {
      const { result } = renderHook(() => useBookmarks());
      act(() => {
        result.current.addBookmark({ input: "tx1", type: "txid", grade: "B", score: 80 });
      });

      const createObjectURL = vi.fn(() => "blob:test");
      const revokeObjectURL = vi.fn();
      const clickSpy = vi.fn();
      vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
      vi.spyOn(document, "createElement").mockReturnValue({
        set href(_: string) { /* noop */ },
        set download(_: string) { /* noop */ },
        click: clickSpy,
      } as unknown as HTMLAnchorElement);

      act(() => {
        result.current.exportBookmarks();
      });

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    });
  });

  describe("importBookmarks", () => {
    it("imports valid bookmarks", () => {
      const { result } = renderHook(() => useBookmarks());
      const data = JSON.stringify([
        { input: "tx1", type: "txid", grade: "A+", score: 95, savedAt: 1000 },
        { input: "addr1", type: "address", grade: "C", score: 55, savedAt: 2000 },
      ]);

      let importResult: { imported: number; error?: string } = { imported: 0 };
      act(() => {
        importResult = result.current.importBookmarks(data);
      });

      expect(importResult.imported).toBe(2);
      expect(importResult.error).toBeUndefined();
      expect(result.current.bookmarks).toHaveLength(2);
    });

    it("merges with existing bookmarks, newer wins", () => {
      const { result } = renderHook(() => useBookmarks());
      // Add existing bookmark
      act(() => {
        result.current.addBookmark({ input: "tx1", type: "txid", grade: "B", score: 80 });
      });
      const existingSavedAt = result.current.bookmarks[0].savedAt;

      // Import same input with newer timestamp and different grade
      const data = JSON.stringify([
        { input: "tx1", type: "txid", grade: "A+", score: 95, savedAt: existingSavedAt + 1000 },
        { input: "tx2", type: "txid", grade: "D", score: 30, savedAt: 5000 },
      ]);

      let importResult: { imported: number; error?: string } = { imported: 0 };
      act(() => {
        importResult = result.current.importBookmarks(data);
      });

      expect(importResult.imported).toBe(2);
      expect(result.current.bookmarks).toHaveLength(2);
      const tx1 = result.current.bookmarks.find((b) => b.input === "tx1");
      expect(tx1?.grade).toBe("A+"); // Updated to newer
    });

    it("keeps existing when import has older timestamp", () => {
      const { result } = renderHook(() => useBookmarks());
      act(() => {
        result.current.addBookmark({ input: "tx1", type: "txid", grade: "B", score: 80 });
      });
      const existingSavedAt = result.current.bookmarks[0].savedAt;

      const data = JSON.stringify([
        { input: "tx1", type: "txid", grade: "D", score: 30, savedAt: existingSavedAt - 1000 },
      ]);

      let importResult: { imported: number; error?: string } = { imported: 0 };
      act(() => {
        importResult = result.current.importBookmarks(data);
      });

      expect(importResult.imported).toBe(0);
      expect(result.current.bookmarks[0].grade).toBe("B"); // Kept existing
    });

    it("rejects invalid JSON", () => {
      const { result } = renderHook(() => useBookmarks());
      let importResult: { imported: number; error?: string } = { imported: 0 };
      act(() => {
        importResult = result.current.importBookmarks("not json{{{");
      });
      expect(importResult.error).toBe("invalid_json");
      expect(importResult.imported).toBe(0);
    });

    it("rejects non-array JSON", () => {
      const { result } = renderHook(() => useBookmarks());
      let importResult: { imported: number; error?: string } = { imported: 0 };
      act(() => {
        importResult = result.current.importBookmarks(JSON.stringify({ foo: "bar" }));
      });
      expect(importResult.error).toBe("invalid_format");
    });

    it("filters out entries missing required fields", () => {
      const { result } = renderHook(() => useBookmarks());
      const data = JSON.stringify([
        { input: "tx1", type: "txid", grade: "B", score: 80, savedAt: 1000 }, // valid
        { input: "tx2", type: "txid" }, // missing fields
        { grade: "A+", score: 95 }, // missing input
        "not an object",
      ]);

      let importResult: { imported: number; error?: string } = { imported: 0 };
      act(() => {
        importResult = result.current.importBookmarks(data);
      });

      expect(importResult.imported).toBe(1);
      expect(result.current.bookmarks).toHaveLength(1);
      expect(result.current.bookmarks[0].input).toBe("tx1");
    });

    it("returns error when all entries are invalid", () => {
      const { result } = renderHook(() => useBookmarks());
      const data = JSON.stringify([
        { foo: "bar" },
        { input: "tx1" }, // missing type, grade, score, savedAt
      ]);

      let importResult: { imported: number; error?: string } = { imported: 0 };
      act(() => {
        importResult = result.current.importBookmarks(data);
      });

      expect(importResult.error).toBe("no_valid_entries");
      expect(importResult.imported).toBe(0);
    });
  });
});
