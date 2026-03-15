"use client";

import { useTranslation } from "react-i18next";
import { getAddressType } from "@/lib/bitcoin/address-type";
import type { TxType } from "@/lib/types";

export const TX_TYPE_LABELS: Partial<Record<TxType, string>> = {
  "whirlpool-coinjoin": "Whirlpool",
  "wabisabi-coinjoin": "WabiSabi",
  "joinmarket-coinjoin": "JoinMarket",
  "generic-coinjoin": "CoinJoin",
  "stonewall": "Stonewall",
  "simplified-stonewall": "Simplified Stonewall",
  "tx0-premix": "TX0 Premix",
  "bip47-notification": "BIP47 Notification",
  "consolidation": "Consolidation",
  "exchange-withdrawal": "Exchange Withdrawal",
  "batch-payment": "Batch Payment",
  "self-transfer": "Self-transfer",
  "peel-chain": "Peel Chain",
  "coinbase": "Coinbase",
};

const ADDRESS_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  p2tr:    { label: "Taproot",  color: "bg-severity-good/20 text-severity-good border-severity-good/30" },
  p2wpkh:  { label: "SegWit",   color: "bg-severity-low/20 text-severity-low border-severity-low/30" },
  p2wsh:   { label: "SegWit",   color: "bg-severity-low/20 text-severity-low border-severity-low/30" },
  p2sh:    { label: "P2SH",     color: "bg-severity-medium/20 text-severity-medium border-severity-medium/30" },
  p2pkh:   { label: "Legacy",   color: "bg-muted/15 text-muted border-muted/30" },
};

export function AddressTypeBadge({ address }: { address: string }) {
  const { t } = useTranslation();
  const addrType = getAddressType(address);
  const config = ADDRESS_TYPE_CONFIG[addrType];
  if (!config) return null;

  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${config.color}`}>
      {t(`results.addressType.${config.label}`, { defaultValue: config.label })}
    </span>
  );
}
