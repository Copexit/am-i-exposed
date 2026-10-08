/**
 * Golden scenario corpus for Privacy first: synthetic wallets with the
 * expected order of the plans, each with its rationale in plain words. This
 * is the spec of the ranking (guide, "How plans are ranked"): when a rule
 * changes, the corpus changes with it. Amounts only; every txid and address
 * is made up.
 */
import { describe, it, expect } from "vitest";
import { adviseCoinSelection, buildCoinInputs, noCleanOption, outpointOf, type CoinSelectionInput } from "../coin-selection";
import { decisionTreeReplica, testerHistory } from "./fixtures/wallet-history";

let seq = 0;
function coin(value: number, opts: Partial<Omit<CoinSelectionInput, "utxo">> & { txid?: string; vout?: number } = {}): CoinSelectionInput {
  const { txid, vout, ...rest } = opts;
  seq++;
  return { utxo: { txid: txid ?? `corpus${seq}`, vout: vout ?? 0, value, status: { confirmed: true } }, address: `bc1qcorpus${seq}`, ...rest };
}

interface Case {
  name: string;
  /** Why this order, in plain words */
  why: string;
  coins: () => CoinSelectionInput[];
  amount: number;
  feeRate: number;
  maxAbsorb?: number;
  /** Values of coins the recipient already knows */
  known?: number[];
  recipientType?: string;
  /** Plans under Privacy first, each as its coin values joined with "+", best first */
  order: string[];
  /** Both best plans leak something significant: "No clean option", no Recommended badge */
  noClean?: boolean;
}

const replica = () => buildCoinInputs(decisionTreeReplica());
const replay = () => { const { h, addresses } = testerHistory(); return buildCoinInputs(h.infos(addresses)); };

const CASES: Case[] = [
  {
    name: "rule 4",
    why: "Two unrelated receipts pay with no change; one receipt would leave change 20x the payment. The merge wins, accepting what it implies.",
    coins: () => [coin(2_100_200, { origin: "received" }), coin(60_000, { origin: "received" }), coin(40_200, { origin: "received" })],
    amount: 100_000, feeRate: 1, maxAbsorb: 0,
    order: ["60000+40200", "2100200"],
  },
  {
    name: "tester, 38,034 sats",
    why: "38,625 pays with no change (591 sats over, to miners); 64,332 would leave change and is only cheaper by 436 sats, under the fee tolerance, so it is not listed.",
    coins: replica, amount: 38_034, feeRate: 5,
    order: ["38625"],
  },
  {
    name: "tester, 3,382,886 sats",
    why: "Coins that are not change (the receipts; both outputs of the self-transfer are change) add up to 102,957: the only plan that breaks no hard rule is the 165M change coin alone, with huge change. The sibling pair (both outputs of one self-transfer) is one violation and no new link; his 3-coin pick is one violation (change merged) and links 3 groups, so it goes third. Both best plans leak something significant: no clean option, nothing recommended. The tester would pick B; the panel lets him.",
    coins: replica, amount: 3_382_886, feeRate: 5,
    order: ["165519188", "3296321+2399400", "3296321+64332+38625"],
    noClean: true,
  },
  {
    name: "tester replay, 600,000 sats",
    why: "Every coin is change. Each coin alone respects the rule; the 99M coin's huge change beats the CoinJoin change coin's toxic change; the 591,429 + 134,361 pair merges change.",
    coins: replay, amount: 600_000, feeRate: 5,
    order: ["99000000", "15240920", "591429+134361"],
  },
  {
    name: "KYC with no-KYC",
    why: "The changeless pair would merge [KYC] with [noKYC] (tier a): the big coin alone goes first even with big change.",
    coins: () => [coin(400_000), coin(60_000, { labelTags: ["kyc"] }), coin(40_200, { labelTags: ["nokyc"] })],
    amount: 100_000, feeRate: 1, maxAbsorb: 0,
    order: ["400000", "60000+40200"],
  },
  {
    name: "[CJ] coin with another coin",
    why: "Merging a [CJ] coin with a coin that is not breaks labeling rule 2; the [CJ] coin alone, with no change, goes first.",
    coins: () => [coin(100_600, { labelTags: ["cj"] }), coin(60_000), coin(40_200, { labelTags: ["cj"] })],
    amount: 100_000, feeRate: 1,
    order: ["100600"],
  },
  {
    name: "absorb small change",
    why: "103,000 leaves under 5,000 sats: paid to miners, no change. The larger coin leaves big change.",
    coins: () => [coin(103_000), coin(300_000)],
    amount: 100_000, feeRate: 1,
    order: ["103000", "300000"],
  },
  {
    name: "recipient already knows a coin",
    why: "The recipient sent the 2M coin: paying with it tells it nothing new (tier b), even with huge change.",
    coins: () => [coin(2_000_000, { txid: "known" }), coin(115_000)],
    amount: 100_000, feeRate: 1, maxAbsorb: 0, known: [2_000_000],
    order: ["2000000", "115000"],
  },
  {
    name: "round payment, round change",
    why: "Both coins leave small change; 140,140's change is a round 40,000 sats, so the round-amount rule cannot point at it (tier e), though the other leaves less.",
    coins: () => [coin(135_000), coin(140_140)],
    amount: 100_000, feeRate: 1, maxAbsorb: 0,
    order: ["140140", "135000"],
  },
  {
    name: "all-change wallet, no coin pays alone",
    why: "Every plan merges change (tier a, equal). The 3-coin set leaves spendable change (big by the 3-group guard) and goes before the pair's toxic change. 60,000 + 50,000 is the 60,000 + 45,000 pair with more change: not listed.",
    coins: () => [coin(60_000, { origin: "change" }), coin(50_000, { origin: "change" }), coin(45_000, { origin: "change" })],
    amount: 100_000, feeRate: 1, maxAbsorb: 0,
    order: ["60000+50000+45000", "60000+45000"],
    noClean: true,
  },
  {
    name: "receipts' merge over a change coin with big change",
    why: "Both respect the change rule. Rule 4: the receipts' changeless pair uses up the change, so it goes before the change coin alone, which leaves 1.5x the payment.",
    coins: () => [coin(250_000, { origin: "change" }), coin(60_000, { origin: "received" }), coin(40_200, { origin: "received" })],
    amount: 100_000, feeRate: 1, maxAbsorb: 0,
    order: ["60000+40200", "250000"],
  },
  {
    name: "one label observer",
    why: "No coin pays alone. Juan already knows both his coins (tier c, softer links); the pair with Ana's coin links groups no observer knows together, and stays listed only for its smaller change.",
    coins: () => [coin(70_000, { labelObserver: "Juan" }), coin(50_000, { labelObserver: "Juan" }), coin(52_000, { labelObserver: "Ana" })],
    amount: 100_000, feeRate: 1, maxAbsorb: 0,
    order: ["70000+50000", "52000+50000"],
  },
  {
    name: "CoinJoin outputs only, when a merge is needed",
    why: "No coin pays alone: merging two mixed outputs (no history) goes before merging two coins with history (tier c, softer links), with its warning; the history pair is only 250 sats cheaper, under the fee tolerance, so it is not listed.",
    coins: () => [coin(60_000, { origin: "mixed" }), coin(40_500, { origin: "mixed" }), coin(55_000), coin(45_250)],
    amount: 100_000, feeRate: 1, maxAbsorb: 0,
    order: ["60000+40500"],
  },
  {
    name: "probable link before a new one",
    why: "No coin pays alone: the pair already probably linked confirms a guess (no new link, tier c); the pairs with the third coin are new links, listed for their smaller change.",
    coins: () => [coin(70_000, { cluster: "a", group: "g" }), coin(50_000, { cluster: "b", group: "g" }), coin(55_000)],
    amount: 100_000, feeRate: 1, maxAbsorb: 0,
    order: ["70000+50000", "70000+55000", "55000+50000"],
  },
  {
    name: "same address: no new link",
    why: "The two coins on one address are already linked: no change and no new link, so they go before the single coin with change.",
    coins: () => [coin(150_000), coin(60_000, { address: "bc1qsame" }), coin(40_200, { address: "bc1qsame" })],
    amount: 100_000, feeRate: 1, maxAbsorb: 0,
    order: ["60000+40200", "150000"],
  },
  {
    name: "address type differs",
    why: "Paying a Taproot address from P2WPKH coins: change of either coin is detectable by type (tier e, equal); the closer coin is better on every fact, so the other is not listed.",
    coins: () => [coin(130_000), coin(170_000)],
    amount: 100_000, feeRate: 1, maxAbsorb: 0, recipientType: "p2tr",
    order: ["130000"],
  },
];

const label = (values: number[]) => values.sort((a, b) => b - a).join("+");

describe("Privacy first: golden corpus", () => {
  for (const c of CASES) {
    it(`${c.name}: ${c.why}`, () => {
      const coins = c.coins();
      const known = new Set(coins.filter(x => c.known?.includes(x.utxo.value)).map(outpointOf));
      const a = adviseCoinSelection(coins, c.amount, c.feeRate, c.maxAbsorb ?? 5_000, { known, ...(c.recipientType ? { recipientType: c.recipientType } : {}) });
      if (a.kind !== "plans") throw new Error(a.kind);
      expect(a.plans.map(p => label(p.selected.map(s => s.utxo.value)))).toEqual(c.order);
      expect(noCleanOption(a.plans) !== null).toBe(c.noClean ?? false);
    });
  }
});
