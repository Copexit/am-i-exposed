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

/** Played source: the <video> src, or the error link's href when the codec is unsupported. */
async function playedSrc(page: Page): Promise<string | null> {
  const v = page.locator("video");
  if (await v.count()) return v.getAttribute("src");
  return page.locator('a[href^="/media/"][target="_blank"]').getAttribute("href");
}

test.beforeEach(async ({ page }) => {
  await mockMempoolApi(page);
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
});

test("ami-language=es plays the es promo", async ({ page }) => {
  const m = trackMedia(page);
  await setLang(page, "es");
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await page.getByRole("button", { name: "Reproducir el resumen de 1 minuto" }).click();
  await expect.poll(() => m.mp4()).toContain("/media/promo-es-9x16.mp4");
  await page.setViewportSize(DESKTOP);
});

test("rotating after playback started keeps the same source", async ({ page }) => {
  const m = trackMedia(page);
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await page.getByRole("button", PLAY_PROMO).click();
  await expect.poll(() => m.mp4()).toEqual(["/media/promo-en-9x16.mp4"]);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
  expect(await playedSrc(page)).toBe("/media/promo-en-9x16.mp4");
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
  // tracks live inside the <video>; if the codec failed the element is gone, so assert only when present
  if (await page.locator("video").count()) {
    await expect(page.locator('video track[srclang="de"]')).toHaveAttribute("default", "");
    await expect(page.locator("video track[default]")).toHaveCount(1);
  }
});

test("chapter click mounts the video and seeks to the chapter start", async ({ page }) => {
  const m = trackMedia(page);
  await page.setViewportSize(DESKTOP);
  await page.goto("/tutorial/");
  await page.getByRole("button", { name: /^Jump to \d+:\d\d, Scanning a transaction$/ }).click();
  await expect.poll(() => m.mp4()).toContain("/media/tutorial-en-16x9.mp4");
  // if the browser can decode it, currentTime lands near the chapter start (en: scan-tx)
  const label = await page.getByRole("button", { name: /^Jump to \d+:\d\d, Scanning a transaction$/ }).getAttribute("aria-label");
  const [mm = 0, ss = 0] = label!.match(/(\d+):(\d\d)/)!.slice(1).map(Number);
  const start = mm * 60 + ss;
  if (await page.locator("video").count()) {
    await expect
      .poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 })
      .toBeGreaterThan(start - 2);
  }
});

test("tutorial examples are links", async ({ page }) => {
  await page.goto("/tutorial/");
  await expect(page.locator('a[href^="/#tx="], a[href^="/#addr="]').first()).toBeVisible();
});
