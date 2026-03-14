import { createRequire } from "node:module";
const require = createRequire("/home/user/.npm/_npx/705bc6b22212b352/node_modules/");
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
const XPUB_HASH = "#xpub=zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });

  const page = await ctx.newPage();
  console.log("Navigating to wallet scan...");
  await page.goto(`${BASE}/${XPUB_HASH}`, { waitUntil: "networkidle" });

  // Poll for completion - look for grade display or score
  // The scan can take ~2 minutes. We poll every 5 seconds for up to 4 minutes.
  const maxWait = 240_000; // 4 minutes
  const pollInterval = 5_000;
  let elapsed = 0;

  while (elapsed < maxWait) {
    await page.waitForTimeout(pollInterval);
    elapsed += pollInterval;

    // Check if grade is visible (A+, A, B, C, D, F)
    const gradeVisible = await page.evaluate(() => {
      const body = document.body.innerText;
      // Look for grade letters that appear in results
      const hasGrade = /Privacy Grade[:\s]*(A\+|[A-F])/i.test(body) ||
                       /Grade[:\s]*(A\+|[A-F])/i.test(body) ||
                       /score/i.test(body);
      // Also check if loading indicators are gone
      const isLoading = /Fetching transaction history/i.test(body) ||
                        /Tracing UTXO/i.test(body) ||
                        /Analyzing transactions/i.test(body) ||
                        /Deriving addresses/i.test(body) ||
                        /Scanning wallet/i.test(body);
      return { hasGrade, isLoading, snippet: body.substring(0, 500) };
    });

    console.log(`[${elapsed / 1000}s] Grade: ${gradeVisible.hasGrade}, Loading: ${gradeVisible.isLoading}`);
    console.log(`  Snippet: ${gradeVisible.snippet.substring(0, 200)}`);

    if (gradeVisible.hasGrade && !gradeVisible.isLoading) {
      console.log("Scan complete! Taking screenshots...");
      break;
    }
  }

  // Extra settle time
  await page.waitForTimeout(2000);

  // Screenshot 1: Top section with grade and stats (viewport only)
  await page.screenshot({ path: "screenshots/wallet-top.png", fullPage: false });
  console.log("Saved: screenshots/wallet-top.png");

  // Screenshot 2: Full page to see all sections
  await page.screenshot({ path: "screenshots/wallet-full.png", fullPage: true });
  console.log("Saved: screenshots/wallet-full.png");

  // Screenshot 3: Scroll to see section headers
  // Scroll down past the grade section to see collapsible sections
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(500);
  await page.screenshot({ path: "screenshots/wallet-sections-1.png", fullPage: false });
  console.log("Saved: screenshots/wallet-sections-1.png");

  await page.evaluate(() => window.scrollTo(0, 1600));
  await page.waitForTimeout(500);
  await page.screenshot({ path: "screenshots/wallet-sections-2.png", fullPage: false });
  console.log("Saved: screenshots/wallet-sections-2.png");

  await page.evaluate(() => window.scrollTo(0, 2400));
  await page.waitForTimeout(500);
  await page.screenshot({ path: "screenshots/wallet-sections-3.png", fullPage: false });
  console.log("Saved: screenshots/wallet-sections-3.png");

  // Look for "Transaction Graph" button/section and click it
  const graphButton = await page.$('button:has-text("Transaction Graph"), [data-testid="graph-section"], summary:has-text("Transaction Graph"), div:has-text("Transaction Graph") >> button');
  if (graphButton) {
    console.log("Found Transaction Graph button, clicking...");
    await graphButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await graphButton.click();
    await page.waitForTimeout(3000); // Wait for graph to load
    await page.screenshot({ path: "screenshots/wallet-graph.png", fullPage: false });
    console.log("Saved: screenshots/wallet-graph.png");
  } else {
    console.log("No Transaction Graph button found. Searching page text...");
    const pageText = await page.evaluate(() => document.body.innerText);
    const hasGraphText = pageText.includes("Transaction Graph");
    console.log(`Page contains 'Transaction Graph' text: ${hasGraphText}`);

    // Try alternative selectors
    const buttons = await page.$$eval('button', btns => btns.map(b => b.textContent?.trim()).filter(Boolean));
    console.log("All buttons on page:", buttons.join(" | "));
  }

  await browser.close();
  console.log("Done!");
}

main().catch(console.error);
