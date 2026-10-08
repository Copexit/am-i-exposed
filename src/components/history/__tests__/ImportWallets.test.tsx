// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, o: { defaultValue?: string; count?: number } = {}) => (o.defaultValue ?? k).replace("{{count}}", String(o.count)) }) }));

import { ScanHistory } from "@/components/ScanHistory";

// BIP-84 test vector account zpub (public test data)
const ZPUB = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const wallet = { input: ZPUB, type: "wallet", grade: "B", score: 80, scriptType: "p2wpkh", network: "mainnet", savedAt: 1 };

afterEach(cleanup);

function setup() {
  const onImport = vi.fn(() => ({ imported: 1 }));
  render(<ScanHistory scans={[]} bookmarks={[{ input: "a".repeat(64), type: "txid", grade: "B", score: 80, savedAt: 1 }]}
    onSelect={() => {}} onRemoveBookmark={() => {}} onClearBookmarks={() => {}} onExportBookmarks={() => {}} onImportBookmarks={onImport} />);
  const pick = (items: unknown[]) => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File([JSON.stringify({ version: 1, bookmarks: items, graphs: [] })], "w.json")] } });
  };
  return { onImport, pick };
}

describe("importing a bookmarks file", () => {
  it("with wallet bookmarks: warns before importing, wallets only after I understand", async () => {
    const { onImport, pick } = setup();
    pick([wallet]);
    const prompt = await screen.findByTestId("import-wallets-prompt");
    expect(prompt.textContent).toContain("This file contains 1 wallet bookmarks");
    expect(prompt.textContent).toContain("never on a shared or public computer");
    expect(onImport).not.toHaveBeenCalled();
    const withWallets = screen.getByRole("button", { name: "Import with wallets" });
    expect(withWallets).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand" }));
    fireEvent.click(withWallets);
    expect(onImport).toHaveBeenCalledWith(expect.any(String), { includeWallets: true });
    expect(screen.queryByTestId("import-wallets-prompt")).toBeNull();
  });

  it("without wallets: can import the rest, or imports directly when the file has none", async () => {
    const first = setup();
    first.pick([wallet]);
    fireEvent.click(await screen.findByRole("button", { name: "Import without wallets" }));
    expect(first.onImport).toHaveBeenCalledWith(expect.any(String), { includeWallets: false });
    cleanup();
    const second = setup();
    second.pick([{ input: "b".repeat(64), type: "txid", grade: "A", score: 90, savedAt: 1 }]);
    await waitFor(() => expect(second.onImport).toHaveBeenCalledWith(expect.any(String), { includeWallets: false }));
    expect(screen.queryByTestId("import-wallets-prompt")).toBeNull();
  });
});
