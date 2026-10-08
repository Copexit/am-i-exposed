"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Lock, Star, X } from "lucide-react";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useNetwork } from "@/context/NetworkContext";
import { RemoveWalletBookmarkPrompt } from "@/components/history/RemoveWalletBookmarkPrompt";

/**
 * Opt-in wallet bookmark: stores the raw xpub/descriptor in this browser after
 * an explicit privacy confirmation.
 */
export function WalletBookmarkButton({ input, scriptType, grade, score, snapshotKey }: {
  input: string;
  scriptType: string;
  grade: string;
  score: number;
  snapshotKey: string | null;
}) {
  const { t } = useTranslation();
  const { network } = useNetwork();
  const { isBookmarked, addBookmark, removeBookmark } = useBookmarks();
  const saved = isBookmarked(input);
  const [dialog, setDialog] = useState(false);
  const [removing, setRemoving] = useState(false);

  const btn = "inline-flex items-center gap-1.5 min-h-[36px] px-2 rounded-md text-[13px] text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer";

  return (
    <>
      <button type="button" onClick={() => (saved ? setRemoving(true) : setDialog(true))} className={btn} data-testid="wallet-bookmark">
        <Star size={13} aria-hidden="true" className={saved ? "text-bitcoin fill-bitcoin" : ""} />
        {saved
          ? t("wallet.bookmark.bookmarked", { defaultValue: "Bookmarked" })
          : t("wallet.bookmark.button", { defaultValue: "Bookmark this wallet" })}
      </button>
      {removing && (
        <div className="basis-full flex sm:justify-end">
          <RemoveWalletBookmarkPrompt
            snapshotKey={snapshotKey ?? undefined}
            onDone={(remove) => { if (remove) removeBookmark(input); setRemoving(false); }}
          />
        </div>
      )}
      {dialog && (
        <BookmarkDialog
          onCancel={() => setDialog(false)}
          onSave={(name) => {
            addBookmark({
              input, type: "wallet", grade, score, scriptType, network,
              ...(name ? { label: name } : {}),
              ...(snapshotKey ? { snapshotKey } : {}),
            });
            setDialog(false);
          }}
        />
      )}
    </>
  );
}

function BookmarkDialog({ onSave, onCancel }: { onSave: (name: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [ok, setOk] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-bm-title"
        className="relative w-full max-w-md bg-surface-elevated border border-hairline rounded-2xl shadow-2xl outline-none p-6 space-y-4"
      >
        <button type="button" onClick={onCancel} className="absolute top-4 right-4 text-muted hover:text-foreground cursor-pointer" aria-label={t("common.close", { defaultValue: "Close" })}>
          <X size={18} />
        </button>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-severity-medium/10"><Lock size={20} className="text-severity-medium" aria-hidden="true" /></div>
          <h2 id="wallet-bm-title" className="text-lg font-semibold text-foreground">
            {t("wallet.bookmark.title", { defaultValue: "Bookmark this wallet?" })}
          </h2>
        </div>
        <ul className="space-y-2 text-sm text-foreground/90 leading-relaxed list-disc pl-5">
          <li>{t("wallet.bookmark.reveals", { defaultValue: "The key (xpub) reveals every past and future address and the balance of this wallet to anyone who can open this browser profile." })}</li>
          <li>{t("wallet.bookmark.ownDevice", { defaultValue: "Use it only on your own device, never on a shared or public computer." })}</li>
          <li>{t("wallet.bookmark.local", { defaultValue: "It is stored in this browser only and never sent anywhere. You can remove it at any time." })}</li>
        </ul>
        <label className="block text-xs text-muted">
          {t("wallet.bookmark.name", { defaultValue: "Name (optional)" })}
          <input
            type="text"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value.slice(0, 40))}
            placeholder={t("wallet.bookmark.namePlaceholder", { defaultValue: "e.g. Savings" })}
            className="mt-1 w-full px-2 py-1.5 rounded border border-card-border bg-surface-inset text-sm text-foreground placeholder:text-muted/50 focus:border-bitcoin/50"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="accent-bitcoin" />
          {t("wallet.bookmark.understand", { defaultValue: "I understand" })}
        </label>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-muted hover:text-foreground cursor-pointer">
            {t("wallet.bookmark.cancel", { defaultValue: "Cancel" })}
          </button>
          <button
            type="button"
            disabled={!ok}
            onClick={() => onSave(name.trim())}
            className="px-4 py-2 rounded-lg bg-bitcoin text-black text-sm font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("wallet.bookmark.save", { defaultValue: "Save bookmark" })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
