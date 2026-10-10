// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k, i18n: { language: "en" } }),
}));
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => ({ network: "signet" }) }));
vi.mock("../WalletWorkspace", () => ({ WalletWorkspace: () => null }));
vi.mock("@/components/wallet/SavedScanBar", () => ({ SavedScanBar: () => null }));
vi.mock("@/components/wallet/WalletBookmarkButton", () => ({ WalletBookmarkButton: () => null }));
vi.mock("@/components/wallet/CoinOrigins", () => ({ CoinOrigins: () => null }));
vi.mock("@/components/services/ServiceCheck", () => ({ ServiceCheck: () => null }));

import { WalletResults } from "../WalletResults";

describe("WalletResults audit scope", () => {
  it("shows the active network, not the key version prefix", () => {
    const descriptor = { xpub: "tpubX", scriptType: "p2wpkh", network: "testnet", accountPath: "m/84'/1'/0'", receiveAddresses: [], changeAddresses: [] };
    const base: Record<string, unknown> = { grade: "A", findings: [] };
    // Any other numeric stat reads as 0.
    const result = new Proxy(base, { get: (o, k) => (k in o ? o[k as string] : 0) });
    render(
      <WalletResults
        {...({ descriptor, result, addressInfos: [], utxoTraces: [], onBack: () => {}, onScan: () => {}, durationMs: 1, labelRecords: [], onLabelsChange: () => {}, query: "tpubX" } as unknown as React.ComponentProps<typeof WalletResults>)}
      />,
    );
    const row = screen.getByText("Network").parentElement;
    expect(row?.textContent).toContain("Signet");
    expect(row?.textContent).not.toContain("testnet");
  });
});
