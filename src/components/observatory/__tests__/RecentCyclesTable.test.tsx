// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import type { WhirlpoolTxsPage } from "@/lib/observatory/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.defaultValue as string) ?? key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({ isUmbrel: false }),
}));

const getWhirlpoolTxs = vi.fn<(base: string, page: number) => Promise<WhirlpoolTxsPage>>();
vi.mock("@/lib/observatory/whirlpool-client", () => ({
  getWhirlpoolTxs: (base: string, page: number) => getWhirlpoolTxs(base, page),
}));

import { RecentCyclesTable } from "../RecentCyclesTable";

function page(n: number, txids: string[], totalPages = 3): WhirlpoolTxsPage {
  return {
    items: txids.map((txid) => ({
      txid,
      block_height: 900000,
      pool_name: "p",
      pool_label: "Pool",
      pool_color: "#000",
      am_i_exposed_url: "",
      tx0_inputs: [],
    })),
    page: n,
    per_page: txids.length,
    total: 10,
    total_pages: totalPages,
  };
}

function txids(container: HTMLElement): string[] {
  return [...container.querySelectorAll("a")].map((a) =>
    a.getAttribute("href")!.replace("/#tx=", ""),
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("RecentCyclesTable load more", () => {
  beforeEach(() => {
    cleanup();
    getWhirlpoolTxs.mockReset();
  });

  it("appends the next page, and drops appended pages when the base page refreshes", async () => {
    getWhirlpoolTxs.mockResolvedValueOnce(page(2, ["b"]));
    const first = page(1, ["a"]);
    const { container, rerender, getByRole } = render(<RecentCyclesTable firstPage={first} />);

    await act(async () => { fireEvent.click(getByRole("button")); });
    expect(getWhirlpoolTxs).toHaveBeenCalledWith(expect.any(String), 2);
    expect(txids(container)).toEqual(["a", "b"]);

    rerender(<RecentCyclesTable firstPage={page(1, ["z"])} />);
    expect(txids(container)).toEqual(["z"]);
  });

  it("discards a page that was in flight when the base page refreshed", async () => {
    const pending = deferred<WhirlpoolTxsPage>();
    getWhirlpoolTxs.mockReturnValueOnce(pending.promise);
    const { container, rerender, getByRole } = render(<RecentCyclesTable firstPage={page(1, ["a"])} />);

    fireEvent.click(getByRole("button"));
    rerender(<RecentCyclesTable firstPage={page(1, ["z"])} />);
    await act(async () => { pending.resolve(page(2, ["stale"])); });

    expect(txids(container)).toEqual(["z"]);
  });
});
