// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.defaultValue as string) ?? key,
  }),
}));

const importBookmarks = vi.fn(() => ({ imported: 0, error: "storage_full" }));
vi.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({ bookmarks: [], exportBookmarks: vi.fn(), importBookmarks }),
}));
vi.mock("@/hooks/useSavedGraphs", () => ({
  useSavedGraphs: () => ({ graphs: [] }),
}));

import { WorkspaceSettingsPanel } from "../settings/WorkspaceSettingsPanel";
import { ScanHistory } from "../ScanHistory";

afterEach(cleanup);

const STORAGE_FULL = "Browser storage is full. Delete some bookmarks or saved graphs and try again.";

function pickFile(input: Element) {
  const file = new File(["[]"], "bookmarks.json", { type: "application/json" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("bookmark import when storage is full", () => {
  it("WorkspaceSettingsPanel shows a storage-full message, not 'invalid file'", async () => {
    const { container } = render(<WorkspaceSettingsPanel />);
    pickFile(container.querySelector('input[type="file"]')!);
    expect(await screen.findByText(STORAGE_FULL)).toBeTruthy();
  });

  it("ScanHistory shows a storage-full message, not 'invalid file'", async () => {
    const { container } = render(
      <ScanHistory
        scans={[]}
        bookmarks={[{ input: "a".repeat(64), type: "txid", grade: "B", score: 70, savedAt: 0 }]}
        onSelect={vi.fn()}
        onRemoveBookmark={vi.fn()}
        onClearBookmarks={vi.fn()}
        onExportBookmarks={vi.fn()}
        onImportBookmarks={importBookmarks}
      />,
    );
    pickFile(container.querySelector('input[type="file"]')!);
    expect(await screen.findByText(STORAGE_FULL)).toBeTruthy();
  });
});
