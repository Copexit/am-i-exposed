// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt } from "@/lib/input/__tests__/fixtures";
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
});

describe("search bar layout", () => {
  it("InlineSearchBar puts the extras and the Scan button in one flex container", async () => {
    vi.doMock("@/context/NetworkContext", () => ({ useNetwork: () => ({ network: "mainnet" }) }));
    const { InlineSearchBar } = await import("../results/InlineSearchBar");
    const { getByTestId, getByRole } = render(<InlineSearchBar onScan={vi.fn()} />);
    const box = getByTestId("input-actions");
    expect(box.className).toContain("flex");
    expect(box.contains(getByTestId("open-file"))).toBe(true);
    expect(box.contains(getByRole("button", { name: /scan/i }))).toBe(true);
  });
});
