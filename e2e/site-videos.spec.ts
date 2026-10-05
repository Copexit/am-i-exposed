import { test, expect, type Page } from "@playwright/test";
import { mockMempoolApi } from "./helpers/mock-api";

// Flag-on suite: `pnpm test:e2e:videos` (serves out-videos/, built with NEXT_PUBLIC_VIDEOS=1).
// Real media files, no mocks for /media. Playwright's Chromium may lack H.264: then the <video>
// fires an error and is replaced by the error link, so assertions are request/src based.
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

function trackMedia(page: Page) {
  const hits: string[] = [];
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith("/media/")) hits.push(p);
  });
  return { all: hits, mp4: () => hits.filter((p) => p.endsWith(".mp4")) };
}

const setLang = (page: Page, lang: string) =>
  page.addInitScript((l) => localStorage.setItem("ami-language", l), lang);

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
});

// This suite requires H.264 playback: fail loudly rather than pass vacuously.
test.beforeEach(async ({ page }) => {
  await page.goto("/about/");
  const h264 = await page.evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="avc1.64001f"'));
  expect(h264, "this browser cannot play H.264; the site-videos suite needs it").not.toBe("");
});

const DE_PLAY = "Tutorial abspielen";
const PLAY_PROMO = { name: "Play the 1-minute overview" };

test("phone: no mp4 before click, click plays the 9x16 promo", async ({ page }) => {
  const m = trackMedia(page);
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const play = page.getByRole("button", PLAY_PROMO);
  await play.scrollIntoViewIfNeeded();
  await expect(play).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(m.mp4()).toEqual([]);
  await expect(page.locator("video")).toHaveCount(0);
  expect(m.all.every((p) => p.endsWith(".webp"))).toBe(true);
  await play.click();
  await expect.poll(() => m.mp4()).toContain("/media/promo-en-9x16.mp4");
});

test("desktop: click plays the 16x9 promo", async ({ page }) => {
  const m = trackMedia(page);
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.getByRole("button", PLAY_PROMO).click();
  await expect.poll(() => m.mp4()).toContain("/media/promo-en-16x9.mp4");
  await expect(page.locator("video")).toBeFocused();
});

test("header: Tutorial sits in the desktop bar only from lg", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Tutorial" });
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto("/");
  await expect(nav).toBeHidden();
  await page.setViewportSize(DESKTOP);
  await expect(nav).toBeVisible();
});

test("ami-language=es plays the es promo", async ({ page }) => {
  const m = trackMedia(page);
  await setLang(page, "es");
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await page.getByRole("button", { name: "Reproducir el resumen de 1 minuto" }).click();
  await expect.poll(() => m.mp4()).toContain("/media/promo-es-9x16.mp4");
});

test("rotating after playback started keeps the same source", async ({ page }) => {
  const m = trackMedia(page);
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await page.getByRole("button", PLAY_PROMO).click();
  await expect.poll(() => m.mp4()).toEqual(["/media/promo-en-9x16.mp4"]);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
  await expect(page.locator("video")).toHaveCount(1);
  await expect(page.locator("video")).toHaveAttribute("src", "/media/promo-en-9x16.mp4");
  expect(new Set(m.mp4())).toEqual(new Set(["/media/promo-en-9x16.mp4"]));
});

test("/tutorial with ami-language=de: en video, de subtitles default", async ({ page }) => {
  const m = trackMedia(page);
  await setLang(page, "de");
  await page.setViewportSize(DESKTOP);
  await page.goto("/tutorial/");
  await page.waitForLoadState("networkidle");
  expect(m.mp4()).toEqual([]);
  await page.getByRole("button", { name: DE_PLAY }).click();
  await expect.poll(() => m.mp4()).toContain("/media/tutorial-en-16x9.mp4");
  await expect(page.locator("video")).toHaveCount(1);
  await expect(page.locator('video track[srclang="de"]')).toHaveAttribute("default", "");
  await expect(page.locator("video track[default]")).toHaveCount(1);
});

test("chapter click mounts the video and seeks to the chapter start", async ({ page }) => {
  const m = trackMedia(page);
  await page.setViewportSize(DESKTOP);
  await page.goto("/tutorial/");
  await page.getByRole("button", { name: /^Jump to \d+:\d\d, Scanning a transaction$/ }).click();
  await expect.poll(() => m.mp4()).toContain("/media/tutorial-en-16x9.mp4");
  const label = await page.getByRole("button", { name: /^Jump to \d+:\d\d, Scanning a transaction$/ }).getAttribute("aria-label");
  const [mm = 0, ss = 0] = label!.match(/(\d+):(\d\d)/)!.slice(1).map(Number);
  const start = mm * 60 + ss;
  await expect(page.locator("video")).toHaveCount(1);
  await expect
    .poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(start - 1);
  await expect
    .poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeLessThanOrEqual(start + 5);
});

test("tutorial examples are links", async ({ page }) => {
  await page.goto("/tutorial/");
  await expect(page.locator('a[href^="/#tx="], a[href^="/#addr="]').first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).locator('[aria-current="page"]')).toHaveText("Tutorial");
});
