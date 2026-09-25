// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { makeTx, makeVin, makeVout } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, o?: Record<string, unknown>) =>
      String(o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_, p) => String(o?.[p])),
  }),
}));

import { IOTab } from "../IOTab";

afterEach(cleanup);

const baseProps = { tx: makeTx({ txid: "io-tx" }), changeOutputs: new Set<string>(), onToggleChange: vi.fn() };

describe("IOTab Compute Linkability button", () => {
  const txWith = (nIn: number, nOut: number) => makeTx({
    txid: `tx-${nIn}-${nOut}`,
    vin: Array.from({ length: nIn }, (_, i) => makeVin({ txid: String(i % 10).repeat(64), vout: i })),
    vout: Array.from({ length: nOut }, (_, i) => makeVout({ value: 10_000 + i })),
  });

  it("is shown for a 2+ input tx the graph can compute", () => {
    const { queryByText } = render(<IOTab {...baseProps} tx={txWith(3, 3)} onComputeBoltzmann={vi.fn()} />);
    expect(queryByText(/Compute Linkability/)).not.toBeNull();
  });

  it("is hidden for a tx over the graph's 80 I/O cap (clicking would do nothing)", () => {
    const { queryByText } = render(<IOTab {...baseProps} tx={txWith(60, 30)} onComputeBoltzmann={vi.fn()} />);
    expect(queryByText(/Compute Linkability/)).toBeNull();
  });
});

describe("IOTab auto-trace progress", () => {
  it("shows a Stop button next to the hop counter that cancels the trace", () => {
    const onCancel = vi.fn();
    const { getByText, getByRole } = render(
      <IOTab {...baseProps} autoTracing autoTraceProgress={{ hop: 3, txid: "x", reason: "expanding" }} onCancelAutoTrace={onCancel} />,
    );
    expect(getByText("Tracing hop 3...")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "Stop" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows why the last trace stopped once tracing has ended", () => {
    const { getByText, rerender, queryByText } = render(<IOTab {...baseProps} autoTraceStop="unspent" />);
    expect(getByText("Trace stopped: unspent")).toBeTruthy();
    rerender(<IOTab {...baseProps} autoTracing autoTraceProgress={{ hop: 1, txid: "x", reason: "expanding" }} autoTraceStop="unspent" />);
    expect(queryByText("Trace stopped: unspent")).toBeNull();
  });

  it("has no Stop button when not tracing", () => {
    const { queryByRole } = render(<IOTab {...baseProps} onCancelAutoTrace={vi.fn()} />);
    expect(queryByRole("button", { name: "Stop" })).toBeNull();
  });
});
