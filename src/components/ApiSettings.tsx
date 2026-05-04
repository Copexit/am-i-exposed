"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Settings, ChevronDown, Sun, Moon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { type BitcoinNetwork } from "@/lib/bitcoin/networks";
import { NetworkSettings } from "@/components/settings/NetworkSettings";
import { AnalysisSettingsPanel } from "@/components/settings/AnalysisSettingsPanel";
import { CacheSettingsPanel } from "@/components/settings/CacheSettingsPanel";
import { WorkspaceSettingsPanel } from "@/components/settings/WorkspaceSettingsPanel";
import { LocaleSelector } from "@/components/settings/LocaleSelector";
import { EntityFilterStatus } from "@/components/settings/EntityFilterStatus";
import { useExperienceMode } from "@/hooks/useExperienceMode";
import { useTheme } from "@/hooks/useTheme";

const NETWORKS: { value: BitcoinNetwork; label: string; dot: string }[] = [
  { value: "mainnet", label: "Mainnet", dot: "bg-bitcoin" },
  { value: "testnet4", label: "Testnet4", dot: "bg-success" },
  { value: "testnet3", label: "Testnet3", dot: "bg-warning" },
  { value: "signet", label: "Signet", dot: "bg-info" },
];

export function ApiSettings() {
  const { t } = useTranslation();
  const { network, setNetwork, customApiUrl, isUmbrel } = useNetwork();
  const { proMode } = useExperienceMode();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const currentNetwork = NETWORKS.find((n) => n.value === network) ?? NETWORKS[0];

  // Close on click outside (check both panel and button since portal moves panel out of DOM tree)
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        panelRef.current && !panelRef.current.contains(target) &&
        buttonRef.current && !buttonRef.current.contains(target)
      ) {
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

  // Focus trap when panel is open
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const savedFocus = document.activeElement as HTMLElement | null;
    function handleTrap(e: KeyboardEvent) {
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, input, select, a, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleTrap);
    return () => {
      document.removeEventListener("keydown", handleTrap);
      savedFocus?.focus();
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => {
          setOpen(!open);
        }}
        className="relative inline-flex items-center gap-1.5 text-muted hover:text-foreground transition-colors cursor-pointer p-2 rounded-lg border border-card-border bg-surface-elevated hover:bg-surface-inset"
        aria-label={t("settings.ariaLabel", { defaultValue: "Settings" })}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t("settings.title", { defaultValue: "Settings" })}
      >
        <Settings size={18} />
        {/* Network indicator dot */}
        <span className={`w-2 h-2 rounded-full ${currentNetwork.dot}`} />
        {customApiUrl && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-bitcoin rounded-full" />
        )}
      </button>

      {open && createPortal(
        <>
        {/* Mobile backdrop */}
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] sm:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
        <div ref={panelRef} role="dialog" aria-modal="true" aria-label={t("settings.ariaLabel", { defaultValue: "Settings" })} className="fixed inset-x-0 bottom-0 sm:bottom-auto sm:top-[72px] rounded-t-2xl sm:rounded-xl mx-0 sm:inset-x-auto sm:right-4 sm:mx-0 sm:mt-2 sm:w-96 z-[60] p-4 space-y-4 max-h-[70dvh] sm:max-h-[80vh] overflow-y-auto border border-glass-border" style={{ background: "var(--card-bg)", boxShadow: "var(--glass-shadow)" }}>

          {/* Mobile drag handle */}
          <div className="flex justify-center sm:hidden pb-2">
            <div className="w-10 h-1 rounded-full bg-muted/30" />
          </div>

          {/* Settings heading (mobile only) */}
          <h2 className="text-sm font-semibold text-foreground">{t("settings.title", { defaultValue: "Settings" })}</h2>

          {/* Network & Language row */}
          <div className="flex items-center gap-3">
            {/* Network selector - hidden on Umbrel (network is preconfigured) */}
            {!isUmbrel && (
            <div className="flex-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-1.5">
                {t("settings.network", { defaultValue: "Network" })}
              </label>
              <div className="relative">
                <select
                  value={network}
                  onChange={(e) => setNetwork(e.target.value as BitcoinNetwork)}
                  className="appearance-none w-full bg-surface-inset border border-card-border rounded-lg px-3 py-2 text-sm text-foreground cursor-pointer hover:border-muted transition-colors pl-7 pr-8 focus-visible:border-bitcoin"
                  aria-label={t("common.selectNetwork", { defaultValue: "Select Bitcoin network" })}
                >
                  {NETWORKS.map((n) => (
                    <option key={n.value} value={n.value}>
                      {n.label}
                    </option>
                  ))}
                </select>
                <span
                  className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${currentNetwork.dot} pointer-events-none`}
                />
                <ChevronDown
                  size={14}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                />
              </div>
            </div>
            )}

            {/* Language selector */}
            <LocaleSelector />

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? t("settings.themeLight", { defaultValue: "Light" }) : t("settings.themeDark", { defaultValue: "Dark" })}
              title={t("settings.theme", { defaultValue: "Theme" })}
              className="flex items-center justify-center w-10 h-10 mt-5 rounded-lg text-muted hover:text-foreground transition-colors cursor-pointer border border-card-border bg-surface-inset hover:border-muted shrink-0"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>

          {/* Workspace export/import (Cypherpunk only) */}
          {proMode && <WorkspaceSettingsPanel />}

          {/* Advanced API settings - hidden on Umbrel (API is preconfigured) */}
          {!isUmbrel && (
            <NetworkSettings onClosePanel={() => setOpen(false)} />
          )}

          {/* Analysis settings (Pro only) */}
          {proMode && <AnalysisSettingsPanel />}

          {/* Cache settings (Pro only) */}
          {proMode && <CacheSettingsPanel />}

          {/* Entity filter status */}
          <EntityFilterStatus proMode={proMode} />

          {/* Version */}
          <div className="border-t border-card-border pt-2 text-center">
            <span className="text-[10px] text-muted/70 font-mono tabular-nums select-all">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </span>
          </div>
        </div>
        </>,
        document.body,
      )}
    </div>
  );
}
