import { createRequire } from "module";
const require = createRequire(
  "/home/user/.npm/_npx/705bc6b22212b352/node_modules/"
);
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
// Use Taproot tx - has OP_RETURN, round amounts, script mix = lots of findings
const TX_HASH = "0bf67b1f05326afbd613e11631a2b86466ac7e255499f6286e31b9d7d889cee7";
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

async function waitForResults(page) {
  // Wait for analysis results - look for score or findings sections
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[class*="score"], [class*="grade"], [class*="finding"]');
        return el !== null;
      },
      { timeout: 20000 }
    );
  } catch {
    console.log("  (selector wait timed out, using time-based fallback)");
  }
  // Wait generously for chain analysis + animations to settle
  await page.waitForTimeout(10000);
}

async function captureViewport(browser, vpName, vp, url, prefix, opts = {}) {
  console.log(`\n--- ${prefix} @ ${vpName} (${vp.width}x${vp.height}) ---`);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    colorScheme: "dark",
  });
  const page = await ctx.newPage();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForResults(page);

  // Full page
  await page.screenshot({ path: `${OUT}/${prefix}-${vpName}-full.png`, fullPage: true });
  console.log(`  full page saved`);

  // Above the fold
  await page.screenshot({ path: `${OUT}/${prefix}-${vpName}-viewport.png`, fullPage: false });
  console.log(`  viewport saved`);

  // Scroll positions
  if (opts.scrollPositions) {
    for (const sp of opts.scrollPositions) {
      await page.evaluate((y) => window.scrollTo(0, y), sp.y);
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `${OUT}/${prefix}-${vpName}-scroll-${sp.name}.png`,
        fullPage: false,
      });
      console.log(`  scroll-${sp.name} saved`);
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
    let scrollOpts = {};
    if (vp.name === "fullhd") {
      scrollOpts = {
        scrollPositions: [
          { name: "score", y: 0 },
          { name: "findings", y: 600 },
          { name: "mid", y: 1200 },
          { name: "deep", y: 2000 },
          { name: "viz", y: 3000 },
          { name: "bottom", y: 99999 },
        ],
      };
    } else if (vp.name === "ultrawide") {
      scrollOpts = {
        scrollPositions: [
          { name: "findings", y: 500 },
          { name: "deep", y: 1500 },
          { name: "bottom", y: 99999 },
        ],
      };
    } else if (vp.name === "desktop" || vp.name === "laptop") {
      scrollOpts = {
        scrollPositions: [
          { name: "findings", y: 500 },
          { name: "bottom", y: 99999 },
        ],
      };
    } else if (vp.name === "mobile") {
      scrollOpts = {
        scrollPositions: [
          { name: "score", y: 400 },
          { name: "recs", y: 800 },
          { name: "findings", y: 1500 },
          { name: "bottom", y: 99999 },
        ],
      };
    }
    await captureViewport(browser, vp.name, vp, txUrl, "tx", scrollOpts);
  }

  // === ADDR SCAN AT MOBILE + FULLHD ===
  for (const vp of VIEWPORTS.filter((v) => v.name === "mobile" || v.name === "fullhd")) {
    let scrollOpts = {};
    if (vp.name === "fullhd") {
      scrollOpts = {
        scrollPositions: [
          { name: "score", y: 0 },
          { name: "findings", y: 600 },
          { name: "bottom", y: 99999 },
        ],
      };
    }
    await captureViewport(browser, vp.name, vp, addrUrl, "addr", scrollOpts);
  }

  // === EXPANDED FINDINGS AT DESKTOP ===
  console.log("\n--- Expanded findings @ desktop ---");
  const dCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const dPage = await dCtx.newPage();
  await dPage.goto(txUrl, { waitUntil: "domcontentloaded" });
  await waitForResults(dPage);

  // Scroll to findings and expand
  await dPage.evaluate(() => window.scrollTo(0, 400));
  await dPage.waitForTimeout(500);

  const findingBtns = await dPage.$$('button[aria-expanded="false"]');
  let expanded = 0;
  for (const btn of findingBtns) {
    if (expanded >= 4) break;
    try {
      if (await btn.isVisible()) {
        await btn.click();
        expanded++;
        await dPage.waitForTimeout(400);
      }
    } catch { /* skip */ }
  }
  console.log(`  Expanded ${expanded} cards`);
  await dPage.waitForTimeout(600);
  await dPage.screenshot({ path: `${OUT}/tx-desktop-expanded-full.png`, fullPage: true });
  await dPage.screenshot({ path: `${OUT}/tx-desktop-expanded-viewport.png`, fullPage: false });
  console.log(`  expanded screenshots saved`);
  await dCtx.close();

  // === EXPANDED FINDINGS AT MOBILE ===
  console.log("\n--- Expanded findings @ mobile ---");
  const mCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
  });
  const mPage = await mCtx.newPage();
  await mPage.goto(txUrl, { waitUntil: "domcontentloaded" });
  await waitForResults(mPage);

  // Scroll to findings area on mobile
  await mPage.evaluate(() => window.scrollTo(0, 1200));
  await mPage.waitForTimeout(500);

  const mBtns = await mPage.$$('button[aria-expanded="false"]');
  let mExp = 0;
  for (const btn of mBtns) {
    if (mExp >= 2) break;
    try {
      if (await btn.isVisible()) {
        await btn.click();
        mExp++;
        await mPage.waitForTimeout(400);
      }
    } catch { /* skip */ }
  }
  console.log(`  Expanded ${mExp} cards`);
  await mPage.waitForTimeout(600);
  await mPage.screenshot({ path: `${OUT}/tx-mobile-expanded-full.png`, fullPage: true });
  await mPage.screenshot({ path: `${OUT}/tx-mobile-expanded-viewport.png`, fullPage: false });
  console.log(`  expanded mobile saved`);
  await mCtx.close();

  // === 2xl BREAKPOINT (1536px) ===
  console.log("\n--- 2xl breakpoint ---");
  const xlCtx = await browser.newContext({
    viewport: { width: 1536, height: 900 },
    colorScheme: "dark",
  });
  const xlPage = await xlCtx.newPage();
  await xlPage.goto(txUrl, { waitUntil: "domcontentloaded" });
  await waitForResults(xlPage);

  await xlPage.screenshot({ path: `${OUT}/tx-2xl-full.png`, fullPage: true });
  await xlPage.evaluate(() => window.scrollTo(0, 500));
  await xlPage.waitForTimeout(500);
  await xlPage.screenshot({ path: `${OUT}/tx-2xl-findings-viewport.png`, fullPage: false });
  await xlPage.evaluate(() => window.scrollTo(0, 1500));
  await xlPage.waitForTimeout(500);
  await xlPage.screenshot({ path: `${OUT}/tx-2xl-deep-viewport.png`, fullPage: false });
  console.log(`  2xl screenshots saved`);
  await xlCtx.close();

  // === SIDEBAR STICKY TEST ===
  console.log("\n--- Sidebar sticky test ---");
  const sCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const sPage = await sCtx.newPage();
  await sPage.goto(txUrl, { waitUntil: "domcontentloaded" });
  await waitForResults(sPage);

  for (const y of [0, 500, 1000, 2000, 4000]) {
    await sPage.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
    await sPage.waitForTimeout(400);
    await sPage.screenshot({
      path: `${OUT}/tx-sidebar-sticky-${y}.png`,
      fullPage: false,
    });
    console.log(`  sidebar @ scroll ${y}`);
  }
  await sCtx.close();

  await browser.close();
  console.log("\n=== Audit 20 capture complete! ===");
}

main().catch(console.error);
