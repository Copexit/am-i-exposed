"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Settings, Check, X, Loader2, RotateCcw } from "lucide-react";
import { useNetwork } from "@/context/NetworkContext";

type HealthStatus = "idle" | "checking" | "ok" | "error";

export function ApiSettings() {
  const { customApiUrl, setCustomApiUrl } = useNetwork();
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(customApiUrl ?? "");
  const [health, setHealth] = useState<HealthStatus>("idle");
  const [errorHint, setErrorHint] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  // Focus input and sync value when opened
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const checkHealth = useCallback(
    async (url: string) => {
      const trimmed = url.trim().replace(/\/+$/, "");
      if (!trimmed) return;

      setHealth("checking");
      setErrorHint("");

      try {
        const res = await fetch(`${trimmed}/blocks/tip/height`, {
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          setHealth("ok");
          setCustomApiUrl(trimmed);
        } else {
          setHealth("error");
          setErrorHint(`HTTP ${res.status}`);
        }
      } catch (err) {
        setHealth("error");
        if (err instanceof TypeError && err.message.includes("fetch")) {
          setErrorHint("Connection failed. Check CORS settings.");
        } else if (err instanceof DOMException && err.name === "AbortError") {
          setErrorHint("Timeout (10s)");
        } else {
          setErrorHint("Connection failed");
        }
      }
    },
    [setCustomApiUrl],
  );

  const handleReset = useCallback(() => {
    setCustomApiUrl(null);
    setInputValue("");
    setHealth("idle");
    setErrorHint("");
  }, [setCustomApiUrl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    checkHealth(inputValue);
  };

  return (
    <div ref={panelRef} className="relative">
      <button
        onClick={() => {
          if (!open) {
            setInputValue(customApiUrl ?? "");
            setHealth("idle");
            setErrorHint("");
          }
          setOpen(!open);
        }}
        className="relative text-muted hover:text-foreground transition-colors cursor-pointer p-1.5"
        aria-label="API settings"
        title="API endpoint settings"
      >
        <Settings size={18} />
        {customApiUrl && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-bitcoin rounded-full" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-surface-elevated border border-card-border rounded-xl shadow-xl z-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground/70 uppercase tracking-wider">
              Mempool API
            </span>
            {customApiUrl && (
              <button
                onClick={handleReset}
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
              >
                <RotateCcw size={12} />
                Reset to default
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setHealth("idle");
                setErrorHint("");
              }}
              placeholder="https://mempool.space/api"
              className="flex-1 bg-surface-inset border border-card-border rounded-lg px-3 py-1.5 text-sm text-foreground font-mono placeholder:text-muted/50 focus:outline-none focus:border-bitcoin/50"
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || health === "checking"}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-bitcoin/10 text-bitcoin hover:bg-bitcoin/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {health === "checking" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                "Apply"
              )}
            </button>
          </form>

          {/* Status indicator */}
          {health === "ok" && (
            <div className="flex items-center gap-1.5 text-xs text-severity-good">
              <Check size={14} />
              Connected. Using custom endpoint.
            </div>
          )}
          {health === "error" && (
            <div className="flex items-center gap-1.5 text-xs text-severity-high">
              <X size={14} />
              {errorHint || "Connection failed"}
            </div>
          )}
          {customApiUrl && health !== "checking" && (
            <p className="text-xs text-muted/70">
              Active: <span className="font-mono">{customApiUrl}</span>
            </p>
          )}
          {!customApiUrl && health === "idle" && (
            <p className="text-xs text-muted/60">
              Point to your own mempool.space instance for maximum privacy.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
