// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFindingFilters } from "../useFindingFilters";
import type { Finding } from "@/lib/types";

const finding = (id: string, extra: Partial<Finding>) =>
  ({ id, severity: "low", title: "", description: "", recommendation: "", scoreImpact: 0, ...extra }) as Finding;

const historical = finding("h3-cioh", { adversaryTiers: ["passive_observer"], temporality: "historical" });
const active = finding("h8-address-reuse", { adversaryTiers: ["passive_observer"], temporality: "active_risk" });
const untagged = finding("h1-round-amount", {});

describe("useFindingFilters", () => {
  it("passes everything through until a filter narrows", () => {
    const { result } = renderHook(() => useFindingFilters());
    expect(result.current.isFiltering).toBe(false);
    const all = [historical, active, untagged];
    expect(result.current.apply(all)).toBe(all);
  });

  it("filters by temporality, keeping untagged findings", () => {
    const { result } = renderHook(() => useFindingFilters());
    act(() => result.current.toggleTemporality("historical"));
    expect(result.current.isFiltering).toBe(true);
    expect(result.current.apply([historical, active, untagged])).toEqual([active, untagged]);
  });

  it("filters by highest adversary tier", () => {
    const { result } = renderHook(() => useFindingFilters());
    act(() => result.current.toggleAdversary("passive_observer"));
    expect(result.current.apply([historical, untagged])).toEqual([untagged]);
  });

  it("never deselects the last active option", () => {
    const { result } = renderHook(() => useFindingFilters());
    act(() => {
      result.current.toggleAdversary("passive_observer");
      result.current.toggleAdversary("kyc_exchange");
      result.current.toggleAdversary("state_adversary");
    });
    expect([...result.current.activeAdversary]).toEqual(["state_adversary"]);

    act(() => result.current.toggleAdversary("passive_observer"));
    expect(result.current.activeAdversary.has("passive_observer")).toBe(true);
  });
});
