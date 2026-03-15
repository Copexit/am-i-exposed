import { createRequire } from "module";
const require = createRequire(
  "/home/user/.npm/_npx/705bc6b22212b352/node_modules/"
);
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
const WHIRLPOOL_TX = "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2";
const OUT = "screenshots/audit21";

async function main() {
  const browser = await chromium.launch({ headless: true });

  // Mobile - Whirlpool
  console.log("=== MOBILE 375x812 - Whirlpool ===");
  const mCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
    deviceScaleFactor: 2,
  });
  const mPage = await mCtx.newPage();

  await mPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await mPage.waitForTimeout(500);
  await mPage.goto(`${BASE}/#tx=${WHIRLPOOL_TX}`, { waitUntil: "domcontentloaded" });

  // Wait much longer for Whirlpool - it needs chain analysis
  console.log("  Waiting for analysis (up to 90s)...");
  try {
    await mPage.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes("Privacy Score") || text.includes("/100") || /Grade:\s*[A-F]/.test(text);
      },
      { timeout: 90000 }
    );
    console.log("  Analysis complete!");
    await mPage.waitForTimeout(5000);
  } catch {
    console.log("  Analysis timed out at 90s");
    await mPage.waitForTimeout(3000);
  }

  await mPage.screenshot({ path: `${OUT}/25-mobile-whirlpool-loaded.png`, fullPage: true });
  console.log("25 - Mobile Whirlpool loaded full page");

  // Find and scroll to TX Flow header
  const found = await mPage.evaluate(() => {
    // Look for the flex-wrap div with input/output text
    const divs = document.querySelectorAll("div");
    for (const div of divs) {
      const text = div.textContent || "";
      const cls = div.className || "";
      if (typeof cls === "string" && cls.includes("flex-wrap") &&
          (text.includes("inputs") || text.includes("INPUTS")) &&
          (text.includes("outputs") || text.includes("OUTPUTS"))) {
        const rect = div.getBoundingClientRect();
        window.scrollTo(0, rect.top + window.scrollY - 20);
        return {
          found: true,
          text: text.slice(0, 100),
          height: Math.round(rect.height),
          width: Math.round(rect.width),
        };
      }
    }
    // Fallback: look for "Transaction Flow" text
    const spans = document.querySelectorAll("span");
    for (const s of spans) {
      if (s.textContent?.toLowerCase().includes("transaction flow")) {
        const parent = s.closest("div.flex");
        if (parent) {
          window.scrollTo(0, parent.getBoundingClientRect().top + window.scrollY - 20);
          return { found: true, text: parent.textContent?.slice(0, 100), fallback: true };
        }
      }
    }
    return { found: false };
  });
  console.log("  TX Flow search:", JSON.stringify(found));
  await mPage.waitForTimeout(800);
  await mPage.screenshot({ path: `${OUT}/26-mobile-whirlpool-txflow.png`, fullPage: false });
  console.log("26 - Mobile Whirlpool TX Flow");

  // Get header layout details
  const headerLayout = await mPage.evaluate(() => {
    const divs = document.querySelectorAll("div");
    for (const div of divs) {
      const cls = div.className || "";
      if (typeof cls !== "string") continue;
      if (!cls.includes("flex-wrap")) continue;
      const text = div.textContent || "";
      if (!((text.includes("input") || text.includes("INPUT")) && (text.includes("output") || text.includes("OUTPUT")))) continue;

      const rect = div.getBoundingClientRect();
      const children = Array.from(div.children);
      return {
        containerWidth: Math.round(rect.width),
        containerHeight: Math.round(rect.height),
        childCount: children.length,
        children: children.map(c => {
          const r = c.getBoundingClientRect();
          return {
            text: c.textContent?.trim().slice(0, 60),
            left: Math.round(r.left),
            top: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
            classes: (c.className || "").toString().slice(0, 80),
          };
        }),
      };
    }
    return null;
  });
  console.log("\n--- MOBILE WHIRLPOOL HEADER LAYOUT ---");
  console.log(JSON.stringify(headerLayout, null, 2));

  // Check for taint flow
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
    await mPage.screenshot({ path: `${OUT}/27-mobile-whirlpool-taintflow.png`, fullPage: false });
    console.log("27 - Mobile Whirlpool Taint Flow");
  } else {
    console.log("27 - SKIP: No Taint Flow");
  }

  await mCtx.close();

  // Tablet - Whirlpool
  console.log("\n=== TABLET 768x1024 - Whirlpool ===");
  const tCtx = await browser.newContext({
    viewport: { width: 768, height: 1024 },
    colorScheme: "dark",
  });
  const tPage = await tCtx.newPage();

  await tPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await tPage.waitForTimeout(500);
  await tPage.goto(`${BASE}/#tx=${WHIRLPOOL_TX}`, { waitUntil: "domcontentloaded" });

  console.log("  Waiting for analysis (up to 90s)...");
  try {
    await tPage.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes("Privacy Score") || text.includes("/100") || /Grade:\s*[A-F]/.test(text);
      },
      { timeout: 90000 }
    );
    console.log("  Analysis complete!");
    await tPage.waitForTimeout(5000);
  } catch {
    console.log("  Analysis timed out");
    await tPage.waitForTimeout(3000);
  }

  // TX Flow header
  await tPage.evaluate(() => {
    const divs = document.querySelectorAll("div");
    for (const div of divs) {
      const cls = div.className || "";
      if (typeof cls !== "string") continue;
      if (!cls.includes("flex-wrap")) continue;
      const text = div.textContent || "";
      if ((text.includes("input") || text.includes("INPUT")) && (text.includes("output") || text.includes("OUTPUT"))) {
        window.scrollTo(0, div.getBoundingClientRect().top + window.scrollY - 30);
        return;
      }
    }
  });
  await tPage.waitForTimeout(600);
  await tPage.screenshot({ path: `${OUT}/28-tablet-whirlpool-txflow.png`, fullPage: false });
  console.log("28 - Tablet Whirlpool TX Flow");

  const tabHeader = await tPage.evaluate(() => {
    const divs = document.querySelectorAll("div");
    for (const div of divs) {
      const cls = div.className || "";
      if (typeof cls !== "string") continue;
      if (!cls.includes("flex-wrap")) continue;
      const text = div.textContent || "";
      if (!((text.includes("input") || text.includes("INPUT")) && (text.includes("output") || text.includes("OUTPUT")))) continue;
      const rect = div.getBoundingClientRect();
      const children = Array.from(div.children);
      return {
        containerWidth: Math.round(rect.width),
        containerHeight: Math.round(rect.height),
        children: children.map(c => {
          const r = c.getBoundingClientRect();
          return {
            text: c.textContent?.trim().slice(0, 60),
            left: Math.round(r.left),
            top: Math.round(r.top),
            width: Math.round(r.width),
          };
        }),
      };
    }
    return null;
  });
  console.log("  Tablet header:", JSON.stringify(tabHeader, null, 2));

  await tCtx.close();

  // Desktop 1920 - Whirlpool
  console.log("\n=== DESKTOP 1920x1080 - Whirlpool ===");
  const dCtx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  });
  const dPage = await dCtx.newPage();

  await dPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await dPage.waitForTimeout(500);
  await dPage.goto(`${BASE}/#tx=${WHIRLPOOL_TX}`, { waitUntil: "domcontentloaded" });

  console.log("  Waiting for analysis (up to 90s)...");
  try {
    await dPage.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes("Privacy Score") || text.includes("/100") || /Grade:\s*[A-F]/.test(text);
      },
      { timeout: 90000 }
    );
    console.log("  Analysis complete!");
    await dPage.waitForTimeout(5000);
  } catch {
    console.log("  Analysis timed out");
    await dPage.waitForTimeout(3000);
  }

  await dPage.screenshot({ path: `${OUT}/29-desktop-whirlpool-full.png`, fullPage: true });
  console.log("29 - Desktop Whirlpool full page");

  // TX Flow header + taint
  await dPage.evaluate(() => {
    const divs = document.querySelectorAll("div");
    for (const div of divs) {
      const cls = div.className || "";
      if (typeof cls !== "string") continue;
      if (!cls.includes("flex-wrap")) continue;
      const text = div.textContent || "";
      if ((text.includes("input") || text.includes("INPUT")) && (text.includes("output") || text.includes("OUTPUT"))) {
        window.scrollTo(0, div.getBoundingClientRect().top + window.scrollY - 80);
        return;
      }
    }
  });
  await dPage.waitForTimeout(600);
  await dPage.screenshot({ path: `${OUT}/30-desktop-whirlpool-txflow.png`, fullPage: false });
  console.log("30 - Desktop Whirlpool TX Flow");

  // Taint flow
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
    await dPage.screenshot({ path: `${OUT}/31-desktop-whirlpool-taintflow.png`, fullPage: false });
    console.log("31 - Desktop Whirlpool Taint Flow");

    // Check scroll centering
    const taintScroll = await dPage.evaluate(() => {
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
    console.log("  Taint scroll:", JSON.stringify(taintScroll));
  } else {
    console.log("31 - SKIP: No Taint Flow");
  }

  await dCtx.close();
  await browser.close();
  console.log("\n=== WHIRLPOOL CAPTURES COMPLETE ===");
}

main().catch(console.error);
