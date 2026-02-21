"use client";

import { useState, useRef, useEffect } from "react";
import { Shield, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useNetwork } from "@/context/NetworkContext";
import { useTranslation } from "react-i18next";

/**
 * Shows connection privacy status by checking the Tor Project API.
 * Tappable on mobile to reveal a tooltip explaining the status.
 */
export function ConnectionBadge() {
  const { t } = useTranslation();
  const { torStatus, localApiStatus } = useNetwork();
  const [showTip, setShowTip] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close tooltip on outside click
  useEffect(() => {
    if (!showTip) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowTip(false);
      }
    }
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [showTip]);

  // Local API (Umbrel) takes display priority - it's the most private option
  const isLocal = localApiStatus === "available";

  const config = isLocal
    ? {
        icon: <ShieldCheck size={16} className="text-success" />,
        label: <span className="text-success text-xs hidden sm:inline">{t("common.local", { defaultValue: "Local" })}</span>,
        tip: t("common.connectionLocal", { defaultValue: "Connected to local mempool instance - all queries stay on your network" }),
      }
    : {
        checking: {
          icon: <Shield size={16} className="text-muted animate-pulse" />,
          label: null,
          tip: t("common.connectionChecking", { defaultValue: "Checking connection type..." }),
        },
        tor: {
          icon: <Shield size={16} className="text-success" />,
          label: <span className="text-success text-xs hidden sm:inline">{t("common.tor", { defaultValue: "Tor" })}</span>,
          tip: t("common.connectionTor", { defaultValue: "Connected via Tor - your IP is hidden from API providers" }),
        },
        unknown: {
          icon: <ShieldQuestion size={16} className="text-muted" />,
          label: null,
          tip: t("common.connectionUnknown", { defaultValue: "Connection privacy status could not be determined" }),
        },
        clearnet: {
          icon: <ShieldAlert size={16} className="text-warning" />,
          label: <span className="text-warning text-xs hidden sm:inline">{t("common.clearnet", { defaultValue: "Clearnet" })}</span>,
          tip: t("common.connectionClearnet", { defaultValue: "Not using Tor - mempool.space can see your IP address" }),
        },
      }[torStatus];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setShowTip((v) => !v)}
        onFocus={() => setShowTip(true)}
        onBlur={() => setShowTip(false)}
        className="inline-flex items-center gap-1.5 text-xs cursor-pointer py-2 min-h-[44px]"
        aria-label={config.tip}
      >
        {config.icon}
        {config.label}
      </button>
      {showTip && (
        <div className="absolute top-full right-0 mt-1 w-56 bg-surface-elevated border border-card-border rounded-lg px-3 py-2 shadow-xl z-50 text-xs text-muted leading-relaxed">
          {config.tip}
        </div>
      )}
    </div>
  );
}
