import { createRequire } from "module";
const require = createRequire(
  "/home/user/.npm/_npx/705bc6b22212b352/node_modules/"
);
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
// Stonewall: 3 inputs, 4 outputs
const STONEWALL_TX = "19a79be39c05a0956c7d1f9f28ee6f1091096247b0906b6a8536dd7f400f2358";
const OUT = "screenshots/audit21";

async function main() {
  const browser = await chromium.launch({ headless: true });

  // Mobile - Stonewall
  console.log("=== MOBILE 375x812 - Stonewall ===");
  const mCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
    deviceScaleFactor: 2,
  });
  const mPage = await mCtx.newPage();

  await mPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await mPage.waitForTimeout(500);
  await mPage.goto(`${BASE}/#tx=${STONEWALL_TX}`, { waitUntil: "domcontentloaded" });

  console.log("  Waiting for analysis (up to 120s)...");
  try {
    await mPage.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes("Privacy Score") || text.includes("/100") || /Grade:\s*[A-F]/.test(text);
      },
      { timeout: 120000 }
    );
    console.log("  Analysis complete!");
    await mPage.waitForTimeout(5000);
  } catch {
    console.log("  Analysis timed out at 120s");
    // Check where it is
    const status = await mPage.evaluate(() => {
      return document.body.innerText.slice(0, 500);
    });
    console.log("  Page text:", status.slice(0, 200));
    await mPage.waitForTimeout(3000);
  }

  // Full page
  await mPage.screenshot({ path: `${OUT}/32-mobile-stonewall-full.png`, fullPage: true });
  console.log("32 - Mobile Stonewall full page");

  // TX Flow header
  const found = await mPage.evaluate(() => {
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
  console.log("\n--- MOBILE STONEWALL HEADER ---");
  console.log(JSON.stringify(found, null, 2));

  await mPage.waitForTimeout(600);
  await mPage.screenshot({ path: `${OUT}/33-mobile-stonewall-txflow.png`, fullPage: false });
  console.log("33 - Mobile Stonewall TX Flow header");

  // Taint flow
  const hasTaint = await mPage.evaluate(() => {
    const els = document.querySelectorAll("h3, span, div");
    for (const el of els) {
      if (el.textContent?.toLowerCase().includes("taint flow") && el.textContent.length < 40) {
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 30);
        return true;
      }
    }
    return false;
  });
  if (hasTaint) {
    await mPage.waitForTimeout(1200);
    await mPage.screenshot({ path: `${OUT}/34-mobile-stonewall-taintflow.png`, fullPage: false });
    console.log("34 - Mobile Stonewall Taint Flow");

    const taintInfo = await mPage.evaluate(() => {
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
    console.log("  Taint scroll:", JSON.stringify(taintInfo));
  } else {
    console.log("34 - SKIP: No Taint Flow");
  }

  await mCtx.close();

  // Desktop 1920 - Stonewall
  console.log("\n=== DESKTOP 1920x1080 - Stonewall ===");
  const dCtx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  });
  const dPage = await dCtx.newPage();

  await dPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await dPage.waitForTimeout(500);
  await dPage.goto(`${BASE}/#tx=${STONEWALL_TX}`, { waitUntil: "domcontentloaded" });

  console.log("  Waiting for analysis (up to 120s)...");
  try {
    await dPage.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes("Privacy Score") || text.includes("/100") || /Grade:\s*[A-F]/.test(text);
      },
      { timeout: 120000 }
    );
    console.log("  Analysis complete!");
    await dPage.waitForTimeout(5000);
  } catch {
    console.log("  Analysis timed out");
    await dPage.waitForTimeout(3000);
  }

  await dPage.screenshot({ path: `${OUT}/35-desktop-stonewall-full.png`, fullPage: true });
  console.log("35 - Desktop Stonewall full page");

  // TX Flow header
  await dPage.evaluate(() => {
    const divs = document.querySelectorAll("div");
    for (const div of divs) {
      const cls = typeof div.className === "string" ? div.className : "";
      if (!cls.includes("flex") || !cls.includes("wrap")) continue;
      const text = div.textContent || "";
      if ((text.toLowerCase().includes("input")) && (text.toLowerCase().includes("output"))) {
        window.scrollTo(0, div.getBoundingClientRect().top + window.scrollY - 80);
        return;
      }
    }
  });
  await dPage.waitForTimeout(600);
  await dPage.screenshot({ path: `${OUT}/36-desktop-stonewall-txflow.png`, fullPage: false });
  console.log("36 - Desktop Stonewall TX Flow");

  // Taint flow on desktop
  const hasTaintD = await dPage.evaluate(() => {
    const els = document.querySelectorAll("h3, span, div");
    for (const el of els) {
      if (el.textContent?.toLowerCase().includes("taint flow") && el.textContent.length < 40) {
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 60);
        return true;
      }
    }
    return false;
  });
  if (hasTaintD) {
    await dPage.waitForTimeout(1200);
    await dPage.screenshot({ path: `${OUT}/37-desktop-stonewall-taintflow.png`, fullPage: false });
    console.log("37 - Desktop Stonewall Taint Flow");
    const taintD = await dPage.evaluate(() => {
      const containers = document.querySelectorAll("[class*='overflow-x']");
      for (const el of containers) {
        if (el.querySelector("svg")) {
          return {
            scrollLeft: Math.round(el.scrollLeft),
            scrollWidth: Math.round(el.scrollWidth),
            clientWidth: Math.round(el.clientWidth),
            needsScroll: el.scrollWidth > el.clientWidth + 10,
          };
        }
      }
      return null;
    });
    console.log("  Taint scroll:", JSON.stringify(taintD));
  } else {
    console.log("37 - SKIP: No Taint Flow");
  }

  await dCtx.close();
  await browser.close();
  console.log("\n=== STONEWALL CAPTURES COMPLETE ===");
}

main().catch(console.error);
