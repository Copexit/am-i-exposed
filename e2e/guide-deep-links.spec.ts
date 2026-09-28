import { test, expect, type Page } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

/** The target is on screen, below the sticky header, and its collapsible is open. */
async function expectLanded(page: Page, id: string) {
  const target = page.locator(`[id="${id}"]`);
  await expect(target).toBeInViewport();
  // Wait for the smooth scroll to settle, then check the sticky header does not cover it.
  await expect(async () => {
    const headerBottom = (await page.locator("header").first().boundingBox())?.height ?? 0;
    const top = (await target.boundingBox())?.y ?? -1;
    expect(top).toBeGreaterThanOrEqual(headerBottom);
    expect(top).toBeLessThan(page.viewportSize()?.height ?? 720);
  }).toPass({ timeout: 5_000 });
}

test.describe("/guide/ deep links", () => {
  test.beforeEach(async ({ page }) => {
    await mockMempoolApi(page);
  });

  test("#coinjoin-ln opens combined strategies and scrolls to the card", async ({ page }) => {
    await page.goto("/guide/#coinjoin-ln");
    await expect(page.locator("#combined-strategies ~ button[aria-expanded]")).toHaveAttribute("aria-expanded", "true");
    await expectLanded(page, "coinjoin-ln");
  });

  test("#stonewall expands the pathway card", async ({ page }) => {
    await page.goto("/guide/#stonewall");
    await expect(page.locator("#stonewall > button")).toHaveAttribute("aria-expanded", "true");
    await expectLanded(page, "stonewall");
  });

  test("hash change while on the page expands and scrolls to the new target", async ({ page }) => {
    await page.goto("/guide/#stonewall");
    await expect(page.locator("#stonewall > button")).toHaveAttribute("aria-expanded", "true");
    await page.evaluate(() => { window.location.hash = "coinjoin-ln"; });
    await expectLanded(page, "coinjoin-ln");
    await page.evaluate(() => { window.location.hash = "lightning"; });
    await expect(page.locator("#lightning > button")).toHaveAttribute("aria-expanded", "true");
    await expectLanded(page, "lightning");
  });

  test("guide link from a scan result lands on the expanded section", async ({ page }) => {
    await page.goto("/#tx=0b6461de422c46a221db99608fcbe0326e4f2325ebf2a47c9faf660ed61ee6a4");
    const link = page.getByRole("link", { name: /Learn more in the privacy guide/ }).first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/guide\/#[a-z0-9-]+$/);
    const id = href!.split("#")[1]!;

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/guide/#${id}$`));
    await expect(page.locator(`[id="${id}"] > button`)).toHaveAttribute("aria-expanded", "true");
    await expectLanded(page, id);
  });
});
