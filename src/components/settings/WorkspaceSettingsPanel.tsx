"use client";

import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Download, Upload } from "lucide-react";
import { useBookmarks } from "@/hooks/useBookmarks";
import { ImportWalletsPrompt } from "@/components/history/ImportWalletsPrompt";
import { walletsInImport } from "@/hooks/useBookmarks";
import { useSavedGraphs } from "@/hooks/useSavedGraphs";
import { isSealedEnvelope } from "@/lib/crypto/envelope";
import { parseBackup, type RestoreResult } from "@/hooks/backup";
import { BackupExportDialog } from "./BackupExportDialog";
import { BackupImportDialog } from "./BackupImportDialog";
import type { TFunction } from "i18next";

const nBookmarks = (t: TFunction, count: number) => t("workspace.nBookmarks", { count, defaultValue: "{{count}} bookmarks" });
const nGraphs = (t: TFunction, count: number) => t("workspace.nGraphs", { count, defaultValue: "{{count}} graphs" });

export function WorkspaceSettingsPanel() {
  const { t } = useTranslation();
  const { bookmarks, importBookmarks } = useBookmarks();
  const { graphs } = useSavedGraphs();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exportPrompt, setExportPrompt] = useState(false);
  /** A sealed or version 2 file waiting for its password and summary */
  const [pendingBackup, setPendingBackup] = useState<unknown>(null);
  const [pendingImport, setPendingImport] = useState<{ json: string; wallets: number } | null>(null);
  const walletCount = bookmarks.filter((b) => b.type === "wallet").length;
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleExport = useCallback(() => {
    // No "nothing to export" guard: saved wallet scans and settings alone are worth a backup
    setPendingBackup(null);
    setPendingImport(null);
    setExportPrompt(true);
  }, []);

  const storageFull = useCallback(() => showToast("error", t("workspace.storageFull", { defaultValue: "Browser storage is full. Delete some bookmarks or saved graphs and try again." })), [showToast, t]);

  const restored = useCallback((r: RestoreResult) => {
    setPendingBackup(null);
    if (r.error === "storage_full") return storageFull();
    const parts = [t("backup.restored", { bookmarks: nBookmarks(t, r.bookmarks), graphs: nGraphs(t, r.graphs), defaultValue: "Restored {{bookmarks}} and {{graphs}}." })];
    if (r.savedWallets > 0) parts.push(t("backup.restoredSavedWallets", { count: r.savedWallets, defaultValue: "{{count}} saved wallet scans restored." }));
    if (r.settings > 0) parts.push(t("backup.settingsReload", { defaultValue: "Reload the page to apply the restored settings." }));
    showToast("success", parts.join(" "));
  }, [showToast, storageFull, t]);

  const runImport = useCallback((json: string, includeWallets: boolean) => {
    const result = importBookmarks(json, { includeWallets });
    if (result.error === "storage_full") {
      storageFull();
    } else if (result.error) {
      showToast("error", t("workspace.importError", { defaultValue: "Import failed. Invalid file format." }));
    } else {
      showToast("success", t("workspace.imported", { count: result.imported, defaultValue: "Imported {{count}} scans." }));
    }
  }, [importBookmarks, showToast, storageFull, t]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const json = reader.result as string;
      let parsed: unknown = null;
      try { parsed = JSON.parse(json); } catch { /* reported by importBookmarks */ }
      setExportPrompt(false);
      setPendingImport(null);
      setPendingBackup(null);
      if (isSealedEnvelope(parsed) || parseBackup(parsed)) {
        setPendingBackup(parsed);
        return;
      }
      // Version 1 workspace files and legacy formats
      const wallets = walletsInImport(json);
      if (wallets > 0) setPendingImport({ json, wallets });
      else runImport(json, false);
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-imported
    e.target.value = "";
  }, [runImport]);


  return (
    <div className="border-t border-card-border pt-3 space-y-2">
      <p className="text-xs font-medium text-muted">
        {t("workspace.title", { defaultValue: "Workspace" })}
      </p>
      <p className="text-[11px] text-muted/70">
        {t("workspace.itemCount", { bookmarks: nBookmarks(t, bookmarks.length), graphs: nGraphs(t, graphs.length), defaultValue: "{{bookmarks}} and {{graphs}} saved" })}
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleExport}
          className="flex-1 flex items-center justify-center gap-1.5 text-[11px] text-muted hover:text-foreground py-1.5 rounded-lg border border-card-border hover:border-muted/50 transition-colors cursor-pointer"
        >
          <Download size={12} />
          {t("workspace.export", { defaultValue: "Export" })}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-1.5 text-[11px] text-muted hover:text-foreground py-1.5 rounded-lg border border-card-border hover:border-muted/50 transition-colors cursor-pointer"
        >
          <Upload size={12} />
          {t("workspace.import", { defaultValue: "Import" })}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          className="hidden"
        />
      </div>
      {pendingImport && (
        <ImportWalletsPrompt
          walletCount={pendingImport.wallets}
          onImport={(includeWallets) => { runImport(pendingImport.json, includeWallets); setPendingImport(null); }}
          onCancel={() => setPendingImport(null)}
        />
      )}
      {pendingBackup !== null && (
        <BackupImportDialog file={pendingBackup} onDone={restored} onCancel={() => setPendingBackup(null)} />
      )}
      {exportPrompt && (
        <BackupExportDialog
          walletCount={walletCount}
          onDone={({ bookmarks: b, graphs: g }) => {
            setExportPrompt(false);
            showToast("success", t("workspace.exported", { bookmarks: nBookmarks(t, b), graphs: nGraphs(t, g), defaultValue: "Exported {{bookmarks}} and {{graphs}}." }));
          }}
          onCancel={() => setExportPrompt(false)}
        />
      )}
      {toast && (
        <p className={`text-[11px] ${toast.type === "success" ? "text-severity-good" : "text-severity-critical"}`}>
          {toast.message}
        </p>
      )}
    </div>
  );
}
