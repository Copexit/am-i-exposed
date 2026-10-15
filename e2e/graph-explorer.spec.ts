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

/** A 1-in tx spending output 0 of `funder`, with the root fixture's outputs. */
function buildSpend(txid: string, funder: MockTx): MockTx {
  const tx = loadTxFixture("simple-legacy-p2pkh");
  tx.txid = txid;
  tx.vin[0]!.txid = funder.txid;
  tx.vin[0]!.vout = 0;
  tx.vin[0]!.prevout = funder.vout[0]!;
  return tx;
}

// ROOT funds MID, which funds CHILD: two hops away, reached only by searching
const MID = buildSpend("11".repeat(32), ROOT);
const CHILD = buildSpend("22".repeat(32), MID);

/** GraphNodeRenderer label: truncateId(txid, 8). */
const label = (txid: string) => `${txid.slice(0, 8)}...${txid.slice(-8)}`;

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
  await mockExtraTxs(page, [buildParent(), MID, CHILD]);
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

test("find connection: a search from the root finds a child two hops away and adds the path", async ({ page }) => {
  await page.goto(`/graph/#txid=${ROOT.txid}`);
  await expect(page.getByText(label(ROOT.txid))).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Find connection" }).first().click();
  const panel = page.getByTestId("connection-panel");
  await expect(panel.getByLabel("From")).toHaveValue(ROOT.txid);
  await panel.getByLabel("To", { exact: true }).fill(CHILD.txid);
  await panel.getByRole("button", { name: "Find connection" }).click();

  await expect(panel.getByRole("heading", { name: "From funds To" })).toBeVisible();
  const card = panel.getByTestId("connection-card").first();
  await expect(card).toContainText("2 hops");
  await expect(card).toContainText("Deterministic");
  await expect(panel.getByTestId("connection-summary")).toBeVisible();

  await card.getByRole("button", { name: "Add to graph" }).click();
  await expect(page.locator(`[data-txid="${CHILD.txid}"]`)).toBeVisible();
  await expect(page.locator(`[data-txid="${MID.txid}"]`)).toBeVisible();
  await expect(card.getByRole("button", { name: "Added" })).toBeDisabled();

  // The toolbar button toggles the panel; closing returns focus to it
  await page.getByRole("button", { name: "Find connection", pressed: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find connection", pressed: false })).toBeFocused();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("graph page reframes after an expand so every node stays inside the canvas", async ({ page }) => {
    await page.goto(`/graph/#txid=${ROOT.txid}`);
    await expect(page.getByText(label(ROOT.txid))).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Expand inputs" }).first().click();
    const nodes = page.locator("[data-txid]");
    await expect(nodes).toHaveCount(2);

    const canvas = page.locator("svg:has([data-txid])");
    await expect.poll(async () => {
      const c = await canvas.boundingBox();
      if (!c) return "no canvas";
      const boxes = await Promise.all((await nodes.all()).map((n) => n.boundingBox()));
      const out = boxes.filter((b) => !b || b.x < c.x || b.y < c.y || b.x + b.width > c.x + c.width || b.y + b.height > c.y + c.height);
      return out.length === 0 ? "all inside" : JSON.stringify({ c, out });
    }).toBe("all inside");
  });

  test("find connection opens as a bottom sheet with a reachable start button", async ({ page }) => {
    await page.goto(`/graph/#txid=${ROOT.txid}`);
    await expect(page.getByText(label(ROOT.txid))).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Find connection" }).first().click();
    const panel = page.getByTestId("connection-panel");
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    const vp = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.x).toBeLessThanOrEqual(20);
    expect(box!.x + box!.width).toBeGreaterThanOrEqual(vp.width - 20);
    expect(box!.y + box!.height).toBeGreaterThan(vp.height - 40);

    await panel.getByLabel("To", { exact: true }).fill(CHILD.txid);
    const start = panel.getByRole("button", { name: "Find connection" });
    await start.scrollIntoViewIfNeeded();
    await start.tap();
    await expect(panel.getByTestId("connection-card").first()).toBeVisible();
  });

  test("picking To on a phone collapses the sheet until a node is tapped", async ({ page }) => {
    await page.goto(`/graph/#txid=${ROOT.txid}`);
    await expect(page.getByText(label(ROOT.txid))).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Find connection" }).first().click();
    const panel = page.getByTestId("connection-panel");
    await panel.getByRole("button", { name: "Pick a node in the graph" }).tap();
    await expect(panel.getByLabel("To", { exact: true })).toBeHidden();
    await page.locator(`[data-txid="${ROOT.txid}"]`).tap();
    await expect(panel.getByLabel("To", { exact: true })).toHaveValue(ROOT.txid);
  });
});
