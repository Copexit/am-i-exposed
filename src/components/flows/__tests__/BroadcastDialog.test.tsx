// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { LocalTx } from "@/lib/input/local-tx";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ScoringResult } from "@/lib/types";

const m = vi.hoisted(() => ({ broadcastTx: vi.fn(), testMempoolAccept: vi.fn(), getTxStatus: vi.fn() }));
vi.mock("@/lib/api/broadcast", () => m);
vi.mock("react-i18next", async () => {
  const en = (await import("../../../../public/locales/en/common.json")).default as Record<string, string>;
  const t = (k: string, o: Record<string, unknown> = {}) =>
    (en[k] ?? (typeof o.defaultValue === "string" ? o.defaultValue : k))
      .replace(/\{\{(\w+)\}\}/g, (raw, name: string) => (name in o ? String(o[name]) : raw));
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

import { BroadcastDialog } from "../BroadcastDialog";

afterEach(() => {
  cleanup();
  m.broadcastTx.mockReset();
  m.testMempoolAccept.mockReset().mockResolvedValue(null);
  m.getTxStatus.mockReset();
});
m.testMempoolAccept.mockResolvedValue(null);

const out = (value: number, addr: string) => ({ value, scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addr });
const TX: MempoolTransaction = {
  txid: "f".repeat(64), version: 2, locktime: 0, size: 141, weight: 564, fee: 141, status: { confirmed: false },
  vin: [{ txid: "a".repeat(64), vout: 0, prevout: out(99_141, "bc1qin"), scriptsig: "", scriptsig_asm: "", witness: [], is_coinbase: false, sequence: 0xfffffffd }],
  vout: [out(60_000, "bc1qa"), out(39_000, "bc1qb")],
};
const LOCAL_SIGNED: LocalTx = { source: "raw", status: "signed", tx: TX, missingPrevouts: [], signedHex: "0200beef", psbt: null };
const RESULT = { score: 80, grade: "B", findings: [] } as unknown as ScoringResult;
const PUBLIC = "https://mempool.space/api";

const renderDialog = (over: Partial<Parameters<typeof BroadcastDialog>[0]> = {}) => {
  const props = { local: LOCAL_SIGNED, tx: TX, result: RESULT, baseUrl: PUBLIC, cls: "public" as const, onClose: vi.fn(), onSuccess: vi.fn(), ...over };
  render(<BroadcastDialog {...props} />);
  return props;
};

describe("BroadcastDialog", () => {
  it("names the endpoint and the clearnet privacy cost", () => {
    renderDialog();
    expect(screen.getByText(/https:\/\/mempool\.space\/api\/tx/)).toBeTruthy();
    expect(screen.getByText(/will see your IP address/)).toBeTruthy();
    expect(screen.getByText(/Projected grade: B/)).toBeTruthy();
    expect(m.testMempoolAccept).not.toHaveBeenCalled(); // dry-run is self-hosted only
  });

  it("double click and Enter send exactly one POST; Escape, backdrop and close are inert while sending", async () => {
    let resolve!: (v: unknown) => void;
    m.broadcastTx.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { onClose, onSuccess } = renderDialog();
    const btn = screen.getByTestId("broadcast-confirm");
    fireEvent.click(btn); fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("broadcast-backdrop"));
    expect(screen.queryByTestId("broadcast-close")).toBeNull();
    expect(m.broadcastTx).toHaveBeenCalledTimes(1);
    expect(m.broadcastTx).toHaveBeenCalledWith(PUBLIC, "0200beef", TX.txid);
    expect(onClose).not.toHaveBeenCalled();
    resolve({ kind: "sent", txid: TX.txid, mismatch: false });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(TX.txid));
  });

  it("Escape and backdrop close the dialog when idle", () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("broadcast-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("unknown outcome offers a status check, never a resend", async () => {
    m.broadcastTx.mockResolvedValue({ kind: "unknown" });
    renderDialog();
    fireEvent.click(screen.getByTestId("broadcast-confirm"));
    await waitFor(() => expect(screen.getByTestId("broadcast-check-status")).toBeTruthy());
    expect(screen.queryByTestId("broadcast-confirm")).toBeNull();
  });

  it("status check: not-found allows confirming again, mempool hands over to the scan", async () => {
    m.broadcastTx.mockResolvedValue({ kind: "unknown" });
    m.getTxStatus.mockResolvedValueOnce("not-found").mockResolvedValueOnce("mempool");
    const { onSuccess } = renderDialog();
    fireEvent.click(screen.getByTestId("broadcast-confirm"));
    fireEvent.click(await screen.findByTestId("broadcast-check-status"));
    await screen.findByText(/It was probably not sent/);
    expect(screen.getByTestId("broadcast-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("broadcast-confirm"));
    fireEvent.click(await screen.findByTestId("broadcast-check-status"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(TX.txid));
    expect(m.broadcastTx).toHaveBeenCalledTimes(2);
  });

  it("rejection shows the node message and the reason", async () => {
    m.broadcastTx.mockResolvedValue({ kind: "rejected", code: -25, message: "bad-txns-inputs-missingorspent", reason: "inputs-missing-or-spent" });
    renderDialog();
    fireEvent.click(screen.getByTestId("broadcast-confirm"));
    await screen.findByText("bad-txns-inputs-missingorspent");
    expect(screen.getByText(/already spent/)).toBeTruthy();
  });

  it("self-hosted: runs the dry-run and names the node", async () => {
    m.testMempoolAccept.mockResolvedValue({ allowed: false, reason: "min relay fee not met" });
    renderDialog({ baseUrl: "http://192.168.1.5:3006/api", cls: "self-hosted" });
    await screen.findByText(/would reject it: min relay fee not met/);
    expect(screen.getByText(/your node \(192\.168\.1\.5\)/)).toBeTruthy();
    expect(screen.getByText(/relays it to its peers/)).toBeTruthy();
  });

  it("critical finding changes the label to Broadcast anyway", () => {
    const critical = { ...RESULT, findings: [{ id: "h2-change-detected", severity: "critical", scoreImpact: -15, title: "Change", description: "", confidence: "high" }] };
    renderDialog({ result: critical as never });
    expect(screen.getByTestId("broadcast-confirm").textContent).toMatch(/Broadcast anyway/);
    expect(screen.getByText(/critical privacy leak/)).toBeTruthy();
  });
});
