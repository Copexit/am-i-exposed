"use client";

import { Fragment, memo, useState } from "react";
import { Lock, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { gradeColor, truncateId } from "@/lib/constants";
import type { Bookmark } from "@/hooks/useBookmarks";
import { RemoveWalletBookmarkPrompt } from "./RemoveWalletBookmarkPrompt";
import { UnlockWalletsPrompt } from "./UnlockWalletsPrompt";
import { resolveBookmarkInput } from "@/hooks/walletVault";

interface BookmarkListProps {
  bookmarks: Bookmark[];
  onSelect: (input: string) => void;
  onRemoveBookmark: (input: string) => void;
}

/** "xpub6CUG...a1b2c3": the key part of an xpub or descriptor, masked. */
export function maskWalletKey(input: string): string {
  const key = /[xyztuv]pub[1-9A-HJ-NP-Za-km-z]{100,}/.exec(input)?.[0] ?? input;
  return `${key.slice(0, 8)}...${key.slice(-6)}`;
}

export const BookmarkList = memo(function BookmarkList({
  bookmarks,
  onSelect,
  onRemoveBookmark,
}: BookmarkListProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState<string | null>(null);
  /** A locked wallet waiting for the password before it opens */
  const [unlocking, setUnlocking] = useState<string | null>(null);

  // A locked wallet's placeholder is never scanned: its key comes from the vault, after the password if needed
  const open = (bm: Bookmark) => {
    const input = resolveBookmarkInput(bm);
    if (input) onSelect(input);
    else setUnlocking(bm.input);
  };

  return (
    <div className="flex flex-wrap items-start gap-2">
      {bookmarks.map((bm) => (
        <Fragment key={bm.input}>
        <div
          data-testid={bm.type === "wallet" ? "wallet-bookmark-item" : undefined}
          className="inline-flex items-center gap-2 max-w-full min-w-0 px-3 py-2.5 rounded-lg bg-surface-elevated/50
            border border-card-border hover:border-card-border hover:bg-surface-elevated
            transition-all text-xs group"
        >
          <button
            onClick={() => { setConfirming(null); open(bm); }}
            className="inline-flex items-center gap-2 cursor-pointer min-w-0"
          >
            {bm.type === "wallet" && (bm.locked
              ? <Lock size={12} className="text-bitcoin shrink-0" aria-label={t("walletLock.lockedWallet", { defaultValue: "Locked wallet" })} />
              : <Lock size={12} className="text-muted shrink-0" aria-label={t("history.walletBookmark", { defaultValue: "Wallet" })} />)}
            <span className={`font-bold ${gradeColor(bm.grade)}`}>
              {bm.grade}
            </span>
            {(bm.label || bm.locked) && <span className="text-foreground truncate max-w-32">{bm.label || t("walletLock.lockedWallet", { defaultValue: "Locked wallet" })}</span>}
            {bm.type === "wallet" ? (
              <>
                {!bm.locked && <span className="font-mono text-muted group-hover:text-foreground transition-colors truncate">{maskWalletKey(bm.input)}</span>}
                <span className="text-muted whitespace-nowrap">{bm.scriptType} · {bm.network}</span>
              </>
            ) : !bm.label && (
              <span className="font-mono text-muted group-hover:text-foreground transition-colors truncate max-w-32">
                {truncateId(bm.input)}
              </span>
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setUnlocking(null);
              if (bm.type === "wallet") setConfirming(bm.input);
              else onRemoveBookmark(bm.input);
            }}
            className="text-muted hover:text-foreground transition-colors cursor-pointer p-2 -mr-2"
            title={t("history.remove", { defaultValue: "Remove bookmark" })}
            aria-label={t("history.remove", { defaultValue: "Remove bookmark" })}
          >
            <X size={12} />
          </button>
        </div>
        {/* In the flow (a full row), so it never covers the page below */}
        {confirming === bm.input && (
          <div className="basis-full max-w-sm">
            <RemoveWalletBookmarkPrompt
              snapshotKey={bm.snapshotKey}
              onDone={(remove) => { if (remove) onRemoveBookmark(bm.input); setConfirming(null); }}
            />
          </div>
        )}
        {unlocking === bm.input && (
          <div className="basis-full max-w-sm">
            <UnlockWalletsPrompt
              onUnlocked={() => { setUnlocking(null); const input = resolveBookmarkInput(bm); if (input) onSelect(input); }}
              onCancel={() => setUnlocking(null)}
            />
          </div>
        )}
        </Fragment>
      ))}
    </div>
  );
});
