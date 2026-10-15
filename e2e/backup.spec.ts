import { test, expect, type Page } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

const TXID = "c".repeat(64);
const BOOKMARK = { input: TXID, type: "txid", grade: "A", score: 90, savedAt: 1, label: "rent" };
const GRAPH = { id: "g-e2e", name: "My graph", savedAt: 1, network: "mainnet", rootTxid: TXID, rootTxids: [TXID], nodes: [{ txid: TXID, depth: 0 }] };
const PASSWORD = "correct horse battery";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Settings" });
  await expect(panel.getByText("Workspace", { exact: true })).toBeVisible();
  return panel;
}

test("exports a password-protected backup and restores it after a wrong password", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(([b, g]) => {
    localStorage.setItem("bookmarks", JSON.stringify([b]));
    localStorage.setItem("ami-saved-graphs", JSON.stringify([g]));
  }, [BOOKMARK, GRAPH] as const);
  await page.reload();

  let panel = await openSettings(page);
  await expect(panel.getByText("1 bookmark and 1 graph saved")).toBeVisible();
  await panel.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = panel.getByTestId("backup-export-dialog");
  await expect(dialog.getByTestId("backup-protect")).toBeChecked();
  await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await dialog.getByLabel("Repeat the password").fill(PASSWORD);
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByTestId("backup-export-submit").click()]);
  expect(download.suggestedFilename()).toMatch(/^am-i-exposed-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();
  const sealed = JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8")) as Record<string, unknown>;
  expect(sealed.format).toBe("am-i-exposed-sealed");
  expect(JSON.stringify(sealed)).not.toContain(TXID);

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  panel = await openSettings(page);
  await expect(panel.getByText("0 bookmarks and 0 graphs saved")).toBeVisible();

  await panel.locator('input[type="file"]').setInputFiles(file);
  const imp = panel.getByTestId("backup-import-dialog");
  await imp.getByTestId("backup-import-password").fill("not the password");
  await imp.getByTestId("backup-import-submit").click();
  await expect(imp.getByText("Wrong password. Try again.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("bookmarks"))).toBeNull();

  await imp.getByTestId("backup-import-password").fill(PASSWORD);
  await imp.getByTestId("backup-import-submit").click();
  await expect(imp.getByTestId("backup-summary")).toContainText("1 bookmark");
  await imp.getByTestId("backup-import-submit").click();

  await expect(panel.getByText("1 bookmark and 1 graph saved")).toBeVisible();
  await expect(panel.getByText("Restored 1 bookmark and 1 graph.")).toBeVisible();
  const restored = await page.evaluate(() => [localStorage.getItem("bookmarks"), localStorage.getItem("ami-saved-graphs")]);
  expect(restored[0]).toContain(TXID);
  expect(restored[1]).toContain("g-e2e");
});
