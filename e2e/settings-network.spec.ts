import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

test("network selector lists exactly Mainnet, Testnet4 and Signet", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  const select = page.getByLabel("Select Bitcoin network");
  await expect(select.locator("option")).toHaveText(["Mainnet", "Testnet4", "Signet"]);
  await expect(select).toHaveValue("mainnet");
});

test("a retired testnet3 link or saved value falls back to mainnet", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ami-network", "testnet3"));
  await page.goto("/?network=testnet3");
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByLabel("Select Bitcoin network")).toHaveValue("mainnet");
  await expect(page).not.toHaveURL(/network=/);
});

test("custom API URL rejects text that is not an http(s) URL", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (req) => requests.push(req.url()));
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Advanced" }).click();

  const input = page.getByLabel("Custom mempool API URL");
  await input.fill("not a url");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByRole("dialog", { name: "Settings" }).getByRole("alert")).toContainText("Invalid URL");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  expect(requests.some((u) => u.includes("blocks/tip/height") && u.includes("not"))).toBe(false);
});
