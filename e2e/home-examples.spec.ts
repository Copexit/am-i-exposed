import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

// Each home example card declares a grade; scanning it (offline, from the
// recorded fixtures in api-responses/home/) must land on that grade. Guards
// the card hints against engine changes.

test.describe.configure({ mode: "parallel" });

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

for (const index of [0, 1, 2, 3]) {
  test(`home example card ${index + 1} scans to its declared grade`, async ({ page }) => {
    await page.goto("/");
    const cards = page.getByRole("group", { name: "Example scans" }).getByRole("button");
    await expect(cards).toHaveCount(4);
    const card = cards.nth(index);
    const hint = (await card.locator("span > span").nth(1).textContent())?.trim();
    expect(hint).toMatch(/^(A\+|B|C|D|F)$/);

    await card.click();
    await expect(page.getByTestId("score-display")).toHaveAttribute("data-grade", hint ?? "", { timeout: 20_000 });
  });
}
