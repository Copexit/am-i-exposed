// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import type { Finding } from "@/lib/types";

// Like i18next: an array of keys resolves to the first one the catalog has,
// falling back to defaultValue only when none exist.
vi.mock("react-i18next", async () => {
  const en = (await import("../../../public/locales/en/common.json")).default as Record<string, string>;
  const t = (k: string | string[], o: Record<string, unknown> = {}) => {
    const hit = [k].flat().find((key) => key in en);
    return (hit ? en[hit]! : String(o.defaultValue ?? k))
      .replace(/\{\{(\w+)\}\}/g, (raw, name: string) => (name in o ? String(o[name]) : raw));
  };
  return { useTranslation: () => ({ t }) };
});

import { ChainAnalysisPanel } from "../ChainAnalysisPanel";

afterEach(cleanup);

describe("ChainAnalysisPanel", () => {
  it("falls back to the base locale title when the variant key is missing", () => {
    const f = {
      id: "chain-coinjoin-input",
      severity: "good",
      title: "ENGLISH DEFAULT",
      description: "",
      recommendation: "",
      scoreImpact: 0,
      params: { _variant: "nokey", coinJoinCount: 1, totalInputs: 2 },
    } as unknown as Finding;
    render(<ChainAnalysisPanel findings={[f]} />);
    expect(screen.getByText("1/2 inputs came from CoinJoin")).toBeTruthy();
    expect(screen.queryByText("ENGLISH DEFAULT")).toBeNull();
  });
});
