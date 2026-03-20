"use client";

import { useState, useRef, useEffect } from "react";
import { Search, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TXID_RE } from "@/lib/constants";
import { truncateId } from "@/lib/constants";

interface GraphSearchBarProps {
  onSubmit: (txid: string) => void;
  loading: boolean;
  error: string | null;
  currentTxid: string | null;
  currentLabel?: string | null;
}

export function GraphSearchBar({ onSubmit, loading, error, currentTxid, currentLabel }: GraphSearchBarProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" shortcut to focus search bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (TXID_RE.test(trimmed)) {
      onSubmit(trimmed);
      setInput("");
    }
  };

  const isValid = input.trim() === "" || TXID_RE.test(input.trim());

  return (
    <div className="max-w-lg mx-auto">
      <form onSubmit={handleSubmit} className="glass rounded-xl border border-glass-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Search size={14} className="text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              currentTxid
                ? `${currentLabel ? `${currentLabel} - ` : ""}${truncateId(currentTxid)}`
                : t("graphPage.searchPlaceholder", { defaultValue: "Enter a transaction ID..." })
            }
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted/60 outline-none min-w-0"
            spellCheck={false}
            autoComplete="off"
          />
          {loading ? (
            <Loader2 size={14} className="text-bitcoin animate-spin shrink-0" />
          ) : (
            input.trim() && (
              <button
                type="submit"
                disabled={!isValid}
                className="text-xs text-bitcoin hover:text-bitcoin-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {t("graphPage.searchButton", { defaultValue: "Explore" })}
              </button>
            )
          )}
        </div>
        {!isValid && (
          <p className="text-[11px] text-severity-critical mt-1">
            {t("graphPage.errorInvalid", { defaultValue: "Invalid transaction ID. Must be a 64-character hex string." })}
          </p>
        )}
        {error && (
          <p className="text-[11px] text-severity-critical mt-1">{error}</p>
        )}
      </form>
    </div>
  );
}
