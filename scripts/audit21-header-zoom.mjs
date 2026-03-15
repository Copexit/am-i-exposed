import { createRequire } from "module";
const require = createRequire(
  "/home/user/.npm/_npx/705bc6b22212b352/node_modules/"
);
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
const MULTISIG_TX = "60a20bd93aa49ab4b28d514ec10b06e1829ce6818ec06cd3aabd013ebcdc4bb1";
const OUT = "screenshots/audit21";

async function main() {
  const browser = await chromium.launch({ headless: true });

  // Mobile - zoom to header area
  console.log("=== MOBILE HEADER ZOOM ===");
  const mCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
    deviceScaleFactor: 3, // Higher DPI for detail
  });
  const mPage = await mCtx.newPage();
  await mPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await mPage.waitForTimeout(1000);

  // Scan
  const input = await mPage.$('input[type="text"]');
  if (input) {
    await input.fill(MULTISIG_TX);
    await mPage.waitForTimeout(300);
    const btn = await mPage.$('button:has-text("Scan")');
    if (btn) await btn.click();
  }

  try {
    await mPage.waitForFunction(() => {
      const t = document.body.innerText;
      return t.includes("Privacy Score") || t.includes("/100") || /Grade:\s*[A-F]/.test(t);
    }, { timeout: 45000 });
    await mPage.waitForTimeout(5000);
  } catch {
    await mPage.waitForTimeout(3000);
  }

  // Scroll so the header row is at the very top of the viewport
  await mPage.evaluate(() => {
    const divs = document.querySelectorAll("div");
    for (const div of divs) {
      const cls = typeof div.className === "string" ? div.className : "";
      if (!cls.includes("flex") || !cls.includes("wrap")) continue;
      const text = div.textContent || "";
      if (text.toLowerCase().includes("input") && text.toLowerCase().includes("output") && text.toLowerCase().includes("transaction flow")) {
        // Scroll so the header is near the top with a bit of padding
        const rect = div.getBoundingClientRect();
        window.scrollTo(0, rect.top + window.scrollY - 10);
        return;
      }
    }
  });
  await mPage.waitForTimeout(500);

  // Take a clip of just the header area (top 120px of viewport)
  await mPage.screenshot({
    path: `${OUT}/60-mobile-header-zoom.png`,
    fullPage: false,
    clip: { x: 0, y: 0, width: 375, height: 120 },
  });
  console.log("60 - Mobile header zoom (clipped)");

  // Also take the full viewport for context
  await mPage.screenshot({ path: `${OUT}/61-mobile-header-viewport.png`, fullPage: false });
  console.log("61 - Mobile header viewport");

  // Check the grammar issue: "1 outputs" for singular
  const grammarCheck = await mPage.evaluate(() => {
    const spans = document.querySelectorAll("span");
    const results = [];
    for (const s of spans) {
      const t = s.textContent?.trim() || "";
      if (t.match(/\d+\s+(input|output)/i)) {
        results.push(t);
      }
    }
    return results;
  });
  console.log("  Grammar check (input/output labels):", grammarCheck);

  await mCtx.close();

  // Desktop - zoom to header
  console.log("\n=== DESKTOP HEADER ZOOM ===");
  const dCtx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  });
  const dPage = await dCtx.newPage();
  await dPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await dPage.waitForTimeout(1000);

  const dInput = await dPage.$('input[type="text"]');
  if (dInput) {
    await dInput.fill(MULTISIG_TX);
    await dPage.waitForTimeout(300);
    const dBtn = await dPage.$('button:has-text("Scan")');
    if (dBtn) await dBtn.click();
  }

  try {
    await dPage.waitForFunction(() => {
      const t = document.body.innerText;
      return t.includes("Privacy Score") || t.includes("/100") || /Grade:\s*[A-F]/.test(t);
    }, { timeout: 45000 });
    await dPage.waitForTimeout(5000);
  } catch {
    await dPage.waitForTimeout(3000);
  }

  // Scroll to TX Flow header
  await dPage.evaluate(() => {
    const divs = document.querySelectorAll("div");
    for (const div of divs) {
      const cls = typeof div.className === "string" ? div.className : "";
      if (!cls.includes("flex") || !cls.includes("wrap")) continue;
      const text = div.textContent || "";
      if (text.toLowerCase().includes("input") && text.toLowerCase().includes("output") && text.toLowerCase().includes("transaction flow")) {
        window.scrollTo(0, div.getBoundingClientRect().top + window.scrollY - 10);
        return;
      }
    }
  });
  await dPage.waitForTimeout(500);

  await dPage.screenshot({
    path: `${OUT}/62-desktop-header-zoom.png`,
    fullPage: false,
    clip: { x: 0, y: 0, width: 1920, height: 80 },
  });
  console.log("62 - Desktop header zoom (clipped)");

  await dCtx.close();
  await browser.close();
  console.log("\n=== HEADER ZOOM CAPTURES COMPLETE ===");
}

main().catch(console.error);
