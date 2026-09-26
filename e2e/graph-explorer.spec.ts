import { test, expect } from "@playwright/test";
import { loadTxFixture, mockExtraTxs, mockMempoolApi, type MockTx } from "./helpers/mock-api";

// Root: the 1-input legacy P2PKH fixture. Its only input spends output 1 of
// PARENT_TXID, which no fixture covers, so a parent is built from the child's
// prevout and served by mockExtraTxs.
const ROOT = loadTxFixture("simple-legacy-p2pkh");
const PARENT_TXID = ROOT.vin[0]!.txid;

function buildParent(): MockTx {
  const parent = loadTxFixture("simple-legacy-p2pkh");
  parent.txid = PARENT_TXID;
  parent.vin[0]!.txid = "aa".repeat(32);
  parent.vout[1] = ROOT.vin[0]!.prevout!;
  return parent;
}

/** GraphNodeRenderer label: truncateId(txid, 8). */
const label = (txid: string) => `${txid.slice(0, 8)}...${txid.slice(-8)}`;

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
  await mockExtraTxs(page, [buildParent()]);
});

test("graph page loads a root, expands an input, and restores a saved graph", async ({ page }) => {
  await page.goto(`/graph/#txid=${ROOT.txid}`);

  await expect(page.getByText(label(ROOT.txid))).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(label(PARENT_TXID))).toHaveCount(0);

  // The lone root node's backward (input) "+"
  await page.getByRole("button", { name: "Expand inputs" }).first().click();
  await expect(page.getByText(label(PARENT_TXID))).toBeVisible();

  await page.getByTitle("Save graph (S)").click();
  const nameInput = page.getByPlaceholder("Graph name...");
  await nameInput.fill("E2E graph");
  // Scope to the save panel (the input's container), not the toolbar's Save toggle
  await nameInput.locator("..").getByRole("button", { name: "Save", exact: true }).click();

  // With no hash and no root, the page restores the most recently saved graph
  await page.goto("/graph/");
  await expect(page.getByText(label(ROOT.txid))).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(label(PARENT_TXID))).toBeVisible();

  await page.getByTitle("Open saved graph (O)").click();
  const saved = page.getByRole("button", { name: /E2E graph/ });
  await expect(saved).toContainText("2 nodes");
});
