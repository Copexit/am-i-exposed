// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_k: string, o: { defaultValue?: string } = {}) => o.defaultValue ?? _k, i18n: { language: "en" } }) }));
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => ({ network: "signet" }) }));

import { WalletBookmarkButton } from "../WalletBookmarkButton";
import { BookmarkList, maskWalletKey } from "@/components/history/BookmarkList";

// BIP-84 test vector account zpub (public test data)
const ZPUB = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const stored = () => JSON.parse(localStorage.getItem("bookmarks") ?? "[]") as Record<string, unknown>[];

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("wallet bookmark", () => {
  it("cannot save without confirming the privacy dialog; saves name, type and network once confirmed", () => {
    render(<WalletBookmarkButton input={ZPUB} scriptType="p2wpkh" grade="B" score={81} snapshotKey={"cd".repeat(32)} />);
    fireEvent.click(screen.getByRole("button", { name: /Bookmark this wallet/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("never on a shared or public computer");
    const save = screen.getByRole("button", { name: "Save bookmark" });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.click(save);
    expect(stored()).toEqual([]);

    fireEvent.change(screen.getByPlaceholderText("e.g. Savings"), { target: { value: "Savings" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand" }));
    fireEvent.click(save);
    expect(stored()).toEqual([expect.objectContaining({
      input: ZPUB, type: "wallet", label: "Savings", scriptType: "p2wpkh", network: "signet", grade: "B", score: 81, snapshotKey: "cd".repeat(32),
    })]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /Bookmarked/ })).toBeTruthy();
  });

  it("the list masks the key; removing asks whether to forget the saved scan", () => {
    const onRemove = vi.fn();
    const bm = { input: ZPUB, type: "wallet" as const, grade: "B", score: 81, savedAt: 1, scriptType: "p2wpkh", network: "signet", label: "Savings", snapshotKey: "cd".repeat(32) };
    render(<BookmarkList bookmarks={[bm]} onSelect={() => {}} onRemoveBookmark={onRemove} />);
    expect(maskWalletKey(ZPUB)).toBe("zpub6rFR...GutZYs");
    expect(screen.getByText(maskWalletKey(ZPUB))).toBeTruthy();
    expect(document.body.textContent).not.toContain(ZPUB);
    fireEvent.click(screen.getByRole("button", { name: "Remove bookmark" }));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove the bookmark only" }));
    expect(onRemove).toHaveBeenCalledWith(ZPUB);
  });
});
