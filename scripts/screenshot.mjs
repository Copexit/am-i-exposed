import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "dark",
  });

  // Screenshot 1: Landing page
  const page1 = await ctx.newPage();
  await page1.goto(BASE, { waitUntil: "networkidle" });
  await page1.waitForTimeout(500);
  await page1.screenshot({ path: "screenshots/landing.png", fullPage: false });
  console.log("Saved: screenshots/landing.png");

  // Screenshot 2: Analysis results for Whirlpool CoinJoin
  const page2 = await ctx.newPage();
  await page2.goto(
    `${BASE}/#tx=323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2`,
    { waitUntil: "networkidle" },
  );
  // Wait for analysis to complete
  await page2.waitForTimeout(8000);
  await page2.screenshot({ path: "screenshots/whirlpool-result.png", fullPage: true });
  console.log("Saved: screenshots/whirlpool-result.png");

  // Screenshot 3: OP_RETURN tx
  const page3 = await ctx.newPage();
  await page3.goto(
    `${BASE}/#tx=8bae12b5f4c088d940733dcd1455efc6a3a69cf9340e17a981286d3778615684`,
    { waitUntil: "networkidle" },
  );
  await page3.waitForTimeout(8000);
  await page3.screenshot({ path: "screenshots/opreturn-result.png", fullPage: true });
  console.log("Saved: screenshots/opreturn-result.png");

  // Screenshot 4: Mobile view
  const mobile = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
  });
  const page4 = await mobile.newPage();
  await page4.goto(BASE, { waitUntil: "networkidle" });
  await page4.waitForTimeout(500);
  await page4.screenshot({ path: "screenshots/mobile-landing.png", fullPage: false });
  console.log("Saved: screenshots/mobile-landing.png");

  await browser.close();
}

main().catch(console.error);
