"use client";

import { ChevronDown } from "lucide-react";
import { useNetwork } from "@/context/NetworkContext";
import { type BitcoinNetwork } from "@/lib/bitcoin/networks";
import { useTranslation } from "react-i18next";

const NETWORKS: { value: BitcoinNetwork; label: string; dot: string }[] = [
  { value: "mainnet", label: "Mainnet", dot: "bg-bitcoin" },
  { value: "testnet4", label: "Testnet4", dot: "bg-success" },
  { value: "signet", label: "Signet", dot: "bg-info" },
];

export function NetworkSelector() {
  const { t } = useTranslation();
  const { network, setNetwork } = useNetwork();
  const current = NETWORKS.find((n) => n.value === network) ?? NETWORKS[0];

  return (
    <div className="relative">
      <select
        value={network}
        onChange={(e) => setNetwork(e.target.value as BitcoinNetwork)}
        className="appearance-none bg-card-bg border border-card-border rounded-lg px-3 py-2.5 min-h-[44px]
          text-sm text-foreground cursor-pointer hover:border-muted transition-colors
          pl-7 pr-8 focus-visible:border-bitcoin"
        aria-label={t("common.selectNetwork", { defaultValue: "Select Bitcoin network" })}
      >
        {NETWORKS.map((n) => (
          <option key={n.value} value={n.value}>
            {n.label}
          </option>
        ))}
      </select>
      <span
        className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${current.dot} pointer-events-none`}
      />
      <ChevronDown
        size={16}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
      />
    </div>
  );
}
