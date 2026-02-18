"use client";

import { useNetwork } from "@/context/NetworkContext";
import { type BitcoinNetwork } from "@/lib/bitcoin/networks";

const NETWORKS: { value: BitcoinNetwork; label: string; dot: string }[] = [
  { value: "mainnet", label: "Mainnet", dot: "bg-bitcoin" },
  { value: "testnet4", label: "Testnet4", dot: "bg-success" },
  { value: "signet", label: "Signet", dot: "bg-info" },
];

export function NetworkSelector() {
  const { network, setNetwork } = useNetwork();
  const current = NETWORKS.find((n) => n.value === network) ?? NETWORKS[0];

  return (
    <div className="relative">
      <select
        value={network}
        onChange={(e) => setNetwork(e.target.value as BitcoinNetwork)}
        className="appearance-none bg-card-bg border border-card-border rounded-lg px-3 py-1.5
          text-sm text-foreground cursor-pointer hover:border-muted transition-colors
          pl-7 pr-8 focus:outline-none focus:border-bitcoin"
        aria-label="Select Bitcoin network"
      >
        {NETWORKS.map((n) => (
          <option key={n.value} value={n.value}>
            {n.label}
          </option>
        ))}
      </select>
      <span
        className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${current.dot}`}
      />
      <svg
        className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}
