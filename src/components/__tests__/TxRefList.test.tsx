// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, o: Record<string, unknown> = {}) => String(o.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (raw, n: string) => (n in o ? String(o[n]) : raw)),
    i18n: { language: "en" },
  }),
}));

import { TxRefList } from "../FindingCardTables";

afterEach(cleanup);

const A = "a".repeat(64);
const B = "b".repeat(64);

describe("TxRefList", () => {
  it("opens a tx and counts the rest", () => {
    const onTxClick = vi.fn();
    render(<TxRefList txidsJson={JSON.stringify([A, B])} more={4} onTxClick={onTxClick} />);
    fireEvent.click(screen.getAllByRole("button")[1]!);
    expect(onTxClick).toHaveBeenCalledWith(B);
    expect(screen.getByText("and 4 more")).toBeTruthy();
  });

  it("renders nothing for bad JSON or an empty list", () => {
    expect(render(<TxRefList txidsJson="not json" more={0} />).container.innerHTML).toBe("");
    expect(render(<TxRefList txidsJson="[]" more={0} />).container.innerHTML).toBe("");
  });
});
