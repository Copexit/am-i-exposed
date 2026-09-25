// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { makeTx } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, o?: Record<string, unknown>) =>
      String(o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_, p) => String(o?.[p])),
  }),
}));

import { IOTab } from "../IOTab";

afterEach(cleanup);

const baseProps = { tx: makeTx({ txid: "io-tx" }), changeOutputs: new Set<string>(), onToggleChange: vi.fn() };

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

  it("has no Stop button when not tracing", () => {
    const { queryByRole } = render(<IOTab {...baseProps} onCancelAutoTrace={vi.fn()} />);
    expect(queryByRole("button", { name: "Stop" })).toBeNull();
  });
});
