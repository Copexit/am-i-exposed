// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const state = { saved: false };
const addBookmark = vi.fn(() => { state.saved = true; });
vi.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({ isBookmarked: () => state.saved, addBookmark, removeBookmark: vi.fn(), updateLabel: vi.fn() }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k }) }));

import { BookmarkButton } from "../BookmarkButton";

const NOTE = "Bookmarks persist in local storage. Clear anytime.";

describe("BookmarkButton", () => {
  beforeEach(() => { state.saved = false; localStorage.clear(); addBookmark.mockClear(); });
  afterEach(cleanup);

  it("creates the bookmark and asks for a label first; the storage note only follows", () => {
    render(<BookmarkButton query="abc" inputType="txid" grade="C" score={50} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(addBookmark).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Add a label (optional)", { selector: "input" })).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByText(NOTE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(localStorage.getItem("bookmark-privacy-dismissed")).toBe("1");
  });

  it("does not show the storage note again once dismissed", () => {
    localStorage.setItem("bookmark-privacy-dismissed", "1");
    render(<BookmarkButton query="abc" inputType="txid" grade="C" score={50} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});
