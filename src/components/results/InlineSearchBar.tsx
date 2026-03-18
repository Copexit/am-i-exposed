"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { detectInputType, cleanInput } from "@/lib/analysis/detect-input";

export function InlineSearchBar({ onScan, initialValue }: { onScan: (input: string) => void; initialValue?: string }) {
  const { t } = useTranslation();
  const { network } = useNetwork();
  const [value, setValue] = useState(initialValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync value when the scanned query changes (initialValue only seeds useState on mount)
  useEffect(() => {
    setValue(initialValue ?? "");
  }, [initialValue]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = cleanInput(value);
    if (!cleaned) return;
    const type = detectInputType(cleaned, network);
    if (type === "invalid") {
      setError(t("input.errorInvalid", { defaultValue: "That doesn't look like a Bitcoin address or txid. Check and try again." }));
      return;
    }
    setError(null);
    onScan(cleaned);
  }, [value, network, onScan, t]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    const cleaned = cleanInput(pasted.trim());
    if (!cleaned) return;
    const type = detectInputType(cleaned, network);
    if (type !== "invalid") {
      e.preventDefault();
      setValue("");
      setError(null);
      onScan(cleaned);
      // Restore focus after the re-render triggered by onScan
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [network, onScan]);

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative flex items-center">
        <Search size={14} className="absolute left-3 text-muted/60 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onPaste={handlePaste}
          placeholder={t("input.placeholderScan", { defaultValue: "Paste a Bitcoin address or transaction ID" })}
          spellCheck={false}
          autoComplete="off"
          aria-label={t("input.placeholderScan", { defaultValue: "Paste a Bitcoin address or transaction ID" })}
          className="w-full rounded-lg border border-card-border bg-surface-elevated/50 pl-8 pr-16 py-2 min-h-[44px]
            font-mono text-sm text-foreground placeholder:text-muted/50
            focus:border-bitcoin/40 focus:shadow-[0_0_8px_rgba(247,147,26,0.1)]
            focus-visible:outline-2 focus-visible:outline-bitcoin/50
            transition-all duration-150"
        />
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
