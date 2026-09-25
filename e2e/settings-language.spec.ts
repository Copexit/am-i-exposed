import { test, expect } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

test("switching language to es translates the UI and persists across reloads", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Select language").selectOption("es");

  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByText("Idioma", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Seleccionar idioma")).toHaveValue("es");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("button", { name: "Configuración de API", exact: true })).toBeVisible();
});
