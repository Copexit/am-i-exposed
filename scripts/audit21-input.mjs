import { createRequire } from "module";
const require = createRequire(
  "/home/user/.npm/_npx/705bc6b22212b352/node_modules/"
);
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
const STONEWALL_TX = "19a79be39c05a0956c7d1f9f28ee6f1091096247b0906b6a8536dd7f400f2358";
const OUT = "screenshots/audit21";

async function main() {
  const browser = await chromium.launch({ headless: true });

  // Test 1: Use input field to trigger analysis on mobile
  console.log("=== TEST: Type TX into search field ===");
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  // Type TXID into input and submit
  const input = await page.$('input[type="text"], input[placeholder*="address"], input[placeholder*="Bitcoin"]');
  if (input) {
    await input.fill(STONEWALL_TX);
    console.log("  Filled input with Stonewall TXID");
    await page.waitForTimeout(300);

    // Click scan button
    const scanBtn = await page.$('button:has-text("Scan")');
    if (scanBtn) {
      await scanBtn.click();
      console.log("  Clicked Scan");
    }
  } else {
    console.log("  No input found, trying direct navigation");
    // Try evaluating hash change directly
    await page.evaluate((tx) => {
      window.location.hash = `tx=${tx}`;
    }, STONEWALL_TX);
    console.log("  Set hash via JS");
  }

  // Wait for analysis
  console.log("  Waiting for results...");
  try {
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes("Privacy Score") || text.includes("/100") || /Grade:\s*[A-F]/.test(text) || text.includes("Analysis failed");
      },
      { timeout: 60000 }
    );
    console.log("  Got result!");
    await page.waitForTimeout(5000);
  } catch {
    console.log("  Timed out waiting for result");
    const pageText = await page.evaluate(() => document.body.innerText.slice(0, 300));
    console.log("  Page text:", pageText);
  }

  await page.screenshot({ path: `${OUT}/40-input-stonewall-full.png`, fullPage: true });
  console.log("40 - Stonewall via input full page");

  // Check if results loaded
  const hasResults = await page.evaluate(() => !!document.getElementById("results-panel"));
  console.log("  Has results panel:", hasResults);

  if (hasResults) {
    // TX Flow header
    const headerInfo = await page.evaluate(() => {
      const divs = document.querySelectorAll("div");
      for (const div of divs) {
        const cls = typeof div.className === "string" ? div.className : "";
        if (!cls.includes("flex") || !cls.includes("wrap")) continue;
        const text = div.textContent || "";
        if ((text.toLowerCase().includes("input")) && (text.toLowerCase().includes("output"))) {
          window.scrollTo(0, div.getBoundingClientRect().top + window.scrollY - 20);
          const rect = div.getBoundingClientRect();
          const children = Array.from(div.children);
          return {
            found: true,
            containerWidth: Math.round(rect.width),
            containerHeight: Math.round(rect.height),
            children: children.map(c => {
              const r = c.getBoundingClientRect();
              return {
                text: c.textContent?.trim().slice(0, 60),
                left: Math.round(r.left),
                top: Math.round(r.top),
                width: Math.round(r.width),
                height: Math.round(r.height),
              };
            }),
          };
        }
      }
      return { found: false };
    });
    console.log("\n--- STONEWALL HEADER LAYOUT ---");
    console.log(JSON.stringify(headerInfo, null, 2));

    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/41-input-stonewall-txflow.png`, fullPage: false });
    console.log("41 - Stonewall TX Flow header");

    // Taint flow
    const taintFound = await page.evaluate(() => {
      const els = document.querySelectorAll("h3, span, div");
      for (const el of els) {
        if (el.textContent?.toLowerCase().includes("taint flow") && el.textContent.length < 40) {
          window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 30);
          return true;
        }
      }
      return false;
    });
    if (taintFound) {
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/42-input-stonewall-taintflow.png`, fullPage: false });
      console.log("42 - Stonewall Taint Flow");

      const taintScroll = await page.evaluate(() => {
        const containers = document.querySelectorAll("[class*='overflow-x']");
        for (const el of containers) {
          if (el.querySelector("svg")) {
            return {
              scrollLeft: Math.round(el.scrollLeft),
              scrollWidth: Math.round(el.scrollWidth),
              clientWidth: Math.round(el.clientWidth),
              needsScroll: el.scrollWidth > el.clientWidth + 10,
              centered: el.scrollLeft > 20,
            };
          }
        }
        return null;
      });
      console.log("  Taint scroll:", JSON.stringify(taintScroll));
    }
  }

  await ctx.close();

  // Test 2: Direct JS hash on a fresh page
  console.log("\n=== TEST 2: Direct JS hash change ===");
  const ctx2 = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
    deviceScaleFactor: 2,
  });
  const page2 = await ctx2.newPage();
  await page2.goto(BASE, { waitUntil: "domcontentloaded" });
  await page2.waitForTimeout(2000);

  // Set hash via JS
  await page2.evaluate((tx) => {
    window.location.hash = `tx=${tx}`;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, STONEWALL_TX);
  console.log("  Set hash and dispatched hashchange event");

  try {
    await page2.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes("Diagnosing") || text.includes("Privacy Score") || text.includes("/100");
      },
      { timeout: 10000 }
    );
    console.log("  Analysis started/completed");
  } catch {
    console.log("  No analysis triggered");
  }

  await page2.screenshot({ path: `${OUT}/43-jshash-test.png`, fullPage: false });
  console.log("43 - JS hash change test");

  await ctx2.close();
  await browser.close();
  console.log("\n=== INPUT TESTS COMPLETE ===");
}

main().catch(console.error);
