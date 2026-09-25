import { describe, it, expect } from "vitest";
import type { Finding, Grade } from "@/lib/types";
import type { FindingId } from "@/lib/analysis/finding-metadata";
import { generateActions } from "../generate-actions";

function f(id: FindingId, over: Partial<Finding> = {}): Finding {
  return { id, severity: "medium", title: id, description: "", recommendation: "", scoreImpact: -5, ...over };
}

const keys = (findings: Finding[], grade: Grade = "B") =>
  generateActions(findings, grade).map((a) => a.textKey.replace("remediation.", ""));

describe("generateActions", () => {
  it("returns nothing for a clean tx with a good grade", () => {
    expect(generateActions([], "A+")).toEqual([]);
  });

  it("falls back to a fresh start only for D/F with no finding-specific actions", () => {
    expect(keys([], "F")).toEqual(["freshStart", "connectionPrivacy"]);
    expect(keys([], "D")).toEqual(["freshStart", "connectionPrivacy"]);
    expect(keys([], "C")).toEqual(["connectionPrivacy"]);
    expect(keys([f("h10-p2pkh")], "F")).toEqual(["upgradeNativeSegwit", "connectionPrivacy"]);
  });

  it("critical reuse is priority 1, non-critical reuse priority 2", () => {
    expect(generateActions([f("h8-address-reuse", { severity: "critical" })], "B")[0]).toMatchObject({
      priority: 1,
      textKey: "remediation.stopReusingAddress",
    });
    expect(generateActions([f("h8-address-reuse", { severity: "high" })], "B")[0]).toMatchObject({
      priority: 2,
      textKey: "remediation.avoidAddressReuse",
    });
  });

  it("change detection adds change handling and small-change disposal", () => {
    expect(keys([f("h2-change-detected")])).toEqual(["betterChangeHandling", "smallChangeDisposal"]);
  });

  it("positive CoinJoin at A+ encourages continuing and warns about exchanges", () => {
    const cj = [f("h4-whirlpool", { scoreImpact: 30 })];
    expect(keys(cj, "A+")).toEqual(["useDecentralizedExchanges", "continueCoinJoin"]);
    expect(keys(cj, "B")).toEqual(["useDecentralizedExchanges"]);
  });

  it("CIOH adds multi-input guidance unless CoinJoin or suppressed", () => {
    expect(keys([f("h3-cioh")])).toEqual(["minimizeMultiInput", "segregatedSpending"]);
    expect(keys([f("h3-cioh", { scoreImpact: 0 })])).toEqual([]);
    expect(keys([f("h3-cioh"), f("h4-coinjoin", { scoreImpact: 20 })])).not.toContain("minimizeMultiInput");
  });

  it.each<[FindingId, string[]]>([
    ["h2-self-send", ["switchWalletSelfSend"]],
    ["dust-attack", ["doNotSpendDust"]],
    ["h10-p2pkh", ["upgradeNativeSegwit"]],
    ["h10-p2sh", ["upgradeNativeSegwit"]],
    ["h7-op-return", ["avoidOpReturn"]],
    ["script-multisig", ["switchMultisig"]],
    ["h11-wallet-fingerprint", ["walletFingerprint", "fingerprintRandomization"]],
    ["h5-low-entropy", ["usePayJoin"]],
    ["h5-zero-entropy", ["usePayJoin"]],
  ])("%s maps to %j", (id, expected) => {
    expect(keys([f(id)])).toEqual(expected);
  });

  it("matches numbered OP_RETURN ids", () => {
    expect(keys([f("h7-op-return-1")])).toEqual(["avoidOpReturn"]);
  });

  it("sorts by priority and keeps only the top five", () => {
    const actions = generateActions(
      [
        f("h11-wallet-fingerprint"),
        f("h10-p2pkh"),
        f("h2-change-detected"),
        f("h8-address-reuse", { severity: "critical" }),
        f("h2-self-send"),
        f("dust-attack"),
      ],
      "F",
    );
    expect(actions).toHaveLength(5);
    expect(actions.map((a) => a.priority)).toEqual([1, 1, 1, 3, 4]);
    expect(actions[0]?.textKey).toBe("remediation.stopReusingAddress");
  });
});
