// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBookmarks, walletsInImport } from "../useBookmarks";

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
    expect(result.current.bookmarks[0]?.input).toBe("abc123");
    expect(result.current.bookmarks[0]?.grade).toBe("B");
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
    expect(result.current.bookmarks[0]?.input).toBe("tx2");
  });

  it("updates a label", () => {
    const { result } = renderHook(() => useBookmarks());
    act(() => {
      result.current.addBookmark({ input: "tx1", type: "txid", grade: "B", score: 80 });
    });
    act(() => {
      result.current.updateLabel("tx1", "My Transaction");
    });
    expect(result.current.bookmarks[0]?.label).toBe("My Transaction");
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
    expect(result.current.bookmarks[0]?.input).toBe("tx2");

    act(() => {
      result.current.addBookmark({ input: "tx1", type: "txid", grade: "A+", score: 95 });
    });
    // tx1 should be at the top now, and only appear once
    expect(result.current.bookmarks).toHaveLength(2);
    expect(result.current.bookmarks[0]?.input).toBe("tx1");
    expect(result.current.bookmarks[0]?.grade).toBe("A+");
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
      const createElementSpy = vi.spyOn(document, "createElement").mockReturnValue({
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

      createElementSpy.mockRestore();
      vi.unstubAllGlobals();
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
      const existingSavedAt = result.current.bookmarks[0]!.savedAt;

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
      const existingSavedAt = result.current.bookmarks[0]!.savedAt;

      const data = JSON.stringify([
        { input: "tx1", type: "txid", grade: "D", score: 30, savedAt: existingSavedAt - 1000 },
      ]);

      let importResult: { imported: number; error?: string } = { imported: 0 };
      act(() => {
        importResult = result.current.importBookmarks(data);
      });

      expect(importResult.imported).toBe(0);
      expect(result.current.bookmarks[0]?.grade).toBe("B"); // Kept existing
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
      expect(result.current.bookmarks[0]?.input).toBe("tx1");
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

  it("removes truncated PSBT bookmarks saved by older versions from storage", async () => {
    localStorage.setItem("bookmarks", JSON.stringify([
      { input: "cHNidP8BAHECAAAAAXqm...", type: "txid", grade: "C", score: 60, savedAt: 1 },
      { input: "a".repeat(64), type: "txid", grade: "B", score: 78, savedAt: 2 },
    ]));
    const { useBookmarks: fresh } = await import("../useBookmarks");
    const { result } = renderHook(() => fresh());
    expect(result.current.bookmarks.map((b) => b.input)).toEqual(["a".repeat(64)]);
    expect(localStorage.getItem("bookmarks")).not.toContain("cHNidP");
    expect(localStorage.getItem("bookmarks")).toContain("a".repeat(64));
  });
  describe("wallet bookmarks", () => {
    // BIP-84 test vector account zpub (public test data)
    const ZPUB = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
    const wallet = { input: ZPUB, type: "wallet" as const, grade: "B", score: 80, scriptType: "p2wpkh", network: "mainnet", label: "Savings", snapshotKey: "ab".repeat(32) };

    it("keeps old bookmark data working next to wallet entries", async () => {
      // Data written by an older version: no wallet fields at all
      localStorage.setItem("bookmarks", JSON.stringify([
        { input: "a".repeat(64), type: "txid", grade: "B", score: 78, savedAt: 2 },
        { input: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", type: "address", grade: "C", score: 60, label: "x", savedAt: 1 },
        { ...wallet, savedAt: 3 },
        // Invalid wallet entries are dropped: bad key, missing fields, bad snapshot key
        { ...wallet, input: ZPUB.slice(0, -1) + "x", savedAt: 4 },
        { input: ZPUB, type: "wallet", grade: "B", score: 1, savedAt: 5 },
        { ...wallet, snapshotKey: "not-hex", savedAt: 6 },
      ]));
      const { useBookmarks: fresh } = await import("../useBookmarks");
      const { result } = renderHook(() => fresh());
      expect(result.current.bookmarks.map((b) => b.type)).toEqual(["txid", "address", "wallet"]);
    });

    it("exports without wallets by default, with them only when asked", () => {
      const { result } = renderHook(() => useBookmarks());
      act(() => {
        result.current.addBookmark({ input: "tx1", type: "txid", grade: "B", score: 80 });
        result.current.addBookmark(wallet);
      });
      const blobs: string[] = [];
      vi.stubGlobal("Blob", class { constructor(parts: string[]) { blobs.push(parts.join("")); } });
      vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: () => {} });
      const spy = vi.spyOn(document, "createElement").mockReturnValue({ click: () => {} } as unknown as HTMLAnchorElement);
      act(() => { result.current.exportBookmarks(); });
      act(() => { result.current.exportBookmarks({ includeWallets: true }); });
      spy.mockRestore();
      vi.unstubAllGlobals();
      expect(blobs[0]).not.toContain(ZPUB);
      expect(blobs[0]).toContain("tx1");
      expect(blobs[1]).toContain(ZPUB);
    });

    it("imports wallet entries only when asked (after the privacy confirmation), rejecting invalid ones", () => {
      const file = JSON.stringify({ version: 1, bookmarks: [
        { input: "tx1", type: "txid", grade: "B", score: 80, savedAt: 1 },
        { ...wallet, label: "x".repeat(60), savedAt: 1 },
        { ...wallet, input: "zpubnotakey", savedAt: 2 },
      ], graphs: [] });
      expect(walletsInImport(file)).toBe(1);
      expect(walletsInImport("not json")).toBe(0);
      const { result } = renderHook(() => useBookmarks());
      let r = { imported: 0 } as { imported: number; error?: string };
      act(() => { r = result.current.importBookmarks(file); });
      expect(r.imported).toBe(1);
      expect(result.current.bookmarks.map((b) => b.type)).toEqual(["txid"]);
      act(() => { r = result.current.importBookmarks(file, { includeWallets: true }); });
      expect(r.imported).toBe(1);
      const w = result.current.bookmarks.find((b) => b.type === "wallet")!;
      expect(w.label).toHaveLength(40);
    });

    it("removes all wallet bookmarks, keeps the others", () => {
      const { result } = renderHook(() => useBookmarks());
      act(() => {
        result.current.addBookmark({ input: "tx1", type: "txid", grade: "B", score: 80 });
        result.current.addBookmark(wallet);
      });
      act(() => { result.current.removeWalletBookmarks(); });
      expect(result.current.bookmarks.map((b) => b.input)).toEqual(["tx1"]);
    });
  });
});
