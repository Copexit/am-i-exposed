import { createRequire } from 'node:module';
const require = createRequire('/home/user/.npm/_npx/705bc6b22212b352/node_modules/');
const { chromium } = require('playwright');

const URL = 'http://localhost:3000/#xpub=zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const OUT_DIR = '/home/user/am-i-exposed/screenshots';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  console.log('Navigating to wallet scan URL...');
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Dismiss the privacy warning dialog
  const proceedButton = await page.$('button:has-text("I understand the risk, proceed")');
  if (proceedButton) {
    console.log('Dismissing privacy warning...');
    await proceedButton.click();
    await page.waitForTimeout(2000);
  }

  // Wait for the scan to complete with extended timeout
  console.log('Waiting for wallet scan to complete (extended timeout: 8 minutes)...');

  let completed = false;
  const maxWait = 480000; // 8 minutes
  const startTime = Date.now();

  while (!completed && (Date.now() - startTime) < maxWait) {
    const status = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasLoading = /Fetching|Tracing|Analyzing|Scanning wallet|Deriving addresses|Loading transaction|Running heuristic/i.test(text);
      const hasWalletResults = /addresses?\s*(scanned|analyzed|found|with activity)/i.test(text) ||
                               /transactions?\s*(found|analyzed)/i.test(text) ||
                               /Overall|Grade|Score.*\d+/i.test(text);
      // Check for the "Scanning. Please wait." banner disappearing
      const stillScanning = /Scanning\.\s*Please wait/i.test(text);
      // Check for wallet results sections
      const hasResultSections = /Address Details|Transaction History|Privacy Score|Wallet Privacy|Coin Selection/i.test(text);

      return {
        hasLoading,
        hasWalletResults,
        stillScanning,
        hasResultSections,
        snippet: text.substring(0, 400)
      };
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (!status.stillScanning && !status.hasLoading && status.hasResultSections) {
      completed = true;
      console.log(`[${elapsed}s] Scan complete! Results visible.`);
    } else if (!status.stillScanning && status.hasWalletResults) {
      completed = true;
      console.log(`[${elapsed}s] Scan complete (wallet results detected).`);
    } else {
      if (elapsed % 30 === 0) {
        console.log(`[${elapsed}s] Still scanning... ${status.snippet.substring(0, 200)}`);
      }
      await page.waitForTimeout(5000);
    }
  }

  if (!completed) {
    console.log('TIMEOUT: Scan did not complete in 8 minutes.');
    await page.screenshot({ path: `${OUT_DIR}/wallet-timeout.png`, fullPage: true });
    await browser.close();
    process.exit(1);
  }

  // Extra settle time for animations
  await page.waitForTimeout(4000);

  // Screenshot 1: Top of page
  console.log('Taking screenshots...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/wallet-top.png`, fullPage: false });

  // Screenshot 2: Full page
  await page.screenshot({ path: `${OUT_DIR}/wallet-full.png`, fullPage: true });

  // Find all section headers
  const sections = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('button, [role="button"], summary, h2, h3, h4, details > summary'));
    return elements
      .filter(el => {
        const text = (el.textContent || '').toLowerCase();
        return text.includes('graph') || text.includes('address') || text.includes('transaction') ||
               text.includes('coin selection') || text.includes('chain analysis') || text.includes('finding') ||
               text.includes('utxo') || text.includes('score') || text.includes('privacy');
      })
      .map(el => ({
        tag: el.tagName,
        text: (el.textContent || '').trim().substring(0, 120),
        y: Math.round(el.getBoundingClientRect().y + window.scrollY),
        h: el.getBoundingClientRect().height,
        visible: el.getBoundingClientRect().height > 0,
      }));
  });
  console.log('Section headers found:', JSON.stringify(sections, null, 2));

  // Scroll down to show all section headers
  if (sections.length > 0) {
    // Find the first visible section header
    const firstVisible = sections.find(s => s.visible && s.h > 10);
    if (firstVisible) {
      await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 100)), firstVisible.y);
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${OUT_DIR}/wallet-sections.png`, fullPage: false });
    }
  }

  // Try to click Transaction Graph
  console.log('Looking for Transaction Graph...');
  let graphFound = false;

  // Try exact text matches
  for (const text of ['Transaction Graph', 'Graph Explorer', 'Graph']) {
    try {
      const btn = await page.locator(`button:has-text("${text}")`).first();
      if (await btn.count() > 0 && await btn.isVisible()) {
        console.log(`Found "${text}" button, clicking...`);
        await btn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await btn.click();
        graphFound = true;

        console.log('Waiting for graph to render...');
        await page.waitForTimeout(6000);
        await page.screenshot({ path: `${OUT_DIR}/wallet-graph.png`, fullPage: false });
        await page.screenshot({ path: `${OUT_DIR}/wallet-graph-full.png`, fullPage: true });
        break;
      }
    } catch (e) {
      // continue
    }
  }

  if (!graphFound) {
    // Also try details/summary elements
    const details = await page.$$('details');
    for (const detail of details) {
      const summary = await detail.$('summary');
      if (summary) {
        const text = await summary.textContent();
        if (text && /graph/i.test(text)) {
          console.log(`Found graph in <details>: "${text.trim().substring(0, 80)}"`);
          await summary.scrollIntoViewIfNeeded();
          await summary.click();
          graphFound = true;
          await page.waitForTimeout(6000);
          await page.screenshot({ path: `${OUT_DIR}/wallet-graph.png`, fullPage: false });
          break;
        }
      }
    }
  }

  if (!graphFound) {
    console.log('No Transaction Graph section found.');
    // List all interactive elements for debugging
    const allElements = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, summary, h2, h3, h4, [role="button"]'))
        .filter(el => el.getBoundingClientRect().height > 0)
        .map(el => `${el.tagName}(${el.className?.substring(0,30)}): "${(el.textContent || '').trim().substring(0, 100)}"`)
        .join('\n');
    });
    console.log('All visible interactive elements:\n', allElements);
  }

  // Capture page text
  const pageContent = await page.evaluate(() => document.body.innerText);
  console.log('\n--- FULL PAGE TEXT ---');
  console.log(pageContent.substring(0, 6000));

  await browser.close();
  console.log('\nDone!');
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
