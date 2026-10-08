"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tags, X } from "lucide-react";

const KEY = "ami-labels-hint-dismissed";

function dismissed(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** Quiet, dismissible pointer to the labeling convention, shown while no labels are loaded. Dismissal is a per-viewer preference. */
export function LabelsHint({ onImport }: { onImport?: () => void }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(dismissed);
  if (hidden) return null;
  return (
    <div data-testid="labels-hint" className="flex items-start gap-2.5 rounded-lg border border-dashed border-hairline-strong px-3 py-2 text-[13px] text-muted leading-relaxed">
      <Tags size={14} className="mt-[3px] shrink-0 text-faint" aria-hidden="true" />
      <p className="flex-1 min-w-0">
        {t("wallet.labels.hint", { defaultValue: "Label your coins by origin ([KYC], [noKYC], [CJ]...) so coin selection can warn before you link identities." })}{" "}
        <a href="/guide/#labeling-coins" className="text-bitcoin hover:text-bitcoin-hover underline-offset-2 hover:underline">{t("wallet.labels.howTo", { defaultValue: "Labeling recommendations" })}</a>
        {onImport && (
          <>
            {" · "}
            <button type="button" onClick={onImport} className="text-bitcoin hover:text-bitcoin-hover underline-offset-2 hover:underline cursor-pointer">
              {t("wallet.labels.importLink", { defaultValue: "Import labels" })}
            </button>
          </>
        )}
      </p>
      <button
        type="button"
        onClick={() => { setHidden(true); try { localStorage.setItem(KEY, "1"); } catch { /* storage unavailable */ } }}
        aria-label={t("wallet.labels.hintDismiss", { defaultValue: "Dismiss the labeling tip" })}
        className="shrink-0 -my-2 -mr-2 inline-flex items-center justify-center size-10 text-faint hover:text-foreground cursor-pointer"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Labels are loaded but none uses an origin prefix: the origin rules have nothing to check. */
export function NoPrefixHint() {
  const { t } = useTranslation();
  return (
    <p data-testid="no-prefix-hint" className="flex items-start gap-2.5 rounded-lg border border-dashed border-hairline-strong px-3 py-2 text-[13px] text-muted leading-relaxed">
      <Tags size={14} className="mt-[3px] shrink-0 text-faint" aria-hidden="true" />
      <span className="min-w-0">
        {t("wallet.labels.noPrefix", { defaultValue: "None of your labels use origin prefixes ([KYC], [noKYC], [CJ]...), so coin selection cannot check origin rules." })}{" "}
        <a href="/guide/#labeling-coins" className="text-bitcoin hover:text-bitcoin-hover underline-offset-2 hover:underline">{t("wallet.labels.howTo", { defaultValue: "Labeling recommendations" })}</a>
      </span>
    </p>
  );
}
