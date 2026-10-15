import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loadTxFixture, mockExtraTxs, mockMempoolApi, type MockTx } from "./helpers/mock-api";

const ROOT = loadTxFixture("simple-legacy-p2pkh");
const PARENT_TXID = ROOT.vin[0]!.txid;
const PARENT_VOUT = ROOT.vin[0]!.vout;

function buildParent(): MockTx {
  const parent = loadTxFixture("simple-legacy-p2pkh");
  parent.txid = PARENT_TXID;
  parent.vin[0]!.txid = "aa".repeat(32);
  parent.vout[PARENT_VOUT] = ROOT.vin[0]!.prevout!;
  return parent;
}

const label = (txid: string) => `${txid.slice(0, 8)}...${txid.slice(-8)}`;
const file = (lines: object[]) => ({ name: "labels.jsonl", mimeType: "application/jsonl", buffer: Buffer.from(lines.map((l) => JSON.stringify(l)).join("\n")) });

test("graph labels: BIP329 import with a preview, export round trip", async ({ page }) => {
  await mockMempoolApi(page);
  await mockExtraTxs(page, [buildParent()]);
  await page.goto(`/graph/#txid=${ROOT.txid}`);
  await expect(page.getByText(label(ROOT.txid))).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Expand inputs" }).first().click();
  await expect(page.getByText(label(PARENT_TXID))).toBeVisible();

  await page.getByTitle("Save graph (S)").click();
  const io = page.getByTestId("graph-labels-io");
  await expect(io).toContainText("plain text");
  const input = io.locator("input[type=file]");
  const status = page.getByTestId("graph-labels-status");

  // Fully matching import with no clash applies directly
  await input.setInputFiles(file([
    { type: "tx", ref: ROOT.txid, label: "exchange deposit" },
    { type: "output", ref: `${PARENT_TXID}:${PARENT_VOUT}`, label: "payment" },
  ]));
  await expect(status).toHaveText("2 labels imported");
  await expect(page.getByTestId("labels-preview")).toHaveCount(0);

  const exported = async () => {
    const [d] = await Promise.all([page.waitForEvent("download"), io.getByRole("button", { name: "Export labels (BIP329)" }).click()]);
    expect(d.suggestedFilename()).toBe(`graph-labels-${ROOT.txid.slice(0, 8)}.jsonl`);
    return readFileSync((await d.path())!, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  };
  let rows = await exported();
  expect(rows).toContainEqual({ type: "tx", ref: ROOT.txid, label: "exchange deposit" });
  expect(rows).toContainEqual({ type: "output", ref: `${PARENT_TXID}:${PARENT_VOUT}`, label: "payment" });

  // A clash plus a record for a tx that is not in the graph: previewed, existing kept by default
  const foreign = "ee".repeat(32);
  await input.setInputFiles(file([
    { type: "tx", ref: ROOT.txid, label: "mixer exit" },
    { type: "tx", ref: foreign, label: "elsewhere" },
  ]));
  const preview = page.getByTestId("labels-preview");
  await expect(preview).toContainText("1 conflict");
  await expect(preview).toContainText("1 not in this graph");
  await preview.getByRole("button", { name: "Apply import" }).click();
  rows = await exported();
  expect(rows).toContainEqual({ type: "tx", ref: ROOT.txid, label: "exchange deposit" });
  expect(JSON.stringify(rows)).not.toContain("elsewhere");

  // Choosing the incoming label replaces it
  await input.setInputFiles(file([{ type: "tx", ref: ROOT.txid, label: "mixer exit" }]));
  await page.getByTestId("labels-preview").getByLabel("Use all incoming").check();
  await page.getByRole("button", { name: "Apply import" }).click();
  rows = await exported();
  expect(rows).toContainEqual({ type: "tx", ref: ROOT.txid, label: "mixer exit" });
});

test("labels imported into an open saved graph survive Update and reopening", async ({ page }) => {
  await mockMempoolApi(page);
  await mockExtraTxs(page, [buildParent()]);
  await page.goto(`/graph/#txid=${ROOT.txid}`);
  await expect(page.getByText(label(ROOT.txid))).toBeVisible({ timeout: 15_000 });
  await page.getByTitle("Save graph (S)").click();
  const nameInput = page.getByPlaceholder("Graph name...");
  await nameInput.fill("Labelled");
  await nameInput.locator("..").getByRole("button", { name: "Save", exact: true }).click();

  // With no hash, the page reopens the saved graph, so Update is offered
  await page.goto("/graph/");
  await expect(page.getByText(label(ROOT.txid))).toBeVisible({ timeout: 15_000 });
  await page.getByTitle("Save graph (S)").click();
  const io = page.getByTestId("graph-labels-io");
  await io.locator("input[type=file]").setInputFiles(file([{ type: "tx", ref: ROOT.txid, label: "exchange deposit" }]));
  await expect(page.getByTestId("graph-labels-status")).toHaveText("1 label imported");
  await page.getByRole("button", { name: "Update", exact: true }).click();

  await page.goto("/graph/");
  await expect(page.getByText(label(ROOT.txid))).toBeVisible({ timeout: 15_000 });
  await page.getByTitle("Save graph (S)").click();
  const [d] = await Promise.all([page.waitForEvent("download"), io.getByRole("button", { name: "Export labels (BIP329)" }).click()]);
  expect(readFileSync((await d.path())!, "utf8")).toContain("exchange deposit");
});
