"use client";

import { Shield, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useTorDetection } from "@/hooks/useTorDetection";

/**
 * Shows connection privacy status by checking the Tor Project API.
 * States: checking, tor, clearnet, unknown.
 */
export function ConnectionBadge() {
  const status = useTorDetection();

  if (status === "checking") {
    return (
      <div
        className="inline-flex items-center gap-1.5 text-xs"
        title="Checking connection type..."
      >
        <Shield size={16} className="text-muted animate-pulse" />
      </div>
    );
  }

  if (status === "tor") {
    return (
      <div
        className="inline-flex items-center gap-1.5 text-xs"
        title="Connected via Tor - your IP is hidden from API providers"
      >
        <Shield size={16} className="text-success" />
        <span className="text-success hidden sm:inline">Tor</span>
      </div>
    );
  }

  if (status === "unknown") {
    return (
      <div
        className="inline-flex items-center gap-1.5 text-xs"
        title="Could not determine connection type"
      >
        <ShieldQuestion size={16} className="text-muted" />
        <span className="text-muted hidden sm:inline">Unknown</span>
      </div>
    );
  }

  // clearnet
  return (
    <div
      className="inline-flex items-center gap-1.5 text-xs"
      title="Not using Tor - mempool.space can see your IP address"
    >
      <ShieldAlert size={16} className="text-warning" />
      <span className="text-warning hidden sm:inline">Clearnet</span>
    </div>
  );
}
