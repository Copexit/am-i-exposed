import { test, expect, type Page } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

/** Records the theme on <html> when <body> first appears, i.e. before first paint. */
async function recordFirstPaintTheme(page: Page) {
  await page.addInitScript(() => {
    new MutationObserver((_, o) => {
      if (!document.body) return;
      (window as unknown as { __firstTheme: string }).__firstTheme = document.documentElement.dataset.theme ?? "dark";
      o.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
}
const firstTheme = (page: Page) => page.evaluate(() => (window as unknown as { __firstTheme?: string }).__firstTheme);

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
  await recordFirstPaintTheme(page);
});

test("theme chosen in v2 settings persists across reloads with no flash", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/v2/");
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const light = page.getByRole("radio", { name: "Light" });
  await light.click();
  await expect(light).toHaveAttribute("aria-checked", "true");
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(236, 238, 242)");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await firstTheme(page)).toBe("light");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.reload();
  await expect(page.getByTestId("v2-home")).toBeVisible();
  expect(await firstTheme(page)).toBe("dark");
  await expect(html).not.toHaveAttribute("data-theme", "light");
});

test("with no stored preference the theme follows the OS, live", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/v2/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await firstTheme(page)).toBe("light");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).not.toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
});
