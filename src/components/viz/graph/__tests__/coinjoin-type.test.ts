import { describe, it, expect } from "vitest";
import type { Finding } from "@/lib/types";
import { getCoinJoinType } from "../layout";

const cj = (params: Record<string, string | number>, title = "Likely CoinJoin"): Finding =>
  ({ id: "h4-coinjoin", severity: "good", title, description: "", recommendation: "", scoreImpact: 20, params }) as Finding;

describe("getCoinJoinType", () => {
  it("labels a classified WabiSabi round WabiSabi", () => {
    expect(getCoinJoinType([cj({ isWabiSabi: 1 })])).toBe("WabiSabi");
  });

  it("labels a Wasabi 1.x (ZeroLink) round as such, not WabiSabi, whatever its title says", () => {
    expect(getCoinJoinType([cj({ isWasabi1: 1 }, "Wasabi Wallet CoinJoin")])).toBe("Wasabi 1.x");
  });

  it("does not infer WabiSabi from the title of a generic CoinJoin", () => {
    expect(getCoinJoinType([cj({ isWabiSabi: 0 }, "WabiSabi CoinJoin")])).toBe("CoinJoin");
  });
});
