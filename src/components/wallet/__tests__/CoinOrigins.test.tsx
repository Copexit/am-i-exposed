// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { COIN_CLASSES, type OriginCounts } from "@/lib/analysis/wallet-behavior";

vi.mock("react-i18next", async () => {
  const en = (await import("../../../../public/locales/en/common.json")).default as Record<string, string>;
  const t = (k: string, o: Record<string, unknown> = {}) =>
    (en[k] ?? (typeof o.defaultValue === "string" ? o.defaultValue : k)).replace(/\{\{(\w+)\}\}/g, (raw, name: string) => (name in o ? String(o[name]) : raw));
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

import { CoinOrigins } from "../CoinOrigins";

afterEach(cleanup);

const origins = (set: Partial<OriginCounts>): OriginCounts =>
  ({ ...Object.fromEntries(COIN_CLASSES.map((c) => [c, { count: 0, sats: 0 }])), ...set }) as OriginCounts;

describe("CoinOrigins", () => {
  it("lists classes with coins and hides empty ones", () => {
    render(<CoinOrigins origins={origins({ mixed: { count: 3, sats: 3_000_000 }, "coinjoin-change": { count: 1, sats: 995_000 } })} />);
    expect(screen.getByText("Mixed (CoinJoin)")).toBeTruthy();
    expect(screen.getByText("CoinJoin change")).toBeTruthy();
    expect(screen.queryByText("Received")).toBeNull();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("4 unspent coins by origin");
  });

  it("renders nothing without coins", () => {
    const { container } = render(<CoinOrigins origins={origins({})} />);
    expect(container.innerHTML).toBe("");
  });
});
