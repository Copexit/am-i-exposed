"use client";

import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileUp, ClipboardPaste, Trash2 } from "lucide-react";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import { MAX_FILE_BYTES, parseBip329, recordKey, serializeBip329, type Bip329Record } from "@/lib/wallet/bip329";
import { autoLabels, exportRecords, labelsFilename, matchLabels } from "@/lib/wallet/labels";
import { fmtN } from "@/lib/format";

interface ImportSummary {
  applied: number;
  unmatched: number;
  invalid: number;
  truncated: number;
}

const BTN = "inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border border-card-border text-sm text-foreground hover:border-bitcoin/50 hover:text-bitcoin transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * Import, clear and export BIP329 labels. Labels live in the caller's state
 * (memory only): nothing is stored, logged or sent.
 */
export function WalletLabelsPanel({ records, onChange, addressInfos, xpub }: {
  records: readonly Bip329Record[];
  onChange: (records: Bip329Record[]) => void;
  addressInfos: WalletAddressInfo[];
  xpub: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<"too-large" | "empty" | null>(null);
  const [onlyAuto, setOnlyAuto] = useState(false);

  function apply(text: string) {
    const parsed = parseBip329(text);
    if (!parsed) { setError("too-large"); setSummary(null); return; }
    if (parsed.records.length === 0 && parsed.invalid === 0) { setError("empty"); setSummary(null); return; }
    const m = matchLabels(parsed.records, addressInfos, xpub);
    setError(null);
    setSummary({ applied: m.applied, unmatched: m.unmatched, invalid: parsed.invalid, truncated: parsed.truncated });
    // A new import adds to the labels already loaded; the same ref is replaced.
    const keys = new Set(parsed.records.map(recordKey));
    onChange([...records.filter(r => !keys.has(recordKey(r))), ...parsed.records]);
    setPaste("");
    setPasteOpen(false);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setError("too-large"); setSummary(null); return; }
    apply(await file.text());
    if (fileRef.current) fileRef.current.value = "";
  }

  function download() {
    const out = exportRecords(records, autoLabels(addressInfos), onlyAuto);
    const blob = new Blob([serializeBip329(out)], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = labelsFilename(xpub);
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4" data-testid="labels-panel">
      <p className="text-sm text-muted leading-relaxed max-w-2xl">
        {t("wallet.labels.intro", { defaultValue: "Import BIP329 labels (.jsonl) exported from Sparrow or another wallet to see them on coins, addresses and transactions, and to let the coin selector follow them. Labels stay in this tab's memory: they are never stored or sent." })}{" "}
        <a href="/guide/#labeling-coins" className="text-bitcoin hover:text-bitcoin-hover underline-offset-2 hover:underline">
          {t("wallet.labels.howTo", { defaultValue: "How to label coins" })}
        </a>
      </p>

      <div className="flex flex-wrap gap-2">
        <label className={`${BTN} focus-within:ring-2 focus-within:ring-bitcoin/60`}>
          <input
            ref={fileRef}
            type="file"
            accept=".jsonl,.json,.txt,application/jsonl,application/json,text/plain"
            className="sr-only"
            onChange={e => void onFile(e.target.files?.[0])}
          />
          <FileUp size={15} aria-hidden="true" />
          {t("wallet.labels.importFile", { defaultValue: "Import file" })}
        </label>
        <button type="button" className={BTN} aria-expanded={pasteOpen} onClick={() => setPasteOpen(o => !o)}>
          <ClipboardPaste size={15} aria-hidden="true" />
          {t("wallet.labels.paste", { defaultValue: "Paste" })}
        </button>
        {records.length > 0 && (
          <button type="button" className={BTN} onClick={() => { onChange([]); setSummary(null); setError(null); }}>
            <Trash2 size={15} aria-hidden="true" />
            {t("wallet.labels.clear", { defaultValue: "Clear labels" })}
          </button>
        )}
      </div>

      {pasteOpen && (
        <div className="space-y-2">
          <label htmlFor={`${id}-paste`} className="block text-[13px] text-muted">
            {t("wallet.labels.pasteLabel", { defaultValue: "BIP329 JSON Lines, one record per line" })}
          </label>
          <textarea
            id={`${id}-paste`}
            value={paste}
            onChange={e => setPaste(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={'{"type":"output","ref":"<txid>:0","label":"[KYC] Exchange · withdrawal"}'}
            className="w-full bg-surface-inset border border-card-border rounded-lg px-3 py-2 text-[13px] num text-foreground placeholder:text-faint focus:border-bitcoin/50 focus-visible:outline-none"
          />
          <button
            type="button"
            disabled={!paste.trim()}
            onClick={() => apply(paste)}
            className="h-10 px-4 bg-bitcoin text-black font-semibold text-sm rounded-lg hover:bg-bitcoin-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("wallet.labels.apply", { defaultValue: "Apply labels" })}
          </button>
        </div>
      )}

      <div role="status" aria-live="polite" data-testid="labels-summary" className="empty:hidden">
        {error && (
          <p className="text-sm text-severity-high">
            {error === "too-large"
              ? t("wallet.labels.tooLarge", { size: "5 MB", defaultValue: "The file is larger than {{size}}, too large for a label export." })
              : t("wallet.labels.none", { defaultValue: "No labels found: the file has no record with a label or a freeze." })}
          </p>
        )}
        {summary && (
          <p className="text-sm text-foreground">
            {t("wallet.labels.applied", { count: summary.applied, n: fmtN(summary.applied), defaultValue: "{{n}} labels applied" })}
            {", "}
            {t("wallet.labels.unmatched", { count: summary.unmatched, n: fmtN(summary.unmatched), defaultValue: "{{n}} not matching this wallet" })}
            {", "}
            {t("wallet.labels.invalid", { count: summary.invalid, n: fmtN(summary.invalid), defaultValue: "{{n}} invalid" })}
            {summary.truncated > 0 && <span className="text-muted">{". "}{t("wallet.labels.truncated", { count: summary.truncated, n: fmtN(summary.truncated), defaultValue: "{{n}} cut to 255 characters" })}</span>}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline pt-4">
        <button type="button" className={BTN} onClick={download} data-testid="labels-export">
          <Download size={15} aria-hidden="true" />
          {t("wallet.labels.export", { defaultValue: "Export labels" })}
        </button>
        <label className="inline-flex items-center gap-2 min-h-10 text-[13px] text-muted cursor-pointer">
          <input type="checkbox" checked={onlyAuto} onChange={e => setOnlyAuto(e.target.checked)} className="size-4 accent-bitcoin" />
          {t("wallet.labels.onlyAuto", { defaultValue: "Only am-i.exposed labels (aie:)" })}
        </label>
        <p className="basis-full text-[13px] text-muted leading-relaxed">
          {t("wallet.labels.exportNote", { defaultValue: "BIP329 file for Sparrow and other wallets: your labels unchanged, plus automatic \"aie:\" labels on coins and addresses (CoinJoin output, toxic change, exposed change, reused address, linkage group). Where you already have a label it becomes \"your label | aie: ...\". Importing it here again drops the aie: part." })}
        </p>
      </div>
    </div>
  );
}
