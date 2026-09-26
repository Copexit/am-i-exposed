// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k }),
}));

import { WalletComparison } from "../WalletComparison";
import { RECOMMENDED_WALLETS } from "@/data/guide/wallets";

describe("WalletComparison", () => {
  it("renders one cell per header column on every wallet row", () => {
    const table = render(<WalletComparison />).container.querySelector("table")!;
    const headers = table.querySelectorAll("thead th").length;
    const rows = table.querySelectorAll("tbody tr");
    expect(headers).toBe(12);
    expect(rows.length).toBe(RECOMMENDED_WALLETS.length);
    for (const row of rows) expect(row.querySelectorAll("td").length).toBe(headers);
  });
});
