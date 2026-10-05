// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { analyzeTransactionSync } from "@/lib/analysis/analyze-sync";
import { TX_BASE_SCORE } from "@/lib/scoring/score";
import { buildResultViewModel } from "@/lib/view/tx-view-model";
import type { MempoolTransaction } from "@/lib/api/types";
import { groupsTiers } from "../stage-layout";
import { TxStage } from "../TxStage";

// Rendering 300+ CoinJoin rows is slow under full-suite load.
vi.setConfig({ testTimeout: 30_000 });

vi.mock("react-i18next", async () => {
  const en = (await import("../../../../public/locales/en/common.json")).default as Record<string, string>;
  const t = (k: string, o: Record<string, unknown> = {}) =>
    (en[k] ?? (typeof o.defaultValue === "string" ? o.defaultValue : k)).replace(/\{\{(\w+)\}\}/g, (raw, n: string) => (n in o ? String(o[n]) : raw));
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

const FIXTURES = join(__dirname, "../../../lib/analysis/heuristics/__tests__/fixtures/api-responses");
const tx = JSON.parse(readFileSync(join(FIXTURES, "wabisabi-coinjoin.json"), "utf-8")) as MempoolTransaction;
const vm = buildResultViewModel({ result: analyzeTransactionSync(tx), baseScore: TX_BASE_SCORE, tx });

beforeAll(() => {
  // jsdom has no layout: give the stage a desktop width so the diagram renders.
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.getBoundingClientRect = () => ({ width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
});

/** Tier headers read "N × value" (equal CoinJoin outputs drawn as one row). */
const tiers = (root: HTMLElement) => within(root).queryAllByText(/^\d+ × /);

describe("groupsTiers", () => {
  it("groups only CoinJoins, not when listed individually or in linkability mode", () => {
    expect(groupsTiers(true, false, false)).toBe(true);
    expect(groupsTiers(true, true, false)).toBe(false);
    expect(groupsTiers(true, false, true)).toBe(false);
    expect(groupsTiers(false, false, false)).toBe(false);
  });
});

describe("TxStage grouping (CoinJoin)", () => {
  it("fixture is a CoinJoin whose outputs collapse into tiers and a more row", () => {
    expect(vm.isCoinJoin).toBe(true);
    render(<TxStage tx={tx} vm={vm} />);
    expect(tiers(screen.getByTestId("tx-stage")).length).toBeGreaterThan(1);
    expect(screen.getAllByText(/^\+\d+ more$/).length).toBeGreaterThan(0);
  });

  it("'+N more' shows every row but keeps equal outputs grouped", () => {
    render(<TxStage tx={tx} vm={vm} />);
    const stage = screen.getByTestId("tx-stage");
    const before = tiers(stage).length;
    const mores = within(stage).getAllByText(/^\+\d+ more$/);
    const outMore = mores.at(-1)!; // inputs come first, the outputs' row is last
    fireEvent.click(outMore.closest("button") ?? outMore);
    expect(tiers(stage).length).toBeGreaterThanOrEqual(before);
    expect(within(stage).queryAllByText(/^\+\d+ more$/)).toHaveLength(mores.length - 1);
  });

  it("fullscreen keeps equal outputs grouped", () => {
    render(<TxStage tx={tx} vm={vm} />);
    fireEvent.click(screen.getByRole("button", { name: "Open fullscreen" }));
    const dialog = screen.getByRole("dialog");
    expect(tiers(dialog).length).toBeGreaterThan(1);
  });

  it("'Show individual outputs' ungroups and 'Group equal outputs' regroups", () => {
    render(<TxStage tx={tx} vm={vm} />);
    const stage = screen.getByTestId("tx-stage");
    fireEvent.click(within(stage).getByRole("button", { name: "Show individual outputs" }));
    expect(tiers(stage)).toHaveLength(0);
    fireEvent.click(within(stage).getByRole("button", { name: "Group equal outputs" }));
    expect(tiers(stage).length).toBeGreaterThan(1);
  });
});
