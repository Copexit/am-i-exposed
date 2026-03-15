import { createRequire } from "module";
const require = createRequire(
  "/home/user/.npm/_npx/705bc6b22212b352/node_modules/"
);
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
const TX_HASH = "fcaa69ffb1faeea59d0f84c4fb4b4ee03b5e1cb2e52e78be0695afe81bca4999";
const ADDR_HASH = "bc1q5nfww5jn5k4ghg7dpa4gy85x7uu3l4g0m0re76";
const OUT = "screenshots/audit20";

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "fullhd", width: 1920, height: 1080 },
  { name: "ultrawide", width: 2560, height: 1080 },
];

async function waitForAnalysis(page) {
  // Wait for the grade letter or score to appear
  try {
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return (
          text.includes("Privacy Score") ||
          text.includes("/100") ||
          /Grade:\s*[A-F]/.test(text)
        );
      },
      { timeout: 25000 }
    );
  } catch {
    console.log("  (waitForFunction timed out, using fallback wait)");
  }
  // Extra settle for animations + chain analysis
  await page.waitForTimeout(5000);
}

async function captureAtViewport(browser, vpName, vp, url, prefix, opts = {}) {
  console.log(`\n--- ${prefix} @ ${vpName} (${vp.width}x${vp.height}) ---`);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    colorScheme: "dark",
  });
  const page = await ctx.newPage();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForAnalysis(page);

  // Full page screenshot
  const fpPath = `${OUT}/${prefix}-${vpName}-full.png`;
  await page.screenshot({ path: fpPath, fullPage: true });
  console.log(`  Saved: ${fpPath}`);

  // Viewport-only screenshot (above the fold)
  const vpPath = `${OUT}/${prefix}-${vpName}-viewport.png`;
  await page.screenshot({ path: vpPath, fullPage: false });
  console.log(`  Saved: ${vpPath}`);

  // Scroll positions if requested
  if (opts.scrollPositions) {
    for (const sp of opts.scrollPositions) {
      await page.evaluate((y) => window.scrollTo(0, y), sp.y);
      await page.waitForTimeout(500);
      const spPath = `${OUT}/${prefix}-${vpName}-scroll-${sp.name}.png`;
      await page.screenshot({ path: spPath, fullPage: false });
      console.log(`  Saved: ${spPath}`);
    }
  }

  await ctx.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const txUrl = `${BASE}/#tx=${TX_HASH}`;
  const addrUrl = `${BASE}/#addr=${ADDR_HASH}`;

  // === TX SCAN AT ALL VIEWPORTS ===
  for (const vp of VIEWPORTS) {
    const scrollOpts =
      vp.name === "fullhd"
        ? {
            scrollPositions: [
              { name: "top", y: 0 },
              { name: "findings", y: 600 },
              { name: "mid-findings", y: 1200 },
              { name: "deep-analysis", y: 2400 },
              { name: "viz", y: 3600 },
              { name: "bottom", y: 99999 },
            ],
          }
        : vp.name === "ultrawide"
        ? {
            scrollPositions: [
              { name: "findings", y: 600 },
              { name: "deep", y: 2000 },
              { name: "bottom", y: 99999 },
            ],
          }
        : {};
    await captureAtViewport(browser, vp.name, vp, txUrl, "tx", scrollOpts);
  }

  // === ADDR SCAN AT MOBILE + FULLHD ===
  for (const vp of VIEWPORTS.filter((v) => v.name === "mobile" || v.name === "fullhd")) {
    const scrollOpts =
      vp.name === "fullhd"
        ? {
            scrollPositions: [
              { name: "top", y: 0 },
              { name: "findings", y: 600 },
              { name: "bottom", y: 99999 },
            ],
          }
        : {};
    await captureAtViewport(browser, vp.name, vp, addrUrl, "addr", scrollOpts);
  }

  // === EXPANDED FINDING CARDS AT DESKTOP 1440 ===
  console.log("\n--- Expanded findings @ desktop ---");
  const dCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const dPage = await dCtx.newPage();
  await dPage.goto(txUrl, { waitUntil: "domcontentloaded" });
  await waitForAnalysis(dPage);

  // Expand finding cards
  const findingButtons = await dPage.$$('button[aria-expanded="false"]');
  let expanded = 0;
  for (const btn of findingButtons) {
    if (expanded >= 4) break;
    try {
      const isVisible = await btn.isVisible();
      if (isVisible) {
        await btn.click();
        expanded++;
        await dPage.waitForTimeout(400);
      }
    } catch {
      // skip
    }
  }
  console.log(`  Expanded ${expanded} cards`);
  await dPage.waitForTimeout(800);
  await dPage.screenshot({ path: `${OUT}/tx-desktop-expanded-full.png`, fullPage: true });
  console.log(`  Saved: tx-desktop-expanded-full.png`);

  // Scroll to show expanded findings
  await dPage.evaluate(() => window.scrollTo(0, 400));
  await dPage.waitForTimeout(300);
  await dPage.screenshot({ path: `${OUT}/tx-desktop-expanded-viewport.png`, fullPage: false });
  console.log(`  Saved: tx-desktop-expanded-viewport.png`);
  await dCtx.close();

  // === EXPANDED FINDINGS AT MOBILE ===
  console.log("\n--- Expanded findings @ mobile ---");
  const mCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
  });
  const mPage = await mCtx.newPage();
  await mPage.goto(txUrl, { waitUntil: "domcontentloaded" });
  await waitForAnalysis(mPage);

  const mButtons = await mPage.$$('button[aria-expanded="false"]');
  let mExp = 0;
  for (const btn of mButtons) {
    if (mExp >= 2) break;
    try {
      const v = await btn.isVisible();
      if (v) {
        await btn.click();
        mExp++;
        await mPage.waitForTimeout(400);
      }
    } catch {
      // skip
    }
  }
  console.log(`  Expanded ${mExp} cards`);
  await mPage.waitForTimeout(800);
  await mPage.screenshot({ path: `${OUT}/tx-mobile-expanded-full.png`, fullPage: true });
  console.log(`  Saved: tx-mobile-expanded-full.png`);
  await mCtx.close();

  // === 2xl BREAKPOINT (1536px) - 2-column finding grid ===
  console.log("\n--- 2xl breakpoint (1536px) ---");
  const xlCtx = await browser.newContext({
    viewport: { width: 1536, height: 900 },
    colorScheme: "dark",
  });
  const xlPage = await xlCtx.newPage();
  await xlPage.goto(txUrl, { waitUntil: "domcontentloaded" });
  await waitForAnalysis(xlPage);

  await xlPage.screenshot({ path: `${OUT}/tx-2xl-full.png`, fullPage: true });
  console.log(`  Saved: tx-2xl-full.png`);

  // Scroll to findings
  await xlPage.evaluate(() => window.scrollTo(0, 500));
  await xlPage.waitForTimeout(500);
  await xlPage.screenshot({ path: `${OUT}/tx-2xl-findings-viewport.png`, fullPage: false });
  console.log(`  Saved: tx-2xl-findings-viewport.png`);

  // Scroll deeper
  await xlPage.evaluate(() => window.scrollTo(0, 1500));
  await xlPage.waitForTimeout(500);
  await xlPage.screenshot({ path: `${OUT}/tx-2xl-deep-viewport.png`, fullPage: false });
  console.log(`  Saved: tx-2xl-deep-viewport.png`);
  await xlCtx.close();

  // === SIDEBAR STICKY BEHAVIOR AT DESKTOP ===
  console.log("\n--- Sidebar sticky test @ desktop ---");
  const sCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const sPage = await sCtx.newPage();
  await sPage.goto(txUrl, { waitUntil: "domcontentloaded" });
  await waitForAnalysis(sPage);

  // Scroll down to test sidebar stickiness
  for (const pos of [0, 500, 1000, 2000, 4000]) {
    await sPage.evaluate((y) => window.scrollTo(0, y), pos);
    await sPage.waitForTimeout(400);
    await sPage.screenshot({
      path: `${OUT}/tx-desktop-sidebar-scroll-${pos}.png`,
      fullPage: false,
    });
    console.log(`  Saved: sidebar scroll ${pos}`);
  }
  await sCtx.close();

  await browser.close();
  console.log("\n=== Audit 20 capture complete! ===");
}

main().catch(console.error);
