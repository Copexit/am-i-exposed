"use client";

import { useState, useRef, useCallback, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { motion, useMotionValue, useSpring } from "motion/react";
import { useNetwork } from "@/context/NetworkContext";
import { detectInputType, cleanInput } from "@/lib/analysis/detect-input";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import { Spinner } from "./ui/Spinner";

function InputTypeHint({ value, network }: { value: string; network: BitcoinNetwork }) {
  const { t } = useTranslation();
  const type = detectInputType(value, network);
  if (type === "invalid") return null;

  const label = type === "txid"
    ? t("input.detectedTxid", { defaultValue: "Transaction ID" })
    : t("input.detectedAddress", { defaultValue: "Bitcoin address" });
  return (
    <p className="text-muted text-sm mt-1.5 text-center">
      {t("input.detected", { defaultValue: "Detected:" })}{" "}
      <span className="text-muted">{label}</span>
    </p>
  );
}

interface AddressInputProps {
  onSubmit: (input: string) => void;
  isLoading: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function AddressInput({ onSubmit, isLoading, inputRef: externalRef }: AddressInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pasteSuccess, setPasteSuccess] = useState(false);
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;
  const { network } = useNetwork();

  // Magnetic button effect
  const magnetX = useMotionValue(0);
  const magnetY = useMotionValue(0);
  const springX = useSpring(magnetX, { stiffness: 150, damping: 15 });
  const springY = useSpring(magnetY, { stiffness: 150, damping: 15 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleButtonMouseMove = useCallback((e: React.MouseEvent) => {
    // Only on pointer devices (not touch)
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    magnetX.set((e.clientX - centerX) * 0.2);
    magnetY.set((e.clientY - centerY) * 0.2);
  }, [magnetX, magnetY]);

  const handleButtonMouseLeave = useCallback(() => {
    magnetX.set(0);
    magnetY.set(0);
  }, [magnetX, magnetY]);

  const submit = useCallback(
    (raw: string) => {
      const cleaned = cleanInput(raw);
      if (!cleaned) return;
      const type = detectInputType(cleaned, network);
      if (type === "invalid") {
        setError(
          t("input.errorInvalid", { defaultValue: "That doesn't look like a Bitcoin address or txid. Check and try again." }),
        );
        return;
      }
      setError(null);
      setValue(cleaned);
      onSubmit(cleaned);
    },
    [onSubmit, network, t],
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

  const placeholder = t("input.placeholderScan", { defaultValue: "Paste a Bitcoin address or transaction ID" });
  const buttonLabel = t("input.buttonScan", { defaultValue: "Scan" });

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-3xl">
      <div className="relative group">
        {/* Ambient glow behind input */}
        <div
          className="absolute -inset-2 rounded-2xl opacity-30 group-focus-within:opacity-60 transition-opacity duration-500 pointer-events-none blur-2xl"
          style={{
            background: "conic-gradient(from var(--border-angle, 0deg), rgba(139,92,246,0.3), rgba(247,147,26,0.3), rgba(59,130,246,0.3), rgba(139,92,246,0.3))",
            animation: "border-rotate 4s linear infinite",
          }}
        />
        {/* Animated border wrapper */}
        <div
          className="relative rounded-xl p-px overflow-hidden"
          style={{
            background: pasteSuccess
              ? "var(--success)"
              : "conic-gradient(from var(--border-angle, 0deg), rgba(68,68,80,0.6), rgba(247,147,26,0.4), rgba(139,92,246,0.3), rgba(59,130,246,0.3), rgba(68,68,80,0.6))",
            animation: "border-rotate 4s linear infinite",
          }}
        >
          <input
            data-testid="address-input"
            id="main-input"
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onPaste={handlePaste}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            autoFocus
            aria-label={placeholder}
            aria-describedby={error ? "input-error" : undefined}
            className="relative w-full glass rounded-[11px] pl-4 pr-24 sm:pl-5 sm:pr-20 py-4
              font-mono text-sm sm:text-base text-foreground placeholder:text-muted/70
              focus:shadow-[0_0_20px_rgba(247,147,26,0.15)]
              transition-all duration-200 border-0
              focus-visible:outline-2 focus-visible:outline-bitcoin/50"
          />
        </div>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10">
          {isLoading ? (
            <Spinner />
          ) : (
            <motion.button
              data-testid="scan-button"
              ref={buttonRef}
              type="submit"
              disabled={!value.trim()}
              onMouseMove={handleButtonMouseMove}
              onMouseLeave={handleButtonMouseLeave}
              style={{ background: "var(--bitcoin-gradient)", x: springX, y: springY }}
              className="px-5 py-2 text-black font-semibold text-sm sm:text-base rounded-lg
                hover:brightness-110 transition-[filter] duration-150 disabled:opacity-30
                disabled:cursor-not-allowed cursor-pointer"
            >
              {buttonLabel}
            </motion.button>
          )}
        </div>
      </div>
      {error && (
        <p data-testid="input-error" id="input-error" className="text-danger text-sm mt-2 text-center">
          {error}
        </p>
      )}
      {!error && value.trim().length > 10 && (
        <InputTypeHint value={value.trim()} network={network} />
      )}
    </form>
  );
}
