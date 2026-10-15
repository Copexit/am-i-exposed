"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { parseBackup, restoreBackup, summarizeBackup, type BackupPayload, type RestoreResult } from "@/hooks/backup";
import { isSealedEnvelope, openJson, WrongPasswordError } from "@/lib/crypto/envelope";
import { getAnalysisSettings } from "@/lib/analysis/settings";
import { inputClass } from "./BackupExportDialog";

/**
 * Import a v2 backup (sealed or plain): the password first when sealed, then
 * a summary with what to restore. Nothing is written before "Restore".
 */
export function BackupImportDialog({ file, onDone, onCancel }: {
  /** The parsed file: a sealed envelope or a plain version 2 backup */
  file: unknown;
  onDone: (result: RestoreResult) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [payload, setPayload] = useState<BackupPayload | null>(() => (isSealedEnvelope(file) ? null : parseBackup(file)));
  const [pw, setPw] = useState("");
  const [error, setError] = useState<"wrong" | "invalid" | null>(null);
  const [busy, setBusy] = useState(false);
  const [wallets, setWallets] = useState(false);
  const [saved, setSaved] = useState(true);
  const [settings, setSettings] = useState(false);
  const cacheOn = getAnalysisSettings().enableCache;

  const unlock = async () => {
    if (!isSealedEnvelope(file) || !pw || busy) return;
    setBusy(true);
    setError(null);
    try {
      const inner = parseBackup(await openJson(file, pw));
      if (inner) setPayload(inner);
      else setError("invalid");
    } catch (e) {
      setError(e instanceof WrongPasswordError ? "wrong" : "invalid");
    }
    setBusy(false);
  };

  const restore = async () => {
    if (!payload || busy) return;
    setBusy(true);
    try {
      onDone(await restoreBackup(payload, { includeWallets: wallets, includeSavedWallets: saved && cacheOn, includeSettings: settings }));
    } catch {
      setError("invalid");
      setBusy(false);
    }
  };

  const s = payload && summarizeBackup(payload);
  const check = (checked: boolean, set: (v: boolean) => void, label: string, testId: string, disabled = false) => (
    <label className={`flex items-start gap-2 text-foreground select-none min-h-[32px] ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" data-testid={testId} checked={checked && !disabled} disabled={disabled} onChange={(e) => set(e.target.checked)} className="accent-bitcoin mt-0.5" />
      <span>{label}</span>
    </label>
  );

  return (
    <form
      role="group"
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
      data-testid="backup-import-dialog"
      className="rounded-lg border border-card-border bg-surface-elevated p-3 space-y-2 text-xs"
      onKeyDown={(e) => { if (e.key === "Escape" && !busy) { e.stopPropagation(); onCancel(); } }}
      onSubmit={(e) => { e.preventDefault(); void (payload ? restore() : unlock()); }}
    >
      <p id={`${id}-title`} className="font-medium text-foreground">
        {t("backup.importTitle", { defaultValue: "Restore a backup" })}
      </p>

      {!s && isSealedEnvelope(file) && (
        <label className="block space-y-1">
          <span className="text-muted">{t("backup.enterPassword", { defaultValue: "This backup is protected. Enter its password." })}</span>
          <input type="password" autoComplete="current-password" autoFocus value={pw}
            onChange={(e) => { setPw(e.target.value); setError(null); }}
            aria-invalid={error === "wrong" || undefined} aria-describedby={`${id}-err`}
            className={inputClass} data-testid="backup-import-password" />
        </label>
      )}
      <p id={`${id}-err`} role="alert" className="text-severity-critical empty:hidden">
        {error === "wrong" && t("backup.wrongPassword", { defaultValue: "Wrong password. Try again." })}
        {error === "invalid" && t("backup.invalidFile", { defaultValue: "This file is damaged or not a backup." })}
      </p>

      {s && (
        <>
          <ul data-testid="backup-summary" className="space-y-0.5 text-foreground/90 list-disc pl-5">
            <li>{t("backup.nBookmarks", { count: s.bookmarks, defaultValue: "{{count}} bookmarks" })}</li>
            <li>{t("backup.nGraphs", { count: s.graphs, defaultValue: "{{count}} graphs" })}</li>
            {s.wallets > 0 && <li>{t("backup.nWallets", { count: s.wallets, defaultValue: "{{count}} wallet bookmarks" })}</li>}
            {s.savedWallets > 0 && <li>{t("backup.nSavedWallets", { count: s.savedWallets, defaultValue: "{{count}} saved wallet scans" })}</li>}
            {s.settings > 0 && <li>{t("backup.hasSettings", { defaultValue: "Settings" })}</li>}
          </ul>
          {s.wallets > 0 && (
            <>
              <p className="flex gap-2 text-foreground leading-relaxed">
                <ShieldAlert size={14} className="text-severity-medium shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  {t("wallet.bookmark.reveals", { defaultValue: "The key (xpub) reveals every past and future address and the balance of this wallet to anyone who can open this browser profile." })}{" "}
                  {t("wallet.bookmark.ownDevice", { defaultValue: "Use it only on your own device, never on a shared or public computer." })}
                </span>
              </p>
              {check(wallets, setWallets, t("backup.restoreWallets", { count: s.wallets, defaultValue: "Restore the {{count}} wallet bookmarks" }), "backup-restore-wallets")}
            </>
          )}
          {s.savedWallets > 0 && (
            <>
              {check(saved, setSaved, t("backup.restoreSavedWallets", { defaultValue: "Restore saved wallet data" }), "backup-restore-saved", !cacheOn)}
              {!cacheOn && <p className="pl-6 text-muted">{t("backup.cacheOff", { setting: t("settings.enableCache", { defaultValue: "Persist cache across sessions" }), defaultValue: "Turn on \"{{setting}}\" to restore saved wallet data." })}</p>}
            </>
          )}
          {s.settings > 0 && check(settings, setSettings, t("backup.restoreSettings", { defaultValue: "Also restore settings" }), "backup-restore-settings")}
        </>
      )}

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} disabled={busy} className="text-muted hover:text-foreground cursor-pointer min-h-[32px] disabled:opacity-40">
          {t("wallet.bookmark.cancel", { defaultValue: "Cancel" })}
        </button>
        {(s || isSealedEnvelope(file)) && (
          <button type="submit" disabled={busy || (!s && !pw)} data-testid="backup-import-submit"
            className="text-bitcoin hover:text-bitcoin-hover font-medium cursor-pointer min-h-[32px] disabled:opacity-40 disabled:cursor-not-allowed">
            {s ? t("backup.restore", { defaultValue: "Restore" }) : t("backup.unlock", { defaultValue: "Open" })}
          </button>
        )}
      </div>
    </form>
  );
}
