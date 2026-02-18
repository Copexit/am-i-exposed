"use client";

import { useState, useRef, useCallback, type FormEvent } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { detectInputType, cleanInput } from "@/lib/analysis/detect-input";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import { Spinner } from "./ui/Spinner";

function InputTypeHint({ value, network }: { value: string; network: BitcoinNetwork }) {
  const type = detectInputType(value, network);
  if (type === "invalid") return null;

  const label = type === "txid" ? "Transaction ID" : "Bitcoin address";
  return (
    <p className="text-muted/40 text-xs mt-1.5 text-center">
      Detected: <span className="text-muted/60">{label}</span>
    </p>
  );
}

interface AddressInputProps {
  onSubmit: (input: string) => void;
  isLoading: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function AddressInput({ onSubmit, isLoading, inputRef: externalRef }: AddressInputProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pasteSuccess, setPasteSuccess] = useState(false);
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;
  const { network } = useNetwork();

  const submit = useCallback(
    (raw: string) => {
      const cleaned = cleanInput(raw);
      if (!cleaned) return;
      const type = detectInputType(cleaned, network);
      if (type === "invalid") {
        setError(
          "That doesn't look like a Bitcoin address or txid. Check and try again.",
        );
        return;
      }
      setError(null);
      setValue(cleaned);
      onSubmit(cleaned);
    },
    [onSubmit, network],
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(value);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (pasted) {
      const cleaned = cleanInput(pasted.trim());
      if (!cleaned) return;
      const type = detectInputType(cleaned, network);
      if (type !== "invalid") {
        e.preventDefault();
        setValue(cleaned);
        setPasteSuccess(true);
        setTimeout(() => {
          setPasteSuccess(false);
          submit(cleaned);
        }, 300);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-3xl">
      <div className="relative group">
        <div className="absolute -inset-1 bg-bitcoin/5 rounded-2xl blur-xl group-focus-within:bg-bitcoin/10 transition-all duration-300 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onPaste={handlePaste}
          placeholder="Paste a Bitcoin address or transaction ID"
          spellCheck={false}
          autoComplete="off"
          autoFocus
          aria-label="Bitcoin address or transaction ID"
          aria-describedby={error ? "input-error" : undefined}
          className={`relative w-full bg-card-bg border rounded-xl pl-5 pr-20 py-4
            font-mono text-sm sm:text-base text-foreground placeholder:text-muted/50
            focus:border-bitcoin focus:ring-2 focus:ring-bitcoin/20
            focus:shadow-[0_0_20px_rgba(247,147,26,0.15)]
            transition-all duration-200
            ${pasteSuccess ? "border-success ring-2 ring-success/20" : "border-card-border"}`}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          {isLoading ? (
            <Spinner />
          ) : (
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-5 py-2 bg-bitcoin text-black font-semibold text-sm sm:text-base rounded-lg
                hover:bg-bitcoin-hover transition-all duration-150 disabled:opacity-30
                disabled:cursor-not-allowed cursor-pointer"
            >
              Scan
            </button>
          )}
        </div>
      </div>
      {error && (
        <p id="input-error" className="text-danger text-xs mt-2 text-center">
          {error}
        </p>
      )}
      {!error && value.trim().length > 10 && (
        <InputTypeHint value={value.trim()} network={network} />
      )}
    </form>
  );
}
