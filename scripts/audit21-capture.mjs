import { createRequire } from "module";
const require = createRequire(
  "/home/user/.npm/_npx/705bc6b22212b352/node_modules/"
);
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
// Whirlpool CoinJoin: 5 inputs, 5 outputs - good for TxFlow header wrap test
const WHIRLPOOL_TX = "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2";
// Taproot with OP_RETURN: 1 input, 2 outputs - grade C, has findings
const TAPROOT_TX = "0bf67b1f05326afbd613e11631a2b86466ac7e255499f6286e31b9d7d889cee7";
// Stonewall: 3 inputs, 4 outputs - moderate complexity
const STONEWALL_TX = "19a79be39c05a0956c7d1f9f28ee6f1091096247b0906b6a8536dd7f400f2358";

const OUT = "screenshots/audit21";

async function loadHashRoute(page, txid, timeout = 30000) {
  const url = `${BASE}/#tx=${txid}`;
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return (
          text.includes("Privacy Score") ||
          text.includes("/100") ||
          /Grade:\s*[A-F]/.test(text) ||
          text.includes("Analysis failed")
        );
      },
      { timeout }
    );
    await page.waitForTimeout(4000);
    console.log("  Analysis complete");
  } catch {
    console.log("  WARNING: analysis didn't complete in " + timeout + "ms");
    await page.waitForTimeout(3000);
  }
}

async function analyzeLayout(page) {
  return await page.evaluate(() => {
    const panel = document.getElementById("results-panel");
    if (!panel) return "NO RESULTS PANEL";
    const wrapper = panel.querySelector("[class*='xl:flex-row']");
    if (!wrapper) return "NO TWO-COL WRAPPER";
    const children = Array.from(wrapper.children);
    let result = "";
    children.forEach((c, i) => {
      const rect = c.getBoundingClientRect();
      const style = window.getComputedStyle(c);
      result += `Child ${i}: left=${Math.round(rect.left)} right=${Math.round(rect.right)} width=${Math.round(rect.width)} order=${style.order}\n`;
    });
    if (children.length >= 2) {
      const c0 = children[0].getBoundingClientRect();
      const c1 = children[1].getBoundingClientRect();
      result += `\nTwo-column: ${c1.left > c0.right - 20 ? "YES" : "NO"}`;
      result += `\nSidebar right of main: ${c1.left > c0.left ? "YES" : "NO"}`;
      result += `\nMain: ${Math.round(c0.width)}px, Sidebar: ${Math.round(c1.width)}px`;
      result += `\nContainer max-width: ${window.getComputedStyle(panel).maxWidth}`;
      result += `\nContainer actual-width: ${Math.round(panel.getBoundingClientRect().width)}px`;
    }
    return result;
  });
}

async function analyzeTxFlowHeader(page) {
  return await page.evaluate(() => {
    const divs = document.querySelectorAll("div.flex.flex-wrap");
    for (const div of divs) {
      const text = div.textContent || "";
      if ((text.includes("input") || text.includes("INPUT")) && (text.includes("output") || text.includes("OUTPUT"))) {
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
              height: Math.round(r.height),
            };
          }),
          wrapping: children.length >= 2 && children.some((c, i) => {
            if (i === 0) return false;
            return c.getBoundingClientRect().top > children[0].getBoundingClientRect().top + 5;
          }),
        };
      }
    }
    return null;
  });
}

async function analyzeTaintScroll(page) {
  return await page.evaluate(() => {
    // Find all overflow-x-auto containers
    const containers = document.querySelectorAll("[class*='overflow-x']");
    for (const el of containers) {
      if (el.scrollWidth > el.clientWidth + 10 && el.querySelector("svg")) {
        return {
          scrollLeft: Math.round(el.scrollLeft),
          scrollWidth: Math.round(el.scrollWidth),
          clientWidth: Math.round(el.clientWidth),
          maxScroll: Math.round(el.scrollWidth - el.clientWidth),
          scrollPercent: el.scrollWidth > el.clientWidth
            ? Math.round((el.scrollLeft / (el.scrollWidth - el.clientWidth)) * 100)
            : 0,
          centered: el.scrollLeft > 20,
        };
      }
    }
    // Check if any container has SVG but doesn't scroll
    for (const el of containers) {
      if (el.querySelector("svg")) {
        return {
          scrollLeft: 0,
          scrollWidth: Math.round(el.scrollWidth),
          clientWidth: Math.round(el.clientWidth),
          noScrollNeeded: true,
        };
      }
    }
    return "No taint flow scroll container found";
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // =======================================
  // 1. MOBILE 375x812 - Whirlpool (TxFlow header wrap test)
  // =======================================
  console.log("\n=== 1. MOBILE 375x812 - Whirlpool CoinJoin ===");
  const m1Ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
    deviceScaleFactor: 2,
  });
  const m1Page = await m1Ctx.newPage();
  await loadHashRoute(m1Page, WHIRLPOOL_TX, 40000);

  await m1Page.screenshot({ path: `${OUT}/01-mobile-whirlpool-full.png`, fullPage: true });
  console.log("01 - Mobile Whirlpool full page");

  // Scroll to TX Flow header
  await m1Page.evaluate(() => {
    const divs = document.querySelectorAll("div.flex.flex-wrap");
    for (const div of divs) {
      const text = div.textContent || "";
      if ((text.includes("input") || text.includes("INPUT")) && (text.includes("output") || text.includes("OUTPUT"))) {
        window.scrollTo(0, div.getBoundingClientRect().top + window.scrollY - 30);
        return;
      }
    }
  });
  await m1Page.waitForTimeout(800);
  await m1Page.screenshot({ path: `${OUT}/02-mobile-whirlpool-txflow.png`, fullPage: false });
  console.log("02 - Mobile Whirlpool TX Flow header");

  const m1Header = await analyzeTxFlowHeader(m1Page);
  console.log("\n--- MOBILE TX FLOW HEADER ---");
  console.log(JSON.stringify(m1Header, null, 2));

  // Scroll to Taint Flow
  const hasTaint = await m1Page.evaluate(() => {
    const all = document.querySelectorAll("h3, span, div");
    for (const el of all) {
      if (el.textContent?.toLowerCase().includes("taint flow") && el.textContent.length < 40) {
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 30);
        return true;
      }
    }
    return false;
  });
  if (hasTaint) {
    await m1Page.waitForTimeout(1200);
    await m1Page.screenshot({ path: `${OUT}/03-mobile-taintflow.png`, fullPage: false });
    console.log("03 - Mobile Taint Flow");
    const taintInfo = await analyzeTaintScroll(m1Page);
    console.log("  Taint scroll:", JSON.stringify(taintInfo, null, 2));
  } else {
    console.log("03 - SKIP: No Taint Flow on this TX");
  }

  await m1Ctx.close();

  // =======================================
  // 2. MOBILE 375x812 - Taproot TX (findings check)
  // =======================================
  console.log("\n=== 2. MOBILE 375x812 - Taproot TX ===");
  const m2Ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
    deviceScaleFactor: 2,
  });
  const m2Page = await m2Ctx.newPage();
  await loadHashRoute(m2Page, TAPROOT_TX);

  await m2Page.screenshot({ path: `${OUT}/04-mobile-taproot-full.png`, fullPage: true });
  console.log("04 - Mobile Taproot full page");

  // Scroll to findings
  await m2Page.evaluate(() => {
    const h2s = document.querySelectorAll("h2");
    for (const h of h2s) {
      if (h.textContent?.includes("Finding")) {
        window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 30);
        return;
      }
    }
  });
  await m2Page.waitForTimeout(600);
  await m2Page.screenshot({ path: `${OUT}/05-mobile-taproot-findings.png`, fullPage: false });
  console.log("05 - Mobile Taproot findings");

  // Check taint flow
  const hasTaint2 = await m2Page.evaluate(() => {
    const all = document.querySelectorAll("h3, span, div");
    for (const el of all) {
      if (el.textContent?.toLowerCase().includes("taint flow") && el.textContent.length < 40) {
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 30);
        return true;
      }
    }
    return false;
  });
  if (hasTaint2) {
    await m2Page.waitForTimeout(1200);
    await m2Page.screenshot({ path: `${OUT}/06-mobile-taproot-taintflow.png`, fullPage: false });
    console.log("06 - Mobile Taproot Taint Flow");
    const taint2 = await analyzeTaintScroll(m2Page);
    console.log("  Taint scroll:", JSON.stringify(taint2, null, 2));
  } else {
    console.log("06 - SKIP: No Taint Flow on Taproot TX");
  }

  await m2Ctx.close();

  // =======================================
  // 3. DESKTOP 1920x1080 - Taproot TX
  // =======================================
  console.log("\n=== 3. DESKTOP 1920x1080 - Taproot TX ===");
  const d1Ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  });
  const d1Page = await d1Ctx.newPage();
  await loadHashRoute(d1Page, TAPROOT_TX);

  await d1Page.screenshot({ path: `${OUT}/07-desktop-taproot-full.png`, fullPage: true });
  console.log("07 - Desktop Taproot full page");

  await d1Page.evaluate(() => window.scrollTo(0, 0));
  await d1Page.waitForTimeout(400);
  await d1Page.screenshot({ path: `${OUT}/08-desktop-taproot-top.png`, fullPage: false });
  console.log("08 - Desktop Taproot top viewport");

  const dLayout = await analyzeLayout(d1Page);
  console.log("\n--- DESKTOP LAYOUT ---");
  console.log(dLayout);

  // Scroll to findings
  await d1Page.evaluate(() => {
    const h2s = document.querySelectorAll("h2");
    for (const h of h2s) {
      if (h.textContent?.includes("Finding")) {
        window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 80);
        return;
      }
    }
  });
  await d1Page.waitForTimeout(500);
  await d1Page.screenshot({ path: `${OUT}/09-desktop-findings.png`, fullPage: false });
  console.log("09 - Desktop findings");

  // Expand additional findings tier
  await d1Page.evaluate(() => {
    const buttons = document.querySelectorAll('[aria-expanded="false"]');
    for (const btn of buttons) {
      const text = btn.textContent || "";
      if (text.includes("Additional") || text.includes("strengths")) {
        btn.click();
        return;
      }
    }
  });
  await d1Page.waitForTimeout(800);
  await d1Page.screenshot({ path: `${OUT}/10-desktop-expanded-tier.png`, fullPage: false });
  console.log("10 - Desktop expanded findings tier");

  // Expand one finding card to check single-col gap
  await d1Page.evaluate(() => {
    const cards = document.querySelectorAll('[aria-expanded="false"]');
    for (const card of cards) {
      const parent = card.closest("[class*='glass'], [class*='bg-severity']");
      if (parent) {
        card.click();
        return;
      }
    }
  });
  await d1Page.waitForTimeout(600);
  await d1Page.screenshot({ path: `${OUT}/11-desktop-card-expanded.png`, fullPage: false });
  console.log("11 - Desktop one card expanded (gap check)");

  // Taint flow
  const hasTaintD = await d1Page.evaluate(() => {
    const all = document.querySelectorAll("h3, span, div");
    for (const el of all) {
      if (el.textContent?.toLowerCase().includes("taint flow") && el.textContent.length < 40) {
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 60);
        return true;
      }
    }
    return false;
  });
  if (hasTaintD) {
    await d1Page.waitForTimeout(1200);
    await d1Page.screenshot({ path: `${OUT}/12-desktop-taintflow.png`, fullPage: false });
    console.log("12 - Desktop Taint Flow");
    const taintD = await analyzeTaintScroll(d1Page);
    console.log("  Desktop taint scroll:", JSON.stringify(taintD, null, 2));
  } else {
    console.log("12 - SKIP: No Taint Flow on desktop");
  }

  // TX Flow header on desktop
  await d1Page.evaluate(() => {
    const divs = document.querySelectorAll("div.flex.flex-wrap");
    for (const div of divs) {
      const text = div.textContent || "";
      if ((text.includes("input") || text.includes("INPUT")) && (text.includes("output") || text.includes("OUTPUT"))) {
        window.scrollTo(0, div.getBoundingClientRect().top + window.scrollY - 80);
        return;
      }
    }
  });
  await d1Page.waitForTimeout(500);
  await d1Page.screenshot({ path: `${OUT}/13-desktop-txflow-header.png`, fullPage: false });
  console.log("13 - Desktop TX Flow header");

  const dHeader = await analyzeTxFlowHeader(d1Page);
  console.log("  Desktop header:", JSON.stringify(dHeader, null, 2));

  await d1Ctx.close();

  // =======================================
  // 4. DESKTOP 1920x1080 - Whirlpool (5in/5out header + taint)
  // =======================================
  console.log("\n=== 4. DESKTOP 1920x1080 - Whirlpool ===");
  const d2Ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  });
  const d2Page = await d2Ctx.newPage();
  await loadHashRoute(d2Page, WHIRLPOOL_TX, 40000);

  await d2Page.screenshot({ path: `${OUT}/14-desktop-whirlpool-full.png`, fullPage: true });
  console.log("14 - Desktop Whirlpool full page");

  // Taint flow for Whirlpool
  const hasTaintW = await d2Page.evaluate(() => {
    const all = document.querySelectorAll("h3, span, div");
    for (const el of all) {
      if (el.textContent?.toLowerCase().includes("taint flow") && el.textContent.length < 40) {
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 60);
        return true;
      }
    }
    return false;
  });
  if (hasTaintW) {
    await d2Page.waitForTimeout(1500);
    await d2Page.screenshot({ path: `${OUT}/15-desktop-whirlpool-taintflow.png`, fullPage: false });
    console.log("15 - Desktop Whirlpool Taint Flow");
    const taintW = await analyzeTaintScroll(d2Page);
    console.log("  Whirlpool taint scroll:", JSON.stringify(taintW, null, 2));
  } else {
    console.log("15 - SKIP: No Taint Flow on Whirlpool");
  }

  await d2Ctx.close();

  // =======================================
  // 5. XL BREAKPOINT 1280x800 - Taproot
  // =======================================
  console.log("\n=== 5. XL BREAKPOINT 1280x800 ===");
  const xlCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
  });
  const xlPage = await xlCtx.newPage();
  await loadHashRoute(xlPage, TAPROOT_TX);

  await xlPage.screenshot({ path: `${OUT}/16-xl-fullpage.png`, fullPage: true });
  console.log("16 - XL full page");

  await xlPage.evaluate(() => window.scrollTo(0, 0));
  await xlPage.waitForTimeout(400);
  await xlPage.screenshot({ path: `${OUT}/17-xl-top.png`, fullPage: false });
  console.log("17 - XL top viewport");

  const xlLayout = await analyzeLayout(xlPage);
  console.log("\n--- XL LAYOUT ---");
  console.log(xlLayout);

  // Findings
  await xlPage.evaluate(() => {
    const h2s = document.querySelectorAll("h2");
    for (const h of h2s) {
      if (h.textContent?.includes("Finding")) {
        window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 60);
        return;
      }
    }
  });
  await xlPage.waitForTimeout(500);
  await xlPage.screenshot({ path: `${OUT}/18-xl-findings.png`, fullPage: false });
  console.log("18 - XL findings");

  await xlCtx.close();

  // =======================================
  // 6. ULTRAWIDE 2560x1440 (max-width check)
  // =======================================
  console.log("\n=== 6. ULTRAWIDE 2560x1440 ===");
  const uwCtx = await browser.newContext({
    viewport: { width: 2560, height: 1440 },
    colorScheme: "dark",
  });
  const uwPage = await uwCtx.newPage();
  await loadHashRoute(uwPage, TAPROOT_TX);

  await uwPage.screenshot({ path: `${OUT}/19-ultrawide-top.png`, fullPage: false });
  console.log("19 - Ultrawide top viewport");

  const uwLayout = await analyzeLayout(uwPage);
  console.log("\n--- ULTRAWIDE LAYOUT ---");
  console.log(uwLayout);

  await uwCtx.close();

  // =======================================
  // 7. TABLET 768x1024 - Whirlpool (header + taint)
  // =======================================
  console.log("\n=== 7. TABLET 768x1024 - Whirlpool ===");
  const tabCtx = await browser.newContext({
    viewport: { width: 768, height: 1024 },
    colorScheme: "dark",
  });
  const tabPage = await tabCtx.newPage();
  await loadHashRoute(tabPage, WHIRLPOOL_TX, 40000);

  // TX Flow header on tablet
  await tabPage.evaluate(() => {
    const divs = document.querySelectorAll("div.flex.flex-wrap");
    for (const div of divs) {
      const text = div.textContent || "";
      if ((text.includes("input") || text.includes("INPUT")) && (text.includes("output") || text.includes("OUTPUT"))) {
        window.scrollTo(0, div.getBoundingClientRect().top + window.scrollY - 40);
        return;
      }
    }
  });
  await tabPage.waitForTimeout(600);
  await tabPage.screenshot({ path: `${OUT}/20-tablet-txflow-header.png`, fullPage: false });
  console.log("20 - Tablet TX Flow header");

  const tabHeader = await analyzeTxFlowHeader(tabPage);
  console.log("  Tablet header:", JSON.stringify(tabHeader, null, 2));

  // Taint flow on tablet
  const hasTaintTab = await tabPage.evaluate(() => {
    const all = document.querySelectorAll("h3, span, div");
    for (const el of all) {
      if (el.textContent?.toLowerCase().includes("taint flow") && el.textContent.length < 40) {
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 30);
        return true;
      }
    }
    return false;
  });
  if (hasTaintTab) {
    await tabPage.waitForTimeout(1200);
    await tabPage.screenshot({ path: `${OUT}/21-tablet-taintflow.png`, fullPage: false });
    console.log("21 - Tablet Taint Flow");
    const taintTab = await analyzeTaintScroll(tabPage);
    console.log("  Tablet taint scroll:", JSON.stringify(taintTab, null, 2));
  } else {
    console.log("21 - SKIP: No Taint Flow on tablet");
  }

  await tabCtx.close();

  // =======================================
  // 8. MOBILE 375x812 - Stonewall (3in/4out, taint test)
  // =======================================
  console.log("\n=== 8. MOBILE 375x812 - Stonewall ===");
  const m3Ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
    deviceScaleFactor: 2,
  });
  const m3Page = await m3Ctx.newPage();
  await loadHashRoute(m3Page, STONEWALL_TX);

  await m3Page.screenshot({ path: `${OUT}/22-mobile-stonewall-full.png`, fullPage: true });
  console.log("22 - Mobile Stonewall full page");

  // TX Flow header
  await m3Page.evaluate(() => {
    const divs = document.querySelectorAll("div.flex.flex-wrap");
    for (const div of divs) {
      const text = div.textContent || "";
      if ((text.includes("input") || text.includes("INPUT")) && (text.includes("output") || text.includes("OUTPUT"))) {
        window.scrollTo(0, div.getBoundingClientRect().top + window.scrollY - 20);
        return;
      }
    }
  });
  await m3Page.waitForTimeout(600);
  await m3Page.screenshot({ path: `${OUT}/23-mobile-stonewall-txflow.png`, fullPage: false });
  console.log("23 - Mobile Stonewall TX Flow header");

  const m3Header = await analyzeTxFlowHeader(m3Page);
  console.log("  Stonewall mobile header:", JSON.stringify(m3Header, null, 2));

  // Taint flow for Stonewall
  const hasTaintS = await m3Page.evaluate(() => {
    const all = document.querySelectorAll("h3, span, div");
    for (const el of all) {
      if (el.textContent?.toLowerCase().includes("taint flow") && el.textContent.length < 40) {
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 30);
        return true;
      }
    }
    return false;
  });
  if (hasTaintS) {
    await m3Page.waitForTimeout(1200);
    await m3Page.screenshot({ path: `${OUT}/24-mobile-stonewall-taintflow.png`, fullPage: false });
    console.log("24 - Mobile Stonewall Taint Flow");
    const taintS = await analyzeTaintScroll(m3Page);
    console.log("  Stonewall taint scroll:", JSON.stringify(taintS, null, 2));
  } else {
    console.log("24 - SKIP: No Taint Flow on Stonewall");
  }

  await m3Ctx.close();

  await browser.close();
  console.log("\n=== ALL SCREENSHOTS CAPTURED ===");
}

main().catch(console.error);
