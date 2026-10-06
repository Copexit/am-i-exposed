// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt, coldcardJson } from "@/lib/input/__tests__/fixtures";
import { InputExtras } from "../InputExtras";

describe("InputExtras", () => {
  it("passes a chosen PSBT file to onPayload as hex", async () => {
    const bytes = buildPsbt({ sign: false }).toPSBT();
    const onPayload = vi.fn();
    const { container } = render(<InputExtras onPayload={onPayload} onError={vi.fn()} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(bytes)], "tx.psbt")] } });
    await waitFor(() => expect(onPayload).toHaveBeenCalledWith(bytesToHex(bytes)));
  });

  it("a multisig-only wallet .json shows the multisig message", async () => {
    const { json } = coldcardJson({ withMultisig: true });
    for (const k of ["bip44", "bip49", "bip84", "bip86"]) delete json[k];
    const onPayload = vi.fn(), onError = vi.fn();
    const { container } = render(<InputExtras onPayload={onPayload} onError={onError} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([JSON.stringify(json)], "wallet.json")] } });
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Multisig wallet exports are not supported yet|qr\.multisig/)));
    expect(onPayload).not.toHaveBeenCalled();
  });

  it("the Scan QR button lazy-loads the scanner dialog", async () => {
    const { getByTestId, findByRole } = render(<InputExtras onPayload={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(getByTestId("scan-qr"));
    expect((await findByRole("dialog", {}, { timeout: 5000 })).getAttribute("aria-modal")).toBe("true");
  });
});

describe("search bar layout", () => {
  it("InlineSearchBar puts the extras and the Scan button in one flex container", async () => {
    vi.doMock("@/context/NetworkContext", () => ({ useNetwork: () => ({ network: "mainnet" }) }));
    const { InlineSearchBar } = await import("../results/InlineSearchBar");
    const { getByTestId, getByRole } = render(<InlineSearchBar onScan={vi.fn()} />);
    const box = getByTestId("input-actions");
    expect(box.className).toContain("flex");
    expect(box.contains(getByTestId("open-file"))).toBe(true);
    expect(box.contains(getByRole("button", { name: /^scan$/i }))).toBe(true);
  });
});
