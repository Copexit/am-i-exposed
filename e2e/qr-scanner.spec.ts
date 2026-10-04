import { test, expect } from "@playwright/test";
import * as path from "path";
import * as os from "os";
import QRCode from "qrcode";
import { UREncoder } from "@ngraveio/bc-ur";
import { CryptoPSBT } from "@keystonehq/bc-ur-registry";
import { mockMempoolApi } from "./helpers/mock-api";
import { buildSignedFixture } from "./helpers/local-tx-fixtures";
import { writeQrVideo } from "./helpers/y4m";

// Fake camera (Chromium only): an animated BC-UR PSBT played as the webcam feed.
const fx = buildSignedFixture();
const video = path.join(os.tmpdir(), "aie-ur-psbt.y4m");
const enc = new UREncoder(new CryptoPSBT(Buffer.from(fx.psbtB64, "base64")).toUR(), 120);
writeQrVideo(video, Array.from({ length: enc.fragmentsLength * 4 }, () => enc.nextPart().toUpperCase()), { size: 480, fps: 5, repeat: 2 });

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`] },
  permissions: ["camera"],
});

const CDN = /jsdelivr|unpkg|cdnjs|fastly/;

test("animated UR PSBT scans into a Before you send result, with no CDN request", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => { if (CDN.test(r.url())) external.push(r.url()); });
  await mockMempoolApi(page);
  await page.goto("/");
  await page.getByTestId("scan-qr").click();
  await expect(page.getByText(/% received/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("before-you-send")).toBeVisible({ timeout: 60_000 });
  expect(new URL(page.url()).hash).toBe("");
  expect(external).toEqual([]);
});

test("photo fallback: a QR photo of an address starts an address scan", async ({ page }) => {
  const address = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
  });
  await mockMempoolApi(page);
  await page.goto("/");
  await page.getByTestId("scan-qr").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Camera access was blocked/)).toBeVisible();
  const buffer = await QRCode.toBuffer(address, { width: 400, margin: 4 });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "qr.png", mimeType: "image/png", buffer });
  await expect(page).toHaveURL(new RegExp(`#addr=${address}`));
});
