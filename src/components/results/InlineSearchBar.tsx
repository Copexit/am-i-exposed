"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { InputExtras, useFileDrop } from "@/components/InputExtras";
import { detectInputType, cleanInput } from "@/lib/analysis/detect-input";

export function InlineSearchBar({ onScan, initialValue }: { onScan: (input: string) => void; initialValue?: string }) {
  const { t } = useTranslation();
  const { network } = useNetwork();
  const [value, setValue] = useState(initialValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync value when the scanned query changes (initialValue only seeds useState on mount)
  useEffect(() => {
    const timer = setTimeout(() => setValue(initialValue ?? ""), 0);
    return () => clearTimeout(timer);
  }, [initialValue]);

  const submitValue = useCallback((raw: string): boolean => {
    const cleaned = cleanInput(raw);
    if (!cleaned) return false;
    const type = detectInputType(cleaned, network);
    if (type === "invalid") {
      setError(t("input.errorInvalid", { defaultValue: "That doesn't look like an address, txid, xpub, PSBT or raw transaction. Check and try again." }));
      return false;
    }
    setError(null);
    onScan(cleaned);
    return true;
  }, [network, onScan, t]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    submitValue(value);
  }, [value, submitValue]);

  const fileDrop = useFileDrop(submitValue, setError);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    if (submitValue(pasted.trim())) {
      e.preventDefault();
      setValue("");
      // Restore focus after the re-render triggered by onScan
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [submitValue]);

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div
        className={`relative flex items-center rounded-lg ${fileDrop.dragging ? "ring-2 ring-bitcoin/40" : ""}`}
        onDragOver={fileDrop.onDragOver}
        onDragLeave={fileDrop.onDragLeave}
        onDrop={fileDrop.onDrop}
      >
        <Search size={14} className="absolute left-3 text-muted/60 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onPaste={handlePaste}
          placeholder={t("input.placeholderScan", { defaultValue: "Paste an address, txid, xpub, PSBT or raw transaction" })}
          spellCheck={false}
          autoComplete="off"
          aria-label={t("input.placeholderScan", { defaultValue: "Paste an address, txid, xpub, PSBT or raw transaction" })}
          className="w-full rounded-lg border border-card-border bg-surface-elevated/50 pl-8 pr-28 py-2 min-h-[44px]
            font-mono text-sm text-foreground placeholder:text-muted/50
            focus:border-bitcoin/40 focus:shadow-[0_0_8px_--alpha(var(--color-bitcoin)/10%)]
            focus-visible:outline-2 focus-visible:outline-bitcoin/50
            transition-all duration-150"
        />
        <div className="absolute right-14 top-1/2 -translate-y-1/2">
          <InputExtras onPayload={submitValue} onError={setError} />
        </div>
        <button
          type="submit"
          disabled={!value.trim()}
          className="absolute right-1.5 px-3 py-1 text-xs font-semibold rounded-md
            bg-bitcoin/80 text-black hover:bg-bitcoin transition-colors
            disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        >
          {t("input.buttonScan", { defaultValue: "Scan" })}
        </button>
      </div>
      {error && <p className="text-danger text-xs mt-1">{error}</p>}
    </form>
  );
}
