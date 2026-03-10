"use client";

import { useState } from "react";
import { getWalletIconId } from "@/lib/wallet-icons";

const SIZES = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

interface WalletIconProps {
  /** Icon file stem (e.g. "sparrow"). If omitted, resolved from walletName. */
  walletId?: string | null;
  /** Wallet display name - used for alt text and fallback letter. */
  walletName: string;
  /** Icon size preset. */
  size?: keyof typeof SIZES;
  className?: string;
}

export function WalletIcon({ walletId, walletName, size = "md", className = "" }: WalletIconProps) {
  const resolvedId = walletId ?? getWalletIconId(walletName);
  const [errored, setErrored] = useState(false);
  const px = SIZES[size];

  if (!resolvedId || errored) {
    const letter = walletName.charAt(0).toUpperCase();
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full bg-surface-elevated border border-card-border text-[10px] font-bold text-muted shrink-0 ${className}`}
        style={{ width: px, height: px, fontSize: Math.max(9, px * 0.45) }}
        aria-hidden="true"
      >
        {letter}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export, next/image requires a server
    <img
      src={`/wallets/${resolvedId}.webp`}
      alt={walletName}
      width={px}
      height={px}
      className={`rounded-full shrink-0 ${className}`}
      onError={() => setErrored(true)}
    />
  );
}
