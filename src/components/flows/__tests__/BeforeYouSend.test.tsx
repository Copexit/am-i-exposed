// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { LocalTx } from "@/lib/input/local-tx";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ScoringResult } from "@/lib/types";

const m = vi.hoisted(() => ({ getRecommendedFees: vi.fn() }));
vi.mock("react-i18next", async () => {
  const en = (await import("../../../../public/locales/en/common.json")).default as Record<string, string>;
  const t = (k: string, o: Record<string, unknown> = {}) =>
    (en[k] ?? (typeof o.defaultValue === "string" ? o.defaultValue : k))
      .replace(/\{\{(\w+)\}\}/g, (raw, name: string) => (name in o ? String(o[name]) : raw));
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => ({ config: { mempoolBaseUrl: "https://mempool.space/api" } }) }));
vi.mock("@/lib/api/mempool", () => ({ createMempoolClient: () => ({ getRecommendedFees: m.getRecommendedFees }) }));

import { BeforeYouSend } from "../BeforeYouSend";

afterEach(() => { cleanup(); m.getRecommendedFees.mockReset(); });

const out = (value: number, addr: string) => ({ value, scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addr });
const tx = (prevout: boolean): MempoolTransaction => ({
  txid: "psbt-preview", version: 2, locktime: 0, size: 141, weight: 564, fee: 141, status: { confirmed: false },
  vin: [{ txid: "a".repeat(64), vout: 0, prevout: prevout ? out(99_141, "bc1qin") : null, scriptsig: "", scriptsig_asm: "", witness: [], is_coinbase: false, sequence: 0xfffffffd }],
  vout: [out(60_000, "bc1qa"), out(39_000, "bc1qb")],
});
const local = (prevout: boolean): LocalTx => ({ source: "psbt", status: "unsigned", tx: tx(prevout), missingPrevouts: prevout ? [] : [0], signedHex: null, psbt: null });
const result = { score: 80, grade: "B", findings: [] } as unknown as ScoringResult;

describe("BeforeYouSend", () => {
  it("asks consent for the lookup, names the host and disables the button while running", () => {
    m.getRecommendedFees.mockReturnValue(new Promise(() => {}));
    const onLookup = vi.fn();
    const props = { local: local(false), txData: null, result, outputTxCounts: null, onLookup, endpoint: "mempool.space" };
    const { rerender } = render(<BeforeYouSend {...props} lookup={{ status: "available", inputs: 3, addresses: 2 }} />);
    expect(screen.getByTestId("before-you-send").textContent).toContain("look up 3 inputs and 2 addresses on mempool.space");
    fireEvent.click(screen.getByTestId("local-lookup"));
    expect(onLookup).toHaveBeenCalledTimes(1);
    rerender(<BeforeYouSend {...props} lookup={{ status: "running", inputs: 3, addresses: 2 }} />);
    expect((screen.getByTestId("local-lookup") as HTMLButtonElement).disabled).toBe(true);
    // Amounts unknown: no fee estimate request
    expect(m.getRecommendedFees).not.toHaveBeenCalled();
  });

  it("shows status, safety items and a fee hint from the estimates", async () => {
    m.getRecommendedFees.mockResolvedValue({ fastestFee: 20, halfHourFee: 10, hourFee: 5, economyFee: 2, minimumFee: 1 });
    render(<BeforeYouSend local={local(true)} txData={null} result={result} lookup={null} outputTxCounts={null} onLookup={() => {}} endpoint="mempool.space" />);
    await act(async () => {});
    expect(screen.getByTestId("local-status").textContent).toBe("Not signed yet");
    expect(screen.queryByTestId("local-lookup")).toBeNull();
    const ids = [...screen.getByTestId("local-safety").querySelectorAll("[data-safety-id]")].map((e) => e.getAttribute("data-safety-id"));
    expect(ids).toEqual(expect.arrayContaining(["unsigned", "signatures-later", "fee-low", "rbf-on", "locktime-none"]));
    expect(screen.getByText("No significant leaks found.")).toBeTruthy();
    expect(m.getRecommendedFees).toHaveBeenCalledTimes(1);
  });
});
