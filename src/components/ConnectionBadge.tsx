"use client";

import { Shield, ShieldAlert } from "lucide-react";

/**
 * Shows connection privacy status:
 * - Green shield if on .onion (Tor)
 * - Amber shield otherwise
 */
export function ConnectionBadge() {
  const isTor =
    typeof window !== "undefined" &&
    window.location.hostname.endsWith(".onion");

  return (
    <div
      className="inline-flex items-center gap-1.5 text-xs"
      title={
        isTor
          ? "Connected via Tor - your IP is hidden from API providers"
          : "Not using Tor - mempool.space can see your IP address"
      }
    >
      {isTor ? (
        <>
          <Shield size={16} className="text-success" />
          <span className="text-success hidden sm:inline">Tor</span>
        </>
      ) : (
        <>
          <ShieldAlert size={16} className="text-warning/60" />
          <span className="text-warning/60 hidden sm:inline">Clearnet</span>
        </>
      )}
    </div>
  );
}
