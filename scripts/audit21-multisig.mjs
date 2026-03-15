import { createRequire } from "module";
const require = createRequire(
  "/home/user/.npm/_npx/705bc6b22212b352/node_modules/"
);
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
// Bare multisig: 3 inputs, 3 outputs - NOT a CoinJoin, uses TxFlowDiagram
const MULTISIG_TX = "60a20bd93aa49ab4b28d514ec10b06e1829ce6818ec06cd3aabd013ebcdc4bb1";
// Taproot script-path spend: 2 inputs, 1 output
const TAPROOT_SCRIPT_TX = "37777defed8717c581b4c0509329550e344bdc14ac38f71fc050096887e535c8";
const OUT = "screenshots/audit21";

async function scanViaInput(page, txid) {
  const input = await page.$('input[type="text"], input[placeholder*="address"], input[placeholder*="Bitcoin"]');
  if (input) {
    await input.fill(txid);
    await page.waitForTimeout(300);
    const scanBtn = await page.$('button:has-text("Scan")');
    if (scanBtn) await scanBtn.click();
  }

  try {
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes("Privacy Score") || text.includes("/100") || /Grade:\s*[A-F]/.test(text) || text.includes("Analysis failed");
      },
      { timeout: 45000 }
    );
    await page.waitForTimeout(5000);
    console.log("  Analysis complete");
  } catch {
    console.log("  Analysis timed out");
    await page.waitForTimeout(3000);
  }
}

async function getTxFlowHeader(page) {
  return await page.evaluate(() => {
    // Try multiple class matching approaches
    const divs = document.querySelectorAll("div");
    for (const div of divs) {
      const cls = typeof div.className === "string" ? div.className : (div.className?.toString?.() || "");
      const text = div.textContent || "";

      // Match "flex" and "wrap" in any form
      const hasFlex = cls.includes("flex");
      const hasWrap = cls.includes("wrap");

      if (hasFlex && hasWrap &&
          (text.toLowerCase().includes("input")) &&
          (text.toLowerCase().includes("output")) &&
          (text.toLowerCase().includes("transaction flow") || text.toLowerCase().includes("linkability"))) {

        const rect = div.getBoundingClientRect();
        window.scrollTo(0, rect.top + window.scrollY - 20);
        const children = Array.from(div.children);
        return {
          found: true,
          type: "TxFlowDiagram",
          containerWidth: Math.round(rect.width),
          containerHeight: Math.round(rect.height),
          childCount: children.length,
          children: children.map(c => {
            const r = c.getBoundingClientRect();
            return {
              text: c.textContent?.trim().slice(0, 60),
              tag: c.tagName,
              left: Math.round(r.left),
              top: Math.round(r.top),
              width: Math.round(r.width),
              height: Math.round(r.height),
              classes: (typeof c.className === "string" ? c.className : "").slice(0, 80),
            };
          }),
          wrapping: (() => {
            if (children.length < 2) return false;
            const tops = children.map(c => Math.round(c.getBoundingClientRect().top));
            return new Set(tops).size > 1;
          })(),
        };
      }

      // Also check for CoinJoin structure header
      if (hasFlex && hasWrap &&
          (text.toLowerCase().includes("input")) &&
          (text.toLowerCase().includes("output")) &&
          text.toLowerCase().includes("coinjoin")) {

        const rect = div.getBoundingClientRect();
        window.scrollTo(0, rect.top + window.scrollY - 20);
        const children = Array.from(div.children);
        return {
          found: true,
          type: "CoinJoinStructure",
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
          wrapping: (() => {
            if (children.length < 2) return false;
            const tops = children.map(c => Math.round(c.getBoundingClientRect().top));
            return new Set(tops).size > 1;
          })(),
        };
      }
    }

    // Broadest search: any flex container with input/output text
    for (const div of divs) {
      const text = div.textContent || "";
      if (!text.toLowerCase().includes("input") || !text.toLowerCase().includes("output")) continue;
      if (!text.toLowerCase().includes("transaction flow") && !text.toLowerCase().includes("coinjoin")) continue;

      const cls = typeof div.className === "string" ? div.className : "";
      const rect = div.getBoundingClientRect();
      if (rect.height > 0 && rect.height < 100) {
        const children = Array.from(div.children);
        return {
          found: true,
          type: "generic",
          classes: cls.slice(0, 120),
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
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ===== 1. MOBILE - Multisig (3in/3out, TxFlowDiagram) =====
  console.log("\n=== MOBILE 375x812 - Multisig (3in/3out) ===");
  const m1Ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
    deviceScaleFactor: 2,
  });
  const m1Page = await m1Ctx.newPage();
  await m1Page.goto(BASE, { waitUntil: "domcontentloaded" });
  await m1Page.waitForTimeout(1000);
  await scanViaInput(m1Page, MULTISIG_TX);

  await m1Page.screenshot({ path: `${OUT}/50-mobile-multisig-full.png`, fullPage: true });
  console.log("50 - Mobile Multisig full page");

  const m1Header = await getTxFlowHeader(m1Page);
  console.log("\n--- MOBILE MULTISIG HEADER ---");
  console.log(JSON.stringify(m1Header, null, 2));

  await m1Page.waitForTimeout(600);
  await m1Page.screenshot({ path: `${OUT}/51-mobile-multisig-txflow.png`, fullPage: false });
  console.log("51 - Mobile Multisig TX Flow header");

  await m1Ctx.close();

  // ===== 2. DESKTOP - Multisig =====
  console.log("\n=== DESKTOP 1920x1080 - Multisig ===");
  const d1Ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  });
  const d1Page = await d1Ctx.newPage();
  await d1Page.goto(BASE, { waitUntil: "domcontentloaded" });
  await d1Page.waitForTimeout(1000);
  await scanViaInput(d1Page, MULTISIG_TX);

  await d1Page.screenshot({ path: `${OUT}/52-desktop-multisig-full.png`, fullPage: true });
  console.log("52 - Desktop Multisig full page");

  const d1Header = await getTxFlowHeader(d1Page);
  console.log("  Desktop header:", JSON.stringify(d1Header, null, 2));

  await d1Page.waitForTimeout(600);
  await d1Page.screenshot({ path: `${OUT}/53-desktop-multisig-txflow.png`, fullPage: false });
  console.log("53 - Desktop Multisig TX Flow header");

  await d1Ctx.close();

  // ===== 3. MOBILE - Taproot script-path (2in/1out) =====
  console.log("\n=== MOBILE 375x812 - Taproot Script Path (2in/1out) ===");
  const m2Ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
    deviceScaleFactor: 2,
  });
  const m2Page = await m2Ctx.newPage();
  await m2Page.goto(BASE, { waitUntil: "domcontentloaded" });
  await m2Page.waitForTimeout(1000);
  await scanViaInput(m2Page, TAPROOT_SCRIPT_TX);

  await m2Page.screenshot({ path: `${OUT}/54-mobile-taproot-script-full.png`, fullPage: true });
  console.log("54 - Mobile Taproot Script Path full page");

  const m2Header = await getTxFlowHeader(m2Page);
  console.log("\n--- MOBILE TAPROOT-SCRIPT HEADER ---");
  console.log(JSON.stringify(m2Header, null, 2));

  await m2Page.waitForTimeout(600);
  await m2Page.screenshot({ path: `${OUT}/55-mobile-taproot-script-txflow.png`, fullPage: false });
  console.log("55 - Mobile Taproot Script Path TX Flow");

  // Taint flow
  const hasTaint = await m2Page.evaluate(() => {
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
    await m2Page.waitForTimeout(1200);
    await m2Page.screenshot({ path: `${OUT}/56-mobile-taproot-script-taintflow.png`, fullPage: false });
    console.log("56 - Mobile Taproot Script Taint Flow");

    const taintScroll = await m2Page.evaluate(() => {
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
  } else {
    console.log("56 - SKIP: No Taint Flow");
  }

  await m2Ctx.close();
  await browser.close();
  console.log("\n=== ALL CAPTURES COMPLETE ===");
}

main().catch(console.error);
