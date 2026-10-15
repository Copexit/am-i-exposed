// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      String((opts?.defaultValue as string) ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts?.[k])),
  }),
}));

import { bookmarkStore, type Bookmark } from "@/hooks/useBookmarks";
import { savedGraphStore } from "@/hooks/useSavedGraphs";
import { sealJson } from "@/lib/crypto/envelope";
import { BackupImportDialog } from "../settings/BackupImportDialog";
import { WorkspaceSettingsPanel } from "../settings/WorkspaceSettingsPanel";

const TXID = "b".repeat(64);
const bookmark: Bookmark = { input: TXID, type: "txid", grade: "A", score: 90, savedAt: 1 };

beforeEach(() => {
  localStorage.clear();
  bookmarkStore.remove();
  savedGraphStore.remove();
});
afterEach(cleanup);

describe("backup import", () => {
  it("a wrong password shows an inline error and writes nothing; the right one restores after confirming", async () => {
    const env = await sealJson({ version: 2, createdAt: 0, bookmarks: [bookmark], graphs: [] }, "correct horse", { iterations: 100000 });
    const onDone = vi.fn();
    render(<BackupImportDialog file={env} onDone={onDone} onCancel={vi.fn()} />);

    const pw = screen.getByTestId("backup-import-password");
    fireEvent.change(pw, { target: { value: "wrong password" } });
    fireEvent.click(screen.getByTestId("backup-import-submit"));
    expect(await screen.findByText("Wrong password. Try again.")).toBeTruthy();
    expect(localStorage.getItem("bookmarks")).toBeNull();

    fireEvent.change(pw, { target: { value: "correct horse" } });
    fireEvent.click(screen.getByTestId("backup-import-submit"));
    expect(await screen.findByTestId("backup-summary")).toBeTruthy();
    // The summary alone writes nothing
    expect(localStorage.getItem("bookmarks")).toBeNull();

    fireEvent.click(screen.getByTestId("backup-import-submit"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0]![0]).toMatchObject({ bookmarks: 1, graphs: 0 });
    expect(bookmarkStore.getSnapshot()[0]!.input).toBe(TXID);
  });

  it("shows the custom API host with its own checkbox, off by default", async () => {
    const onDone = vi.fn();
    render(<BackupImportDialog file={{ version: 2, createdAt: 0, bookmarks: [], graphs: [], settings: { "ami-custom-api-url": "https://evil.example/api" } }} onDone={onDone} onCancel={vi.fn()} />);
    const box = screen.getByTestId("backup-restore-custom-api") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText("Use custom server: evil.example")).toBeTruthy();
    fireEvent.click(screen.getByTestId("backup-import-submit"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(localStorage.getItem("ami-custom-api-url")).toBeNull();
  });

  it("a version 1 workspace file still imports through importBookmarks", async () => {
    const { container } = render(<WorkspaceSettingsPanel />);
    const file = new File([JSON.stringify({ version: 1, bookmarks: [bookmark], graphs: [] })], "w.json", { type: "application/json" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    expect(await screen.findByText("Imported 1 scans.")).toBeTruthy();
    expect(screen.queryByTestId("backup-import-dialog")).toBeNull();
    expect(bookmarkStore.getSnapshot()[0]!.input).toBe(TXID);
  });
});
