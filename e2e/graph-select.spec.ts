import { test, expect, type Page } from "@playwright/test";
import { loadTxFixture, mockExtraTxs, mockMempoolApi, type MockTx } from "./helpers/mock-api";

// ROOT funds MID, which funds CHILD. The graph opens on CHILD and expands back
// to MID and ROOT, so two nodes that are not the root can be selected.
const ROOT = loadTxFixture("simple-legacy-p2pkh");

/** A 1-in tx spending output 0 of `funder`, with the root fixture's outputs. */
function buildSpend(txid: string, funder: MockTx): MockTx {
  const tx = loadTxFixture("simple-legacy-p2pkh");
  tx.txid = txid;
  tx.vin[0]!.txid = funder.txid;
  tx.vin[0]!.vout = 0;
  tx.vin[0]!.prevout = funder.vout[0]!;
  return tx;
}
const MID = buildSpend("11".repeat(32), ROOT);
const CHILD = buildSpend("22".repeat(32), MID);

const node = (page: Page, txid: string) => page.locator(`[data-txid="${txid}"]`);

/** Opens CHILD and expands back `hops` steps (MID, then ROOT). */
async function openChain(page: Page, hops: 1 | 2) {
  await page.goto(`/graph/#txid=${CHILD.txid}`);
  await expect(node(page, CHILD.txid)).toBeVisible({ timeout: 15_000 });
  await node(page, CHILD.txid).getByRole("button", { name: "Expand inputs" }).click();
  await expect(node(page, MID.txid)).toBeVisible();
  if (hops === 2) {
    await node(page, MID.txid).getByRole("button", { name: "Expand inputs" }).click();
    await expect(node(page, ROOT.txid)).toBeVisible();
  }
}

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
  await mockExtraTxs(page, [MID, CHILD]);
});

test("ctrl+click selects two nodes, Hide hides them, the chip brings them back", async ({ page }) => {
  await openChain(page, 2);

  await node(page, MID.txid).click({ modifiers: ["Control"] });
  await node(page, ROOT.txid).click({ modifiers: ["Control"] });
  const bar = page.getByTestId("graph-batch-bar");
  await expect(bar).toContainText("2 selected");
  await expect(page.locator("[data-selected]")).toHaveCount(2);
  // Selecting never opens the sidebar
  await expect(page.getByTitle("Collapse sidebar")).toHaveCount(0);

  await bar.getByRole("button", { name: "Hide" }).click();
  await expect(node(page, MID.txid)).toHaveCount(0);
  await expect(node(page, ROOT.txid)).toHaveCount(0);
  await expect(bar).toHaveCount(0);
  const chips = page.getByTestId("graph-filter-chips");
  await expect(chips).toContainText("2 hidden");

  await chips.getByRole("button", { name: "Remove: 2 hidden" }).click();
  await expect(node(page, MID.txid)).toBeVisible();
  await expect(node(page, ROOT.txid)).toBeVisible();
  await expect(chips).toHaveCount(0);

  // Escape clears the selection
  await node(page, MID.txid).click({ modifiers: ["Control"] });
  await expect(bar).toContainText("1 selected");
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the select-mode toggle makes a tap select a node", async ({ page }) => {
    await openChain(page, 1);

    const toggle = page.getByRole("button", { name: "Select nodes" });
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await node(page, MID.txid).tap();
    await expect(page.getByTestId("graph-batch-bar")).toContainText("1 selected");
    await expect(node(page, MID.txid)).toHaveAttribute("data-selected", "true");
  });
});
