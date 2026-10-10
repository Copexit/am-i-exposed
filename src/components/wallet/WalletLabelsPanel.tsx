"use client";

import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileUp, ClipboardPaste, Trash2 } from "lucide-react";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import { MAX_FILE_BYTES, parseBip329, recordKey, serializeBip329, type Bip329Record } from "@/lib/wallet/bip329";
import { autoLabels, exportRecords, labelsFilename, matchLabels, setWalletOrigin, withFiatValues, WALLET_ORIGINS, type WalletOrigin } from "@/lib/wallet/labels";
import { createApiClient } from "@/lib/api/client";
import { useNetwork } from "@/context/NetworkContext";
import { fmtN } from "@/lib/format";
import { useWalletLabels } from "./WalletLabels";
import { NoPrefixHint } from "./LabelsHint";

interface ImportSummary {
  read: number;
  onCoins: number;
  history: number;
  unmatched: number;
  invalid: number;
  truncated: number;
}

/** Locales whose default fiat currency is EUR (mempool.space has no PLN prices, so pl falls back to USD). */
const EUR_LOCALES = new Set(["es", "de", "fr", "pt"]);

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
  const { t, i18n } = useTranslation();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<"too-large" | "empty" | null>(null);
  const [onlyAuto, setOnlyAuto] = useState(false);
  const [addFiat, setAddFiat] = useState(false);
  // mempool.space historical prices come in USD and EUR; no currency setting exists, so the locale picks the default.
  const [fiatCur, setFiatCur] = useState<"EUR" | "USD">(() => (EUR_LOCALES.has(i18n.language?.slice(0, 2)) ? "EUR" : "USD"));
  const { config } = useNetwork();
  const matched = useWalletLabels();
  const checks = matched?.checks ?? [];
  const walletOrigin = matched?.walletOrigin ?? null;

  function apply(text: string) {
    const parsed = parseBip329(text);
    if (!parsed) { setError("too-large"); setSummary(null); return; }
    if (parsed.records.length === 0 && parsed.invalid === 0) { setError("empty"); setSummary(null); return; }
    const m = matchLabels(parsed.records, addressInfos, xpub);
    setError(null);
    setSummary({ read: parsed.records.length, onCoins: m.onCoins, history: m.history, unmatched: m.unmatched, invalid: parsed.invalid, truncated: parsed.truncated });
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

  async function download() {
    // Fiat values: one historical price lookup per block time (timestamps only, through the mempool client and its cache).
    const api = createApiClient(config);
    const base = addFiat
      ? await withFiatValues(records, addressInfos, ts => (fiatCur === "EUR" ? api.getHistoricalEurPrice(ts) : api.getHistoricalPrice(ts)), fiatCur)
      : records;
    const out = exportRecords(base, autoLabels(addressInfos), onlyAuto);
    const blob = new Blob([serializeBip329(out)], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = labelsFilename(xpub);
    a.click();
    // Firefox starts the download after click() returns: revoke later
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-4" data-testid="labels-panel">
      <p className="text-sm text-muted leading-relaxed max-w-2xl">
        {t("wallet.labels.intro", { defaultValue: "Import BIP329 labels (.jsonl) exported from Sparrow or another wallet to see them on coins, addresses and transactions, and to let the coin selector follow them. Labels stay in this tab's memory: they are never stored or sent." })}{" "}
        <a href="/guide/labeling/" className="text-bitcoin hover:text-bitcoin-hover underline-offset-2 hover:underline">
          {t("wallet.labels.howTo", { defaultValue: "Labeling recommendations" })}
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
            {t("wallet.labels.read", {
              count: summary.read, n: fmtN(summary.read), coins: fmtN(summary.onCoins), history: fmtN(summary.history),
              defaultValue: "{{n}} labels read: {{coins}} on current coins, {{history}} on past transactions and addresses",
            })}
            {summary.unmatched > 0 && <>{", "}{t("wallet.labels.otherWallets", { count: summary.unmatched, n: fmtN(summary.unmatched), defaultValue: "{{n}} for other wallets" })}</>}
            {summary.invalid > 0 && <>{", "}{t("wallet.labels.invalid", { count: summary.invalid, n: fmtN(summary.invalid), defaultValue: "{{n}} invalid" })}</>}
            {summary.truncated > 0 && <span className="text-muted">{". "}{t("wallet.labels.truncated", { count: summary.truncated, n: fmtN(summary.truncated), defaultValue: "{{n}} cut to 255 characters" })}</span>}
          </p>
        )}
      </div>

      {matched && !matched.hasPrefixes && <NoPrefixHint />}

      <div className="space-y-1.5">
        <label htmlFor={`${id}-origin`} className="block text-[13px] text-muted">
          {t("wallet.labels.walletOrigin", { defaultValue: "This wallet holds" })}
        </label>
        <select
          id={`${id}-origin`}
          data-testid="wallet-origin"
          value={walletOrigin ?? ""}
          onChange={e => onChange(setWalletOrigin(records, xpub, (e.target.value || null) as WalletOrigin | null))}
          className="h-10 bg-surface-inset border border-card-border rounded-lg px-3 text-sm text-foreground focus:border-bitcoin/50 focus-visible:outline-none cursor-pointer max-w-full"
        >
          <option value="">{t("wallet.labels.walletOriginNone", { defaultValue: "Not set" })}</option>
          {WALLET_ORIGINS.map(o => <option key={o} value={o}>{t(`wallet.labels.walletOriginOpt.${o}`)}</option>)}
        </select>
        <p className="text-[13px] text-muted leading-relaxed">
          {t(`wallet.labels.walletOriginNote.${walletOrigin ?? "none"}`)}
        </p>
      </div>

      {checks.length > 0 && (
        <div data-testid="label-checks" className="space-y-2 border-t border-hairline pt-4">
          <h3 className="eyebrow">{t("wallet.labels.checkTitle", { defaultValue: "Label check" })}</h3>
          <p className="text-[13px] text-muted">{t("wallet.labels.checkIntro", { defaultValue: "Labels that disagree with what an observer sees on-chain. Informational: the score does not change." })}</p>
          <ul className="space-y-2">
            {checks.map(c => (
              <li key={c.id} className="flex items-start gap-2.5 text-sm">
                <span className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 bg-severity-medium" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="text-foreground">{t(`wallet.labels.check.${c.id}`)}</span>{" "}
                  <span className="num text-muted">({t("flows.utxosAvailable", { count: c.refs.length, defaultValue: "{{count}} UTXOs" })})</span>{" "}
                  <span className="text-muted">{t(`wallet.labels.fix.${c.id}`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline pt-4">
        <button type="button" className={BTN} onClick={() => void download()} data-testid="labels-export">
          <Download size={15} aria-hidden="true" />
          {t("wallet.labels.export", { defaultValue: "Export labels" })}
        </button>
        <label className="inline-flex items-center gap-2 min-h-10 text-[13px] text-muted cursor-pointer">
          <input type="checkbox" checked={onlyAuto} onChange={e => setOnlyAuto(e.target.checked)} className="size-4 accent-bitcoin" />
          {t("wallet.labels.onlyAuto", { defaultValue: "Only am-i.exposed labels (aie:)" })}
        </label>
        <label className="inline-flex items-center gap-2 min-h-10 text-[13px] text-muted cursor-pointer">
          <input type="checkbox" checked={addFiat} onChange={e => setAddFiat(e.target.checked)} disabled={onlyAuto} className="size-4 accent-bitcoin" />
          {t("wallet.labels.addFiat", { defaultValue: "Add the fiat value at the time to transaction labels" })}
        </label>
        {addFiat && !onlyAuto && (
          <select
            aria-label={t("wallet.labels.fiatCurrency", { defaultValue: "Currency" })}
            value={fiatCur}
            onChange={e => setFiatCur(e.target.value as "EUR" | "USD")}
            className="h-10 bg-surface-inset border border-card-border rounded-lg px-3 text-sm text-foreground focus:border-bitcoin/50 focus-visible:outline-none cursor-pointer"
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
          </select>
        )}
        {addFiat && !onlyAuto && (
          <p className="basis-full text-[13px] text-muted leading-relaxed">
            {t("wallet.labels.addFiatNote", { defaultValue: "Incoming transactions get \" · N\" in the chosen currency at the price of their block's hour, unless the label already has a value. Only that hour's timestamp is sent to the price lookup, never a transaction." })}
          </p>
        )}
        <p className="basis-full text-[13px] text-muted leading-relaxed">
          {t("wallet.labels.exportNote", { defaultValue: "BIP329 file for Sparrow and other wallets: your labels unchanged, plus automatic \"aie:\" labels on coins and addresses (CoinJoin output, toxic change, exposed change, reused address, linkage group). Where you already have a label it becomes \"your label | aie: ...\". Importing it here again drops the aie: part." })}
        </p>
      </div>
    </div>
  );
}
